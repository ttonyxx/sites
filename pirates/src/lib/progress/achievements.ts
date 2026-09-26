/** Achievements, checked after every session (they pop on the results screen, never mid-game). */
import { currentStreak } from "./streak";
import type { AchievementId, PlayerData, SessionResult } from "./types";

export type AchievementIcon = "blood" | "bolt" | "fuse" | "triple" | "monster" | "flame" | "hundred" | "coins" | "target" | "letters" | "undo" | "calendar";

export interface AchievementDef {
  id: AchievementId;
  title: string;
  description: string;
  icon: AchievementIcon;
  /** Evaluated with the player *after* the session was applied. */
  check: (ctx: { player: PlayerData; result: SessionResult; today: string }) => boolean;
}

export const ACHIEVEMENTS: AchievementDef[] = [
  {
    id: "first-blood",
    title: "First Blood",
    description: "Make your first steal",
    icon: "blood",
    check: ({ player }) => player.stats.stealsMade >= 1,
  },
  {
    id: "lightning",
    title: "Lightning",
    description: "Solve a steal in under 2 seconds",
    icon: "bolt",
    check: ({ result }) => result.mode !== "anagram" && result.solveTimesMs.some((t) => t < 2000),
  },
  {
    id: "fusion",
    title: "Fusion",
    description: "Complete a two-word steal",
    icon: "fuse",
    check: ({ result }) => result.fusions >= 1,
  },
  {
    id: "triple-threat",
    title: "Triple Threat",
    description: "Fuse three words into one",
    icon: "triple",
    check: ({ result }) => result.triples >= 1,
  },
  {
    id: "monster-word",
    title: "Monster Word",
    description: "Create a word of 10+ letters",
    icon: "monster",
    check: ({ result }) => result.words.some((w) => w.length >= 10),
  },
  {
    id: "on-fire",
    title: "On Fire",
    description: "Get a 10× combo",
    icon: "flame",
    check: ({ result }) => result.mode === "sprint" && result.bestCombo >= 10,
  },
  {
    id: "century",
    title: "Century",
    description: "Complete 100 steals",
    icon: "hundred",
    check: ({ player }) => player.stats.stealsMade >= 100,
  },
  {
    id: "high-roller",
    title: "High Roller",
    description: "Score 5,000 in one Steal Sprint",
    icon: "coins",
    check: ({ result }) => result.mode === "sprint" && result.score >= 5000,
  },
  {
    id: "sharpshooter",
    title: "Sharpshooter",
    description: "Go 10 for 10 in Fusion Vision",
    icon: "target",
    check: ({ result }) => result.mode === "fusion" && result.perfect === true,
  },
  {
    id: "anagram-ace",
    title: "Anagram Ace",
    description: "Find 20 words in one Raw Anagrams round",
    icon: "letters",
    check: ({ result }) => result.mode === "anagram" && (result.rawWords ?? 0) >= 20,
  },
  {
    id: "redemption",
    title: "Redemption",
    description: "Solve 10 steals you once missed",
    icon: "undo",
    check: ({ player }) => player.stats.reviewSolved >= 10,
  },
  {
    id: "week-streak",
    title: "Seven Seas",
    description: "Train seven days in a row",
    icon: "calendar",
    check: ({ player, today }) => currentStreak(player.streak, today) >= 7,
  },
];

export function achievementById(id: AchievementId): AchievementDef {
  return ACHIEVEMENTS.find((a) => a.id === id)!;
}

/** Achievements newly earned by this session. */
export function newlyUnlocked(player: PlayerData, result: SessionResult, today: string): AchievementId[] {
  return ACHIEVEMENTS.filter((a) => !player.achievements[a.id] && a.check({ player, result, today })).map((a) => a.id);
}
