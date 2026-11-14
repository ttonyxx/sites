#!/usr/bin/env node
// Serves the in-browser Roku simulator (brs-engine + SceneGraph extension) running the channel.
// Every request for app.zip repackages ../channel, so a browser reload picks up edits.
//
//   npm run preview   ->  http://localhost:8787/?seed=37.7749,-122.4194,San%20Francisco
//   add &mock=rain (clear|partly|overcast|rain|snow|storm|fog) to use a fake forecast instead of Open-Meteo
import http from "node:http";
import fs from "node:fs";
import path from "node:path";
import { fileURLToPath } from "node:url";
import { buildPackage } from "../package.mjs";
import { mockForecast } from "./mock.mjs";

const HERE = path.dirname(fileURLToPath(import.meta.url));
const NM = path.resolve(HERE, "../node_modules");
const PORT = Number(process.env.PORT || 8787);

const ROUTES = {
  "/": [path.join(HERE, "index.html"), "text/html"],
  "/index.html": [path.join(HERE, "index.html"), "text/html"],
  "/brs.api.js": [path.join(NM, "brs-engine/lib/brs.api.js"), "text/javascript"],
  "/brs.worker.js": [path.join(NM, "brs-engine/lib/brs.worker.js"), "text/javascript"],
  "/brs-sg.js": [path.join(NM, "brs-scenegraph/lib/brs-sg.js"), "text/javascript"],
  "/assets/common.zip": [path.join(NM, "brs-scenegraph/assets/common.zip"), "application/zip"],
};

http
  .createServer((req, res) => {
    const url = new URL(req.url, "http://localhost");
    const headers = {
      // SharedArrayBuffer (used by the simulator) needs a cross-origin isolated page.
      "Cross-Origin-Opener-Policy": "same-origin",
      "Cross-Origin-Embedder-Policy": "credentialless",
      "Cross-Origin-Resource-Policy": "same-origin",
      "Cache-Control": "no-store",
    };
    try {
      let file, type;
      const mock = url.pathname.match(/^\/mock\/(\w+)\/v1\/forecast$/);
      if (mock) {
        res.writeHead(200, { ...headers, "Content-Type": "application/json", "Access-Control-Allow-Origin": "*" });
        res.end(JSON.stringify(mockForecast(mock[1], url.searchParams)));
        return;
      }
      if (url.pathname === "/app.zip") {
        file = buildPackage({ quiet: true });
        type = "application/zip";
      } else if (ROUTES[url.pathname]) {
        [file, type] = ROUTES[url.pathname];
      } else {
        res.writeHead(404, headers).end("not found");
        return;
      }
      res.writeHead(200, { ...headers, "Content-Type": type });
      fs.createReadStream(file).pipe(res);
    } catch (err) {
      res.writeHead(500, headers).end(String(err));
    }
  })
  .listen(PORT, "127.0.0.1", () => console.log(`Window preview on http://localhost:${PORT}/`));
