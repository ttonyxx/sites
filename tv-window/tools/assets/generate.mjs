#!/usr/bin/env node
// Generates every image the Window channel ships with, plus copies its fonts.
// Procedural textures (sky masks, stars, clouds, nine-patches) are drawn here in Node;
// vector art (weather icons, key caps, posters) is rendered by headless Chrome.
//
//   npm run assets
import fs from "node:fs";
import path from "node:path";
import { fileURLToPath } from "node:url";
import { encodePNG } from "./png.mjs";

const HERE = path.dirname(fileURLToPath(import.meta.url));
const TOOLS = path.resolve(HERE, "..");
const CHANNEL = path.resolve(TOOLS, "../channel");
const IMG = path.join(CHANNEL, "images");
const FONTS = path.join(CHANNEL, "fonts");
fs.mkdirSync(IMG, { recursive: true });
fs.mkdirSync(FONTS, { recursive: true });

const clamp = (v, a = 0, b = 1) => Math.min(b, Math.max(a, v));
const smooth = (e0, e1, x) => { const t = clamp((x - e0) / (e1 - e0)); return t * t * (3 - 2 * t); };
const BAYER = [0, 8, 2, 10, 12, 4, 14, 6, 3, 11, 1, 9, 15, 7, 13, 5].map((v) => (v + 0.5) / 16 - 0.5);
const dither = (x, y) => BAYER[(y & 3) * 4 + (x & 3)];
const byte = (v, x, y) => clamp(Math.round(v * 255 + dither(x, y)), 0, 255);

// Deterministic PRNG so regenerating gives identical files.
function rng(seed) {
  let s = seed >>> 0;
  return () => ((s = (s * 1664525 + 1013904223) >>> 0) / 4294967296);
}

function write(name, w, h, px) {
  const file = path.join(IMG, name);
  fs.writeFileSync(file, encodePNG(w, h, px));
  console.log(`  ${name.padEnd(22)} ${w}x${h}  ${(fs.statSync(file).size / 1024).toFixed(0)} KB`);
}

/** White texture whose alpha comes from fn(x, y) in 0..1, ordered-dithered to hide banding. */
function alphaMask(name, w, h, fn) {
  const px = new Uint8Array(w * h * 4);
  for (let y = 0; y < h; y++)
    for (let x = 0; x < w; x++) {
      const i = (y * w + x) * 4;
      px[i] = px[i + 1] = px[i + 2] = 255;
      px[i + 3] = byte(fn(x, y), x, y);
    }
  write(name, w, h, px);
}

// --- Sky -------------------------------------------------------------------------------
// Sky = solid horizon colour + this mask tinted with the zenith colour (opaque at top).
alphaMask("sky_grad.png", 1920, 1080, (x, y) => Math.pow(clamp(1 - y / (1080 * 0.92)), 1.35));

// Sun / moon glow: soft radial falloff.
alphaMask("glow.png", 512, 512, (x, y) => {
  const r = Math.hypot(x - 255.5, y - 255.5) / 256;
  return clamp((Math.exp(-5 * r * r) - Math.exp(-5)) / (1 - Math.exp(-5)));
});

// Soft horizontal edge (opaque -> clear), used where the info panel meets the photos.
alphaMask("fade_h.png", 256, 8, (x) => Math.pow(1 - x / 255, 1.8));

// Legibility scrim: darkens the left (clock) and bottom (forecast) of the screen.
{
  const w = 960, h = 540, px = new Uint8Array(w * h * 4);
  for (let y = 0; y < h; y++)
    for (let x = 0; x < w; x++) {
      const left = 0.55 * Math.pow(clamp(1 - x / (w * 0.7)), 1.6);
      const bottom = 0.7 * Math.pow(clamp((y / h - 0.42) / 0.58), 1.4);
      const top = 0.38 * Math.pow(clamp(1 - y / (h * 0.5)), 1.5);
      const a = 1 - (1 - left) * (1 - bottom) * (1 - top);
      const i = (y * w + x) * 4;
      px[i] = px[i + 1] = px[i + 2] = 0;
      px[i + 3] = byte(a, x, y);
    }
  write("scrim.png", w, h, px);
}

// --- Stars -----------------------------------------------------------------------------
function stars(name, w, h, count, seed, sizeRange, brightPow) {
  const r = rng(seed);
  const acc = new Float32Array(w * h * 4); // premultiplied accumulation
  for (let n = 0; n < count; n++) {
    const sx = r() * w;
    const sy = Math.pow(r(), 1.35) * h * 0.82; // denser toward the zenith
    const size = sizeRange[0] + Math.pow(r(), 3) * (sizeRange[1] - sizeRange[0]);
    const bright = 0.25 + 0.75 * Math.pow(r(), brightPow);
    const tint = r();
    const col = tint < 0.2 ? [0.8, 0.87, 1] : tint > 0.9 ? [1, 0.92, 0.8] : [1, 1, 1];
    const rad = Math.ceil(size * 2.5);
    for (let dy = -rad; dy <= rad; dy++)
      for (let dx = -rad; dx <= rad; dx++) {
        const px = Math.round(sx) + dx, py = Math.round(sy) + dy;
        if (px < 0 || py < 0 || px >= w || py >= h) continue;
        const d = Math.hypot(px - sx, py - sy) / size;
        const a = bright * Math.exp(-2.2 * d * d);
        if (a < 0.004) continue;
        const i = (py * w + px) * 4;
        acc[i] += col[0] * a; acc[i + 1] += col[1] * a; acc[i + 2] += col[2] * a; acc[i + 3] += a;
      }
  }
  const px = new Uint8Array(w * h * 4);
  for (let i = 0; i < w * h; i++) {
    const a = Math.min(1, acc[i * 4 + 3]);
    if (a <= 0) continue;
    const k = 1 / acc[i * 4 + 3];
    px[i * 4] = clamp(acc[i * 4] * k * 255, 0, 255);
    px[i * 4 + 1] = clamp(acc[i * 4 + 1] * k * 255, 0, 255);
    px[i * 4 + 2] = clamp(acc[i * 4 + 2] * k * 255, 0, 255);
    px[i * 4 + 3] = Math.round(a * 255);
  }
  write(name, w, h, px);
}
stars("stars_a.png", 1920, 1080, 1100, 7, [0.55, 1.4], 2.4);
stars("stars_b.png", 960, 540, 90, 21, [0.7, 1.3], 1.2); // twinkling layer, shown at 2x

// --- Clouds (horizontally tileable fBm value noise) --------------------------------------
function makeNoise(seed) {
  const r = rng(seed);
  const table = new Float32Array(4096 * 4);
  for (let i = 0; i < table.length; i++) table[i] = r();
  const hash = (ix, iy, o) => table[((iy * 977 + ix * 131 + o * 7919) >>> 0) % table.length];
  return function fbm(x, y, period, octaves) {
    let sum = 0, amp = 0.5, norm = 0, cells = period;
    for (let o = 0; o < octaves; o++) {
      const fx = x * cells, fy = y * cells;
      const x0 = Math.floor(fx), y0 = Math.floor(fy);
      const tx = fx - x0, ty = fy - y0;
      const sx = tx * tx * (3 - 2 * tx), sy = ty * ty * (3 - 2 * ty);
      const w0 = ((x0 % cells) + cells) % cells, w1 = (w0 + 1) % cells;
      const a = hash(w0, y0, o), b = hash(w1, y0, o), c = hash(w0, y0 + 1, o), d = hash(w1, y0 + 1, o);
      sum += amp * (a + (b - a) * sx + (c - a) * sy + (a - b - c + d) * sx * sy);
      norm += amp; amp *= 0.52; cells *= 2;
    }
    return sum / norm;
  };
}
function clouds(name, w, h, seed, period, lo, hi, topFade, bottomFade) {
  const fbm = makeNoise(seed);
  const aspect = h / w;
  const px = new Uint8Array(w * h * 4);
  for (let y = 0; y < h; y++)
    for (let x = 0; x < w; x++) {
      const u = x / w, v = (y / h) * aspect;
      const n = fbm(u, v, period, 6);
      const yy = y / h;
      const fade = smooth(0, topFade, yy) * (1 - smooth(1 - bottomFade, 1, yy));
      const a = smooth(lo, hi, n) * fade;
      // Self-shadowing: the side away from the light is a little greyer.
      const n2 = fbm(u + 0.004, v - 0.01, period, 4);
      const shade = 0.82 + 0.18 * clamp(0.5 + (n - n2) * 5);
      const i = (y * w + x) * 4;
      const c = byte(shade, x, y);
      px[i] = c; px[i + 1] = c; px[i + 2] = Math.min(255, c + 4);
      px[i + 3] = byte(a * 0.95, x, y);
    }
  write(name, w, h, px);
}
clouds("clouds_far.png", 960, 300, 3, 6, 0.4, 0.74, 0.02, 0.45);
clouds("clouds_near.png", 960, 380, 11, 4, 0.42, 0.78, 0.12, 0.5);

// --- Nine-patches ----------------------------------------------------------------------
function roundRectSD(x, y, w, h, r) {
  const qx = Math.abs(x - w / 2) - (w / 2 - r), qy = Math.abs(y - h / 2) - (h / 2 - r);
  return Math.hypot(Math.max(qx, 0), Math.max(qy, 0)) + Math.min(Math.max(qx, qy), 0) - r;
}
/** Roku nine-patch: 1px border whose black pixels mark the stretchable middle. */
function ninePatch(name, radius, fillAlpha, strokeAlpha, strokeW) {
  const inner = radius * 2 + 8, W = inner + 2;
  const px = new Uint8Array(W * W * 4);
  for (let y = 0; y < inner; y++)
    for (let x = 0; x < inner; x++) {
      const sd = roundRectSD(x + 0.5, y + 0.5, inner, inner, radius);
      const cover = clamp(0.5 - sd);
      const ring = cover - clamp(0.5 - (sd + strokeW));
      const a = clamp(cover * fillAlpha + ring * strokeAlpha * (1 - fillAlpha));
      const i = ((y + 1) * W + (x + 1)) * 4;
      px[i] = px[i + 1] = px[i + 2] = 255;
      px[i + 3] = Math.round(a * 255);
    }
  const mark = (x, y) => { const i = (y * W + x) * 4; px[i] = px[i + 1] = px[i + 2] = 0; px[i + 3] = 255; };
  for (let k = 1 + radius; k < 1 + radius + 8; k++) { mark(k, 0); mark(0, k); mark(k, W - 1); mark(W - 1, k); }
  write(name, W, W, px);
}
ninePatch("card.9.png", 28, 1, 0, 0); // solid, tinted + faded at runtime
ninePatch("card_edge.9.png", 28, 0, 1, 1.6); // hairline outline
ninePatch("focus.9.png", 18, 0.16, 0.7, 2.5); // list focus highlight
ninePatch("pill.9.png", 22, 1, 0, 0);
ninePatch("ring.9.png", 36, 0, 1, 7); // thick focus ring (Dibs game picker)

// --- Fonts -----------------------------------------------------------------------------
// Nunito: rounded terminals read as friendly at couch distance.
const NUNITO = path.join(TOOLS, "node_modules/@expo-google-fonts/nunito");
for (const f of fs.readdirSync(FONTS)) if (f.endsWith(".ttf")) fs.rmSync(path.join(FONTS, f));
for (const [src, dst] of [
  ["200ExtraLight/Nunito_200ExtraLight.ttf", "Nunito-ExtraLight.ttf"],
  ["300Light/Nunito_300Light.ttf", "Nunito-Light.ttf"],
  ["400Regular/Nunito_400Regular.ttf", "Nunito-Regular.ttf"],
  ["600SemiBold/Nunito_600SemiBold.ttf", "Nunito-SemiBold.ttf"],
]) fs.copyFileSync(path.join(NUNITO, src), path.join(FONTS, dst));
fs.copyFileSync(path.join(NUNITO, "LICENSE_FONT"), path.join(FONTS, "OFL.txt"));
console.log("  fonts: Nunito ExtraLight / Light / Regular / SemiBold (SIL OFL 1.1)");

// --- Vector art via headless Chrome ------------------------------------------------------
const { renderVector } = await import("./vector.mjs");
await renderVector({ IMG, FONTS });
