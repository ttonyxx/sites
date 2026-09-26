import { describe, expect, it } from "vitest";
import { EMPTY_SELECTION } from "./board";
import { rankMissed, rivalDelay, SprintGame, type MissedSteal, type SprintEvent } from "./sprint";
import { testBank, testLexicon } from "../testing/fixtures";

const lexicon = testLexicon();
const bank = testBank();

function newGame(seed = 42, extra: Partial<ConstructorParameters<typeof SprintGame>[2]> = {}) {
  const game = new SprintGame(bank, lexicon, { seed, ...extra });
  const events: SprintEvent[] = [];
  game.onEvent((e) => events.push(e));
  game.start(0);
  return { game, events };
}

/** Pick an available steal the way a perfect player would. */
function firstAnswer(game: SprintGame): string {
  const opp = game.opportunities().sort((a, b) => b.answers[0].length - a.answers[0].length)[0];
  return opp.answers[0];
}

describe("SprintGame", () => {
  it("starts with a full board and at least one steal available", () => {
    const { game } = newGame();
    const view = game.view();
    expect(view.status).toBe("playing");
    expect(view.board.words.length).toBeGreaterThanOrEqual(10);
    expect(view.board.words.length).toBeLessThanOrEqual(16);
    expect(game.opportunities().length).toBeGreaterThan(0);
  });

  it("is deterministic for a seed", () => {
    const a = newGame(7).game.view().board.words.map((w) => w.word);
    const b = newGame(7).game.view().board.words.map((w) => w.word);
    expect(a).toEqual(b);
  });

  it("accepts a steal, moves the tiles to the pile and scores it", () => {
    const { game, events } = newGame();
    const answer = firstAnswer(game);
    const before = game.view();
    const res = game.submit(answer, EMPTY_SELECTION, 2_000);
    expect(res.ok).toBe(true);
    const after = game.view();
    expect(after.score).toBeGreaterThan(0);
    expect(after.pile[0].word).toBe(answer);
    expect(after.combo).toBe(1);
    const steal = events.find((e) => e.type === "steal");
    expect(steal && steal.type === "steal" && steal.stolen.tiles.map((t) => t.letter).join("")).toBe(answer);
    // The tiles came from the board: none of the consumed word ids remain.
    if (steal?.type === "steal") {
      for (const id of steal.wordIds) expect(after.board.words.some((w) => w.id === id)).toBe(false);
      const boardTileIds = new Set(before.board.words.flatMap((w) => w.tiles.map((t) => t.id)).concat(before.board.loose.map((l) => l.id)));
      expect(steal.stolen.tiles.every((t) => boardTileIds.has(t.id))).toBe(true);
    }
    // Board refilled, still something to steal.
    expect(after.board.words.length).toBeGreaterThanOrEqual(10);
    expect(game.opportunities().length).toBeGreaterThan(0);
  });

  it("builds combos for quick consecutive steals", () => {
    const { game } = newGame(11);
    game.submit(firstAnswer(game), EMPTY_SELECTION, 1_000);
    game.submit(firstAnswer(game), EMPTY_SELECTION, 3_000);
    expect(game.view().combo).toBe(2);
    game.submit(firstAnswer(game), EMPTY_SELECTION, 30_000);
    expect(game.view().combo).toBe(1);
  });

  it("penalizes wrong answers with time and a broken combo", () => {
    const { game } = newGame();
    game.submit(firstAnswer(game), EMPTY_SELECTION, 1_000);
    const before = game.remainingMs(2_000);
    const res = game.submit("qqqqq", EMPTY_SELECTION, 2_000);
    expect(res).toMatchObject({ ok: false, reason: "not-a-word" });
    expect(game.remainingMs(2_000)).toBe(before - 2_000);
    expect(game.view().combo).toBe(0);
  });

  it("doesn't penalize too-short or must-rearrange attempts", () => {
    const { game } = newGame();
    const before = game.remainingMs(1_000);
    game.submit("ab", EMPTY_SELECTION, 1_000);
    expect(game.remainingMs(1_000)).toBe(before);
  });

  it("flips pool letters over time and ends after 60 seconds", () => {
    const { game, events } = newGame(3, { rival: false });
    for (let t = 0; t <= 61_000; t += 250) game.tick(t);
    expect(events.filter((e) => e.type === "flip").length).toBeGreaterThanOrEqual(8);
    expect(game.view().status).toBe("over");
    expect(events.at(-1)?.type).toBe("end");
  });

  it("reports steals left on the board as missed", () => {
    const { game } = newGame(5, { rival: false });
    for (let t = 0; t <= 61_000; t += 500) game.tick(t);
    const result = game.result();
    expect(result.missed.length).toBeGreaterThan(0);
    for (const m of result.missed) {
      expect(m.availableMs).toBeGreaterThanOrEqual(3_000);
      expect(m.answers).toContain(m.target);
    }
    // Planted (intended) misses come first.
    expect(result.missed[0].planted).toBe(true);
  });

  it("lets a rival take planted steals that sit too long", () => {
    const { game, events } = newGame(9);
    for (let t = 0; t <= 45_000; t += 250) game.tick(t);
    const rivals = events.filter((e) => e.type === "rival");
    expect(rivals.length).toBeGreaterThan(0);
    expect(game.result().missed.some((m) => m.reason === "rival")).toBe(true);
  });

  it("pauses the clock", () => {
    const { game } = newGame();
    game.pause(10_000);
    expect(game.remainingMs(40_000)).toBe(50_000);
    game.resume(40_000);
    expect(game.remainingMs(41_000)).toBe(49_000);
  });

  it("produces a result with accuracy and rating events", () => {
    const { game } = newGame(21);
    game.submit(firstAnswer(game), EMPTY_SELECTION, 1_500);
    game.submit("zzzzzz", EMPTY_SELECTION, 2_000);
    game.finish(10_000);
    const r = game.result();
    expect(r.steals).toBe(1);
    expect(r.wrong).toBe(1);
    expect(r.accuracy).toBe(0.5);
    expect(r.ratingEvents.some((e) => e.score === 1)).toBe(true);
  });
});

describe("sprint helpers", () => {
  it("gives the rival longer on harder steals", () => {
    expect(rivalDelay(900)).toBe(18_000);
    expect(rivalDelay(2500)).toBe(26_000);
  });

  it("ranks planted and longer misses first and de-duplicates", () => {
    const base: MissedSteal = {
      id: "a",
      type: "steal",
      sources: ["store"],
      loose: "v",
      target: "voters",
      answers: ["voters", "strove"],
      difficulty: 900,
      availableMs: 5_000,
      planted: false,
      reason: "end",
    };
    const ranked = rankMissed([
      base,
      { ...base, id: "b", target: "strove" },
      { ...base, id: "c", sources: ["coop", "agree"], loose: "", target: "cooperage", planted: true },
    ]);
    expect(ranked.map((m) => m.id)).toEqual(["c", "a"]);
  });

  it("uses each board word in at most one reported miss", () => {
    const m = (id: string, sources: string[], target: string, planted = false): MissedSteal => ({
      id,
      type: sources.length === 1 ? "steal" : "fusion",
      sources,
      loose: "",
      target,
      answers: [target],
      difficulty: 1200,
      availableMs: 6_000,
      planted,
      reason: "end",
    });
    const ranked = rankMissed([m("x", ["rag", "end"], "garden", true), m("y", ["end", "rat", "sit"], "strained"), m("z", ["coop", "agree"], "cooperage")]);
    expect(ranked.map((r) => r.id)).toEqual(["x", "z"]);
  });
});

describe("hints", () => {
  it("points at a planted steal that's really on the board", () => {
    const game = new SprintGame(bank, lexicon, { seed: 77 });
    game.start(0);
    const h = game.hint()!;
    expect(h).not.toBeNull();
    const words = game.view().board.words.filter((w) => h.wordIds.includes(w.id));
    expect(words).toHaveLength(h.wordIds.length);
    expect(game.opportunities().some((o) => o.answers.includes(h.target))).toBe(true);
    expect(game.idleMs(5_000)).toBe(5_000);
  });
});

describe("refill", () => {
  it("tops planted steals up to the target instead of over-planting", () => {
    const counts: number[] = [];
    for (let seed = 1; seed <= 20; seed++) {
      const game = new SprintGame(bank, lexicon, { seed, rival: false, initialPlants: 2, plantedTarget: 2 });
      game.start(0);
      for (let t = 1000; t < 40_000; t += 3000) {
        const o = game.opportunities().sort((a, b) => a.answers[0].length - b.answers[0].length)[0];
        if (o && game.submit(o.answers[0], EMPTY_SELECTION, t).ok) counts.push(game.plantedAliveCount());
      }
    }
    const avg = counts.reduce((a, b) => a + b, 0) / counts.length;
    // Every refill restores at least one intended steal; on average we sit near the target of 2
    // (a new plant's letters can occasionally revive an older one, so the max isn't exactly 2).
    expect(Math.min(...counts)).toBeGreaterThanOrEqual(1);
    expect(avg).toBeLessThan(2.7);
  });
});
