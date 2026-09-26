/**
 * Fusion Vision: 10 boards of 8–12 words, each hiding exactly one intended
 * two-word fusion. We verify no *other* pair on the board also fuses into a
 * familiar word, so there's one clean answer to find.
 */
import { combineSignatures, getSignature } from "../engine/letters";
import type { Lexicon } from "../engine/lexicon";
import { isTrivialSteal, type Puzzle } from "../engine/puzzles";
import type { Rng } from "../engine/rng";
import type { PuzzleBank } from "./bank";
import { IdGen, makeWord, type Board } from "./board";

export const FUSION_SESSION_LENGTH = 10;
export const FUSION_TIME_LIMIT_MS = 30_000;

export interface FusionRound {
  puzzle: Puzzle;
  board: Board;
  /** Board word ids of the two sources. */
  answerWordIds: [string, string];
}

/** Other familiar fusions among the board's words (should be none besides the answer). */
export function otherFusions(words: readonly string[], lexicon: Lexicon, answerPair: readonly [string, string]): string[] {
  const found: string[] = [];
  for (let i = 0; i < words.length; i++) {
    for (let j = i + 1; j < words.length; j++) {
      const pair = [words[i], words[j]];
      if (pair.includes(answerPair[0]) && pair.includes(answerPair[1])) continue;
      const sig = combineSignatures(getSignature(pair[0]), getSignature(pair[1]));
      for (const w of lexicon.anagrams(sig)) {
        if (lexicon.isPlayable(w, 3) && !isTrivialSteal(pair, w)) found.push(w);
      }
    }
  }
  return found;
}

export function buildFusionRound(
  bank: PuzzleBank,
  lexicon: Lexicon,
  rng: Rng,
  opts: { rating: number; used: ReadonlySet<string>; wordCount: number; ids: IdGen },
): FusionRound | null {
  for (let attempt = 0; attempt < 8; attempt++) {
    const puzzle = bank.pick({
      rng,
      types: { fusion: 1 },
      target: opts.rating + rng.int(-60, 90),
      exclude: (p) => opts.used.has(p.id),
    });
    if (!puzzle) return null;

    // Harder puzzles get sneakier distractors (sharing letters with the answer).
    const similarTo = puzzle.difficulty > 1300 ? getSignature(puzzle.target) : undefined;
    const exclude = new Set([...puzzle.sources, ...puzzle.answers]);
    const words = [...puzzle.sources];
    for (const d of bank.distractors(opts.wordCount * 2, { rng, exclude, similarTo, maxLength: 7 })) {
      if (words.length >= opts.wordCount) break;
      const candidate = [...words, d];
      if (otherFusions(candidate, lexicon, [puzzle.sources[0], puzzle.sources[1]]).length === 0) words.push(d);
    }
    if (words.length < Math.min(8, opts.wordCount)) continue;

    const boardWords = rng.shuffle(words).map((w) => makeWord(opts.ids, w, 0, puzzle.sources.includes(w) ? puzzle.id : undefined));
    const a = boardWords.find((w) => w.word === puzzle.sources[0])!;
    const b = boardWords.find((w) => w.word === puzzle.sources[1])!;
    return { puzzle, board: { words: boardWords, loose: [] }, answerWordIds: [a.id, b.id] };
  }
  return null;
}
