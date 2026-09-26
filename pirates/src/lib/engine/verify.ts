import { getSignature } from "./letters";
import type { Lexicon } from "./lexicon";
import { puzzleProblem, type Puzzle } from "./puzzles";
import type { WordEntry } from "./words";

export interface DatasetReport {
  puzzles: number;
  words: number;
  problems: string[];
}

/** Exact-letter verification of the shipped dataset (used by the build gate and tests). */
export function verifyDataset(puzzles: readonly Puzzle[], words: readonly WordEntry[], lexicon: Lexicon): DatasetReport {
  const problems: string[] = [];
  const ids = new Set<string>();
  for (const p of puzzles) {
    const problem = puzzleProblem(p, lexicon);
    if (problem) problems.push(`puzzle ${p.id}: ${problem}`);
    if (ids.has(p.id)) problems.push(`puzzle ${p.id}: duplicate id`);
    ids.add(p.id);
  }
  for (const w of words) {
    if (w.signature !== getSignature(w.word)) problems.push(`word ${w.word}: signature ${w.signature} is wrong`);
    if (w.length !== w.word.length) problems.push(`word ${w.word}: length ${w.length} is wrong`);
    if (!lexicon.isPlayable(w.word)) problems.push(`word ${w.word}: not playable in the lexicon`);
  }
  return { puzzles: puzzles.length, words: words.length, problems };
}
