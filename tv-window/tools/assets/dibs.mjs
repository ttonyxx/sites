// Renders the "Play Dibs" card (images/dibs_card.png): Dibs branding, how to put dibsgames.com/tv on the TV,
// and a QR code for the link. Roku can't run the Dibs web app itself, so the TV mode is mirrored from a
// laptop or phone (AirPlay / Screen Mirroring); this card is the shortcut to that.
import fs from "node:fs";
import path from "node:path";
import { createRequire } from "node:module";

const require = createRequire(import.meta.url);
const QRCode = require("qrcode");

const URL = "https://dibsgames.com/tv";
const INK = "#221836", CREAM = "#FFF6E8", CORAL = "#FF6B57", YELLOW = "#FFC93C", BLUE = "#47B5FF";

// The Dibs mascot (the box from dibsgames.com's favicon).
const MASCOT = `<svg viewBox="0 0 64 64" width="112" height="112">
  <rect width="64" height="64" rx="16" fill="${YELLOW}"/>
  <path d="M14 28 L50 28 L47 52 Q46.6 55 43.5 55 L20.5 55 Q17.4 55 17 52 Z" fill="${CORAL}" stroke="${INK}" stroke-width="4" stroke-linejoin="round"/>
  <path d="M10 20 Q10 17 13 17 L51 17 Q54 17 54 20 L54 26 Q54 29 51 29 L13 29 Q10 29 10 26 Z" fill="${BLUE}" stroke="${INK}" stroke-width="4" stroke-linejoin="round" transform="rotate(-8 32 23)"/>
  <circle cx="26" cy="40" r="3" fill="${INK}"/><circle cx="38" cy="40" r="3" fill="${INK}"/>
  <path d="M27 46 Q32 50 37 46" fill="none" stroke="${INK}" stroke-width="3" stroke-linecap="round"/>
</svg>`;

export async function renderDibs({ browser, IMG, FONTS, TOOLS }) {
  const qr = await QRCode.toString(URL, { type: "svg", margin: 0, errorCorrectionLevel: "M", color: { dark: INK, light: "#0000" } });
  const font = (file) => fs.readFileSync(file).toString("base64");
  const brico = path.join(TOOLS, "node_modules/@fontsource/bricolage-grotesque/files/bricolage-grotesque-latin-800-normal.woff2");
  const brico7 = path.join(TOOLS, "node_modules/@fontsource/bricolage-grotesque/files/bricolage-grotesque-latin-700-normal.woff2");
  const html = `<!doctype html><html><head><style>
    @font-face{font-family:Brico;font-weight:800;src:url(data:font/woff2;base64,${font(brico)}) format('woff2')}
    @font-face{font-family:Brico;font-weight:700;src:url(data:font/woff2;base64,${font(brico7)}) format('woff2')}
    @font-face{font-family:Body;src:url(data:font/ttf;base64,${font(path.join(FONTS, "Nunito-Regular.ttf"))}) format('truetype')}
    @font-face{font-family:Body;font-weight:700;src:url(data:font/ttf;base64,${font(path.join(FONTS, "Nunito-SemiBold.ttf"))}) format('truetype')}
    html,body{margin:0;background:transparent}
    #card{position:relative;box-sizing:border-box;width:1280px;height:720px;border-radius:48px;overflow:hidden;
      background:radial-gradient(circle,rgba(34,24,54,.09) 1.6px,transparent 2px) 0 0/28px 28px,${CREAM};
      color:${INK};padding:64px 72px;display:flex;gap:64px;border:5px solid ${INK}}
    .left{flex:1;display:flex;flex-direction:column}
    .brand{display:flex;align-items:center;gap:22px}
    .badge{font:800 54px Brico;color:#fff;background:${CORAL};border:5px solid ${INK};border-radius:18px;padding:2px 22px 8px;
      transform:rotate(-3deg);box-shadow:6px 6px 0 ${INK};letter-spacing:.01em}
    h1{font:800 66px/1.02 Brico;margin:40px 0 30px;letter-spacing:-.02em}
    ol{list-style:none;margin:0;padding:0;display:flex;flex-direction:column;gap:22px}
    li{display:flex;gap:20px;align-items:flex-start;font:30px/1.3 Body}
    li b{font:700 30px/1.3 Brico}
    .n{flex:none;width:50px;height:50px;border-radius:50%;border:4px solid ${INK};display:grid;place-items:center;font:800 26px Brico;margin-top:-4px}
    .right{width:360px;display:flex;flex-direction:column;align-items:center;justify-content:center;gap:22px}
    .qr{background:#fff;border:5px solid ${INK};border-radius:32px;padding:28px;box-shadow:8px 8px 0 ${INK};width:300px;height:300px}
    .qr svg{width:100%;height:100%;display:block}
    .url{font:800 34px Brico;background:${YELLOW};border:4px solid ${INK};border-radius:16px;padding:4px 18px 8px}
    .scan{font:24px Body;opacity:.7;margin-top:-6px}
  </style></head><body><div id="card">
    <div class="left">
      <div class="brand">${MASCOT}<span class="badge">DIBS</span></div>
      <h1>Play Dibs on the big screen</h1>
      <ol>
        <li><span class="n" style="background:${YELLOW}">1</span><span><b>Open dibsgames.com/tv</b> on a laptop or phone, or scan the code.</span></li>
        <li><span class="n" style="background:${CORAL};color:#fff">2</span><span><b>Mirror it to this TV</b> with AirPlay or Screen Mirroring.</span></li>
        <li><span class="n" style="background:${BLUE}">3</span><span><b>Everyone joins</b> on their own phone with the room code.</span></li>
      </ol>
    </div>
    <div class="right"><div class="qr">${qr}</div><div class="url">dibsgames.com/tv</div><div class="scan">Scan with your phone camera</div></div>
  </div></body></html>`;

  const page = await browser.newPage();
  await page.setViewport({ width: 1280, height: 720, deviceScaleFactor: 1 });
  await page.setContent(html);
  await page.evaluate(() => document.fonts.ready);
  const buf = await (await page.$("#card")).screenshot({ omitBackground: true });
  fs.writeFileSync(path.join(IMG, "dibs_card.png"), buf);
  console.log(`  dibs_card.png          1280x720  ${(buf.length / 1024).toFixed(0)} KB`);
  await page.close();
}
