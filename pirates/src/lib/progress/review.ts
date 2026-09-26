/**
 * Review Mistakes: a light spaced-repetition deck of missed steals.
 *
 * Priority rises with repeated misses, never having solved it, and time since
 * it was last shown; it falls as you solve it quickly again and again. Not a
 * full Anki scheduler — a weighted queue is plenty for this.
 */
import { bandFor } from "../engine/puzzles";
import type { GameMode, MissedInput, MissedPuzzle } from "./types";

export type ReviewDeck = Record<string, MissedPuzzle>;

/** A solve faster than this counts toward mastery. */
export const FAST_SOLVE_MS = 6_000;
/** Solved quickly this many times (and more solves than misses) → mastered. */
export const MASTERY_FAST_SOLVES = 3;
/** Keep the deck bounded; the least useful cards fall off. */
export const MAX_DECK_SIZE = 300;

export function addMisses(deck: ReviewDeck, misses: readonly MissedInput[], mode: GameMode, now: number): ReviewDeck {
  if (!misses.length) return deck;
  const next = { ...deck };
  for (const m of misses) {
    const prev = next[m.id];
    next[m.id] = prev
      ? { ...prev, misses: prev.misses + 1, lastMissedAt: now, availableMs: m.availableMs, fastSolves: Math.max(0, prev.fastSolves - 1) }
      : {
          id: m.id,
          type: m.type,
          sources: m.sources,
          loose: m.loose,
          target: m.target,
          answers: m.answers,
          difficulty: m.difficulty,
          band: bandFor(m.difficulty),
          availableMs: m.availableMs,
          mode,
          misses: 1,
          solves: 0,
          fastSolves: 0,
          reveals: 0,
          firstMissedAt: now,
          lastMissedAt: now,
          lastSeenAt: null,
          lastSolveMs: null,
          bestSolveMs: null,
        };
  }
  return trimDeck(next, now);
}

export interface ReviewOutcome {
  solved: boolean;
  solveMs: number | null;
  revealed: boolean;
}

export function recordReview(deck: ReviewDeck, id: string, outcome: ReviewOutcome, now: number): ReviewDeck {
  const card = deck[id];
  if (!card) return deck;
  const next: MissedPuzzle = { ...card, lastSeenAt: now };
  if (outcome.solved && outcome.solveMs !== null) {
    next.solves++;
    next.lastSolveMs = outcome.solveMs;
    next.bestSolveMs = card.bestSolveMs === null ? outcome.solveMs : Math.min(card.bestSolveMs, outcome.solveMs);
    if (outcome.solveMs < FAST_SOLVE_MS) next.fastSolves++;
  }
  if (outcome.revealed) {
    next.reveals++;
    next.misses++;
  }
  return { ...deck, [id]: next };
}

export function isMastered(m: MissedPuzzle): boolean {
  return m.fastSolves >= MASTERY_FAST_SOLVES && m.solves > m.misses;
}

export function reviewPriority(m: MissedPuzzle, now: number): number {
  const missWeight = 1 + 0.8 * m.misses;
  const unsolvedWeight = m.solves === 0 ? 1.6 : 1;
  // Never reviewed = due now. Otherwise it "recharges" over roughly a day.
  const hours = m.lastSeenAt === null ? Infinity : (now - m.lastSeenAt) / 3_600_000;
  const recency = hours === Infinity ? 1.4 : 0.15 + 1.25 * (1 - Math.exp(-hours / 12));
  const masteryWeight = 1 / (1 + 0.9 * m.fastSolves);
  return missWeight * unsolvedWeight * recency * masteryWeight;
}

/** The next cards to review, most urgent first. Mastered cards only fill in if the deck is thin. */
export function reviewQueue(deck: ReviewDeck, now: number, count = 10): MissedPuzzle[] {
  const cards = Object.values(deck);
  const byPriority = (a: MissedPuzzle, b: MissedPuzzle) => reviewPriority(b, now) - reviewPriority(a, now) || b.lastMissedAt - a.lastMissedAt;
  const active = cards.filter((c) => !isMastered(c)).sort(byPriority);
  if (active.length >= count) return active.slice(0, count);
  const mastered = cards.filter(isMastered).sort(byPriority);
  return [...active, ...mastered].slice(0, count);
}

/** Cards that still need work. */
export function activeCount(deck: ReviewDeck): number {
  return Object.values(deck).filter((c) => !isMastered(c)).length;
}

function trimDeck(deck: ReviewDeck, now: number): ReviewDeck {
  const cards = Object.values(deck);
  if (cards.length <= MAX_DECK_SIZE) return deck;
  const keep = cards
    .sort((a, b) => reviewPriority(b, now) - reviewPriority(a, now))
    .slice(0, MAX_DECK_SIZE);
  return Object.fromEntries(keep.map((c) => [c.id, c]));
}
