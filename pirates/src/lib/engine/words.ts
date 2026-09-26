/** A board-worthy word from data/words.json. */
export interface WordEntry {
  word: string;
  /** Sorted letters, e.g. "coop" → "coop", "agree" → "aeegr". */
  signature: string;
  length: number;
  /** 0–1 rough familiarity (1 = everyday). */
  familiarity: number;
}
