/**
 * Builds public/lexicon.txt — every valid word plus a rough familiarity tier.
 *
 *   validity    ENABLE (public-domain word-game list) ∪ common SCOWL words ENABLE lacks (email, blog…)
 *   familiarity SCOWL size level: 10/20 → tier 5 … 80/95 or unlisted → tier 0
 *   blocklist   hard-blocked words are dropped; soft-blocked go to "@x" (valid, never used in puzzles)
 *
 * Run `npm run data:fetch` first. The output is committed, so the app never needs the raw lists.
 */
import fs from "node:fs";
import path from "node:path";
import { LEXICON_MAX_LENGTH, LEXICON_MIN_LENGTH, serializeLexicon, type Tier, type TierKey } from "../src/lib/engine/lexicon";

const DATA = path.join(__dirname, "..", "data");
const RAW = path.join(DATA, "raw");
const OUT = path.join(__dirname, "..", "public", "lexicon.txt");

const SCOWL_LEVELS = [10, 20, 35, 40, 50, 55, 60, 70, 80, 95] as const;
const INFLECTIONS = ["", "s", "es", "d", "ed", "ing"];

function tierForLevel(level: number | undefined): Tier {
  if (level === undefined) return 0;
  if (level <= 20) return 5;
  if (level <= 35) return 4;
  if (level <= 50) return 3;
  if (level <= 60) return 2;
  if (level <= 70) return 1;
  return 0;
}

function readLines(file: string, encoding: BufferEncoding = "utf8"): string[] {
  return fs
    .readFileSync(file, encoding)
    .split(/\r?\n/)
    .map((s) => s.trim());
}

function main() {
  if (!fs.existsSync(path.join(RAW, "enable1.txt"))) {
    throw new Error("Missing data/raw — run `npm run data:fetch` first.");
  }
  const inRange = (w: string) => /^[a-z]+$/.test(w) && w.length >= LEXICON_MIN_LENGTH && w.length <= LEXICON_MAX_LENGTH;

  const enable = new Set(readLines(path.join(RAW, "enable1.txt")).filter(inRange));

  const scowlLevel = new Map<string, number>();
  for (const level of SCOWL_LEVELS) {
    for (const list of ["english-words", "american-words"]) {
      const file = path.join(RAW, "scowl", "final", `${list}.${level}`);
      if (!fs.existsSync(file)) continue;
      for (const w of readLines(file, "latin1")) {
        if (inRange(w) && !scowlLevel.has(w)) scowlLevel.set(w, level);
      }
    }
  }

  const blocklist = JSON.parse(fs.readFileSync(path.join(DATA, "blocklist.json"), "utf8")) as { hard: string[]; soft: string[] };
  const ldnoobw = readLines(path.join(RAW, "ldnoobw-en.txt")).map((w) => w.toLowerCase()).filter((w) => /^[a-z]+$/.test(w));
  const expand = (roots: string[]) => new Set(roots.flatMap((r) => INFLECTIONS.map((s) => r + s)));
  const hard = expand(blocklist.hard);
  const soft = expand([...blocklist.soft, ...ldnoobw]);

  // Curated puzzle words must stay plantable even when SCOWL rates them as rare.
  const curatedFile = path.join(DATA, "curated.json");
  const curatedWords = new Set<string>();
  if (fs.existsSync(curatedFile)) {
    const curated = JSON.parse(fs.readFileSync(curatedFile, "utf8")) as { sources: string[]; target: string }[];
    for (const c of curated) for (const w of [...c.sources, c.target]) curatedWords.add(w.toLowerCase());
  }

  const entries = new Map<string, TierKey>();
  const add = (w: string, tier: TierKey) => {
    if (hard.has(w)) return;
    entries.set(w, soft.has(w) ? "x" : tier);
  };
  for (const w of enable) {
    let tier = tierForLevel(scowlLevel.get(w));
    if (curatedWords.has(w) && tier < 3) tier = 3;
    add(w, tier);
  }
  // Modern everyday words ENABLE predates. Valid to type, but tier 0 so they're never planted.
  for (const [w, level] of scowlLevel) if (!enable.has(w) && level <= 50) add(w, 0);

  fs.mkdirSync(path.dirname(OUT), { recursive: true });
  fs.writeFileSync(OUT, serializeLexicon(entries));

  const counts: Record<string, number> = {};
  for (const t of entries.values()) counts[t] = (counts[t] ?? 0) + 1;
  console.log(`✓ public/lexicon.txt — ${entries.size.toLocaleString()} words`, counts);
  console.log(`  ${(fs.statSync(OUT).size / 1024).toFixed(0)} KB`);
}

main();
