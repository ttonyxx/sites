/**
 * Board-level difficulty: the same steal is harder to spot on a crowded
 * board full of look-alike words. Added on top of a puzzle's intrinsic
 * difficulty (engine/puzzles.ts) for scoring and rating updates.
 */
import { getSignature, subtractLetters } from "../engine/letters";

/** Rating points per board word beyond ten. */
const PER_EXTRA_WORD = 8;
/** Rating points when the nearest distractors are entirely made of the target's letters. */
const MAX_SIMILARITY_BONUS = 90;

/** Share of `word`'s letters that the target could supply (0–1). */
export function letterOverlap(word: string, targetSig: string): number {
  let rest = targetSig;
  let hits = 0;
  for (const ch of getSignature(word)) {
    const next = subtractLetters(rest, ch);
    if (next !== null) {
      rest = next;
      hits++;
    }
  }
  return word.length ? hits / word.length : 0;
}

/**
 * How much the other words on the board look like part of the answer:
 * the mean overlap of the three most similar distractors (0–1).
 */
export function distractorSimilarity(target: string, distractors: readonly string[]): number {
  if (!distractors.length) return 0;
  const sig = getSignature(target);
  const overlaps = distractors.map((w) => letterOverlap(w, sig)).sort((a, b) => b - a);
  const top = overlaps.slice(0, 3);
  return top.reduce((s, x) => s + x, 0) / top.length;
}

/** Difficulty adjustment for playing a puzzle on this particular board. */
export function boardAdjustment(target: string, boardWordCount: number, distractors: readonly string[]): number {
  const crowd = PER_EXTRA_WORD * (boardWordCount - 10);
  const lookalikes = MAX_SIMILARITY_BONUS * Math.max(0, distractorSimilarity(target, distractors) - 0.5) * 2;
  return Math.round(crowd + lookalikes);
}
