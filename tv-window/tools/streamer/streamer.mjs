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
//       GET /live/index.m3u8 (+ segments)    GET /frame.jpg (latest frame, for debugging)
import http from "node:http";
import fs from "node:fs";
import os from "node:os";
import path from "node:path";
import { spawn } from "node:child_process";
import { createRequire } from "node:module";

const require = createRequire(import.meta.url);
const puppeteer = require("puppeteer-core");

const PORT = Number(process.env.PORT || 8790);
const DIBS = (process.env.DIBS_URL || "https://dibsgames.com").replace(/\/$/, "");
const CHROME = process.env.CHROME_PATH || "/Applications/Google Chrome.app/Contents/MacOS/Google Chrome";
const FFMPEG = process.env.FFMPEG_PATH || "ffmpeg";
const FPS = Number(process.env.FPS || 30);
const LIVE = fs.mkdtempSync(path.join(os.tmpdir(), "dibs-live-"));

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

// If the TV stops fetching the stream (Home button, TV off), stop rendering after a while.
setInterval(() => {
  if (session && Date.now() - session.startedAt > 60000 && Date.now() - lastHit > 45000) {
    log("no viewer for 45 s, stopping");
    stop();
  }
}, 10000);

const log = (...a) => console.log(new Date().toISOString().slice(11, 19), ...a);

async function getBrowser() {
  if (browser?.connected) return browser;
  browser = await puppeteer.launch({
    executablePath: CHROME,
    headless: true,
    defaultViewport: { width: 1920, height: 1080, deviceScaleFactor: 1 },
    args: ["--autoplay-policy=no-user-gesture-required", "--enable-gpu-rasterization", "--ignore-gpu-blocklist", "--disable-background-timer-throttling", "--disable-renderer-backgrounding", "--disable-backgrounding-occluded-windows"],
  });
  return browser;
}

function clearLive() {
  for (const f of fs.readdirSync(LIVE)) fs.rmSync(path.join(LIVE, f), { force: true });
}

async function stop() {
  const s = session;
  session = null;
  if (!s) return;
  clearInterval(s.timer);
  try { s.ffmpeg.stdin.end(); } catch {}
  setTimeout(() => s.ffmpeg.kill("SIGKILL"), 2000);
  try { await s.cdp.send("Page.stopScreencast"); } catch {}
  try { await s.page.close(); } catch {}
  log("stopped", s.game, s.code || "");
}

async function start(gameId) {
  const label = GAMES[gameId];
  if (!label) throw new Error(`unknown game "${gameId}"`);
  await stop();
  clearLive();

  const b = await getBrowser();
  const page = await b.newPage();
  page.on("pageerror", (e) => log("page error:", e.message));
  await page.goto(`${DIBS}/tv`, { waitUntil: "networkidle2", timeout: 30000 });

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

  // Video: screencast JPEG frames -> fixed-rate pipe into ffmpeg -> H.264 HLS with 1 s segments.
  // A silent audio track keeps every player happy.
  const ffmpeg = spawn(FFMPEG, [
    "-hide_banner", "-loglevel", "error",
    "-f", "image2pipe", "-framerate", String(FPS), "-i", "-",
    "-f", "lavfi", "-i", "anullsrc=r=48000:cl=stereo",
    "-map", "0:v", "-map", "1:a",
    "-c:v", "libx264", "-preset", "veryfast", "-tune", "zerolatency", "-profile:v", "main", "-pix_fmt", "yuv420p",
    "-r", String(FPS), "-g", String(FPS), "-keyint_min", String(FPS), "-sc_threshold", "0",
    "-b:v", "5M", "-maxrate", "6M", "-bufsize", "3M",
    "-c:a", "aac", "-b:a", "64k",
    "-f", "hls", "-hls_time", "1", "-hls_list_size", "6",
    "-hls_flags", "delete_segments+independent_segments+omit_endlist",
    path.join(LIVE, "index.m3u8"),
  ], { stdio: ["pipe", "inherit", "inherit"] });
  ffmpeg.on("exit", (c) => log("ffmpeg exited", c));
  ffmpeg.stdin.on("error", () => {});

  const cdp = await page.createCDPSession();
  const s = { page, cdp, ffmpeg, frame: null, game: gameId, code, startedAt: Date.now(), frames: 0 };
  cdp.on("Page.screencastFrame", async (f) => {
    s.frame = Buffer.from(f.data, "base64");
    s.frames++;
    try { await cdp.send("Page.screencastFrameAck", { sessionId: f.sessionId }); } catch {}
  });
  await cdp.send("Page.startScreencast", { format: "jpeg", quality: 82, maxWidth: 1920, maxHeight: 1080, everyNthFrame: 1 });
  // The screencast only sends frames when something changes; repeat the latest one at a steady rate.
  s.timer = setInterval(() => {
    if (s.frame && !ffmpeg.stdin.destroyed) ffmpeg.stdin.write(s.frame);
  }, 1000 / FPS);
  session = s;

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
        return json(200, { running: !!session, game: session?.game ?? null, code: session?.code ?? null, frames: session?.frames ?? 0, games: Object.keys(GAMES) });
      }
      if (url.pathname === "/start" && req.method === "POST") return json(200, await start(url.searchParams.get("game") || "punchline"));
      if (url.pathname === "/stop" && req.method === "POST") { await stop(); return json(200, { ok: true }); }
      if (url.pathname === "/frame.jpg" && session?.frame) { res.writeHead(200, { "Content-Type": "image/jpeg" }); return res.end(session.frame); }
      if (url.pathname.startsWith("/live/")) {
        lastHit = Date.now();
        const file = path.join(LIVE, path.basename(url.pathname));
        if (!fs.existsSync(file)) return json(404, { error: "not ready" });
        res.writeHead(200, { "Content-Type": TYPES[path.extname(file)] || "application/octet-stream", "Cache-Control": "no-store", "Access-Control-Allow-Origin": "*" });
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

for (const sig of ["SIGINT", "SIGTERM"]) process.on(sig, async () => { await stop(); await browser?.close(); process.exit(0); });
