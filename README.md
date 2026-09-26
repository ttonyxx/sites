# sites

Random ideas, each one a small self-contained website.

**Every top-level folder is its own site**, published at:

```
https://tonyxin.com/sites/<folder>/
```

| Site | URL | What it is |
| --- | --- | --- |
| [`pirates`](pirates) | [tonyxin.com/sites/pirates](https://tonyxin.com/sites/pirates/) | **Pirates Blitz**: an arcade trainer for the anagram-stealing word game Pirates |

## How publishing works

`tonyxin.com` is served by GitHub Pages from the `TtonyxX.github.io` user site.
GitHub Pages serves any *project* repo with Pages enabled at `tonyxin.com/<repo>/`,
so this repo (`sites`) is served at `tonyxin.com/sites/`.

On every push to `main`, [`.github/workflows/deploy.yml`](.github/workflows/deploy.yml) runs
[`scripts/build-sites.mjs`](scripts/build-sites.mjs), which:

1. Finds every top-level folder that isn't hidden (`.`), private (`_`), or tooling (`scripts`, `node_modules`).
2. Builds it:
   - **Node project** (has `package.json` with a `build` script): runs `npm ci`, `npm run check --if-present`,
     then `npm run build` with `SITE_BASE_PATH=/sites/<folder>` in the environment. The output folder
     (`out/`, `dist/`, or `build/`) is published.
   - **Plain static folder** (has `index.html`): published as-is.
3. Writes everything to `_site/<folder>/`, plus an index page for `tonyxin.com/sites/`.
4. Uploads `_site/` to GitHub Pages.

## Adding a new site

1. Create a folder: `mkdir my-idea`.
2. Either drop an `index.html` in it, or create a Node project whose `build` script emits static files.
   Frameworks need to know they live under a sub-path: read `process.env.SITE_BASE_PATH`
   (it defaults to `/sites/<folder>`). For Next.js that means `output: "export"` and `basePath`.
3. Optional: add `site.json` with `{ "title": "...", "description": "..." }` for the index page.
4. Merge to `main`. It's live a minute later.

For day-to-day work, use each site's own dev server (see its README). To build everything
the same way CI does and preview it under `/sites/` like production:

```bash
node scripts/build-sites.mjs && node scripts/preview.mjs   # http://localhost:4173/sites/
```
