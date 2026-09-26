/**
 * Downloads the raw word lists into data/raw/ (gitignored). Only needed when
 * rebuilding public/lexicon.txt — the processed outputs are committed.
 *
 *  - ENABLE (enable1.txt): public-domain word-game dictionary → which words are valid.
 *  - SCOWL 2020.12.07: spell-checker lists split into size levels 10…95 → familiarity.
 *    © Kevin Atkinson, permissive license (see data/SOURCES.md).
 *  - LDNOOBW "en": list of offensive words (CC BY 4.0) → kept out of every puzzle.
 */
import { execFileSync } from "node:child_process";
import fs from "node:fs";
import path from "node:path";

const RAW = path.join(__dirname, "..", "data", "raw");

const SOURCES = {
  enable: "https://raw.githubusercontent.com/dolph/dictionary/master/enable1.txt",
  scowl: "https://sourceforge.net/projects/wordlist/files/SCOWL/2020.12.07/scowl-2020.12.07.tar.gz/download",
  ldnoobw: "https://raw.githubusercontent.com/LDNOOBW/List-of-Dirty-Naughty-Obscene-and-Otherwise-Bad-Words/master/en",
};

async function download(url: string, dest: string) {
  if (fs.existsSync(dest)) {
    console.log(`✓ ${path.relative(process.cwd(), dest)} (cached)`);
    return;
  }
  const res = await fetch(url, { redirect: "follow" });
  if (!res.ok) throw new Error(`GET ${url} → ${res.status}`);
  fs.writeFileSync(dest, Buffer.from(await res.arrayBuffer()));
  console.log(`↓ ${path.relative(process.cwd(), dest)}`);
}

async function main() {
  fs.mkdirSync(RAW, { recursive: true });
  await download(SOURCES.enable, path.join(RAW, "enable1.txt"));
  await download(SOURCES.ldnoobw, path.join(RAW, "ldnoobw-en.txt"));

  const tarball = path.join(RAW, "scowl.tar.gz");
  await download(SOURCES.scowl, tarball);
  const scowlDir = path.join(RAW, "scowl");
  if (!fs.existsSync(scowlDir)) {
    fs.mkdirSync(scowlDir);
    execFileSync("tar", ["-xzf", tarball, "-C", scowlDir, "--strip-components=1"]);
    console.log("✓ extracted SCOWL");
  }
}

main().catch((err) => {
  console.error(err);
  process.exit(1);
});
