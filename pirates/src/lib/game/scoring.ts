/**
 * All scoring rules live here, never in components.
 *
 *   total = (base + length bonus) × speed × combo × difficulty, rounded to 5
 *
 *   base        one-word steal 100 · two-word fusion 250 · three+ words 500
 *   length      +25 per letter beyond 5
 *   speed       ×1.5 if found within 2s of becoming available, fading to ×1.0 at 10s
 *   combo       ×1.0, ×1.25, ×1.5 … capped at ×3.0 (9 quick steals in a row)
 *   difficulty  ×0.8 … ×1.5 around a 1200-rated puzzle
 */

export const SCORING = {
  base: [0, 100, 250, 500] as const,
  lengthBonusPerLetter: 25,
  lengthBonusFrom: 5,
  speed: { max: 1.5, fastMs: 2000, slowMs: 10000 },
  combo: { step: 0.25, cap: 3 },
  difficulty: { pivot: 1200, span: 1600, min: 0.8, max: 1.5 },
  /** Successes closer together than this keep the combo alive. */
  comboWindowMs: 10000,
  /** Seconds taken off the clock for a wrong answer in Steal Sprint. */
  wrongPenaltyMs: 2000,
} as const;

export interface StealScoreInput {
  sourceCount: number;
  targetLength: number;
  /** How long the steal was available before the player took it. */
  solveMs: number;
  /** Combo count including this steal (1 = first in a chain). */
  combo: number;
  /** Rating-scale difficulty of the steal. */
  difficulty: number;
}

export interface ScoreBreakdown {
  base: number;
  lengthBonus: number;
  speedMultiplier: number;
  comboMultiplier: number;
  difficultyMultiplier: number;
  total: number;
}

const clamp = (x: number, lo: number, hi: number) => Math.min(hi, Math.max(lo, x));
const round2 = (x: number) => Math.round(x * 100) / 100;

export function speedMultiplier(solveMs: number): number {
  const { max, fastMs, slowMs } = SCORING.speed;
  const t = clamp((slowMs - solveMs) / (slowMs - fastMs), 0, 1);
  return round2(1 + (max - 1) * t);
}

export function comboMultiplier(combo: number): number {
  const { step, cap } = SCORING.combo;
  return round2(clamp(1 + step * (Math.max(1, combo) - 1), 1, cap));
}

export function difficultyMultiplier(difficulty: number): number {
  const { pivot, span, min, max } = SCORING.difficulty;
  return round2(clamp(1 + (difficulty - pivot) / span, min, max));
}

export function baseScore(sourceCount: number): number {
  return SCORING.base[clamp(sourceCount, 1, 3)];
}

export function lengthBonus(targetLength: number): number {
  return Math.max(0, targetLength - SCORING.lengthBonusFrom) * SCORING.lengthBonusPerLetter;
}

export function scoreSteal(input: StealScoreInput): ScoreBreakdown {
  const base = baseScore(input.sourceCount);
  const bonus = lengthBonus(input.targetLength);
  const speed = speedMultiplier(input.solveMs);
  const combo = comboMultiplier(input.combo);
  const diff = difficultyMultiplier(input.difficulty);
  const total = Math.round(((base + bonus) * speed * combo * diff) / 5) * 5;
  return { base, lengthBonus: bonus, speedMultiplier: speed, comboMultiplier: combo, difficultyMultiplier: diff, total };
}

/** Combo after a success at `now`, given the previous success time. */
export function nextCombo(combo: number, lastSuccessAt: number | null, now: number, windowMs: number = SCORING.comboWindowMs): number {
  if (lastSuccessAt === null || now - lastSuccessAt > windowMs) return 1;
  return combo + 1;
}

// ── Raw Anagrams ───────────────────────────────────────────────────────────

/** 3 → 100, 4 → 200, 5 → 400, 6 → 700, 7 → 1100, 8 → 1600 … */
export function rawWordScore(length: number): number {
  const table = [0, 0, 0, 100, 200, 400, 700, 1100, 1600];
  return length < table.length ? table[length] : 1600 + (length - 8) * 600;
}

/** Bonus for using every letter in the rack. */
export const RAW_FULL_RACK_BONUS = 500;

// ── Fusion Vision ──────────────────────────────────────────────────────────

/** Points for solving a Fusion Vision puzzle: base by length, boosted by speed. */
export function fusionScore(targetLength: number, solveMs: number, difficulty: number): number {
  const base = 250 + lengthBonus(targetLength);
  const speed = speedMultiplier(Math.max(0, solveMs - 3000)); // everyone needs a moment to scan
  return Math.round((base * speed * difficultyMultiplier(difficulty)) / 5) * 5;
}
