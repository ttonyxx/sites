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
import net from "node:net";

const HERE = path.dirname(fileURLToPath(import.meta.url));

// Dependencies added after a machine was installed: /update only swaps this file, so install what's missing.
async function need(name, version) {
  try {
    return (await import(name)).default;
  } catch {
    console.log(`installing ${name}@${version}`);
    const npm = path.join(path.dirname(process.execPath), "npm");
    await new Promise((resolve) => {
      const p = spawn(fs.existsSync(npm) ? npm : "npm", ["install", "--no-audit", "--no-fund", "--omit=dev", `${name}@${version}`], { cwd: HERE, stdio: "inherit" });
      p.on("exit", resolve);
      p.on("error", resolve);
    });
    return (await import(`${name}?installed=${Date.now()}`).catch(() => import(name))).default;
  }
}
const QRCode = await need("qrcode", "^1.5.4");

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
const SEG_S = Number(process.env.SEGMENT || 1);
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
const VERSION = "2026-11-15.2";
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

// roomCode: show an existing room (one the host switched to from a native screen) instead of making one.
async function start(gameId, roomCode) {
  const label = GAMES[gameId];
  if (!label) throw new Error(`unknown game "${gameId}"`);
  await stop();
  closeNative();
  clearLive();

  const page = await takeHub();

  if (roomCode) {
    await page.goto(`${DIBS}/tv/${gameId}/${roomCode}`, { waitUntil: "domcontentloaded" });
  } else {
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
  }
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
    // macOS: the hardware encoder (VideoToolbox) leaves the CPU free for Chrome, so capture runs smoother.
    ...(process.platform === "darwin" && process.env.SOFTWARE_ENCODER !== "1"
      ? ["-c:v", "h264_videotoolbox", "-realtime", "1", "-allow_sw", "1", "-profile:v", "main"]
      : ["-c:v", "libx264", "-preset", "veryfast", "-profile:v", "main"]),
    "-pix_fmt", "yuv420p",
    "-r", String(FPS), "-g", String(FPS * SEG_S), "-keyint_min", String(FPS * SEG_S), "-sc_threshold", "0",
    "-vf", `scale=${OUT_W}:${OUT_H}:flags=bicubic`,
    "-b:v", `${KBPS}k`, "-maxrate", `${Math.round(KBPS * 1.25)}k`, "-bufsize", `${KBPS * 2}k`,
    "-c:a", "aac", "-b:a", "64k",
    // The TV's player starts ~3 segments behind live, so the segment length sets the delay. At ~1.6 Mbps,
    // 1 s segments play steadily over Wi-Fi (SEGMENT=2 if a TV stalls). temp_file makes writes atomic.
    "-f", "hls", "-hls_time", String(SEG_S), "-hls_list_size", String(Math.ceil(20 / SEG_S)), "-hls_delete_threshold", String(Math.ceil(20 / SEG_S)),
    "-hls_flags", "delete_segments+independent_segments+omit_endlist+temp_file",
    path.join(LIVE, "index.m3u8"),
  ], { stdio: ["pipe", "inherit", "inherit"] });
  ffmpeg.on("exit", (c) => log("ffmpeg exited", c));
  ffmpeg.stdin.on("error", () => {});

  const cdp = await page.createCDPSession();
  const s = { page, cdp, ffmpeg, frame: null, game: gameId, code, startedAt: Date.now(), frames: 0, written: 0, streamStart: 0, recent: [] };
  // The web TV follows the host when they switch games (/tv/<game>/<code>). Keep up, and if the new game has a
  // native screen, hand the room over to it: no video needed any more.
  page.on("framenavigated", (f) => {
    if (f !== page.mainFrame() || session !== s) return;
    const m = f.url().match(/\/tv\/([^/?#]+)\/([A-Z]{6})(?:[?#]|$)/);
    if (!m || (m[1] === s.game && m[2] === s.code)) return;
    log("streamed room switched to", m[1], m[2]);
    s.game = m[1];
    s.code = m[2];
    if (NATIVE[m[1]]) adoptNative(m[1], m[2]).catch((e) => log("native handover:", e.message));
  });
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
        if (/Roku/i.test(req.headers["user-agent"] || "")) tvIp = (req.socket.remoteAddress || "").replace(/^::ffff:/, "") || tvIp;
        return json(200, { running: !!session || !!nroom, game: session?.game ?? nroom?.key ?? null, code: session?.code ?? nroom?.code ?? null, mode: session ? "stream" : nroom ? "native" : null, frames: session?.frames ?? 0, games: Object.keys(GAMES) });
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
          load: os.loadavg().map((n) => +n.toFixed(2)), chrome: browser?.connected ? await browser.version() : null, hubPreloaded: !!warm, running: !!s,
          tv: { ip: tvIp, autoOpen: AUTO_OPEN, homeIdleMinutes: HOME_IDLE_MS / 60000, power: tvState.power, lastAction: tvState.lastAction } };
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
      if (url.pathname === "/qr.png") {
        // QR codes for the native TV screen (Roku can't make them). Only for dibsgames.com links.
        const data = url.searchParams.get("data") || "";
        if (!/^https:\/\/(www\.)?dibsgames\.com\//.test(data)) return json(400, { error: "bad data" });
        const size = Math.min(1024, Number(url.searchParams.get("size")) || 480);
        const png = await QRCode.toBuffer(data, { type: "png", margin: 1, width: size, errorCorrectionLevel: "M", color: { dark: "#221836", light: "#FFFFFF" } });
        res.writeHead(200, { "Content-Type": "image/png", "Cache-Control": "max-age=3600" });
        return res.end(png);
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

// ---- keep Window on the TV ----------------------------------------------------------------------
// When the TV turns on, or sits on the Roku home screen / Roku screensaver for a few minutes, open Window.
// ECP queries and "launch" are allowed in the TV's default Limited mode. AUTO_OPEN=0 turns this off;
// HOME_IDLE_MINUTES=0 keeps only the power-on behaviour.
const AUTO_OPEN = process.env.AUTO_OPEN !== "0";
const HOME_IDLE_MS = Number(process.env.HOME_IDLE_MINUTES ?? 3) * 60000;
let tvIp = process.env.TV_IP || null;
const tvState = { power: null, onAt: 0, homeSince: 0, lastAction: null };

function findRoku() {
  return new Promise((resolve) => {
    const sock = dgram.createSocket({ type: "udp4", reuseAddr: true });
    let done = false;
    const finish = (ip) => { if (done) return; done = true; try { sock.close(); } catch {} resolve(ip); };
    sock.on("message", (m, r) => { if (/roku:ecp/i.test(m.toString())) finish(r.address); });
    sock.on("error", () => finish(null));
    sock.bind(() => {
      const q = Buffer.from('M-SEARCH * HTTP/1.1\r\nHOST: 239.255.255.250:1900\r\nMAN: "ssdp:discover"\r\nST: roku:ecp\r\nMX: 1\r\n\r\n');
      sock.send(q, 1900, "239.255.255.250");
    });
    setTimeout(() => finish(null), 2500);
  });
}

async function ecp(pathname, method = "GET") {
  const r = await fetch(`http://${tvIp}:8060${pathname}`, { method, signal: AbortSignal.timeout(4000) });
  return { status: r.status, text: method === "GET" ? await r.text() : "" };
}

async function watchTv() {
  if (!AUTO_OPEN) return;
  try {
    if (!tvIp) tvIp = await findRoku();
    if (!tvIp) return;
    const power = ((await ecp("/query/device-info")).text.match(/<power-mode>([^<]+)</) || [])[1] || null;
    const now = Date.now();
    if (power === "PowerOn" && tvState.power && tvState.power !== "PowerOn") tvState.onAt = now;
    tvState.power = power;
    if (power !== "PowerOn") { tvState.homeSince = 0; return; }
    const app = (await ecp("/query/active-app")).text;
    const idleHome = /type="home"/.test(app) || /<screensaver/.test(app);
    if (!idleHome) { tvState.homeSince = 0; return; }
    if (!tvState.homeSince) tvState.homeSince = now;
    const justOn = tvState.onAt && now - tvState.onAt < 90000;
    const idleLong = HOME_IDLE_MS > 0 && now - tvState.homeSince >= HOME_IDLE_MS;
    if (justOn || idleLong) {
      const r = await ecp("/launch/dev", "POST");
      tvState.lastAction = `${new Date().toISOString().slice(11, 19)} ${justOn ? "TV turned on" : "idle on home"} -> opened Window (${r.status})`;
      log(tvState.lastAction);
      tvState.onAt = 0;
      tvState.homeSince = 0;
    }
  } catch {
    // TV off or unreachable; try again next round.
  }
}
setInterval(watchTv, 10000);

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

// ---- native TV bridge ------------------------------------------------------------------------------
// The Roku draws Dibs itself (no video): this joins the room as a seatless "screen" over Dibs's WebSocket
// (wss + Origin check, which a Roku can't do) and sends the TV small "screen" messages over a plain LAN
// socket (newline-delimited JSON on BRIDGE_PORT). See channel/components/DibsNative.brs for the screens.
const API = process.env.DIBS_API || "https://gamebox-production-a48f.up.railway.app";
const BRIDGE_PORT = Number(process.env.BRIDGE_PORT || 8791);
const WS = await need("ws", "^8.18.0");
const AVATAR_COLORS = ["#FF6B57", "#FFC93C", "#2FD6A3", "#47B5FF", "#9B6CFF", "#FF78C4", "#A8E05F", "#FF9A3C", "#2BC6C6", "#C8A6FF", "#FFB38A", "#5B7CFF"];
const fnv = (s) => { let h = 0x811c9dc5; for (let i = 0; i < s.length; i++) { h ^= s.charCodeAt(i); h = Math.imul(h, 0x01000193); } return h >>> 0; };
const avatarColor = (name) => "0x" + AVATAR_COLORS[fnv((name || "").trim().toLowerCase() || "?") % 12].slice(1) + "FF";
const names = (ps) => (ps.length <= 3 ? ps.map((p) => p.name).join(", ") : `${ps.slice(0, 2).map((p) => p.name).join(", ")} and ${ps.length - 2} more`);

// Players in the order they joined (the servers send map or id order), so avatars don't jump around on the TV.
function joinOrder(s, room) {
  const seen = (room.seen ??= new Map());
  for (const p of s.players || []) if (!seen.has(p.id)) seen.set(p.id, seen.size);
  return [...(s.players || [])].sort((a, b) => seen.get(a.id) - seen.get(b.id))
    .map((p) => ({ id: p.id, name: p.name, color: avatarColor(p.name), host: p.id === s.hostId, online: p.online !== false, spectator: !!p.spectator, score: p.score || 0, ready: !!p.ready, voted: !!p.hasVoted }));
}

function lobbyHint(players, min) {
  if (!players.length) return "Scan the code to join. Whoever gets in first is the host.";
  const missing = min - players.filter((p) => p.online).length;
  if (missing > 0) return `Need ${missing} more player${missing === 1 ? "" : "s"} to start`;
  return `${players.find((p) => p.host)?.name ?? "The host"} starts the game from their phone`;
}

const lobbyPlayers = (players) => players.map((p) => ({ name: p.name, color: p.color, host: p.host, away: !p.online }));

function punchlineScreen(s, room) {
  const base = { game: "Punchline", color: "0xFFD84AFF", code: room.code, join: `https://dibsgames.com/punchline/game/${room.code}`, now: Date.now() };
  const players = joinOrder(s, room);
  const secs = s.timeRemaining > 0 ? s.timeRemaining : undefined;
  const done = new Set(s.submittedPlayers || []);
  const active = players.filter((p) => !p.spectator && p.online);
  const roster = active.map((p) => ({ name: p.name, color: p.color, done: done.has(p.id) }));
  const pending = active.filter((p) => !done.has(p.id));
  const ph = s.phase;
  if (ph === "lobby") return { ...base, t: "lobby", players: lobbyPlayers(players), max: 16, hint: lobbyHint(players, 3) };
  if (/_answer$/.test(ph) || ph === "round1_write_question") {
    const heading = { round1_answer: "Write two funny answers", round2_answer: "Answer your friends' prompts", round3_answer: "Everyone answers the same prompt", round1_write_question: "Write a prompt for round 2" }[ph];
    const kicker = ph === "round3_answer" ? "Final round" : ph === "round1_write_question" ? "Round 2 prep" : `Round ${s.round}`;
    return { ...base, t: "stage", kicker, heading, body: pending.length ? `Still writing: ${names(pending)}` : "Everyone's in! Hang tight.", phones: true, secs, players: roster };
  }
  if (ph === "round1_vote" || ph === "round2_vote") {
    const vp = (s.votePairs || [])[0];
    if (!vp) return null;
    const voted = done.size, expected = Math.max(s.votersExpected || 0, voted);
    const byline = vp.questionAuthor ? `Written by ${vp.questionAuthor}` : undefined;
    (room.bylines ??= {})[vp.questionText] = byline; // results don't carry the author; keep it for the reveal
    return { ...base, t: "matchup", kicker: `Vote ${s.currentVoteIndex + 1} of ${s.totalVotePairs}`, prompt: vp.questionText, byline,
      answers: [{ text: vp.answer1.text }, { text: vp.answer2.text }], secs, note: `${voted} of ${expected} votes in` };
  }
  if (ph === "round1_results" || ph === "round2_results") {
    const r = (s.voteResults || [])[s.currentVoteIndex];
    if (!r) return null;
    const side = (a, voters, pts, bonus) => ({ text: a.text, author: a.playerName, color: avatarColor(a.playerName), votes: voters.length, points: pts, winner: !!r.winner && r.winner === a.playerId, sweep: bonus > 0 });
    const a1 = side(r.answer1, r.votersFor1 || [], r.pointsEarned1, r.sweepBonus1), a2 = side(r.answer2, r.votersFor2 || [], r.pointsEarned2, r.sweepBonus2);
    const w = a1.winner ? a1 : a2.winner ? a2 : null;
    const note = w ? `${w.author} takes it!` : (r.votersFor1?.length || r.votersFor2?.length) ? "It's a tie!" : "Nobody voted!";
    return { ...base, t: "matchup", kicker: `Result ${s.currentVoteIndex + 1} of ${s.totalVotePairs}`, prompt: r.questionText, byline: room.bylines?.[r.questionText], answers: [a1, a2], reveal: true, secs, note };
  }
  if (ph === "round3_vote") {
    const vp = s.votePairs || [];
    return { ...base, t: "list", kicker: "Final round · Pick your top 3", prompt: vp[0]?.questionText ?? "", items: vp.map((x) => ({ text: x.answer1.text })), secs, phones: true,
      note: pending.length ? `Still picking: ${names(pending)}` : "Everyone's in!" };
  }
  if (ph === "round3_results") {
    return { ...base, t: "list", kicker: "Final round · Results", prompt: s.round3Prompt ?? "", reveal: true, secs,
      items: (s.round3Results || []).map((x, i) => ({ text: x.answer.text, author: x.answer.playerName, color: avatarColor(x.answer.playerName), points: x.totalPoints, place: i + 1 })) };
  }
  if (ph === "results") {
    const rows = [...players].sort((a, b) => b.score - a.score || a.name.localeCompare(b.name)).map((p) => ({ name: p.name, color: p.color, score: p.score }));
    const tie = rows[1] && rows[0] && rows[1].score === rows[0].score;
    const host = players.find((p) => p.host);
    return { ...base, t: "scores", title: tie ? "It's a tie!" : `${rows[0]?.name ?? "Nobody"} wins!`, rows, final: true, note: host ? `Waiting for ${host.name} to start a new game` : undefined };
  }
  return null;
}

// Imposter (backend/internal/imposter PlayerView, as a spectator sees it). Dark theme like the web game.
function imposterScreen(s, room) {
  const base = { game: "Imposter", color: "0x201539FF", dark: true, code: room.code, join: `https://dibsgames.com/imposter/game/${room.code}`, now: Date.now() };
  const players = joinOrder(s, room);
  const inRound = players.filter((p) => !p.spectator);
  const host = players.find((p) => p.host);
  const face = (p) => ({ name: p.name, color: avatarColor(p.name) });
  const ph = s.phase;
  // Count rounds and remember scores as each one starts, for the reveal's "+100"s and to spin the spotlight once per round.
  if (ph === "reveal" && room.phase !== "reveal") { room.round = (room.round || 0) + 1; room.before = Object.fromEntries(players.map((p) => [p.id, p.score])); }
  room.phase = ph;
  if (ph === "lobby") {
    const st = s.settings || {};
    const n = st.numImposters || 1;
    const cat = !st.category || st.category === "random" ? "Random category" : st.category;
    const settings = [`${n} imposter${n === 1 ? "" : "s"}`, cat, st.imposterSeesCategory === false ? "Imposters don't see the category" : null].filter(Boolean).join("   ·   ");
    return { ...base, t: "lobby", players: lobbyPlayers(players), max: 15, hint: lobbyHint(players, 3), settings };
  }
  if (ph === "reveal") {
    const ready = inRound.filter((p) => p.ready).length;
    return { ...base, t: "stage", kicker: "Secret roles", heading: "Shhh... check your role", body: `${ready} of ${inRound.length} have read their role`, phones: true,
      players: inRound.map((p) => ({ ...face(p), done: p.ready })) };
  }
  if (ph === "discuss") {
    // Same order the phones show: the server's player list (sorted by id), starting with the starter.
    const order = (s.players || []).filter((p) => !p.spectator);
    const i = Math.max(0, order.findIndex((p) => p.id === s.starterId));
    return { ...base, t: "turns", kicker: "Clue time", heading: "One word each", body: "Go around in this order. Say one word that fits the secret word.",
      people: [...order.slice(i), ...order.slice(0, i)].map(face), callout: "Give your clues out loud!",
      note: host ? `${host.name} starts the vote when everyone's gone` : undefined };
  }
  if (ph === "vote") {
    const pending = inRound.filter((p) => !p.voted);
    return { ...base, t: "stage", kicker: "Vote", heading: "Who's the imposter?", body: pending.length ? `Still voting: ${names(pending)}` : "All votes in!", phones: true,
      players: inRound.map((p) => ({ ...face(p), done: p.voted })) };
  }
  if (ph === "results") {
    const r = s.results;
    if (!r) return null;
    const imps = new Set((r.imposters || []).map((p) => p.id));
    const before = room.before || {};
    const rows = [...players].sort((a, b) => b.score - a.score || a.name.localeCompare(b.name))
      .map((p) => ({ ...face(p), score: p.score, delta: p.score - (before[p.id] ?? p.score) }));
    return { ...base, t: "unmask", key: `${room.code}-${room.round || 0}`, lead: imps.size > 1 ? "The imposters were..." : "The imposter was...",
      everyone: inRound.map(face), imposters: (r.imposters || []).map(face), caught: !!r.crewCaught, verdict: r.crewCaught ? "Caught!" : "Got away!",
      word: r.word, category: r.category,
      tally: (r.tally || []).map((t) => ({ ...face({ name: t.playerName }), count: t.count, imp: imps.has(t.playerId), voters: t.voters?.length ? `from ${t.voters.join(", ")}` : "" })),
      rows, note: host ? `Waiting for ${host.name} to start the next round` : undefined };
  }
  return null;
}

// Pirates (backend/internal/pirates PlayerView; everyone gets the same one). Tiles flip every few seconds and
// everyone races to make and steal words, so this one benefits most from not being video.
function piratesScreen(s, room) {
  const base = { game: "Pirates", color: "0x174A72FF", dark: true, code: room.code, join: `https://dibsgames.com/pirates/game/${room.code}`, now: Date.now() };
  const humans = joinOrder(s, room);
  const bots = (s.bots || []).map((b) => ({ id: b.id, name: b.name, color: avatarColor(b.name), bot: true, score: b.score || 0, online: true }));
  const crew = [...humans, ...bots];
  const nameOf = (id) => crew.find((p) => p.id === id)?.name ?? "Someone";
  const face = (p) => ({ name: p.name, color: avatarColor(p.name) });
  const host = humans.find((p) => p.host);
  const st = s.settings || {};
  const ph = s.phase;
  if (ph === "lobby") {
    const settings = [`Words of ${st.minLength || 3}+ letters`, `${st.bagSize || 144} tiles`, `a flip every ${st.flipSecs || 5}s`, st.strict ? "strict steals" : null].filter(Boolean).join("   ·   ");
    const hint = humans.length && !bots.length && humans.filter((p) => p.online).length === 1 ? `${host?.name ?? "The host"} can add bots, or start solo` : lobbyHint(humans, 1);
    return { ...base, t: "lobby", players: [...lobbyPlayers(humans), ...bots.map((b) => ({ name: b.name, color: b.color, bot: true }))], max: s.maxSeats || 8, hint, settings };
  }
  if (ph === "playing" || ph === "last_call") {
    const lastCall = ph === "last_call";
    const top = Math.max(0, ...crew.map((p) => p.score));
    const votes = new Set((lastCall ? s.doneVotes : s.flipVotes) || []);
    const byOwner = {};
    for (const w of s.words || []) (byOwner[w.owner] ??= []).push(w.word);
    // What happened, like the web feed ("Ana turned Ben's TEAM into STEAM").
    const describe = (e) => {
      const took = e.took || [];
      const whose = (t) => (t.owner === e.by ? `their ${t.word}` : `${nameOf(t.owner)}'s ${t.word}`);
      if (!took.length) return `grabbed ${e.word}`;
      if (took.length === 1) return `${took[0].owner === e.by ? "stretched" : "turned"} ${whose(took[0])} into ${e.word}`;
      const parts = took.map(whose);
      return `merged ${parts.slice(0, -1).join(", ")} and ${parts.at(-1)} into ${e.word}`;
    };
    const pool = s.pool || [];
    const secs = lastCall ? Math.ceil((s.lastCallMs || 0) / 1000) : s.flipMs > 0 && s.bagLeft > 0 && !s.paused ? Math.max(1, Math.ceil((s.nextFlipMs || 0) / 1000)) : undefined;
    const voters = humans.filter((p) => p.online).length;
    return { ...base, t: "sea", kicker: lastCall ? "Last call" : "Grab and steal", lastCall, paused: !!s.paused,
      pool: pool.map((t) => t.l).join(""), fresh: pool.findIndex((t) => t.id === s.lastFlip), bagLeft: s.bagLeft || 0, flips: s.flips || 0,
      votes: voters > 1 ? `${votes.size}/${voters} ${lastCall ? "done" : "want the next tile"}` : undefined, secs,
      holds: crew.map((p) => ({ ...face(p), score: p.score, bot: !!p.bot, away: !p.online, lead: top > 0 && p.score === top, voted: !p.bot && votes.has(p.id), words: byOwner[p.id] || [] })),
      voteLabel: lastCall ? "DONE" : "FLIP",
      feed: (s.log || []).slice(-4).reverse().map((e) => ({ seq: e.seq, ...face({ name: nameOf(e.by) }), text: describe(e), word: e.word, steal: (e.took || []).some((t) => t.owner !== e.by) })) };
  }
  if (ph === "game_over") {
    const r = s.results || {};
    const rows = (r.standings || []).map((x) => ({ ...face(x), score: x.score, bot: !!x.bot, words: x.words || [], stats: `${x.stats?.words ?? 0} made · ${x.stats?.steals ?? 0} stolen · ${x.stats?.robbed ?? 0} lost` }));
    const champs = rows[0]?.score > 0 ? rows.filter((x) => x.score === rows[0].score) : [];
    return { ...base, t: "haul", champs: champs.map(face), eyebrow: champs.length > 1 ? "Shared treasure" : "Captain of the seas",
      title: champs.length ? champs.map((c) => c.name).join(" & ") : "Nobody made a word!", points: champs.length ? `${rows[0].score} ${rows[0].score === 1 ? "point" : "points"} of loot` : undefined,
      rows, awards: (r.awards || []).slice(0, 4).map((a) => ({ ...face(a), title: a.title, detail: a.detail })),
      missed: r.missed ? r.missed.slice(0, 6).map((m) => m.word) : undefined,
      note: host ? `Waiting for ${host.name} to play again` : undefined };
  }
  return null;
}

const NATIVE = {
  punchline: { name: "Punchline", create: "/api/create-room", ws: "/ws", translate: punchlineScreen },
  imposter: { name: "Imposter", create: "/api/imposter/create-room", ws: "/imposter-ws", translate: imposterScreen },
  pirates: { name: "Pirates", create: "/api/pirates/create-room", ws: "/pirates-ws", translate: piratesScreen },
};
// Dibs's game ids (in "switch" messages) -> the ids the TV and this streamer use (also the web paths).
const KEY_FOR_GAME = { quiplash: "punchline", imposter: "imposter", tko: "tee-party", brawl: "brawl", piggyback: "piggyback", pirates: "pirates" };
const tvs = new Set();
let nroom = null; // { key, g, code, ws, screen, ping, attempts, dead }
let lastTv = Date.now();

function tvSend(obj, only) {
  const line = JSON.stringify(obj) + "\n";
  for (const s of only ? [only] : tvs) { try { s.write(line); } catch {} }
}

function closeNative() {
  if (!nroom) return;
  const r = nroom;
  nroom = null;
  r.dead = true;
  clearInterval(r.ping);
  try { r.ws?.close(); } catch {}
  log("native room closed", r.code);
}

async function hostNative(key) {
  const g = NATIVE[key];
  if (!g) throw new Error(`no native screen for "${key}"`);
  closeNative();
  await stop(); // one room at a time: end any video-streamed room
  const r = await fetch(`${API}${g.create}`, { method: "POST", headers: { "Content-Type": "application/json", Origin: "https://dibsgames.com" }, body: JSON.stringify({ playerName: "TV" }), signal: AbortSignal.timeout(10000) });
  const j = await r.json().catch(() => ({}));
  if (!r.ok || !j.roomCode) throw new Error(j.error || `create-room ${r.status}`);
  await adoptNative(key, j.roomCode);
}

// Watch an existing room as the TV's native screen (a new one, or one the host switched games into).
async function adoptNative(key, code) {
  const g = NATIVE[key];
  if (!g) throw new Error(`no native screen for "${key}"`);
  closeNative();
  await stop();
  nroom = { key, g, code, ws: null, screen: null, attempts: 0, dead: false };
  connectNative(nroom);
  tvSend({ t: "room", game: key, code });
  log("native", g.name, "room", code);
}

// The host took the room to another game ("switch" message): follow it, natively if we can, else as video.
async function followSwitch(mv) {
  const key = KEY_FOR_GAME[mv?.game];
  const code = typeof mv?.roomCode === "string" && /^[A-Z]{6}$/.test(mv.roomCode) ? mv.roomCode : null;
  if (!key || !code) { closeNative(); tvSend({ t: "ended", text: "That room closed" }); return; }
  const label = GAMES[key] || mv.name || "a new game";
  log("native room switched to", key, code);
  tvSend({ t: "status", text: `Next up: ${label}` });
  if (NATIVE[key]) return adoptNative(key, code);
  closeNative();
  try {
    const r = await start(key, code);
    tvSend({ t: "stream", game: key, code: r.code, hls: r.hls });
  } catch (e) {
    log("switch to video:", e.message);
    tvSend({ t: "ended", text: `Couldn't show ${label}` });
  }
}

function connectNative(room) {
  const ws = new WS(`${API.replace(/^http/, "ws")}${room.g.ws}?roomCode=${room.code}&screen=1`, { origin: "https://dibsgames.com" });
  room.ws = ws;
  ws.on("open", () => {
    room.attempts = 0;
    clearInterval(room.ping);
    room.ping = setInterval(() => { try { ws.send('{"type":"ping"}'); } catch {} }, 10000); // also keeps the room alive
  });
  ws.on("message", (buf) => {
    let msg;
    try { msg = JSON.parse(buf.toString()); } catch { return; }
    if (msg.type === "game_state") {
      const screen = room.g.translate(msg.payload, room);
      if (!screen || nroom !== room) return;
      room.screen = screen;
      // Only send what the TV would draw differently (states also arrive for changes the TV doesn't show).
      const { now, ...rest } = screen;
      const sig = JSON.stringify(rest);
      if (sig !== room.sentSig) { room.sentSig = sig; tvSend(screen); }
    } else if (msg.type === "switch") {
      room.dead = true;
      try { ws.close(); } catch {}
      if (nroom === room) followSwitch(msg.payload).catch((e) => log("switch:", e.message));
    } else if (msg.type === "closed" || msg.type === "error") {
      room.dead = true;
      if (nroom === room) {
        hostNative(room.key).then(() => tvSend({ t: "status", text: "Everyone left, so here's a fresh room" }))
          .catch(() => { nroom = null; tvSend({ t: "ended", text: "That room closed" }); });
      }
    }
  });
  ws.on("close", () => {
    clearInterval(room.ping);
    if (room.dead || nroom !== room) return;
    const delay = Math.min(8000, 600 * 2 ** room.attempts++) + Math.random() * 400;
    setTimeout(() => { if (nroom === room && !room.dead) connectNative(room); }, delay);
  });
  ws.on("error", () => {});
}

// No Window on the TV for a while (another app, TV off): let the room go.
setInterval(() => {
  if (nroom && tvs.size === 0 && Date.now() - lastTv > IDLE_MS) { log("no TV for a while, closing native room"); closeNative(); }
}, 10000);

net.createServer((sock) => {
  sock.setNoDelay(true);
  sock.setKeepAlive(true, 15000);
  tvs.add(sock);
  lastTv = Date.now();
  let buf = "";
  sock.on("data", async (d) => {
    buf += d.toString();
    let i;
    while ((i = buf.indexOf("\n")) >= 0) {
      const line = buf.slice(0, i).trim();
      buf = buf.slice(i + 1);
      if (!line) continue;
      let m;
      try { m = JSON.parse(line); } catch { continue; }
      lastTv = Date.now();
      try {
        if (m.op === "host") await hostNative(m.game);
        else if (m.op === "resume") {
          if (nroom) { tvSend({ t: "room", game: nroom.key, code: nroom.code }, sock); if (nroom.screen) tvSend({ ...nroom.screen, now: Date.now() }, sock); }
          else tvSend({ t: "ended" }, sock);
        } else if (m.op === "leave") { closeNative(); tvSend({ t: "ended" }); }
      } catch (e) {
        log("bridge:", e.message);
        tvSend({ t: "error", text: "Couldn't start the room: " + e.message }, sock);
      }
    }
  });
  sock.on("close", () => { tvs.delete(sock); lastTv = Date.now(); });
  sock.on("error", () => {});
}).listen(BRIDGE_PORT, "0.0.0.0", () => log(`native TV bridge on :${BRIDGE_PORT}`));

for (const sig of ["SIGINT", "SIGTERM"]) process.on(sig, async () => {
  const enc = session?.ffmpeg;
  await stop();
  try { enc?.kill("SIGKILL"); } catch {}
  await browser?.close();
  process.exit(0);
});
