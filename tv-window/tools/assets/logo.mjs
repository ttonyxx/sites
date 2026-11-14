#!/usr/bin/env node
// Turns a logo on a black background into a transparent, tightly cropped PNG for the dashboard header.
//
//   npm run logo -- ~/Downloads/logo.png          -> channel/local/logo.png  (gitignored)
//   options: --height 360   output height in px     --keep-small   keep small text bands (taglines)
//
// Alpha is recovered by treating the image as premultiplied over black (alpha = brightest channel),
// which keeps anti-aliased edges and coloured shadows intact. Small separate bands of content
// (e.g. an "EST 2022" line) are dropped unless --keep-small, since they turn to mush at TV header size.
import fs from "node:fs";
import path from "node:path";
import { fileURLToPath } from "node:url";
import puppeteer from "puppeteer-core";

const TOOLS = path.resolve(path.dirname(fileURLToPath(import.meta.url)), "..");
const OUT = path.resolve(TOOLS, "../channel/local/logo.png");
const CHROME = process.env.CHROME_PATH || "/Applications/Google Chrome.app/Contents/MacOS/Google Chrome";
const args = process.argv.slice(2);
const input = args.find((a) => !a.startsWith("--") && !/^\d+$/.test(a));
const height = Number(args[args.indexOf("--height") + 1]) || 360;
const keepSmall = args.includes("--keep-small");
if (!input) {
  console.error("usage: npm run logo -- <image> [--height 360] [--keep-small]");
  process.exit(1);
}

const ext = path.extname(input).slice(1).toLowerCase().replace("jpg", "jpeg");
const dataUrl = `data:image/${ext};base64,${fs.readFileSync(input).toString("base64")}`;
const browser = await puppeteer.launch({ executablePath: CHROME, headless: true });
try {
  const page = await browser.newPage();
  const result = await page.evaluate(
    async ({ dataUrl, height, keepSmall }) => {
      const img = new Image();
      img.src = dataUrl;
      await img.decode();
      const W = img.naturalWidth, H = img.naturalHeight;
      const c = new OffscreenCanvas(W, H);
      const ctx = c.getContext("2d");
      ctx.drawImage(img, 0, 0);
      const d = ctx.getImageData(0, 0, W, H);
      const px = d.data;
      const rows = new Uint32Array(H);
      const edge = Math.max(2, Math.round(Math.min(W, H) * 0.01)); // ignore border lines/scan edges
      for (let i = 0; i < W * H; i++) {
        const r = px[i * 4], g = px[i * 4 + 1], b = px[i * 4 + 2];
        const x = i % W, y = Math.floor(i / W);
        let a = Math.max(r, g, b);
        if (a < 10) a = 0; // JPEG/scan noise floor
        if (x < edge || y < edge || x >= W - edge || y >= H - edge) a = 0;
        if (a) {
          px[i * 4] = Math.min(255, Math.round((r * 255) / a));
          px[i * 4 + 1] = Math.min(255, Math.round((g * 255) / a));
          px[i * 4 + 2] = Math.min(255, Math.round((b * 255) / a));
        }
        px[i * 4 + 3] = a;
        if (a > 40) rows[Math.floor(i / W)]++;
      }
      // Split into vertical bands separated by >= 2% empty rows; keep the heaviest unless asked not to.
      const gap = Math.max(8, Math.round(H * 0.02));
      const bands = [];
      let cur = null, empty = 0;
      for (let y = 0; y < H; y++) {
        if (rows[y]) {
          if (!cur || empty >= gap) bands.push((cur = { y0: y, y1: y, mass: 0 }));
          cur.y1 = y; cur.mass += rows[y]; empty = 0;
        } else empty++;
      }
      const heaviest = bands.reduce((a, b) => (b.mass > a.mass ? b : a));
      const keep = keepSmall ? bands : bands.filter((b) => b === heaviest || b.mass > heaviest.mass * 0.15);
      const y0 = Math.min(...keep.map((b) => b.y0)), y1 = Math.max(...keep.map((b) => b.y1));
      let x0 = W, x1 = 0;
      for (let y = y0; y <= y1; y++)
        for (let x = 0; x < W; x++)
          if (px[(y * W + x) * 4 + 3] > 40) { if (x < x0) x0 = x; if (x > x1) x1 = x; }
      const pad = Math.round((y1 - y0) * 0.02);
      const sx = Math.max(0, x0 - pad), sy = Math.max(0, y0 - pad);
      const sw = Math.min(W, x1 + pad + 1) - sx, sh = Math.min(H, y1 + pad + 1) - sy;
      const keyed = new OffscreenCanvas(W, H);
      keyed.getContext("2d").putImageData(d, 0, 0);
      const oh = Math.min(height, sh), ow = Math.round((sw * oh) / sh);
      const out = new OffscreenCanvas(ow, oh);
      const octx = out.getContext("2d");
      octx.imageSmoothingQuality = "high";
      octx.drawImage(keyed, sx, sy, sw, sh, 0, 0, ow, oh);
      const blob = await out.convertToBlob({ type: "image/png" });
      const bytes = new Uint8Array(await blob.arrayBuffer());
      let bin = "";
      for (let i = 0; i < bytes.length; i += 0x8000) bin += String.fromCharCode(...bytes.subarray(i, i + 0x8000));
      return { b64: btoa(bin), w: ow, h: oh, dropped: bands.length - keep.length };
    },
    { dataUrl, height, keepSmall },
  );
  fs.mkdirSync(path.dirname(OUT), { recursive: true });
  fs.writeFileSync(OUT, Buffer.from(result.b64, "base64"));
  console.log(`Wrote ${path.relative(process.cwd(), OUT)} (${result.w}x${result.h})${result.dropped ? `, dropped ${result.dropped} small text band(s)` : ""}`);
  console.log(`Add to channel/local.json:  "logo": "pkg:/local/logo.png", "logoAspect": ${(result.w / result.h).toFixed(3)}`);
} finally {
  await browser.close();
}
