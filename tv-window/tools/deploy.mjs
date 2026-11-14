#!/usr/bin/env node
// Sideloads the Window channel onto a Roku in Developer Mode.
//
//   npm run deploy            package, find the TV, ask for the dev password, install, screenshot
//   npm run dev               same, then keep watching ../channel and reinstall on every change
//
// Options: --host 10.0.0.16   skip discovery      --no-shot   don't grab a screenshot
// The password is read from ROKU_DEV_PASSWORD or typed at a hidden prompt; it is never written to disk.
import { execFile } from "node:child_process";
import dgram from "node:dgram";
import fs from "node:fs";
import net from "node:net";
import path from "node:path";
import readline from "node:readline";
import { fileURLToPath } from "node:url";
import { buildPackage } from "./package.mjs";

const TOOLS = path.dirname(fileURLToPath(import.meta.url));
const CHANNEL = path.resolve(TOOLS, "../channel");
const SHOT = path.join(TOOLS, "dist", "screenshot.jpg");
const args = process.argv.slice(2);
const flag = (name) => args.includes(`--${name}`);
const opt = (name) => { const i = args.indexOf(`--${name}`); return i >= 0 ? args[i + 1] : undefined; };

function discover(timeoutMs = 3000) {
  return new Promise((resolve) => {
    const sock = dgram.createSocket("udp4");
    const found = new Map();
    sock.on("message", (msg, rinfo) => {
      const text = msg.toString();
      if (/roku:ecp/i.test(text) || /Roku/i.test(text)) found.set(rinfo.address, true);
    });
    sock.bind(() => {
      const q = Buffer.from('M-SEARCH * HTTP/1.1\r\nHOST: 239.255.255.250:1900\r\nMAN: "ssdp:discover"\r\nST: roku:ecp\r\nMX: 2\r\n\r\n');
      sock.send(q, 1900, "239.255.255.250");
      setTimeout(() => sock.send(q, 1900, "239.255.255.250"), 500);
    });
    setTimeout(() => { sock.close(); resolve([...found.keys()]); }, timeoutMs);
  });
}

function portOpen(host, port) {
  return new Promise((resolve) => {
    const s = net.connect({ host, port, timeout: 2500 }, () => { s.destroy(); resolve(true); });
    s.on("error", () => resolve(false));
    s.on("timeout", () => { s.destroy(); resolve(false); });
  });
}

function askHidden(question) {
  return new Promise((resolve) => {
    const rl = readline.createInterface({ input: process.stdin, output: process.stdout, terminal: true });
    rl._writeToOutput = (s) => { if (s.includes(question)) rl.output.write(s); };
    rl.question(question, (answer) => { rl.close(); process.stdout.write("\n"); resolve(answer); });
  });
}

// curl does the HTTP digest auth; credentials go in via stdin so they never show up in `ps`.
function curl(password, curlArgs, { binaryOut } = {}) {
  return new Promise((resolve, reject) => {
    const child = execFile("curl", ["-sS", "--digest", "-K", "-", "--max-time", "120", ...curlArgs], { encoding: binaryOut ? "buffer" : "utf8", maxBuffer: 64 << 20 }, (err, stdout) => {
      if (err) reject(err); else resolve(stdout);
    });
    child.stdin.end(`user = "rokudev:${password.replace(/(["\\])/g, "\\$1")}"\n`);
  });
}

async function install(host, password) {
  const zip = buildPackage();
  const html = await curl(password, ["-F", "mysubmit=Replace", "-F", `archive=@${zip}`, `http://${host}/plugin_install`]);
  if (/401|Unauthorized/i.test(html) && !/Install Success|Identical/i.test(html)) throw new Error("The TV rejected the password (user is rokudev).");
  const msgs = [...html.matchAll(/'(Install (?:Success|Failure)[^']*|Identical to previous version[^']*|Application Received[^']*)'/g)].map((m) => m[1]);
  const text = msgs.join(" | ") || html.replace(/<[^>]+>/g, " ").replace(/\s+/g, " ").slice(0, 200);
  if (/Failure|Compilation Failed/i.test(html)) throw new Error(`Install failed: ${text}`);
  console.log(`✓ Installed on ${host}  (${text})`);
}

async function screenshot(host, password) {
  const html = await curl(password, ["-F", "mysubmit=Screenshot", "-F", "archive=", "-F", "passwd=", `http://${host}/plugin_inspect`]);
  const m = html.match(/pkgs\/dev\.(jpg|png)(\?[^"']*)?/);
  if (!m) return console.log("(no screenshot — is the channel running?)");
  const buf = await curl(password, [`http://${host}/${m[0]}`], { binaryOut: true });
  fs.writeFileSync(SHOT, buf);
  console.log(`✓ Screenshot saved to ${path.relative(process.cwd(), SHOT)}`);
}

async function main() {
  let host = opt("host") || process.env.ROKU_HOST;
  if (!host) {
    process.stdout.write("Looking for Roku devices on the network… ");
    const hosts = await discover();
    console.log(hosts.length ? hosts.join(", ") : "none found");
    host = hosts[0];
  }
  if (!host) throw new Error("No Roku found. Pass --host <ip>.");

  if (!(await portOpen(host, 80))) {
    console.log(`\nDeveloper Mode is off on ${host}. On the Roku remote press:\n  Home ×3, Up ×2, Right, Left, Right, Left, Right\nthen enable the installer, accept the license, set a password, and run this again.`);
    process.exit(2);
  }

  const password = process.env.ROKU_DEV_PASSWORD || (await askHidden(`Developer password for ${host} (user rokudev): `));
  await install(host, password);
  if (!flag("no-shot")) { await new Promise((r) => setTimeout(r, 6000)); await screenshot(host, password).catch((e) => console.log(`(screenshot failed: ${e.message})`)); }

  if (!flag("watch")) return;
  console.log(`\nWatching ${path.relative(process.cwd(), CHANNEL)} — edits reinstall automatically. Ctrl+C to stop.`);
  let timer = null, busy = false, again = false;
  const redeploy = async () => {
    if (busy) { again = true; return; }
    busy = true;
    try {
      await install(host, password);
      if (!flag("no-shot")) { await new Promise((r) => setTimeout(r, 6000)); await screenshot(host, password); }
    } catch (e) { console.error(`✗ ${e.message}`); }
    busy = false;
    if (again) { again = false; redeploy(); }
  };
  fs.watch(CHANNEL, { recursive: true }, (_e, file) => {
    if (!file || path.basename(file).startsWith(".")) return;
    clearTimeout(timer);
    timer = setTimeout(redeploy, 800);
  });
}

main().catch((e) => { console.error(`✗ ${e.message}`); process.exit(1); });
