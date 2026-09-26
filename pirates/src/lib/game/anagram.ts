/**
 * Raw Anagrams: a 7-letter rack, 30 seconds, as many words as you can.
 * Racks come from familiar 7-letter words that hide plenty of sub-words.
 */
import { getSignature, normalizeWord, subSignatures, subtractLetters } from "../engine/letters";
import type { Lexicon } from "../engine/lexicon";
import type { Rng } from "../engine/rng";
import { RAW_FULL_RACK_BONUS, rawWordScore } from "./scoring";

export const RAW_DURATION_MS = 30_000;
export const RAW_RACK_SIZE = 7;
export const RAW_MIN_WORD = 3;

export interface Rack {
  /** Rack letters in display order. */
  letters: string[];
  /** A 7-letter word that uses the whole rack. */
  seed: string;
  /** Every valid word the rack can make (any familiarity), longest first. */
  all: string[];
  /** The familiar subset, used for "you missed" and the par score. */
  familiar: string[];
  /** Rating-scale difficulty of the rack. */
  difficulty: number;
}

export function wordsFromRack(rackSig: string, lexicon: Lexicon, minTier: number | null = null): string[] {
  const out: string[] = [];
  for (const sub of subSignatures(rackSig, RAW_MIN_WORD)) {
    for (const w of lexicon.anagrams(sub)) {
      const t = lexicon.tier(w);
      if (t === undefined) continue;
      if (minTier !== null && (t === "x" || t < minTier)) continue;
      out.push(w);
    }
  }
  return out.sort((a, b) => b.length - a.length || a.localeCompare(b));
}

export function buildRack(lexicon: Lexicon, rng: Rng, rating: number, avoid: ReadonlySet<string> = new Set()): Rack {
  const seeds = lexicon.wordsWhere((w, t) => w.length === RAW_RACK_SIZE && t !== "x" && t >= 4 && !avoid.has(w));
  let best: Rack | null = null;
  for (let i = 0; i < 40; i++) {
    const seed = rng.pick(seeds);
    const sig = getSignature(seed);
    const familiar = wordsFromRack(sig, lexicon, 4);
    // Harder racks for stronger players: fewer familiar words to lean on.
    const wanted = rating > 1350 ? 14 : rating > 1150 ? 18 : 22;
    if (familiar.length < 12) continue;
    const difficulty = Math.round(1500 - (familiar.length - 12) * 12);
    const rack: Rack = { letters: rng.shuffle([...seed]), seed, all: wordsFromRack(sig, lexicon), familiar, difficulty };
    if (!best || Math.abs(familiar.length - wanted) < Math.abs(best.familiar.length - wanted)) best = rack;
    if (Math.abs(familiar.length - wanted) <= 3) break;
  }
  return best ?? fallbackRack(lexicon);
}

function fallbackRack(lexicon: Lexicon): Rack {
  const seed = "painter";
  const sig = getSignature(seed);
  return { letters: [...seed], seed, all: wordsFromRack(sig, lexicon), familiar: wordsFromRack(sig, lexicon, 4), difficulty: 1200 };
}

export type RawRejectReason = "too-short" | "not-in-rack" | "not-a-word" | "duplicate";

export function checkRawWord(
  input: string,
  rack: Rack,
  found: ReadonlySet<string>,
  lexicon: Lexicon,
): { ok: true; word: string; points: number } | { ok: false; word: string; reason: RawRejectReason } {
  const word = normalizeWord(input);
  if (word.length < RAW_MIN_WORD) return { ok: false, word, reason: "too-short" };
  if (subtractLetters(rack.letters.join(""), word) === null) return { ok: false, word, reason: "not-in-rack" };
  if (found.has(word)) return { ok: false, word, reason: "duplicate" };
  if (!lexicon.has(word)) return { ok: false, word, reason: "not-a-word" };
  const points = rawWordScore(word.length) + (word.length === rack.letters.length ? RAW_FULL_RACK_BONUS : 0);
  return { ok: true, word, points };
}

/** Points a strong player would expect from this rack (used for the rating update). */
export function rackPar(rack: Rack): number {
  const top = rack.familiar.slice(0, 12);
  return Math.round(top.reduce((s, w) => s + rawWordScore(w.length), 0) * 0.45);
}
