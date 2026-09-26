/**
 * Puzzles: a set of source words (+ optional loose letters) that combine,
 * using every letter exactly once, into a target word.
 *
 *   steal        1 word + 1–2 loose letters   STORE + V   → VOTERS
 *   fusion       2 words                      COOP + AGREE → COOPERAGE
 *   fusion-plus  2 words + 1 loose letter
 *   triple       3 words
 */
import { canCombine, combineSignatures, getSignature, longestCommonSubstring } from "./letters";
import type { Lexicon, Tier } from "./lexicon";

export type PuzzleType = "steal" | "fusion" | "fusion-plus" | "triple";
export type DifficultyBand = "easy" | "medium" | "hard" | "insane";

export interface Puzzle {
  id: string;
  type: PuzzleType;
  /** Board words consumed, lowercase. */
  sources: string[];
  /** Loose letters consumed, as a sorted signature ("" if none). */
  loose: string;
  /** Best (most familiar) answer. */
  target: string;
  /** Every accepted answer for these exact letters, most familiar first. Includes target. */
  answers: string[];
  /** Rating-scale difficulty (~700 easy … 2000+ insane). */
  difficulty: number;
  band: DifficultyBand;
}

export const BANDS: { band: DifficultyBand; label: string; min: number }[] = [
  { band: "easy", label: "Easy", min: -Infinity },
  { band: "medium", label: "Medium", min: 1050 },
  { band: "hard", label: "Hard", min: 1350 },
  { band: "insane", label: "Insane", min: 1650 },
];

export function bandFor(difficulty: number): DifficultyBand {
  let out: DifficultyBand = "easy";
  for (const b of BANDS) if (difficulty >= b.min) out = b.band;
  return out;
}

export function bandLabel(band: DifficultyBand): string {
  return BANDS.find((b) => b.band === band)!.label;
}

export function puzzleTypeFor(sourceCount: number, looseCount: number): PuzzleType {
  if (sourceCount <= 1) return "steal";
  if (sourceCount === 2) return looseCount === 0 ? "fusion" : "fusion-plus";
  return "triple";
}

/** Min letters a target must have. */
export const MIN_TARGET_LENGTH = 4;

/**
 * Pirates' "you must actually rearrange" rule. Adding letters to the ends of a
 * word (STORE → STORES, IRATE → PIRATE) isn't a steal; neither is gluing
 * words together (BATH + ROOM → BATHROOM).
 */
export function isTrivialSteal(sources: readonly string[], target: string): boolean {
  const t = target.toLowerCase();
  if (sources.length === 0) return false;
  return sources.every((s) => t.includes(s.toLowerCase()));
}

/** Why a puzzle is broken, or null if it's valid. Every shipped puzzle passes this. */
export function puzzleProblem(p: Puzzle, lexicon?: Lexicon): string | null {
  if (p.sources.length === 0) return "no sources";
  if (p.target.length < MIN_TARGET_LENGTH) return "target too short";
  if (p.loose !== getSignature(p.loose)) return "loose letters not a sorted signature";
  if (!canCombine(p.sources, p.target, p.loose)) {
    return `letters don't match: ${p.sources.join("+")}${p.loose ? `+${p.loose}` : ""} ≠ ${p.target}`;
  }
  if (p.sources.length === 1 && p.loose.length === 0) return "a single word needs at least one loose letter";
  if (!p.answers.includes(p.target)) return "answers must include target";
  const sig = combineSignatures(...p.sources.map(getSignature), p.loose);
  for (const a of p.answers) {
    if (getSignature(a) !== sig) return `answer ${a} uses different letters`;
    if (isTrivialSteal(p.sources, a)) return `answer ${a} doesn't rearrange its sources`;
  }
  if (p.type !== puzzleTypeFor(p.sources.length, p.loose.length)) return "type doesn't match shape";
  if (lexicon) {
    for (const w of [...p.sources, ...p.answers]) if (!lexicon.has(w)) return `${w} is not in the lexicon`;
  }
  return null;
}

export function isValidPuzzle(p: Puzzle, lexicon?: Lexicon): boolean {
  return puzzleProblem(p, lexicon) === null;
}

export interface DifficultyFeatures {
  targetLength: number;
  sourceCount: number;
  looseCount: number;
  /** Familiarity tier of the target (0–5). */
  targetTier: Tier;
  /** Least familiar source's tier (0–5). */
  sourceTier: Tier;
  /** 0 = target contains a source verbatim, 1 = fully rearranged. */
  scramble: number;
  /** How many familiar words these letters spell (more = easier to hit one). */
  answerCount: number;
}

/**
 * Intrinsic difficulty on a rating-like scale. Board-level factors (how many
 * words, how similar the distractors are) are added at play time.
 */
export function computeDifficulty(f: DifficultyFeatures): number {
  const d =
    700 +
    85 * (f.targetLength - 4) +
    190 * (f.sourceCount - 1) +
    70 * f.looseCount +
    90 * (5 - f.targetTier) +
    40 * (5 - f.sourceTier) +
    260 * (f.scramble - 0.5) -
    70 * Math.min(f.answerCount - 1, 3);
  return Math.round(d / 5) * 5;
}

/** How rearranged the target is relative to its sources (0–1). */
export function scrambleOf(sources: readonly string[], target: string): number {
  let best = 0;
  for (const s of sources) best = Math.max(best, longestCommonSubstring(s, target));
  return 1 - best / target.length;
}

/** Features for a puzzle given a lexicon (tiers default to 3 for unknown words). */
export function featuresFor(sources: readonly string[], loose: string, answers: readonly string[], lexicon: Lexicon): DifficultyFeatures {
  const tierOf = (w: string): Tier => {
    const t = lexicon.tier(w);
    return t === undefined || t === "x" ? 0 : t;
  };
  const target = answers[0];
  return {
    targetLength: target.length,
    sourceCount: sources.length,
    looseCount: loose.length,
    targetTier: tierOf(target),
    sourceTier: Math.min(...sources.map(tierOf)) as Tier,
    scramble: scrambleOf(sources, target),
    answerCount: Math.max(1, answers.filter((a) => tierOf(a) >= 3).length),
  };
}

/** Stable id from the puzzle's shape so the same steal is recognised across sessions. */
export function puzzleId(sources: readonly string[], loose: string, target: string): string {
  return `${[...sources].sort().join("+")}${loose ? `+${loose}` : ""}=${target}`;
}
