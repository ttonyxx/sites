#!/usr/bin/env node
// Serves _site/ under /sites/ exactly like GitHub Pages does on tonyxin.com.
//   node scripts/build-sites.mjs && node scripts/preview.mjs   → http://localhost:4173/sites/

import fs from "node:fs";
import http from "node:http";
import path from "node:path";
import { fileURLToPath } from "node:url";

const ROOT = path.resolve(path.dirname(fileURLToPath(import.meta.url)), "..", "_site");
const PREFIX = "/sites";
const PORT = Number(process.env.PORT ?? 4173);
const TYPES = {
  ".html": "text/html; charset=utf-8",
  ".js": "text/javascript; charset=utf-8",
  ".css": "text/css; charset=utf-8",
  ".json": "application/json",
  ".txt": "text/plain; charset=utf-8",
  ".svg": "image/svg+xml",
  ".png": "image/png",
  ".ico": "image/x-icon",
  ".woff2": "font/woff2",
  ".webmanifest": "application/manifest+json",
};

function resolveFile(urlPath) {
  const rel = decodeURIComponent(urlPath.slice(PREFIX.length)) || "/";
  const file = path.join(ROOT, path.normalize(rel));
  if (!file.startsWith(ROOT)) return null;
  const candidates = [file, path.join(file, "index.html"), `${file}.html`];
  return candidates.find((f) => fs.existsSync(f) && fs.statSync(f).isFile()) ?? null;
}

http
  .createServer((req, res) => {
    const url = new URL(req.url ?? "/", "http://localhost");
    if (url.pathname === "/" || url.pathname === PREFIX) {
      res.writeHead(302, { location: `${PREFIX}/` }).end();
      return;
    }
    // GitHub Pages redirects directory URLs without a trailing slash.
    const file = url.pathname.startsWith(`${PREFIX}/`) ? resolveFile(url.pathname) : null;
    if (file && file.endsWith("index.html") && !url.pathname.endsWith("/") && !url.pathname.endsWith(".html")) {
      res.writeHead(301, { location: `${url.pathname}/` }).end();
      return;
    }
    const target = file ?? path.join(ROOT, "404.html");
    res.writeHead(file ? 200 : 404, { "content-type": TYPES[path.extname(target)] ?? "application/octet-stream" });
    fs.createReadStream(target).pipe(res);
  })
  .listen(PORT, () => console.log(`Previewing _site at http://localhost:${PORT}${PREFIX}/`));
