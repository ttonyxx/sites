#!/usr/bin/env node
// Builds every site folder into _site/<folder>/ for GitHub Pages.
// The repo is served at https://tonyxin.com/sites/, so each site lives at /sites/<folder>/.
//
// Usage:
//   node scripts/build-sites.mjs            build every site
//   node scripts/build-sites.mjs pirates    build only the named site(s)

import { execSync } from "node:child_process";
import fs from "node:fs";
import path from "node:path";
import { fileURLToPath } from "node:url";

const ROOT = path.resolve(path.dirname(fileURLToPath(import.meta.url)), "..");
const OUT = path.join(ROOT, "_site");
const URL_PREFIX = "/sites";
const IGNORED = new Set(["scripts", "node_modules"]);
const OUTPUT_DIRS = ["out", "dist", "build"];

function discoverSites() {
  return fs
    .readdirSync(ROOT, { withFileTypes: true })
    .filter((d) => d.isDirectory())
    .map((d) => d.name)
    .filter((name) => !name.startsWith(".") && !name.startsWith("_") && !IGNORED.has(name))
    .filter((name) => {
      const dir = path.join(ROOT, name);
      return fs.existsSync(path.join(dir, "package.json")) || fs.existsSync(path.join(dir, "index.html"));
    })
    .sort();
}

function readJson(file) {
  try {
    return JSON.parse(fs.readFileSync(file, "utf8"));
  } catch {
    return null;
  }
}

function run(cmd, cwd, env = {}) {
  console.log(`  $ ${cmd}`);
  execSync(cmd, { cwd, stdio: "inherit", env: { ...process.env, ...env } });
}

function copyDir(src, dest) {
  fs.cpSync(src, dest, {
    recursive: true,
    filter: (p) => !path.basename(p).startsWith(".") || p === src,
  });
}

function buildSite(name) {
  const dir = path.join(ROOT, name);
  const dest = path.join(OUT, name);
  const pkg = readJson(path.join(dir, "package.json"));
  const meta = readJson(path.join(dir, "site.json")) ?? {};
  const basePath = `${URL_PREFIX}/${name}`;

  console.log(`\n▸ ${name}  →  ${basePath}/`);

  if (pkg?.scripts?.build) {
    const env = { SITE_BASE_PATH: basePath, NEXT_TELEMETRY_DISABLED: "1" };
    run(fs.existsSync(path.join(dir, "package-lock.json")) ? "npm ci --no-audit --no-fund" : "npm install --no-audit --no-fund", dir, env);
    if (pkg.scripts.check) run("npm run check", dir, env);
    run("npm run build", dir, env);
    const outDir = OUTPUT_DIRS.map((d) => path.join(dir, meta.output ?? d)).find((d) => fs.existsSync(d));
    if (!outDir) throw new Error(`${name}: build finished but no ${OUTPUT_DIRS.join("/")} folder was produced`);
    copyDir(outDir, dest);
  } else {
    copyDir(dir, dest);
  }

  return {
    name,
    title: meta.title ?? pkg?.displayName ?? name,
    description: meta.description ?? pkg?.description ?? "",
  };
}

function escapeHtml(s) {
  return String(s).replace(/[&<>"']/g, (c) => ({ "&": "&amp;", "<": "&lt;", ">": "&gt;", '"': "&quot;", "'": "&#39;" })[c]);
}

function writeIndex(sites) {
  const items = sites
    .map(
      (s) => `      <a class="site" href="${URL_PREFIX}/${s.name}/">
        <span class="name">${escapeHtml(s.title)}</span>
        <span class="desc">${escapeHtml(s.description)}</span>
        <span class="path">/sites/${escapeHtml(s.name)}</span>
      </a>`,
    )
    .join("\n");

  const html = `<!doctype html>
<html lang="en">
<head>
  <meta charset="utf-8" />
  <meta name="viewport" content="width=device-width, initial-scale=1" />
  <title>sites · tonyxin.com</title>
  <meta name="description" content="Random ideas, each one a small website." />
  <style>
    :root { color-scheme: dark; --bg: #0a0a0b; --fg: #ededec; --muted: #8b8b88; --line: #1f1f21; --card: #111113; --accent: #f5b544; }
    * { box-sizing: border-box; }
    body { margin: 0; min-height: 100vh; background: var(--bg); color: var(--fg); font: 15px/1.5 ui-sans-serif, system-ui, -apple-system, "Segoe UI", sans-serif; }
    main { max-width: 640px; margin: 0 auto; padding: 72px 16px; }
    h1 { font-size: 28px; letter-spacing: -0.02em; margin: 0 0 6px; }
    p.lede { color: var(--muted); margin: 0 0 40px; }
    .list { display: grid; gap: 10px; }
    .site { display: grid; gap: 2px; padding: 16px 18px; border: 1px solid var(--line); border-radius: 12px; background: var(--card); color: inherit; text-decoration: none; transition: border-color .15s, transform .15s; }
    .site:hover { border-color: #3a3a3d; transform: translateY(-1px); }
    .name { font-weight: 600; }
    .desc { color: var(--muted); font-size: 14px; }
    .path { color: var(--accent); font: 12px/1.6 ui-monospace, SFMono-Regular, Menlo, monospace; }
  </style>
</head>
<body>
  <main>
    <h1>sites</h1>
    <p class="lede">Random ideas, each one a small website.</p>
    <nav class="list">
${items}
    </nav>
  </main>
</body>
</html>
`;
  fs.writeFileSync(path.join(OUT, "index.html"), html);
  fs.writeFileSync(
    path.join(OUT, "404.html"),
    html.replace("<h1>sites</h1>", "<h1>Not found</h1>").replace("Random ideas, each one a small website.</p>", "That page doesn't exist. Try one of these:</p>"),
  );
  // Pages artifacts deployed via Actions skip Jekyll, but keep this so a branch deploy never hides _next/.
  fs.writeFileSync(path.join(OUT, ".nojekyll"), "");
}

const only = process.argv.slice(2);
const sites = discoverSites().filter((s) => only.length === 0 || only.includes(s));
if (only.length && sites.length !== only.length) {
  console.error(`Unknown site(s): ${only.filter((s) => !sites.includes(s)).join(", ")}`);
  process.exit(1);
}

fs.rmSync(OUT, { recursive: true, force: true });
fs.mkdirSync(OUT, { recursive: true });
const built = sites.map(buildSite);
writeIndex(discoverSites().map((name) => built.find((b) => b.name === name) ?? { name, title: name, description: "" }));
console.log(`\n✓ Built ${built.length} site(s) into ${path.relative(ROOT, OUT)}/`);
