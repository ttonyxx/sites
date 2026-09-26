/**
 * Find every steal currently available on a board: all combinations of 1–3
 * board words plus 0–2 loose letters whose letters spell a familiar word.
 * Used to guarantee the board is never dead and to report missed steals.
 */
import { combineSignatures, getSignature, subSignatures } from "../engine/letters";
import type { Lexicon, Tier } from "../engine/lexicon";
import { isTrivialSteal, MIN_TARGET_LENGTH } from "../engine/puzzles";
import type { Board, BoardWord } from "./board";

export interface Opportunity {
  /** Stable while the same pieces stay on the board: word ids + loose letters. */
  key: string;
  wordIds: string[];
  sources: string[];
  /** Loose letters needed, as a signature. */
  loose: string;
  /** Familiar non-trivial answers, most familiar first. */
  answers: string[];
  /** Familiarity tier of the best answer. */
  tier: Tier;
}

export interface FindOptions {
  /** Only count answers at least this familiar. */
  minTier?: Tier;
  maxWords?: number;
  maxLoose?: number;
}

export function opportunityKey(wordIds: readonly string[], loose: string): string {
  return `${[...wordIds].sort().join(",")}|${loose}`;
}

export function findOpportunities(board: Board, lexicon: Lexicon, opts: FindOptions = {}): Opportunity[] {
  const minTier = opts.minTier ?? 3;
  const maxWords = opts.maxWords ?? 3;
  const maxLoose = opts.maxLoose ?? 2;
  const looseSubs = subSignatures(getSignature(board.loose.map((l) => l.letter).join("")), 0, maxLoose);
  const words = board.words.map((w) => ({ w, sig: getSignature(w.word) }));
  const out: Opportunity[] = [];

  const check = (chosen: BoardWord[], sig: string) => {
    for (const loose of looseSubs) {
      if (chosen.length === 1 && loose === "") continue;
      const letters = combineSignatures(sig, loose);
      if (letters.length < MIN_TARGET_LENGTH) continue;
      const found = lexicon.anagrams(letters);
      if (!found.length) continue;
      const sources = chosen.map((c) => c.word);
      let tier: Tier | -1 = -1;
      const answers: string[] = [];
      for (const a of found) {
        const t = lexicon.tier(a);
        if (t === undefined || t === "x" || isTrivialSteal(sources, a)) continue;
        answers.push(a);
        if (t > tier) tier = t;
      }
      if (tier < minTier) continue;
      answers.sort((a, b) => (lexicon.tier(b) as number) - (lexicon.tier(a) as number) || a.localeCompare(b));
      const wordIds = chosen.map((c) => c.id);
      out.push({ key: opportunityKey(wordIds, loose), wordIds, sources, loose, answers, tier: tier as Tier });
    }
  };

  const walk = (start: number, chosen: BoardWord[], sig: string) => {
    if (chosen.length) check(chosen, sig);
    if (chosen.length >= maxWords) return;
    for (let i = start; i < words.length; i++) walk(i + 1, [...chosen, words[i].w], combineSignatures(sig, words[i].sig));
  };
  walk(0, [], "");
  return out;
}
