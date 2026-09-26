/**
 * PlayerData lifecycle: create, normalize (old/partial saves), and apply a
 * finished session — the single place stats, ratings, XP, streaks, the review
 * deck and achievements change. Pure: returns new objects, never mutates.
 */
import { newlyUnlocked } from "./achievements";
import { applyRatingEvents, initialRatings, overallRating } from "./ratings";
import { addMisses, recordReview } from "./review";
import { currentStreak, initialStreak, localDateKey, recordPlay } from "./streak";
import type { AchievementId, GameMode, PlayerData, PlayerStats, SessionResult, SessionSummary, SkillKey } from "./types";
import { levelForXp, rankFor, xpForSession } from "./xp";

const MAX_HISTORY = 60;
const MAX_RATING_HISTORY = 200;

export function initialStats(): PlayerStats {
  return {
    gamesPlayed: 0,
    gamesByMode: { sprint: 0, fusion: 0, anagram: 0, review: 0 },
    bestSprintScore: 0,
    bestFusionScore: 0,
    bestAnagramScore: 0,
    longestCombo: 0,
    wordsStolen: 0,
    correctAnswers: 0,
    wrongAnswers: 0,
    fusionsMade: 0,
    triplesMade: 0,
    totalSolveMs: 0,
    solveCount: 0,
    fastestSolveMs: null,
    longestWord: null,
    bestFusionStreak: 0,
    rawWordsFound: 0,
    reviewSolved: 0,
    perfectFusionSessions: 0,
  };
}

export function createPlayer(now: number = Date.now()): PlayerData {
  return {
    version: 1,
    createdAt: now,
    xp: 0,
    ratings: initialRatings(),
    ratingHistory: [],
    stats: initialStats(),
    streak: initialStreak(),
    achievements: {},
    missed: {},
    history: [],
    settings: { sound: true },
  };
}

/** Fill in anything missing from an older or hand-edited save. */
export function normalizePlayer(raw: unknown, now: number = Date.now()): PlayerData {
  const base = createPlayer(now);
  if (!raw || typeof raw !== "object") return base;
  const p = raw as Partial<PlayerData>;
  return {
    ...base,
    ...p,
    version: 1,
    ratings: { ...base.ratings, ...(p.ratings ?? {}) },
    stats: { ...base.stats, ...(p.stats ?? {}), gamesByMode: { ...base.stats.gamesByMode, ...(p.stats?.gamesByMode ?? {}) } },
    streak: { ...base.streak, ...(p.streak ?? {}) },
    settings: { ...base.settings, ...(p.settings ?? {}) },
    achievements: p.achievements ?? {},
    missed: p.missed ?? {},
    history: Array.isArray(p.history) ? p.history : [],
    ratingHistory: Array.isArray(p.ratingHistory) ? p.ratingHistory : [],
  };
}

export interface SessionReport {
  mode: GameMode;
  overallBefore: number;
  overallAfter: number;
  skills: Partial<Record<SkillKey, { before: number; after: number }>>;
  xpGained: number;
  xpBefore: number;
  xpAfter: number;
  levelBefore: number;
  levelAfter: number;
  rankBefore: string;
  rankAfter: string;
  newAchievements: AchievementId[];
  personalBests: string[];
  streakBefore: number;
  streakAfter: number;
}

export function applySession(
  player: PlayerData,
  result: SessionResult,
  now: number = Date.now(),
  today: string = localDateKey(new Date(now)),
): { player: PlayerData; report: SessionReport } {
  const overallBefore = overallRating(player.ratings);
  const { ratings, deltas } = applyRatingEvents(player.ratings, result.ratingEvents);
  const overallAfter = overallRating(ratings);

  const s = player.stats;
  const solves = result.solveTimesMs;
  const longest = [...result.words].sort((a, b) => b.length - a.length)[0];
  const reviewedSolved = result.reviewed?.filter((r) => r.solved).length ?? 0;
  const personalBests: string[] = [];

  const stats: PlayerStats = {
    ...s,
    gamesPlayed: s.gamesPlayed + 1,
    gamesByMode: { ...s.gamesByMode, [result.mode]: s.gamesByMode[result.mode] + 1 },
    longestCombo: Math.max(s.longestCombo, result.bestCombo),
    wordsStolen: s.wordsStolen + (result.mode === "sprint" ? result.correct : 0),
    correctAnswers: s.correctAnswers + result.correct,
    wrongAnswers: s.wrongAnswers + result.wrong,
    fusionsMade: s.fusionsMade + result.fusions,
    triplesMade: s.triplesMade + result.triples,
    totalSolveMs: s.totalSolveMs + solves.reduce((a, b) => a + b, 0),
    solveCount: s.solveCount + solves.length,
    fastestSolveMs: solves.length ? Math.min(s.fastestSolveMs ?? Infinity, ...solves) : s.fastestSolveMs,
    longestWord: longest && longest.length > (s.longestWord?.length ?? 0) ? longest : s.longestWord,
    bestFusionStreak: Math.max(s.bestFusionStreak, result.fusionStreak ?? 0),
    rawWordsFound: s.rawWordsFound + (result.rawWords ?? 0),
    reviewSolved: s.reviewSolved + reviewedSolved,
    perfectFusionSessions: s.perfectFusionSessions + (result.mode === "fusion" && result.perfect ? 1 : 0),
  };

  const best = (key: "bestSprintScore" | "bestFusionScore" | "bestAnagramScore", label: string) => {
    if (result.score > s[key]) {
      stats[key] = result.score;
      if (s[key] > 0) personalBests.push(label);
    }
  };
  if (result.mode === "sprint") best("bestSprintScore", "Best Sprint score");
  if (result.mode === "fusion") best("bestFusionScore", "Best Fusion Vision score");
  if (result.mode === "anagram") best("bestAnagramScore", "Best Raw Anagrams score");
  if (result.bestCombo > s.longestCombo && s.longestCombo > 0) personalBests.push("Longest combo");
  if (stats.longestWord !== s.longestWord && s.longestWord) personalBests.push("Longest word");

  let missed = addMisses(player.missed, result.missed, result.mode, now);
  for (const r of result.reviewed ?? []) missed = recordReview(missed, r.id, r, now);

  const streak = recordPlay(player.streak, today);
  const xpGained = xpForSession(result);
  const xp = player.xp + xpGained;

  const summary: SessionSummary = {
    id: `${result.mode}-${now}`,
    mode: result.mode,
    at: now,
    durationMs: result.durationMs,
    score: result.score,
    correct: result.correct,
    wrong: result.wrong,
    bestCombo: result.bestCombo,
    avgSolveMs: solves.length ? Math.round(solves.reduce((a, b) => a + b, 0) / solves.length) : null,
    overallBefore,
    overallAfter,
    xp: xpGained,
  };

  const updated: PlayerData = {
    ...player,
    xp,
    ratings,
    ratingHistory: [...player.ratingHistory, { at: now, overall: overallAfter }].slice(-MAX_RATING_HISTORY),
    stats,
    streak,
    missed,
    history: [summary, ...player.history].slice(0, MAX_HISTORY),
  };

  const unlocked = newlyUnlocked(updated, result, today);
  if (unlocked.length) {
    updated.achievements = { ...updated.achievements };
    for (const id of unlocked) updated.achievements[id] = { unlockedAt: now };
  }

  const skills: SessionReport["skills"] = {};
  for (const key of Object.keys(deltas) as SkillKey[]) skills[key] = { before: player.ratings[key].rating, after: ratings[key].rating };

  const levelBefore = levelForXp(player.xp);
  const levelAfter = levelForXp(xp);
  return {
    player: updated,
    report: {
      mode: result.mode,
      overallBefore,
      overallAfter,
      skills,
      xpGained,
      xpBefore: player.xp,
      xpAfter: xp,
      levelBefore,
      levelAfter,
      rankBefore: rankFor(levelBefore).name,
      rankAfter: rankFor(levelAfter).name,
      newAchievements: unlocked,
      personalBests,
      streakBefore: currentStreak(player.streak, today),
      streakAfter: currentStreak(streak, today),
    },
  };
}

/** Change in overall rating from the previous session (for the dashboard's "+32"). */
export function lastRatingDelta(player: PlayerData): number | null {
  const h = player.ratingHistory;
  if (h.length === 0) return null;
  const prev = h.length >= 2 ? h[h.length - 2].overall : player.history.at(-1)?.overallBefore ?? h[0].overall;
  return h[h.length - 1].overall - prev;
}

export function averageSolveMs(stats: PlayerStats): number | null {
  return stats.solveCount ? stats.totalSolveMs / stats.solveCount : null;
}
