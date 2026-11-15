#!/usr/bin/env node
// Dibs TV streamer: hosts a Dibs room "on the TV" for a Roku.
//
// A Roku can't run the dibsgames.com web app (no browser engine, no WebSockets), but it plays live video.
// Dibs's /tv screen never takes input (everyone plays on their phones), so this renders it in headless
// Chrome and streams it as HLS. The Roku picks a game, calls POST /start?game=..., then plays /live/index.m3u8.
//
//   node streamer.mjs                 # listens on :8790 (all interfaces, so the TV can reach it)
//   PORT=8790 DIBS_URL=https://dibsgames.com node streamer.mjs
//
// API:  GET /status   POST /start?game=<punchline|imposter|tee-party|brawl|piggyback|pirates>   POST /stop
//       POST /launch?app=<roku channel id>  opens another app on the TV that asked (Roku won't let a channel
//       launch apps itself, but accepts ECP "launch" from another device on the LAN, even in Limited mode)
//       GET /live/index.m3u8 (+ segments)    GET /frame.jpg (latest frame, for debugging)
//       GET /diag (health: capture rate, how far the stream is behind real time, GPU)   GET /log
//       POST /update  re-downloads this file from GitHub and restarts (launchd brings it back up)
import http from "node:http";
import dgram from "node:dgram";
import fs from "node:fs";
import os from "node:os";
import path from "node:path";
import { spawn } from "node:child_process";
import { fileURLToPath } from "node:url";
import puppeteer from "puppeteer-core";

const PORT = Number(process.env.PORT || 8790);
const DIBS = (process.env.DIBS_URL || "https://dibsgames.com").replace(/\/$/, "");
const firstExisting = (...paths) => paths.find((p) => p && fs.existsSync(p));
const CHROME = process.env.CHROME_PATH || firstExisting(
  "/Applications/Google Chrome.app/Contents/MacOS/Google Chrome",
  "/Applications/Chromium.app/Contents/MacOS/Chromium",
  "/Applications/Brave Browser.app/Contents/MacOS/Brave Browser",
  "/usr/bin/chromium", "/usr/bin/chromium-browser", "/usr/bin/google-chrome",
);
const FFMPEG = process.env.FFMPEG_PATH || firstExisting("/opt/homebrew/bin/ffmpeg", "/usr/local/bin/ffmpeg", "/usr/bin/ffmpeg") || "ffmpeg";
// TVs find the streamer on the LAN by sending an SSDP M-SEARCH for this service type.
const SSDP_ST = "urn:tonyxin-com:service:dibs-tv-streamer:1";
const FPS = Number(process.env.FPS || 24);
// Video bitrate (kbit/s). Both the streamer Mac and the TV are often on Wi-Fi, where ~3 Mbps of fast 3D
// motion stalls the TV; Dibs's flat cartoon art still looks clean at this rate.
const KBPS = Number(process.env.KBPS || 1600);
// Encoders left behind by an earlier run (crash, reinstall) write into an old dibs-live-* folder; stop them.
try {
  const orphans = (await new Promise((resolve) => {
    let out = "";
    const ps = spawn("/bin/ps", ["-Ao", "pid=,args="]);
    ps.stdout.on("data", (b) => (out += b));
    ps.on("close", () => resolve(out));
    ps.on("error", () => resolve(""));
  })).split("\n").filter((l) => /ffmpeg/.test(l) && /dibs-live-/.test(l)).map((l) => Number(l.trim().split(/\s+/)[0]));
  for (const pid of orphans) { try { process.kill(pid, "SIGKILL"); } catch {} }
  if (orphans.length) console.log(`stopped ${orphans.length} leftover encoder(s)`);
} catch {}
const LIVE = fs.mkdtempSync(path.join(os.tmpdir(), "dibs-live-"));
const VERSION = "2026-11-14.7";
// Stream size. The page still renders at 1920x1080 (the TV layout Dibs expects); the capture is scaled down.
// 720p is plenty for Dibs's big type and halves the work per frame on a busy Mac. OUT=1080 for full HD.
const OUT_H = Number(process.env.OUT || 720);
const OUT_W = Math.round((OUT_H * 16) / 9);
const RAW = "https://raw.githubusercontent.com/ttonyxx/sites/main/tv-window/tools/streamer";

// Game ids on the Roku side -> the name on the /tv hub's game cards.
const GAMES = {
  punchline: "Punchline",
  imposter: "Imposter",
  "tee-party": "Tee Party",
  brawl: "Blob Brawl",
  piggyback: "Piggyback",
  pirates: "Pirates",
};

let browser = null;
let session = null; // { page, cdp, ffmpeg, timer, frame, game, code, startedAt }
let lastHit = 0; // last time a TV fetched the stream

// The TV fetches the stream while it's on screen and polls /status while the room is parked, so phones can
// keep playing while Window is away. With no TV contact for 15 minutes (TV off, another app), stop.
const IDLE_MS = Number(process.env.IDLE_MINUTES || 15) * 60000;
setInterval(() => {
  if (session && Date.now() - session.startedAt > 60000 && Date.now() - lastHit > IDLE_MS) {
    log(`no TV contact for ${IDLE_MS / 60000} min, stopping`);
    stop();
  }
}, 10000);

const LOG = [];
const DELIVERIES = [];
const log = (...a) => {
  const line = [new Date().toISOString().slice(11, 19), ...a].join(" ");
  console.log(line);
  LOG.push(line);
  if (LOG.length > 300) LOG.shift();
};

async function getBrowser() {
  if (browser?.connected) return browser;
  browser = await puppeteer.launch({
    executablePath: CHROME,
    headless: true,
    defaultViewport: { width: 1920, height: 1080, deviceScaleFactor: 1 },
    args: ["--autoplay-policy=no-user-gesture-required", "--enable-gpu-rasterization", "--ignore-gpu-blocklist", "--use-angle=metal", "--disable-background-timer-throttling", "--disable-renderer-backgrounding", "--disable-backgrounding-occluded-windows"],
  });
  return browser;
}

// A page already sitting on the /tv hub, so starting a room is just a click (refreshed every 30 min).
let warm = null;
let warmAt = 0;
async function openHub() {
  const b = await getBrowser();
  const page = await b.newPage();
  page.on("pageerror", (e) => log("page error:", e.message));
  await page.goto(`${DIBS}/tv`, { waitUntil: "domcontentloaded", timeout: 30000 });
  await page.waitForFunction((names) => names.every((n) => document.body.innerText.includes(n)), { timeout: 20000 }, Object.values(GAMES));
  return page;
}
async function prewarm() {
  if (session) return;
  try {
    if (warm && !warm.isClosed() && Date.now() - warmAt < 30 * 60000) return;
    try { await warm?.close(); } catch {}
    warm = null;
    warm = await openHub();
    warmAt = Date.now();
    log("hub preloaded");
  } catch (e) {
    warm = null;
    log("preload failed:", e.message);
  }
}
async function takeHub() {
  const p = warm;
  warm = null;
  if (p && !p.isClosed() && Date.now() - warmAt < 30 * 60000) return p;
  try { await p?.close(); } catch {}
  return openHub();
}
setInterval(prewarm, 5 * 60000);
setTimeout(prewarm, 1000);

function clearLive() {
  for (const f of fs.readdirSync(LIVE)) fs.rmSync(path.join(LIVE, f), { force: true });
}

async function stop() {
  const s = session;
  session = null;
  if (!s) return;
  clearInterval(s.timer);
  try { s.awake?.kill(); } catch {}
  try { s.ffmpeg.stdin.end(); } catch {}
  setTimeout(() => s.ffmpeg.kill("SIGKILL"), 2000);
  try { await s.cdp.send("Page.stopScreencast"); } catch {}
  try { await s.page.close(); } catch {}
  log("stopped", s.game, s.code || "");
  setTimeout(prewarm, 1500);
}

async function start(gameId) {
  const label = GAMES[gameId];
  if (!label) throw new Error(`unknown game "${gameId}"`);
  await stop();
  clearLive();

  const page = await takeHub();

  // Pick the game on the hub the way a person would: click the card that names it.
  const clicked = await page.evaluate((name) => {
    const els = [...document.querySelectorAll("button, a, [role=button]")];
    const el = els.find((e) => e.textContent && e.textContent.trim().toLowerCase().startsWith(name.toLowerCase()))
      || els.find((e) => e.textContent && e.textContent.toLowerCase().includes(name.toLowerCase()));
    if (!el) return false;
    el.click();
    return true;
  }, label);
  if (!clicked) throw new Error(`couldn't find "${label}" on ${DIBS}/tv`);
  await page.waitForFunction(() => /^\/tv\/[^/]+\/[A-Z]{6}$/.test(location.pathname), { timeout: 20000 });
  const code = page.url().split("/").pop();
  log("hosting", label, "room", code);

  // Video: screencast JPEG frames -> ffmpeg at a fixed rate -> H.264 HLS with 1 s segments. The writer below
  // keeps the frame count locked to the wall clock, so a busy machine can't make the stream play slower than
  // real time (which starves the TV's buffer and shows black). A silent audio track keeps every player happy.
  const ffmpeg = spawn(FFMPEG, [
    "-hide_banner", "-loglevel", "error",
    "-f", "image2pipe", "-framerate", String(FPS), "-i", "-",
    "-f", "lavfi", "-i", "anullsrc=r=48000:cl=stereo",
    "-map", "0:v", "-map", "1:a",
    "-c:v", "libx264", "-preset", "veryfast", "-profile:v", "main", "-pix_fmt", "yuv420p",
    "-r", String(FPS), "-g", String(FPS * 2), "-keyint_min", String(FPS * 2), "-sc_threshold", "0",
    "-vf", `scale=${OUT_W}:${OUT_H}:flags=bicubic`,
    "-b:v", `${KBPS}k`, "-maxrate", `${Math.round(KBPS * 1.25)}k`, "-bufsize", `${KBPS * 2}k`,
    "-c:a", "aac", "-b:a", "64k",
    // 2 s segments and a 20 s window: Roku's live player rebuffers (black) with 1 s segments over Wi-Fi.
    // temp_file makes playlist/segment writes atomic so the TV never reads a half-written playlist.
    "-f", "hls", "-hls_time", "2", "-hls_list_size", "10", "-hls_delete_threshold", "10",
    "-hls_flags", "delete_segments+independent_segments+omit_endlist+temp_file",
    path.join(LIVE, "index.m3u8"),
  ], { stdio: ["pipe", "inherit", "inherit"] });
  ffmpeg.on("exit", (c) => log("ffmpeg exited", c));
  ffmpeg.stdin.on("error", () => {});

  const cdp = await page.createCDPSession();
  const s = { page, cdp, ffmpeg, frame: null, game: gameId, code, startedAt: Date.now(), frames: 0, written: 0, streamStart: 0, recent: [] };
  cdp.on("Page.screencastFrame", async (f) => {
    s.frame = Buffer.from(f.data, "base64");
    s.frames++;
    s.recent.push(Date.now());
    if (s.recent.length > 300) s.recent.shift();
    if (!s.streamStart) s.streamStart = Date.now();
    try { await cdp.send("Page.screencastFrameAck", { sessionId: f.sessionId }); } catch {}
  });
  await cdp.send("Page.startScreencast", { format: "jpeg", quality: 80, maxWidth: OUT_W, maxHeight: OUT_H, everyNthFrame: 1 });
  // The screencast only sends frames when something changes and slows down when the machine is busy;
  // feed ffmpeg exactly FPS frames per wall-clock second, repeating the latest one as needed.
  s.timer = setInterval(() => {
    if (!s.frame || ffmpeg.stdin.destroyed) return;
    const due = Math.floor(((Date.now() - s.streamStart) / 1000) * FPS);
    let n = Math.min(due - s.written, FPS); // catch up after a stall, at most a second at a time
    if (ffmpeg.stdin.writableLength > 32 * 1024 * 1024) n = 0; // encoder can't keep up; don't hoard memory
    for (; n > 0; n--) { ffmpeg.stdin.write(s.frame); s.written++; }
  }, 1000 / FPS);
  session = s;
  lastHit = Date.now();
  // Keep the Mac from idle-sleeping while a game is on the TV (macOS only).
  if (process.platform === "darwin") s.awake = spawn("/usr/bin/caffeinate", ["-i", "-w", String(process.pid)], { stdio: "ignore" });

  // Answer once the playlist has a couple of segments so the TV can start playing right away.
  const t0 = Date.now();
  while (Date.now() - t0 < 15000) {
    const m3u8 = path.join(LIVE, "index.m3u8");
    if (fs.existsSync(m3u8) && (fs.readFileSync(m3u8, "utf8").match(/\.ts/g) || []).length >= 2) break;
    await new Promise((r) => setTimeout(r, 250));
  }
  return { ok: true, game: gameId, code, hls: "/live/index.m3u8" };
}

const TYPES = { ".m3u8": "application/vnd.apple.mpegurl", ".ts": "video/mp2t" };

http
  .createServer(async (req, res) => {
    const url = new URL(req.url, "http://x");
    const json = (code, body) => { res.writeHead(code, { "Content-Type": "application/json", "Cache-Control": "no-store" }); res.end(JSON.stringify(body)); };
    try {
      if (url.pathname === "/status") {
        if (session) lastHit = Date.now();
        return json(200, { running: !!session, game: session?.game ?? null, code: session?.code ?? null, frames: session?.frames ?? 0, games: Object.keys(GAMES) });
      }
      if (url.pathname === "/start" && req.method === "POST") return json(200, await start(url.searchParams.get("game") || "punchline"));
      if (url.pathname === "/stop" && req.method === "POST") { await stop(); return json(200, { ok: true }); }
      if (url.pathname === "/launch" && req.method === "POST") {
        const app = url.searchParams.get("app") || "";
        const tv = (url.searchParams.get("tv") || req.socket.remoteAddress || "").replace(/^::ffff:/, "");
        if (!/^[A-Za-z0-9_]{1,32}$/.test(app) || !/^\d{1,3}(\.\d{1,3}){3}$/.test(tv)) return json(400, { ok: false, error: "bad app or tv" });
        const r = await fetch(`http://${tv}:8060/launch/${app}`, { method: "POST", signal: AbortSignal.timeout(5000) });
        log("launch", app, "on", tv, "->", r.status);
        return json(r.ok ? 200 : 502, { ok: r.ok, status: r.status });
      }
      if (url.pathname === "/diag") {
        const s = session;
        const d = { version: VERSION, uptime: Math.round(process.uptime()), host: os.hostname(), platform: `${os.type()} ${os.release()} ${os.arch()}`,
          load: os.loadavg().map((n) => +n.toFixed(2)), chrome: browser?.connected ? await browser.version() : null, hubPreloaded: !!warm, running: !!s };
        if (s) {
          const now = Date.now();
          d.game = s.game; d.code = s.code;
          d.captureFps = +(s.recent.filter((t) => now - t < 5000).length / 5).toFixed(1);
          d.streamSeconds = +(s.written / FPS).toFixed(1);
          d.wallSeconds = s.streamStart ? +((now - s.streamStart) / 1000).toFixed(1) : 0;
          d.behindSeconds = +(d.wallSeconds - d.streamSeconds).toFixed(1);
          d.encoderBacklogMB = +(s.ffmpeg.stdin.writableLength / 1048576).toFixed(1);
          d.resolution = `${OUT_W}x${OUT_H}`;
          d.kbps = KBPS;
          d.fps = FPS;
          const recent = DELIVERIES.slice(-10);
          d.deliveries = recent;
          if (recent.length) d.avgSegmentMs = Math.round(recent.reduce((a, x) => a + x.ms, 0) / recent.length);
          d.segments = fs.readdirSync(LIVE).filter((f) => f.endsWith(".ts")).length;
          d.webgl = await s.page.evaluate(() => {
            const gl = document.createElement("canvas").getContext("webgl2");
            const ext = gl && gl.getExtension("WEBGL_debug_renderer_info");
            return gl ? (ext ? gl.getParameter(ext.UNMASKED_RENDERER_WEBGL) : "webgl2") : "none";
          }).catch(() => null);
        }
        // What else is keeping this machine busy (a busy machine means a choppier stream).
        d.topProcesses = await new Promise((resolve) => {
          const ps = spawn("/bin/ps", ["-Aceo", "pcpu=,comm="]);
          let out = "";
          ps.stdout.on("data", (b) => (out += b));
          ps.on("close", () => resolve(out.trim().split("\n").map((l) => l.trim().split(/\s+(.+)/)).map(([c, n]) => ({ cpu: +c, name: n }))
            .sort((a, b) => b.cpu - a.cpu).slice(0, 6)));
          ps.on("error", () => resolve([]));
        });
        return json(200, d);
      }
      if (url.pathname === "/log") { res.writeHead(200, { "Content-Type": "text/plain" }); return res.end(LOG.join("\n") + "\n"); }
      if (url.pathname === "/update" && req.method === "POST") {
        if (session && url.searchParams.get("force") !== "1") return json(409, { ok: false, error: "a room is running" });
        const src = await (await fetch(`${RAW}/streamer.mjs?t=${Date.now()}`, { signal: AbortSignal.timeout(20000) })).text();
        if (!src.includes("Dibs TV streamer")) return json(502, { ok: false, error: "download looked wrong" });
        const me = fileURLToPath(import.meta.url);
        if (src === fs.readFileSync(me, "utf8")) return json(200, { ok: true, updated: false, version: VERSION });
        fs.writeFileSync(me, src);
        log("updated from GitHub; restarting");
        json(200, { ok: true, updated: true });
        setTimeout(async () => { await browser?.close().catch(() => {}); process.exit(0); }, 300);
        return;
      }
      if (url.pathname === "/frame.jpg" && session?.frame) { res.writeHead(200, { "Content-Type": "image/jpeg" }); return res.end(session.frame); }
      if (url.pathname.startsWith("/live/")) {
        lastHit = Date.now();
        const file = path.join(LIVE, path.basename(url.pathname));
        if (!fs.existsSync(file)) return json(404, { error: "not ready" });
        const bytes = fs.statSync(file).size;
        res.writeHead(200, { "Content-Type": TYPES[path.extname(file)] || "application/octet-stream", "Content-Length": bytes, "Cache-Control": "no-store", "Access-Control-Allow-Origin": "*" });
        if (file.endsWith(".ts")) {
          // Record how fast each segment reaches the viewer: slower than its 2 s of video means the TV will stall.
          const t = Date.now();
          const ip = (req.socket.remoteAddress || "").replace(/^::ffff:/, "");
          res.on("finish", () => {
            const ms = Date.now() - t;
            DELIVERIES.push({ seg: path.basename(file), kb: Math.round(bytes / 1024), ms, ip });
            if (DELIVERIES.length > 30) DELIVERIES.shift();
            if (ms > 1500) log(`slow segment to ${ip}: ${Math.round(bytes / 1024)} KB took ${ms} ms`);
          });
        }
        return fs.createReadStream(file).pipe(res);
      }
      json(404, { error: "not found" });
    } catch (e) {
      log("error:", e.message);
      json(500, { ok: false, error: e.message });
    }
  })
  .listen(PORT, "0.0.0.0", () => {
    const ips = Object.values(os.networkInterfaces()).flat().filter((i) => i && i.family === "IPv4" && !i.internal).map((i) => i.address);
    log(`Dibs TV streamer on :${PORT}  (TV should use http://${ips[0] || "localhost"}:${PORT})  rendering ${DIBS}/tv`);
  });

// ---- LAN discovery (SSDP) ---------------------------------------------------------------------
function lanAddressFor(remote) {
  const ips = Object.values(os.networkInterfaces()).flat().filter((i) => i && i.family === "IPv4" && !i.internal);
  const same = ips.find((i) => remote && i.address.split(".").slice(0, 3).join(".") === remote.split(".").slice(0, 3).join("."));
  return (same || ips[0])?.address || "127.0.0.1";
}
const ssdp = dgram.createSocket({ type: "udp4", reuseAddr: true });
ssdp.on("message", (msg, rinfo) => {
  const text = msg.toString();
  if (!/^M-SEARCH/i.test(text)) return;
  const st = (text.match(/^ST:\s*(.+)$/im) || [])[1]?.trim();
  if (st !== SSDP_ST && st !== "ssdp:all") return;
  const reply = [
    "HTTP/1.1 200 OK", "CACHE-CONTROL: max-age=60", "EXT:",
    `LOCATION: http://${lanAddressFor(rinfo.address)}:${PORT}/`,
    `SERVER: ${os.type()}/${os.release()} UPnP/1.0 dibs-tv-streamer/1`,
    `ST: ${SSDP_ST}`, `USN: uuid:dibs-tv-streamer-${os.hostname()}::${SSDP_ST}`, "", "",
  ].join("\r\n");
  ssdp.send(reply, rinfo.port, rinfo.address);
});
ssdp.on("error", (e) => log("ssdp:", e.message));
if (process.env.NO_SSDP !== "1") {
  ssdp.bind(1900, () => {
    try { ssdp.addMembership("239.255.255.250"); } catch (e) { log("ssdp membership:", e.message); }
  });
}

for (const sig of ["SIGINT", "SIGTERM"]) process.on(sig, async () => {
  const enc = session?.ffmpeg;
  await stop();
  try { enc?.kill("SIGKILL"); } catch {}
  await browser?.close();
  process.exit(0);
});
