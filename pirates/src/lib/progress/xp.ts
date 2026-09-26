/** XP, levels and pirate ranks. */
import type { SessionResult } from "./types";

export interface Rank {
  name: string;
  minLevel: number;
}

export const RANKS: Rank[] = [
  { name: "Deckhand", minLevel: 1 },
  { name: "Raider", minLevel: 5 },
  { name: "Buccaneer", minLevel: 10 },
  { name: "First Mate", minLevel: 20 },
  { name: "Captain", minLevel: 30 },
  { name: "Pirate King", minLevel: 50 },
];

/** Total XP needed to reach `level`: 0, 100, 300, 600, 1000, … (50·L·(L−1)). */
export function xpForLevel(level: number): number {
  return 50 * level * (level - 1);
}

export function levelForXp(xp: number): number {
  // Solve 50L² − 50L − xp = 0 for L, then floor.
  return Math.max(1, Math.floor((1 + Math.sqrt(1 + (4 * xp) / 50)) / 2));
}

export function levelProgress(xp: number): { level: number; into: number; needed: number; fraction: number } {
  const level = levelForXp(xp);
  const base = xpForLevel(level);
  const needed = xpForLevel(level + 1) - base;
  const into = xp - base;
  return { level, into, needed, fraction: needed ? into / needed : 0 };
}

export function rankFor(level: number): Rank {
  let out = RANKS[0];
  for (const r of RANKS) if (level >= r.minLevel) out = r;
  return out;
}

export function nextRank(level: number): Rank | null {
  return RANKS.find((r) => r.minLevel > level) ?? null;
}

/** XP earned for a finished session. Showing up always pays a little. */
export function xpForSession(result: SessionResult): number {
  const participation = 25;
  switch (result.mode) {
    case "sprint":
      return participation + Math.round(result.score / 12) + result.correct * 4;
    case "fusion":
      return participation + result.correct * 25 + (result.perfect ? 50 : 0);
    case "anagram":
      return participation + Math.round(result.score / 15);
    case "review":
      return 15 + result.correct * 20;
  }
}
