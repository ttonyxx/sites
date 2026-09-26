import { describe, expect, it } from "vitest";
import { memoryStore } from "../storage/kv";
import { createLocalPlayerRepository, PLAYER_KEY } from "../storage/player-repository";
import { achievementById, ACHIEVEMENTS } from "./achievements";
import { applySession, createPlayer, lastRatingDelta, normalizePlayer } from "./player";
import { applyRatingEvents, expectedScore, initialRatings, kFactor, overallRating } from "./ratings";
import { addMisses, isMastered, recordReview, reviewPriority, reviewQueue } from "./review";
import { currentStreak, daysBetween, localDateKey, recordPlay } from "./streak";
import type { MissedInput, SessionResult } from "./types";
import { levelForXp, levelProgress, rankFor, xpForLevel } from "./xp";

const sprintResult = (over: Partial<SessionResult> = {}): SessionResult => ({
  mode: "sprint",
  startedAt: 0,
  durationMs: 60_000,
  score: 3000,
  correct: 10,
  wrong: 1,
  bestCombo: 4,
  solveTimesMs: [2500, 3000, 1800],
  words: ["cooperage", "voters"],
  fusions: 1,
  triples: 0,
  ratingEvents: [{ skill: "fusion", difficulty: 1300, score: 1 }],
  missed: [],
  ...over,
});

const miss = (id: string): MissedInput => ({
  id,
  type: "fusion",
  sources: ["coop", "agree"],
  loose: "",
  target: "cooperage",
  answers: ["cooperage"],
  difficulty: 1500,
  availableMs: 7800,
});

describe("streak / date logic", () => {
  it("formats local dates", () => {
    expect(localDateKey(new Date(2026, 0, 5, 23, 59))).toBe("2026-01-05");
  });

  it("counts days across months, years and DST", () => {
    expect(daysBetween("2026-02-28", "2026-03-01")).toBe(1);
    expect(daysBetween("2025-12-31", "2026-01-01")).toBe(1);
    expect(daysBetween("2026-03-07", "2026-03-09")).toBe(2); // US DST weekend
  });

  it("extends on consecutive days, ignores repeats, resets after a gap", () => {
    let s = recordPlay({ current: 0, best: 0, lastPlayedDate: null }, "2026-09-01");
    expect(s.current).toBe(1);
    s = recordPlay(s, "2026-09-01");
    expect(s.current).toBe(1);
    s = recordPlay(s, "2026-09-02");
    s = recordPlay(s, "2026-09-03");
    expect(s).toMatchObject({ current: 3, best: 3 });
    s = recordPlay(s, "2026-09-06");
    expect(s).toMatchObject({ current: 1, best: 3 });
  });

  it("shows a lapsed streak as zero", () => {
    const s = { current: 5, best: 5, lastPlayedDate: "2026-09-01" };
    expect(currentStreak(s, "2026-09-02")).toBe(5);
    expect(currentStreak(s, "2026-09-03")).toBe(0);
  });
});

describe("ratings", () => {
  it("expects 50% at equal strength", () => {
    expect(expectedScore(1200, 1200)).toBeCloseTo(0.5);
    expect(expectedScore(1400, 1000)).toBeGreaterThan(0.9);
  });

  it("goes up for wins, down for losses, more for surprises", () => {
    const r = initialRatings();
    const win = applyRatingEvents(r, [{ skill: "steals", difficulty: 1200, score: 1 }]);
    const loss = applyRatingEvents(r, [{ skill: "steals", difficulty: 1200, score: 0 }]);
    const easyLoss = applyRatingEvents(r, [{ skill: "steals", difficulty: 700, score: 0 }]);
    expect(win.deltas.steals).toBeGreaterThan(0);
    expect(loss.deltas.steals).toBeLessThan(0);
    expect(easyLoss.deltas.steals!).toBeLessThan(loss.deltas.steals!);
    expect(win.ratings.steals.games).toBe(1);
    expect(win.ratings.fusion).toEqual(r.fusion);
  });

  it("caps a single session's movement", () => {
    const events = Array.from({ length: 60 }, () => ({ skill: "fusion" as const, difficulty: 2000, score: 1 }));
    expect(applyRatingEvents(initialRatings(), events).deltas.fusion).toBe(80);
  });

  it("settles as more games are played", () => {
    expect(kFactor(0)).toBeGreaterThan(kFactor(100));
  });

  it("blends skills into an overall rating", () => {
    expect(overallRating(initialRatings())).toBe(1000);
  });
});

describe("xp and ranks", () => {
  it("maps xp to levels", () => {
    expect(xpForLevel(1)).toBe(0);
    expect(xpForLevel(2)).toBe(100);
    expect(levelForXp(0)).toBe(1);
    expect(levelForXp(99)).toBe(1);
    expect(levelForXp(100)).toBe(2);
    expect(levelForXp(xpForLevel(37))).toBe(37);
    expect(levelForXp(xpForLevel(37) - 1)).toBe(36);
    expect(levelProgress(150)).toMatchObject({ level: 2, into: 50, needed: 200 });
  });

  it("names ranks by level", () => {
    expect(rankFor(1).name).toBe("Deckhand");
    expect(rankFor(5).name).toBe("Raider");
    expect(rankFor(12).name).toBe("Buccaneer");
    expect(rankFor(20).name).toBe("First Mate");
    expect(rankFor(49).name).toBe("Captain");
    expect(rankFor(80).name).toBe("Pirate King");
  });
});

describe("review deck", () => {
  it("adds misses and bumps repeats", () => {
    let deck = addMisses({}, [miss("a")], "sprint", 1000);
    expect(deck.a).toMatchObject({ misses: 1, solves: 0, lastSeenAt: null, band: "hard" });
    deck = addMisses(deck, [miss("a")], "sprint", 2000);
    expect(deck.a.misses).toBe(2);
  });

  it("prioritizes repeated, unsolved, not-recently-seen cards", () => {
    const now = 10 * 3_600_000;
    let deck = addMisses({}, [miss("once"), miss("twice"), miss("seen")], "sprint", 0);
    deck = addMisses(deck, [miss("twice")], "sprint", 0);
    deck = recordReview(deck, "seen", { solved: true, solveMs: 9000, revealed: false }, now - 60_000);
    const order = reviewQueue(deck, now, 3).map((c) => c.id);
    expect(order).toEqual(["twice", "once", "seen"]);
    expect(reviewPriority(deck.twice, now)).toBeGreaterThan(reviewPriority(deck.once, now));
  });

  it("marks cards mastered after several quick solves", () => {
    let deck = addMisses({}, [miss("m")], "sprint", 0);
    for (let i = 1; i <= 3; i++) deck = recordReview(deck, "m", { solved: true, solveMs: 2500, revealed: false }, i * 86_400_000);
    expect(isMastered(deck.m)).toBe(true);
    const later = addMisses(deck, [miss("n")], "sprint", 4 * 86_400_000);
    expect(reviewQueue(later, 5 * 86_400_000, 1)[0].id).toBe("n");
  });

  it("treats a reveal as another miss", () => {
    let deck = addMisses({}, [miss("r")], "sprint", 0);
    deck = recordReview(deck, "r", { solved: false, solveMs: null, revealed: true }, 1000);
    expect(deck.r).toMatchObject({ misses: 2, reveals: 1, lastSeenAt: 1000 });
  });
});

describe("applySession", () => {
  it("updates stats, xp, streak, ratings, review deck and achievements", () => {
    const player = createPlayer(0);
    const { player: p, report } = applySession(
      player,
      sprintResult({ missed: [miss("x")], words: ["cooperage", "federalists"], bestCombo: 10 }),
      1_000,
      "2026-09-26",
    );
    expect(p.stats.gamesPlayed).toBe(1);
    expect(p.stats.wordsStolen).toBe(10);
    expect(p.stats.bestSprintScore).toBe(3000);
    expect(p.stats.longestWord).toBe("federalists");
    expect(p.xp).toBe(report.xpGained);
    expect(report.xpGained).toBeGreaterThan(0);
    expect(p.streak).toMatchObject({ current: 1, lastPlayedDate: "2026-09-26" });
    expect(p.ratings.fusion.rating).toBeGreaterThan(1000);
    expect(report.overallAfter).toBeGreaterThan(report.overallBefore);
    expect(p.missed.x.misses).toBe(1);
    expect(report.newAchievements).toEqual(expect.arrayContaining(["first-blood", "lightning", "fusion", "monster-word", "on-fire"]));
    expect(p.history).toHaveLength(1);
    expect(lastRatingDelta(p)).toBe(report.overallAfter - report.overallBefore);
  });

  it("doesn't re-award achievements and reports personal bests", () => {
    const first = applySession(createPlayer(0), sprintResult(), 1000, "2026-09-26").player;
    const { report } = applySession(first, sprintResult({ score: 4000 }), 2000, "2026-09-27");
    expect(report.newAchievements).not.toContain("first-blood");
    expect(report.personalBests).toContain("Best Sprint score");
    expect(report.streakAfter).toBe(2);
  });

  it("records review outcomes", () => {
    let player = applySession(createPlayer(0), sprintResult({ missed: [miss("x")] }), 1000, "2026-09-26").player;
    player = applySession(
      player,
      { ...sprintResult({ mode: "review", correct: 1, reviewed: [{ id: "x", solved: true, solveMs: 3000, revealed: false }] }) },
      5000,
      "2026-09-26",
    ).player;
    expect(player.missed.x).toMatchObject({ solves: 1, fastSolves: 1 });
    expect(player.stats.reviewSolved).toBe(1);
  });

  it("doesn't re-apply review outcomes that were saved card by card", () => {
    let player = applySession(createPlayer(0), sprintResult({ missed: [miss("x")] }), 1000, "2026-09-26").player;
    player = applySession(
      player,
      { ...sprintResult({ mode: "review", correct: 1, reviewed: [{ id: "x", solved: true, solveMs: 3000, revealed: false }], reviewApplied: true }) },
      5000,
      "2026-09-26",
    ).player;
    expect(player.missed.x).toMatchObject({ solves: 0 });
    expect(player.stats.reviewSolved).toBe(1);
  });

  it("doesn't count raw anagram words as steals", () => {
    const { player, report } = applySession(createPlayer(0), sprintResult({ mode: "anagram", correct: 12, fusions: 0, words: ["ring"], bestCombo: 0, solveTimesMs: [] }), 1000, "2026-09-26");
    expect(player.stats.stealsMade).toBe(0);
    expect(report.newAchievements).not.toContain("first-blood");
  });

  it("only awards ON FIRE for Sprint combos", () => {
    const fusion = applySession(createPlayer(0), sprintResult({ mode: "fusion", bestCombo: 12 }), 1000, "2026-09-26");
    expect(fusion.report.newAchievements).not.toContain("on-fire");
    const sprint = applySession(createPlayer(0), sprintResult({ bestCombo: 10 }), 1000, "2026-09-26");
    expect(sprint.report.newAchievements).toContain("on-fire");
  });

  it("has a definition for every achievement", () => {
    for (const a of ACHIEVEMENTS) expect(achievementById(a.id).title).toBeTruthy();
  });
});

describe("storage", () => {
  it("round-trips player data through the repository", () => {
    const kv = memoryStore();
    const repo = createLocalPlayerRepository(kv);
    const fresh = repo.load();
    expect(fresh.xp).toBe(0);
    repo.save({ ...fresh, xp: 1234 });
    expect(repo.load().xp).toBe(1234);
    expect(kv.get(PLAYER_KEY)).toContain("1234");
  });

  it("recovers from corrupt or partial saves", () => {
    const kv = memoryStore({ [PLAYER_KEY]: "{not json" });
    expect(createLocalPlayerRepository(kv).load().version).toBe(1);
    const partial = normalizePlayer({ xp: 50, stats: { gamesPlayed: 2 } });
    expect(partial.xp).toBe(50);
    expect(partial.stats.gamesPlayed).toBe(2);
    expect(partial.stats.gamesByMode.sprint).toBe(0);
    expect(partial.ratings.steals.rating).toBe(1000);
  });
});
