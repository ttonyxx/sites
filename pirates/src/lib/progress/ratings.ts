/**
 * Local skill ratings. This is *not* Elo against other players: it's a
 * puzzle-rating system like chess trainers use. Each attempt is a "game"
 * against a puzzle of known difficulty; beating harder puzzles (or beating
 * them faster) moves the rating up, failing easy ones moves it down.
 */
import { SKILLS, type RatingEvent, type SkillKey, type SkillRatings } from "./types";

export const INITIAL_RATING = 1000;
/** Sessions per skill before losses count in full. */
export const PROVISIONAL_GAMES = 10;
/** A session can't move one skill more than this, so one great/bad round doesn't dominate. */
export const MAX_SESSION_DELTA = 80;

const WEIGHTS: Record<SkillKey, number> = { steals: 0.25, fusion: 0.25, longWords: 0.15, rawAnagrams: 0.15, boardScan: 0.2 };

export function initialRatings(): SkillRatings {
  const r = {} as SkillRatings;
  for (const s of SKILLS) r[s.key] = { rating: INITIAL_RATING, games: 0, peak: INITIAL_RATING };
  return r;
}

/** Chance of "beating" a puzzle of this difficulty at this rating. */
export function expectedScore(rating: number, difficulty: number): number {
  return 1 / (1 + 10 ** ((difficulty - rating) / 400));
}

/** New players move fast; established ratings settle down. */
export function kFactor(games: number): number {
  if (games < 10) return 48;
  if (games < 30) return 32;
  if (games < 80) return 22;
  return 16;
}

/**
 * Apply one session's events. Each skill's events are batched:
 *   Δ = K · Σ wᵢ(sᵢ − Eᵢ) / √Σwᵢ
 * so many small samples in one round add up without exploding.
 */
export function applyRatingEvents(ratings: SkillRatings, events: readonly RatingEvent[]): { ratings: SkillRatings; deltas: Partial<Record<SkillKey, number>> } {
  const next: SkillRatings = { ...ratings };
  const deltas: Partial<Record<SkillKey, number>> = {};
  for (const { key } of SKILLS) {
    const mine = events.filter((e) => e.skill === key);
    if (!mine.length) continue;
    const current = ratings[key];
    let sum = 0;
    let weights = 0;
    for (const e of mine) {
      const w = e.weight ?? 1;
      sum += w * (clamp01(e.score) - expectedScore(current.rating, e.difficulty));
      weights += w;
    }
    if (weights <= 0) continue;
    let raw = (kFactor(current.games) * sum) / Math.sqrt(weights);
    // Provisional ratings fall gently: your first rounds are for learning the game.
    if (raw < 0 && current.games < PROVISIONAL_GAMES) raw *= 0.6;
    const delta = Math.round(Math.max(-MAX_SESSION_DELTA, Math.min(MAX_SESSION_DELTA, raw)));
    const rating = Math.max(100, current.rating + delta);
    next[key] = { rating, games: current.games + 1, peak: Math.max(current.peak, rating) };
    deltas[key] = rating - current.rating;
  }
  return { ratings: next, deltas };
}

/** Overall Pirate Rating: a weighted blend of the five skills. */
export function overallRating(ratings: SkillRatings): number {
  let total = 0;
  for (const { key } of SKILLS) total += WEIGHTS[key] * ratings[key].rating;
  return Math.round(total);
}

function clamp01(x: number): number {
  return Math.min(1, Math.max(0, x));
}
