// Renders vector art (weather icons, remote key caps, channel posters, splash) with headless Chrome.
import fs from "node:fs";
import path from "node:path";
import puppeteer from "puppeteer-core";

const CHROME = process.env.CHROME_PATH || "/Applications/Google Chrome.app/Contents/MacOS/Google Chrome";

const SUN = "#FFC85C", CLOUD = "#F5F8FC", CLOUD_BACK = "#AEB9C9", RAIN = "#7CC0FF", MOON = "#E6EBFF";
const CLOUD_D =
  "M19 46C13.5 46 10 42 10 37.5C10 33 13.5 29.6 17.8 29.2C19.3 22.8 25 18 31.8 18C38.6 18 44.2 22.6 45.7 28.8C50.6 29.3 54 33 54 37.6C54 42.4 50.2 46 45.4 46Z";

const cloud = (t, fill = CLOUD) => `<path transform="${t}" d="${CLOUD_D}" fill="${fill}"/>`;
const sun = (t = "") => {
  const rays = Array.from({ length: 8 }, (_, i) => {
    const a = (i * Math.PI) / 4, c = Math.cos(a), s = Math.sin(a);
    return `<line x1="${32 + c * 16.5}" y1="${32 + s * 16.5}" x2="${32 + c * 22.5}" y2="${32 + s * 22.5}"/>`;
  }).join("");
  return `<g transform="${t}"><g stroke="${SUN}" stroke-width="3.6" stroke-linecap="round">${rays}</g><circle cx="32" cy="32" r="10.5" fill="${SUN}"/></g>`;
};
const moon = (t = "", id = "m") =>
  `<defs><mask id="${id}"><rect width="64" height="64" fill="#fff"/><circle cx="41" cy="24" r="13" fill="#000"/></mask></defs>` +
  `<g transform="${t}"><circle cx="31" cy="33" r="17" fill="${MOON}" mask="url(#${id})"/></g>`;
const up = "translate(0 -6)";
const drops = (pts, w = 3.6) =>
  `<g stroke="${RAIN}" stroke-width="${w}" stroke-linecap="round">${pts.map(([a, b, c, d]) => `<line x1="${a}" y1="${b}" x2="${c}" y2="${d}"/>`).join("")}</g>`;
const flake = (x, y, r = 4.2) =>
  `<g stroke="${CLOUD}" stroke-width="2.3" stroke-linecap="round">${[0, 60, 120]
    .map((deg) => {
      const a = (deg * Math.PI) / 180, c = Math.cos(a) * r, s = Math.sin(a) * r;
      return `<line x1="${x - c}" y1="${y - s}" x2="${x + c}" y2="${y + s}"/>`;
    })
    .join("")}</g>`;

const ICONS = {
  clear_day: sun(),
  clear_night: moon(),
  partly_day: sun("translate(22 23) scale(0.7) translate(-32 -32)") + cloud("translate(6 8)"),
  partly_night: moon("translate(23 22) scale(0.72) translate(-32 -32)") + cloud("translate(6 8)"),
  cloudy: cloud("translate(15 3) scale(0.8)", CLOUD_BACK) + cloud("translate(-3 9) scale(0.95)"),
  fog:
    `<g stroke="${CLOUD}" stroke-width="4" stroke-linecap="round">` +
    `<line x1="12" y1="23" x2="52" y2="23"/><line x1="8" y1="33" x2="46" y2="33" opacity="0.8"/>` +
    `<line x1="18" y1="43" x2="56" y2="43" opacity="0.6"/></g>`,
  drizzle: cloud(up) + drops([[22, 47, 21, 51], [32, 50, 31, 54], [42, 47, 41, 51]], 3.4),
  rain: cloud(up) + drops([[24, 45, 20, 55], [34, 45, 30, 55], [44, 45, 40, 55]]),
  snow: cloud(up) + flake(22, 50) + flake(33, 55) + flake(44, 50),
  sleet: cloud(up) + drops([[24, 45, 21, 53], [44, 45, 41, 53]]) + flake(33, 53),
  thunder: cloud(up, "#D5DCE6") + `<path d="M35 37L25.5 51H32.5L29 61L41 45.5H34L38 37Z" fill="${SUN}"/>`,
};

const asterisk = Array.from({ length: 3 }, (_, i) => {
  const a = (i * Math.PI) / 3 + Math.PI / 2, c = Math.cos(a) * 9, s = Math.sin(a) * 9;
  return `<line x1="${-c}" y1="${-s}" x2="${c}" y2="${s}"/>`;
}).join("");
const KEYS = {
  key_star: `<svg width="22" height="22" viewBox="-11 -11 22 22"><g stroke="#fff" stroke-width="2.6" stroke-linecap="round">${asterisk}</g></svg>`,
  key_ok: `<span>OK</span>`,
  key_back: `<svg width="24" height="22" viewBox="0 0 24 22"><path d="M9 3L3 9L9 15M3.5 9H15A6 6 0 0 1 15 21H11" fill="none" stroke="#fff" stroke-width="2.6" stroke-linecap="round" stroke-linejoin="round"/></svg>`,
  key_lr: `<svg width="34" height="22" viewBox="0 0 34 22"><path d="M10 4L3 11L10 18M24 4L31 11L24 18" fill="none" stroke="#fff" stroke-width="2.6" stroke-linecap="round" stroke-linejoin="round"/></svg>`,
  key_updown: `<svg width="22" height="26" viewBox="0 0 22 26"><path d="M5 9L11 3L17 9M5 17L11 23L17 17" fill="none" stroke="#fff" stroke-width="2.6" stroke-linecap="round" stroke-linejoin="round"/></svg>`,
};

function fontFace(FONTS, family, file) {
  const b64 = fs.readFileSync(path.join(FONTS, file)).toString("base64");
  return `@font-face{font-family:'${family}';src:url(data:font/ttf;base64,${b64}) format('truetype');}`;
}

function posterHtml(w, h, fonts, { wordmark = true, night = false } = {}) {
  const sky = night
    ? "linear-gradient(180deg,#060A18 0%,#0D1430 55%,#1B2448 100%)"
    : "linear-gradient(180deg,#1A2152 0%,#4A3C7E 42%,#B0617E 74%,#F39A68 100%)";
  const glow = night
    ? "radial-gradient(ellipse 40% 30% at 74% 22%, rgba(150,170,230,.18), transparent 70%)"
    : "radial-gradient(ellipse 46% 40% at 70% 100%, rgba(255,200,140,.85), rgba(255,170,120,.25) 45%, transparent 75%)";
  return `<!doctype html><html><head><style>${fonts}
    html,body{margin:0;width:${w}px;height:${h}px;overflow:hidden}
    .p{position:relative;width:${w}px;height:${h}px;background:${glow},${sky};}
    canvas{position:absolute;inset:0}
    .wm{position:absolute;inset:0;display:flex;align-items:center;justify-content:center;flex-direction:column;
      color:rgba(255,255,255,.96);font-family:'InterX';font-size:${h * (night ? 0.075 : 0.2)}px;letter-spacing:-0.02em}
    .wm small{font-family:'InterR';font-size:${h * 0.05}px;letter-spacing:.08em;text-transform:uppercase;opacity:.7;margin-top:${h * 0.02}px}
    .horizon{position:absolute;left:0;right:0;bottom:${h * 0.18}px;height:1px;background:linear-gradient(90deg,transparent,rgba(255,255,255,.35),transparent)}
  </style></head><body><div class="p"><canvas id="c" width="${w}" height="${h}"></canvas>
    ${night ? "" : '<div class="horizon"></div>'}
    ${wordmark ? `<div class="wm">Window${night ? "" : "<small>sky · clock · weather</small>"}</div>` : ""}
  </div><script>
    const c=document.getElementById('c').getContext('2d');let s=11;const r=()=>((s=(s*1664525+1013904223)>>>0)/4294967296);
    for(let i=0;i<${Math.round((w * h) / (night ? 2600 : 5200))};i++){const x=r()*${w},y=Math.pow(r(),1.6)*${h}*${night ? 0.9 : 0.55};
      const a=(0.25+0.75*Math.pow(r(),2.5))*(1-y/${h});c.fillStyle='rgba(255,255,255,'+a+')';c.beginPath();
      c.arc(x,y,${w / 1920}*(0.6+Math.pow(r(),4)*1.4)+0.35,0,7);c.fill();}
  </script></body></html>`;
}

export async function renderVector({ IMG, FONTS }) {
  const browser = await puppeteer.launch({ executablePath: CHROME, headless: true, args: ["--force-color-profile=srgb"] });
  try {
    const page = await browser.newPage();
    const save = async (name, buf) => {
      fs.writeFileSync(path.join(IMG, name), buf);
      console.log(`  ${name.padEnd(22)} ${(buf.length / 1024).toFixed(0)} KB`);
    };

    // Weather icons, 192px, transparent.
    await page.setViewport({ width: 192, height: 192, deviceScaleFactor: 1 });
    for (const [name, body] of Object.entries(ICONS)) {
      await page.setContent(
        `<html><body style="margin:0;background:transparent"><svg id="s" width="192" height="192" viewBox="0 0 64 64">${body}</svg></body></html>`,
      );
      const el = await page.$("#s");
      await save(`wx_${name}.png`, await el.screenshot({ omitBackground: true }));
    }

    // Remote key caps used in on-screen hints.
    const fonts = fontFace(FONTS, "InterX", "Inter-ExtraLight.ttf") + fontFace(FONTS, "InterR", "Inter-Regular.ttf") + fontFace(FONTS, "InterM", "Inter-Medium.ttf");
    await page.setViewport({ width: 200, height: 100, deviceScaleFactor: 1 });
    for (const [name, inner] of Object.entries(KEYS)) {
      const width = { key_ok: 72, key_lr: 76 }[name] ?? 60;
      await page.setContent(`<html><head><style>${fonts}
        body{margin:0;background:transparent}
        #k{box-sizing:border-box;width:${width}px;height:48px;border:2.5px solid rgba(255,255,255,.85);border-radius:12px;
           display:flex;align-items:center;justify-content:center;color:#fff;font:20px 'InterM';letter-spacing:.02em}
      </style></head><body><div id="k">${inner}</div></body></html>`);
      await page.evaluate(() => document.fonts.ready);
      const el = await page.$("#k");
      await save(`${name}.png`, await el.screenshot({ omitBackground: true }));
    }

    // Channel posters (home-screen tiles) and splash.
    for (const [name, w, h, opts, type] of [
      ["icon_fhd.png", 540, 405, {}, "png"],
      ["icon_hd.png", 290, 218, {}, "png"],
      ["splash_fhd.jpg", 1920, 1080, { night: true }, "jpeg"],
    ]) {
      await page.setViewport({ width: w, height: h, deviceScaleFactor: 1 });
      await page.setContent(posterHtml(w, h, fonts, opts));
      await page.evaluate(() => document.fonts.ready);
      await save(name, await page.screenshot({ type, quality: type === "jpeg" ? 90 : undefined }));
    }
  } finally {
    await browser.close();
  }
}
