/** Player-progress domain types (persisted in localStorage via lib/storage). */
import type { DifficultyBand, PuzzleType } from "../engine/puzzles";

export type GameMode = "sprint" | "fusion" | "anagram" | "review";

export type SkillKey = "steals" | "fusion" | "longWords" | "rawAnagrams" | "boardScan";

export const SKILLS: { key: SkillKey; label: string; blurb: string }[] = [
  { key: "steals", label: "+1 Steals", blurb: "One word plus loose letters" },
  { key: "fusion", label: "Word Fusion", blurb: "Combining two or more words" },
  { key: "longWords", label: "Long Words", blurb: "Steals of eight letters or more" },
  { key: "rawAnagrams", label: "Raw Anagrams", blurb: "Unscrambling a rack against the clock" },
  { key: "boardScan", label: "Board Scan", blurb: "How fast you spot steals on a busy board" },
];

export interface SkillRating {
  rating: number;
  /** Number of rating updates so far (drives the K-factor). */
  games: number;
  peak: number;
}

export type SkillRatings = Record<SkillKey, SkillRating>;

/** One performance sample against something of known difficulty. */
export interface RatingEvent {
  skill: SkillKey;
  /** Rating-scale difficulty of what was attempted. */
  difficulty: number;
  /** 0 = failed … 1 = aced it. */
  score: number;
  /** Relative importance (default 1). */
  weight?: number;
}

export interface PlayerStats {
  gamesPlayed: number;
  gamesByMode: Record<GameMode, number>;
  bestSprintScore: number;
  bestFusionScore: number;
  bestAnagramScore: number;
  longestCombo: number;
  /** Steals made in Steal Sprint. */
  wordsStolen: number;
  /** Every correct answer in every mode. */
  correctAnswers: number;
  wrongAnswers: number;
  fusionsMade: number;
  triplesMade: number;
  totalSolveMs: number;
  solveCount: number;
  fastestSolveMs: number | null;
  longestWord: string | null;
  bestFusionStreak: number;
  rawWordsFound: number;
  reviewSolved: number;
  perfectFusionSessions: number;
}

export interface StreakState {
  current: number;
  best: number;
  /** Local calendar date (YYYY-MM-DD) of the last completed session. */
  lastPlayedDate: string | null;
}

/** A steal the player missed, kept for Review Mistakes (spaced repetition). */
export interface MissedPuzzle {
  id: string;
  type: PuzzleType;
  sources: string[];
  loose: string;
  target: string;
  answers: string[];
  difficulty: number;
  band: DifficultyBand;
  /** How long it was available when it was missed. */
  availableMs: number;
  mode: GameMode;
  misses: number;
  solves: number;
  /** Solves under FAST_SOLVE_MS. */
  fastSolves: number;
  reveals: number;
  firstMissedAt: number;
  lastMissedAt: number;
  /** Last time it was shown in Review Mistakes (null = never reviewed). */
  lastSeenAt: number | null;
  lastSolveMs: number | null;
  bestSolveMs: number | null;
}

export interface SessionSummary {
  id: string;
  mode: GameMode;
  at: number;
  durationMs: number;
  score: number;
  correct: number;
  wrong: number;
  bestCombo: number;
  avgSolveMs: number | null;
  overallBefore: number;
  overallAfter: number;
  xp: number;
}

export type AchievementId =
  | "first-blood"
  | "lightning"
  | "fusion"
  | "triple-threat"
  | "monster-word"
  | "on-fire"
  | "century"
  | "high-roller"
  | "sharpshooter"
  | "anagram-ace"
  | "redemption"
  | "week-streak";

export interface PlayerSettings {
  sound: boolean;
}

export interface PlayerData {
  version: 1;
  createdAt: number;
  xp: number;
  ratings: SkillRatings;
  /** Overall rating after each session (most recent last, capped). */
  ratingHistory: { at: number; overall: number }[];
  stats: PlayerStats;
  streak: StreakState;
  achievements: Partial<Record<AchievementId, { unlockedAt: number }>>;
  missed: Record<string, MissedPuzzle>;
  history: SessionSummary[];
  settings: PlayerSettings;
}

/** A missed steal as reported by a game mode, before it enters the review deck. */
export interface MissedInput {
  id: string;
  type: PuzzleType;
  sources: string[];
  loose: string;
  target: string;
  answers: string[];
  difficulty: number;
  availableMs: number;
}

/** Everything a finished session reports back to the progress system. */
export interface SessionResult {
  mode: GameMode;
  startedAt: number;
  durationMs: number;
  score: number;
  correct: number;
  wrong: number;
  bestCombo: number;
  solveTimesMs: number[];
  /** Words made (steals, solutions, anagrams). */
  words: string[];
  fusions: number;
  triples: number;
  ratingEvents: RatingEvent[];
  missed: MissedInput[];
  /** Review mode: what happened to each card. */
  reviewed?: { id: string; solved: boolean; solveMs: number | null; revealed: boolean }[];
  /** The deck was already updated card by card (so applySession only counts stats). */
  reviewApplied?: boolean;
  /** Mode-specific extras used by achievements. */
  fusionStreak?: number;
  perfect?: boolean;
  rawWords?: number;
}
