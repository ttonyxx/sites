/**
 * Generates data/puzzles.json and data/words.json from public/lexicon.txt.
 *
 * For every familiar target word we enumerate the sub-multisets of its letters
 * and look them up in a signature index of board-worthy source words:
 *
 *   steal        target − 1..2 letters             = one source word
 *   fusion       target − source A                 = source B
 *   fusion-plus  target − source A − 1 letter      = source B
 *   triple       target − source A − source B      = source C
 *
 * Every candidate is checked with exact letter counts (puzzleProblem), scored
 * for quality (familiar words, genuinely rearranged, not just a plural) and
 * difficulty, then a balanced, diverse set is kept. data/curated.json entries
 * are always included.
 */
import fs from "node:fs";
import path from "node:path";
import { getSignature, subSignatures, subtractLetters, type Signature } from "../src/lib/engine/letters";
import { Lexicon, TIER_FAMILIARITY, type Tier } from "../src/lib/engine/lexicon";
import {
  bandFor,
  computeDifficulty,
  featuresFor,
  isTrivialSteal,
  puzzleId,
  puzzleProblem,
  puzzleTypeFor,
  type DifficultyBand,
  type Puzzle,
  type PuzzleType,
} from "../src/lib/engine/puzzles";
import type { WordEntry } from "../src/lib/engine/words";

const ROOT = path.join(__dirname, "..");
const lexicon = Lexicon.fromText(fs.readFileSync(path.join(ROOT, "public", "lexicon.txt"), "utf8"));

const tierOf = (w: string): Tier => {
  const t = lexicon.tier(w);
  return t === undefined || t === "x" ? 0 : t;
};

// ── Vocabulary ──────────────────────────────────────────────────────────────

const TARGET_MIN_TIER: Tier = 3;
const has = (x: string) => x.length >= 3 && lexicon.isPlayable(x);

/** Looks like an inflection of a simpler word (plural, past tense, -ing…). */
function isInflection(w: string): boolean {
  if (w.endsWith("ies") && has(w.slice(0, -3) + "y")) return true;
  if (w.endsWith("ied") && has(w.slice(0, -3) + "y")) return true;
  if (isPlainPlural(w)) return true;
  if (w.endsWith("ed") && (has(w.slice(0, -2)) || has(w.slice(0, -1)) || (w.length > 5 && w.at(-3) === w.at(-4) && has(w.slice(0, -3))))) return true;
  if (w.endsWith("ing") && (has(w.slice(0, -3)) || has(w.slice(0, -3) + "e"))) return true;
  return false;
}

/** LITERS, NOTES, BOXES: the plurals people naturally make in Pirates. */
function isPlainPlural(w: string): boolean {
  return w.endsWith("s") && !w.endsWith("ss") && (has(w.slice(0, -1)) || (w.endsWith("es") && has(w.slice(0, -2))));
}

/**
 * Comparative/superlative forms (GOLDENER, HOARSEST, MEASLIER). SCOWL lists
 * these at common levels even when nobody says them. Detected by the sibling
 * form existing: X+er and X+est are both words.
 */
function isDegreeForm(w: string): boolean {
  if (w.endsWith("iest")) return has(w.slice(0, -4) + "ier");
  if (w.endsWith("ier")) return has(w.slice(0, -3) + "iest");
  if (w.endsWith("est")) return has(w.slice(0, -3) + "er");
  if (w.endsWith("er")) return has(w.slice(0, -2) + "est");
  return false;
}

/** Real words that nonetheless look odd sitting on a board (plurals of 2-letter words, etc.). */
const ODD_ON_A_BOARD = new Set(
  "hes ifs ins mas ohs pas pis ups qua sic chi cox sop ova thy nit sac ohm ugh huh pap gob lye yen yap fro cad din fen eon hew moron idiot".split(" "),
);

/** Words that look natural sitting on a Pirates board. */
function isBoardWorthy(w: string): boolean {
  const t = tierOf(w);
  if (lexicon.tier(w) === "x" || w.length < 3 || w.length > 8 || ODD_ON_A_BOARD.has(w)) return false;
  if (t < 3 || (t === 3 && w.length > 4)) return false;
  if (t < 5 && isDegreeForm(w)) return false;
  if (t < 5 && isInflection(w) && !isPlainPlural(w)) return false;
  return true;
}

/** Words good enough to be the intended answer. */
function isTargetWorthy(w: string): boolean {
  const t = tierOf(w);
  return lexicon.tier(w) !== "x" && t >= TARGET_MIN_TIER && w.length >= 4 && (t === 5 || !isDegreeForm(w));
}

/** Signature → board-worthy source words, most familiar first (max 3 per signature). */
const sourceIndex = new Map<Signature, string[]>();
for (const w of lexicon.wordsWhere((w) => isBoardWorthy(w))) {
  const sig = getSignature(w);
  const list = sourceIndex.get(sig) ?? [];
  list.push(w);
  sourceIndex.set(sig, list);
}
for (const [sig, list] of sourceIndex) {
  list.sort((a, b) => tierOf(b) - tierOf(a) || Number(isInflection(a)) - Number(isInflection(b)) || a.localeCompare(b));
  sourceIndex.set(sig, list.slice(0, 3));
}

/** Distinct letter-sets that spell at least one familiar target. */
const targetSigs = new Set<Signature>();
for (const w of lexicon.wordsWhere((w) => isTargetWorthy(w))) targetSigs.add(getSignature(w));

function answersFor(sig: Signature, sources: string[]): string[] {
  return lexicon
    .anagrams(sig)
    .filter((w) => lexicon.isPlayable(w, 3) && w.length >= 4 && !isTrivialSteal(sources, w))
    .sort(
      (a, b) =>
        Number(isTargetWorthy(b)) - Number(isTargetWorthy(a)) ||
        tierOf(b) - tierOf(a) ||
        Number(isInflection(a)) - Number(isInflection(b)) ||
        a.localeCompare(b),
    );
}

// ── Candidate generation ────────────────────────────────────────────────────

interface Candidate extends Puzzle {
  quality: number;
}

/** Only the best few candidates per letter-set survive (each letter-set is used at most once). */
const KEEP_PER_TYPE = 2;
const candidates: Candidate[] = [];

function makeCandidate(sources: string[], loose: string, sig: Signature, pool: readonly string[]): Candidate | null {
  if (new Set(sources).size !== sources.length) return null;
  const answers = pool.filter((w) => !isTrivialSteal(sources, w));
  if (answers.length === 0 || !isTargetWorthy(answers[0])) return null;
  const target = answers[0];
  const type = puzzleTypeFor(sources.length, loose.length);
  const features = featuresFor(sources, loose, answers, lexicon);
  const difficulty = computeDifficulty(features);
  const puzzle: Puzzle = { id: puzzleId(sources, loose, target), type, sources, loose, target, answers, difficulty, band: bandFor(difficulty) };
  if (puzzleProblem(puzzle, lexicon)) return null;
  return { ...puzzle, quality: qualityOf(puzzle, features.scramble) };
}

function qualityOf(p: Puzzle, scramble: number): number {
  const fam = (w: string) => TIER_FAMILIARITY[tierOf(w)];
  let q = 2 * fam(p.target) + p.sources.reduce((s, w) => s + fam(w), 0) / p.sources.length + 0.8 * scramble;
  q += (0.25 * Math.min(p.target.length, 10)) / 10;
  if (isInflection(p.target)) q -= 0.45; // "TIERS" is fine, but base words make better puzzles
  if (p.loose === "s") q -= 0.35;
  q -= 0.15 * p.sources.filter(isInflection).length;
  if (p.answers.length > 1) q += 0.05;
  return q;
}

console.time("generate");
const sourceSigSet = new Set(sourceIndex.keys());

for (const sig of targetSigs) {
  const L = sig.length;
  const pool = answersFor(sig, []);
  if (pool.length === 0) continue;
  const local: Record<PuzzleType, Candidate[]> = { steal: [], fusion: [], "fusion-plus": [], triple: [] };
  const add = (sources: string[], loose: string) => {
    const c = makeCandidate(sources, loose, sig, pool);
    if (c) local[c.type].push(c);
  };

  // steal: one source + 1–2 loose letters
  if (L >= 4 && L <= 10) {
    for (const rest of subSignatures(sig, Math.max(3, L - 2), L - 1)) {
      const srcs = sourceIndex.get(rest);
      if (!srcs) continue;
      const loose = subtractLetters(sig, rest)!;
      for (const s of srcs) add([s], loose);
    }
  }

  if (L >= 6) {
    const subs = subSignatures(sig, 3, L - 3).filter((s) => sourceSigSet.has(s));
    for (const a of subs) {
      const restA = subtractLetters(sig, a)!;
      const [wa1, wa2] = sourceIndex.get(a)!;

      // fusion: two sources
      if (L <= 13 && a <= restA && sourceSigSet.has(restA)) {
        for (const wa of [wa1, wa2]) for (const wb of sourceIndex.get(restA)!.slice(0, 2)) if (wa) add([wa, wb], "");
      }

      // fusion-plus: two sources + one loose letter
      if (L >= 7 && L <= 13) {
        for (const letter of new Set(restA)) {
          const b = subtractLetters(restA, letter)!;
          if (b.length < 3 || a > b || !sourceSigSet.has(b)) continue;
          add([wa1, sourceIndex.get(b)![0]], letter);
        }
      }

      // triple: three sources
      if (L >= 9 && L <= 14) {
        for (const b of subSignatures(restA, 3, restA.length - 3)) {
          if (b < a || !sourceSigSet.has(b)) continue;
          const c = subtractLetters(restA, b)!;
          if (c < b || !sourceSigSet.has(c)) continue;
          add([wa1, sourceIndex.get(b)![0], sourceIndex.get(c)![0]], "");
        }
      }
    }
  }

  for (const list of Object.values(local)) {
    list.sort((x, y) => y.quality - x.quality);
    candidates.push(...list.slice(0, KEEP_PER_TYPE));
  }
}
console.timeEnd("generate");

// ── Curated classics ────────────────────────────────────────────────────────

interface CuratedEntry {
  sources: string[];
  loose?: string;
  target: string;
}
const curated: Puzzle[] = [];
const curatedFile = path.join(ROOT, "data", "curated.json");
for (const c of JSON.parse(fs.readFileSync(curatedFile, "utf8")) as CuratedEntry[]) {
  const sources = c.sources.map((s) => s.toLowerCase());
  const loose = getSignature(c.loose ?? "");
  const sig = getSignature(sources.join("") + loose);
  const others = answersFor(sig, sources).filter((w) => w !== c.target);
  const answers = [c.target, ...others];
  const features = featuresFor(sources, loose, answers, lexicon);
  const difficulty = computeDifficulty(features);
  const p: Puzzle = {
    id: puzzleId(sources, loose, c.target),
    type: puzzleTypeFor(sources.length, loose.length),
    sources,
    loose,
    target: c.target,
    answers,
    difficulty,
    band: bandFor(difficulty),
  };
  const problem = puzzleProblem(p, lexicon);
  if (problem) {
    console.warn(`✗ curated ${c.sources.join(" + ")} → ${c.target}: ${problem} (skipped)`);
    continue;
  }
  curated.push(p);
}

// ── Selection ───────────────────────────────────────────────────────────────

const QUOTAS: Record<PuzzleType, Record<DifficultyBand, number>> = {
  steal: { easy: 420, medium: 480, hard: 340, insane: 160 },
  fusion: { easy: 200, medium: 440, hard: 460, insane: 300 },
  "fusion-plus": { easy: 60, medium: 200, hard: 220, insane: 140 },
  triple: { easy: 0, medium: 40, hard: 110, insane: 110 },
};
const MAX_USES_PER_SOURCE = 4;

const withoutQuality = ({ quality, ...puzzle }: Candidate): Puzzle => (void quality, puzzle);

const selected: Puzzle[] = [];
const usedTargets = new Set<Signature>();
const sourceUses = new Map<string, number>();
const take = (p: Puzzle) => {
  selected.push(p);
  usedTargets.add(getSignature(p.target));
  for (const s of p.sources) sourceUses.set(s, (sourceUses.get(s) ?? 0) + 1);
};

for (const p of curated) take(p);

const ranked = [...candidates].sort((a, b) => b.quality - a.quality || a.id.localeCompare(b.id));
const filled: Record<string, number> = {};
for (const c of ranked) {
  const key = `${c.type}/${c.band}`;
  if ((filled[key] ?? 0) >= QUOTAS[c.type][c.band]) continue;
  if (usedTargets.has(getSignature(c.target))) continue;
  if (c.sources.some((s) => (sourceUses.get(s) ?? 0) >= MAX_USES_PER_SOURCE)) continue;
  take(withoutQuality(c));
  filled[key] = (filled[key] ?? 0) + 1;
}

selected.sort((a, b) => a.type.localeCompare(b.type) || a.difficulty - b.difficulty || a.id.localeCompare(b.id));

// ── Board vocabulary (words.json) ───────────────────────────────────────────

const boardWords = new Set<string>();
for (const p of selected) for (const s of p.sources) boardWords.add(s);
// Everyday base words to fill boards around the planted steals.
for (const w of lexicon.wordsWhere((w, t) => t === 5 && w.length >= 3 && w.length <= 7)) {
  if (isBoardWorthy(w) && !isInflection(w)) boardWords.add(w);
}
const words: WordEntry[] = [...boardWords].sort().map((word) => ({
  word,
  signature: getSignature(word),
  length: word.length,
  familiarity: TIER_FAMILIARITY[tierOf(word)],
}));

// ── Write ───────────────────────────────────────────────────────────────────

const dataDir = path.join(ROOT, "data");
const oneLinePerItem = (items: unknown[]) => `[\n${items.map((i) => JSON.stringify(i)).join(",\n")}\n]\n`;
fs.writeFileSync(path.join(dataDir, "puzzles.json"), oneLinePerItem(selected));
fs.writeFileSync(path.join(dataDir, "words.json"), oneLinePerItem(words));

const summary: Record<string, Record<string, number>> = {};
for (const p of selected) {
  summary[p.type] ??= {};
  summary[p.type][p.band] = (summary[p.type][p.band] ?? 0) + 1;
}
console.log(`candidates: ${candidates.length.toLocaleString()}  curated: ${curated.length}`);
console.log(`✓ data/puzzles.json — ${selected.length} puzzles`, summary);
console.log(`✓ data/words.json — ${words.length} board words`);
