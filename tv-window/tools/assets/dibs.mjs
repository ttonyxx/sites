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

  // Game picker art for hosting on the TV through the streamer: a header and one tile per game.
  const head = html.split("<body>")[0];
  const shot = async (name, w, h, body) => {
    await page.setViewport({ width: w, height: h, deviceScaleFactor: 1 });
    await page.setContent(`${head}<body><div id="x" style="width:${w}px;height:${h}px">${body}</div></body></html>`);
    await page.evaluate(() => document.fonts.ready);
    const b = await (await page.$("#x")).screenshot({ omitBackground: true });
    fs.writeFileSync(path.join(IMG, name), b);
    console.log(`  ${name.padEnd(22)} ${w}x${h}  ${(b.length / 1024).toFixed(0)} KB`);
  };
  await shot("dibs_header.png", 1400, 150, `<div style="display:flex;align-items:center;gap:26px;height:150px">
    ${MASCOT.replace('width="112" height="112"', 'width="104" height="104"')}<span class="badge" style="font-size:46px">DIBS</span>
    <div style="margin-left:14px"><div style="font:800 58px/1 Brico;color:#fff;letter-spacing:-.02em">Host a game on this TV</div>
    <div style="font:28px Body;color:rgba(255,255,255,.75);margin-top:10px">Pick one, then everyone joins on their phones.</div></div></div>`);
  const games = [
    ["punchline", "Punchline", "Funny answers, head to head votes", "3 to 16 players", YELLOW, INK],
    ["imposter", "Imposter", "Give clues, catch the faker", "3 to 15 players", "#9B6BFF", "#fff"],
    ["tee-party", "Tee Party", "Draw, write, and battle T-shirts", "3 to 8 players", "#FF7AC6", INK],
    ["brawl", "Blob Brawl", "Wobbly 3D beasts, last one standing", "2 to 8 players", BLUE, INK],
    ["piggyback", "Piggyback", "Stack up and get the team through the door", "2 to 8 players", "#2DD4A0", INK],
    ["pirates", "Pirates", "Grab and steal words from the pool", "1 to 8 players", "#FFFFFF", INK],
    ["fishbowl", "Fishbowl", "Two teams race to guess the cards in the bowl", "4 to 16 players", "#FF9A52", INK],
  ];
  for (const [id, name, blurb, players, bg, fg] of games) {
    await shot(`dibs_g_${id}.png`, 440, 250, `<div style="box-sizing:border-box;width:440px;height:250px;border-radius:30px;background:${bg};
      border:5px solid ${INK};box-shadow:inset 0 -10px 0 rgba(0,0,0,.12);padding:28px 30px;color:${fg};display:flex;flex-direction:column">
      <div style="font:800 50px/1 Brico;letter-spacing:-.02em">${name}</div>
      <div style="font:26px/1.25 Body;margin-top:14px;opacity:.88">${blurb}</div>
      <div style="margin-top:auto;font:700 22px Brico;opacity:.7">${players}</div></div>`);
  }
  // Tee Party pieces for the native TV screen (DibsNative.brs): the VS burst, the K.O. stamp, the champion's belt,
  // and a faint shirt shown while a painted one loads (same size and outline as the streamer's /tee.png).
  await shot("tko_vs.png", 180, 144, `<svg viewBox="-40 -32 80 64" width="180" height="144">
    <path d="M0 -28 L9 -10 L30 -14 L17 1 L32 15 L10 12 L5 30 L-6 13 L-28 19 L-15 3 L-32 -11 L-10 -10 Z" fill="${YELLOW}" stroke="${INK}" stroke-width="4" stroke-linejoin="round"/>
    <text y="6" text-anchor="middle" font-family="Brico" font-weight="800" font-size="17" fill="${INK}">VS</text></svg>`);
  await shot("tko_ko.png", 320, 150, `<div style="width:320px;height:150px;display:grid;place-items:center;font:800 116px/1 Brico;color:${CORAL};
    -webkit-text-stroke:7px ${INK};paint-order:stroke fill;text-shadow:0 10px 0 ${INK}">K.O.</div>`);
  await shot("tko_belt.png", 450, 135, `<svg viewBox="0 0 200 60" width="450" height="135">
    <path d="M6 22 Q100 8 194 22 L194 40 Q100 26 6 40 Z" fill="${YELLOW}" stroke="${INK}" stroke-width="4" stroke-linejoin="round"/>
    <ellipse cx="100" cy="30" rx="30" ry="22" fill="#FFE38A" stroke="${INK}" stroke-width="4"/>
    <path d="M86 32 L92 22 L100 30 L108 22 L114 32 L112 38 L88 38 Z" fill="${INK}"/>
    <circle cx="40" cy="26" r="4" fill="${INK}"/><circle cx="160" cy="26" r="4" fill="${INK}"/></svg>`);
  await shot("tko_blank.png", 560, 560, `<svg viewBox="0 0 300 300" width="560" height="560">
    <path d="M110 26 Q150 62 190 26 L242 40 L292 92 L256 128 L226 108 L228 284 Q150 292 72 284 L74 108 L44 128 L8 92 L58 40 Z"
      fill="rgba(255,255,255,.45)" stroke="rgba(34,24,54,.35)" stroke-width="6" stroke-linejoin="round"/></svg>`);
  // Fishbowl pieces (DibsNative.brs): the web's goldfish bowl of slips, a "got it" check, and the winner's crown.
  const BOWL = "M112 28 H188 Q188 44 202 54 Q232 74 232 110 Q232 162 150 163 Q68 162 68 110 Q68 74 98 54 Q112 44 112 28 Z";
  const slips = [[108, 140, -14, "#FFF6E8"], [140, 147, 8, "#FFE9A8"], [176, 141, 18, "#FFF6E8"], [124, 128, 22, "#FFD3E8"], [162, 127, -10, "#FFF6E8"]]
    .map(([x, y, r, f]) => `<g transform="translate(${x} ${y}) rotate(${r})"><rect x="-17" y="-10" width="34" height="20" rx="3" fill="${f}" stroke="${INK}" stroke-width="3"/>
      <path d="M-9 -2 H9 M-9 4 H3" stroke="${INK}" stroke-width="2.5" stroke-linecap="round"/></g>`).join("");
  await shot("fb_bowl.png", 330, 300, `<svg viewBox="64 18 172 150" width="330" height="288" style="display:block;margin-top:6px">
    <defs><clipPath id="g"><path d="${BOWL}"/></clipPath></defs>
    <path d="${BOWL}" fill="#E8F6FF"/>
    <g clip-path="url(#g)"><rect x="60" y="74" width="180" height="100" fill="#8FD3FF"/>
      <path d="M40 76 Q60 68 80 76 T120 76 T160 76 T200 76 T240 76 T280 76 V88 H40 Z" fill="#B9E6FF"/>${slips}
      <g transform="translate(150 102)"><path d="M-21 0 L-36 -13 L-32 0 L-36 13 Z" fill="#FF9A3C" stroke="${INK}" stroke-width="3.5" stroke-linejoin="round"/>
        <ellipse cx="0" cy="0" rx="24" ry="14" fill="#FF9A3C" stroke="${INK}" stroke-width="3.5"/>
        <path d="M-6 -13 Q0 -24 10 -12" fill="#FFC93C" stroke="${INK}" stroke-width="3" stroke-linejoin="round"/>
        <circle cx="11" cy="-3" r="3.2" fill="${INK}"/><path d="M19 5 Q15 9 10 6" stroke="${INK}" stroke-width="2.5" fill="none" stroke-linecap="round"/></g></g>
    <path d="M88 96 Q86 76 102 64" fill="none" stroke="#FFFFFF" stroke-width="5" stroke-linecap="round" opacity=".85"/>
    <path d="${BOWL}" fill="none" stroke="${INK}" stroke-width="5" stroke-linejoin="round"/>
    <rect x="106" y="22" width="88" height="11" rx="5.5" fill="#E8F6FF" stroke="${INK}" stroke-width="4.5"/></svg>`);
  await shot("fb_check.png", 48, 48, `<svg viewBox="0 0 48 48" width="48" height="48"><circle cx="24" cy="24" r="20" fill="#2DD4A0" stroke="${INK}" stroke-width="4"/>
    <path d="M14 25 L21 32 L34 17" fill="none" stroke="${INK}" stroke-width="5" stroke-linecap="round" stroke-linejoin="round"/></svg>`);
  await shot("fb_crown.png", 132, 100, `<svg viewBox="1 3 22 17" width="132" height="102"><path d="M3 8 L7.5 12.5 L12 5 L16.5 12.5 L21 8 L19 18 H5 Z"
    fill="${YELLOW}" stroke="${INK}" stroke-width="1.6" stroke-linejoin="round"/></svg>`);
  // App dock icons: Dibs (the mascot box) and a generic music glyph for music apps.
  await shot("app_dibs.png", 192, 192, MASCOT.replace('width="112" height="112"', 'width="192" height="192"'));
  await shot("app_music.png", 192, 192, `<svg viewBox="0 0 64 64" width="192" height="192"><g fill="none" stroke="#fff" stroke-width="5" stroke-linecap="round">
    <path d="M17 25 Q32 19 47 25"/><path d="M19 33 Q32 28.5 45 33"/><path d="M21 41 Q32 37.5 43 41"/></g></svg>`);
  await page.close();
}
