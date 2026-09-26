import { describe, expect, it } from "vitest";
import { getSignature } from "../engine/letters";
import { createRng } from "../engine/rng";
import { boardOf, testBank, testLexicon } from "../testing/fixtures";
import { buildRack, checkRawWord, wordsFromRack } from "./anagram";
import { EMPTY_SELECTION, pruneSelection, removePieces, selectionSignature, tilesForTarget, toggleSelection } from "./board";
import { buildFusionRound, otherFusions } from "./fusion";
import { IdGen } from "./board";
import { findOpportunities } from "./opportunities";
import { resolveSteal } from "./resolve";
import {
  comboMultiplier,
  difficultyMultiplier,
  fusionScore,
  nextCombo,
  rawWordScore,
  scoreSteal,
  speedMultiplier,
} from "./scoring";

const lexicon = testLexicon();
const isWord = (w: string) => lexicon.has(w);

describe("board", () => {
  it("rearranges source tiles into the target, keeping tile identity", () => {
    const board = boardOf(["coop", "agree"]);
    const tiles = board.words.flatMap((w) => w.tiles);
    const target = tilesForTarget("cooperage", tiles)!;
    expect(target.map((t) => t.letter).join("")).toBe("cooperage");
    expect(new Set(target.map((t) => t.id)).size).toBe(9);
    expect(target.every((t) => tiles.includes(t))).toBe(true);
  });

  it("refuses targets the tiles can't spell", () => {
    const board = boardOf(["irate", "vial"]);
    expect(tilesForTarget("varietal", board.words.flatMap((w) => w.tiles))).toBeNull();
  });

  it("removes pieces and prunes selections", () => {
    const board = boardOf(["coop", "agree", "tux"], "sv");
    let sel = toggleSelection(EMPTY_SELECTION, "word", board.words[0].id);
    sel = toggleSelection(sel, "loose", board.loose[1].id);
    expect(selectionSignature(board, sel)).toBe(getSignature("coopv"));
    const next = removePieces(board, [board.words[0].id], []);
    expect(next.words.map((w) => w.word)).toEqual(["agree", "tux"]);
    expect(pruneSelection(sel, next)).toEqual({ wordIds: [], looseIds: [board.loose[1].id] });
    expect(toggleSelection(sel, "loose", board.loose[1].id).looseIds).toEqual([]);
  });
});

describe("resolveSteal", () => {
  const board = boardOf(["irate", "vain", "coop", "liters", "agree", "fade", "store", "merge", "tux"], "vsa");

  it("finds a fusion without any selection", () => {
    const res = resolveSteal(board, "COOPERAGE", EMPTY_SELECTION, { isWord });
    expect(res.ok && res.plan.sources.sort()).toEqual(["agree", "coop"]);
  });

  it("uses loose letters for +1 steals", () => {
    const res = resolveSteal(board, "voters", EMPTY_SELECTION, { isWord });
    expect(res.ok).toBe(true);
    if (res.ok) {
      expect(res.plan.sources).toEqual(["store"]);
      expect(res.plan.loose).toBe("v");
      expect(res.plan.looseIds).toHaveLength(1);
    }
  });

  it("finds FEDERALIST from FADE + LITERS", () => {
    const res = resolveSteal(board, "federalist", EMPTY_SELECTION, { isWord });
    expect(res.ok && res.plan.sources.sort()).toEqual(["fade", "liters"]);
  });

  it("prefers the player's selection when several readings work", () => {
    const b = boardOf(["tire", "rite"], "s");
    const pick = b.words[1];
    const res = resolveSteal(b, "tiers", { wordIds: [pick.id], looseIds: [] }, { isWord });
    expect(res.ok && res.plan.wordIds).toEqual([pick.id]);
  });

  it("rejects non-words, short words, and trivial extensions", () => {
    expect(resolveSteal(board, "coopagree", EMPTY_SELECTION, { isWord })).toMatchObject({ ok: false, reason: "not-a-word" });
    expect(resolveSteal(board, "tux", EMPTY_SELECTION, { isWord })).toMatchObject({ ok: false, reason: "too-short" });
    expect(resolveSteal(board, "stores", EMPTY_SELECTION, { isWord })).toMatchObject({ ok: false, reason: "must-rearrange" });
  });

  it("rejects real words the board can't make, explaining the letter gap for a selection", () => {
    const vial = boardOf(["irate", "vial"]);
    const sel = { wordIds: vial.words.map((w) => w.id), looseIds: [] };
    const res = resolveSteal(vial, "varietal", sel, { isWord });
    expect(res).toMatchObject({ ok: false, reason: "no-match", diff: { missing: "", extra: "i" } });
  });

  it("requires a board word (loose letters alone aren't a steal)", () => {
    const b = boardOf(["tux"], "cat");
    expect(resolveSteal(b, "acts", EMPTY_SELECTION, { isWord })).toMatchObject({ ok: false });
  });

  it("requires at least one added letter for a single word", () => {
    const b = boardOf(["store"], "");
    expect(resolveSteal(b, "rotes", EMPTY_SELECTION, { isWord })).toMatchObject({ ok: false });
  });
});

describe("findOpportunities", () => {
  it("lists familiar steals on the board", () => {
    const board = boardOf(["coop", "agree", "store", "tux"], "v");
    const opps = findOpportunities(board, lexicon, { minTier: 3 });
    const answers = opps.flatMap((o) => o.answers);
    expect(answers).toContain("cooperage");
    expect(answers).toContain("voters");
    expect(opps.every((o) => o.answers.length > 0)).toBe(true);
  });

  it("never counts trivial extensions", () => {
    const board = boardOf(["store"], "s");
    expect(findOpportunities(board, lexicon).flatMap((o) => o.answers)).not.toContain("stores");
  });
});

describe("scoring", () => {
  it("uses base values by number of source words", () => {
    const flat = { targetLength: 5, solveMs: 60_000, combo: 1, difficulty: 1200 };
    expect(scoreSteal({ ...flat, sourceCount: 1 }).total).toBe(100);
    expect(scoreSteal({ ...flat, sourceCount: 2 }).total).toBe(250);
    expect(scoreSteal({ ...flat, sourceCount: 3 }).total).toBe(500);
  });

  it("rewards length, speed, combo and difficulty", () => {
    const s = scoreSteal({ sourceCount: 2, targetLength: 9, solveMs: 1500, combo: 3, difficulty: 1500 });
    expect(s.lengthBonus).toBe(100);
    expect(s.speedMultiplier).toBe(1.5);
    expect(s.comboMultiplier).toBe(1.5);
    expect(s.difficultyMultiplier).toBeCloseTo(1.19);
    expect(s.total).toBe(Math.round(((250 + 100) * 1.5 * 1.5 * 1.19) / 5) * 5);
    expect(s.total % 5).toBe(0);
  });

  it("bounds the multipliers", () => {
    expect(speedMultiplier(0)).toBe(1.5);
    expect(speedMultiplier(6000)).toBeCloseTo(1.25);
    expect(speedMultiplier(99_000)).toBe(1);
    expect(comboMultiplier(1)).toBe(1);
    expect(comboMultiplier(50)).toBe(3);
    expect(difficultyMultiplier(0)).toBe(0.8);
    expect(difficultyMultiplier(9999)).toBe(1.5);
  });

  it("keeps combos alive only inside the window", () => {
    expect(nextCombo(0, null, 1000)).toBe(1);
    expect(nextCombo(3, 1000, 5000)).toBe(4);
    expect(nextCombo(3, 1000, 20_000)).toBe(1);
  });

  it("scores raw anagrams and fusion vision", () => {
    expect(rawWordScore(3)).toBe(100);
    expect(rawWordScore(7)).toBe(1100);
    expect(rawWordScore(9)).toBeGreaterThan(rawWordScore(8));
    expect(fusionScore(9, 2000, 1200)).toBeGreaterThan(fusionScore(9, 20_000, 1200));
  });
});

describe("fusion vision", () => {
  it("builds boards with exactly one familiar fusion", () => {
    const rng = createRng(7);
    const ids = new IdGen("f");
    for (let i = 0; i < 5; i++) {
      const round = buildFusionRound(testBank(), lexicon, rng, { rating: 1200, used: new Set(), wordCount: 10, ids })!;
      expect(round).not.toBeNull();
      const words = round.board.words.map((w) => w.word);
      expect(words.length).toBeGreaterThanOrEqual(8);
      expect(otherFusions(words, lexicon, [round.puzzle.sources[0], round.puzzle.sources[1]])).toEqual([]);
      expect(round.answerWordIds.map((id) => round.board.words.find((w) => w.id === id)!.word).sort()).toEqual(
        [...round.puzzle.sources].sort(),
      );
    }
  });
});

describe("fusion session", () => {
  it("reports the pair the player actually fused", async () => {
    const { FusionSession } = await import("./fusion");
    const session = new FusionSession(testBank(), lexicon, createRng(5), { rating: 1200, length: 2 });
    const round = session.next(0)!;
    const res = session.submit(round.puzzle.target, EMPTY_SELECTION, 4000);
    expect(res.ok).toBe(true);
    if (res.ok) {
      expect([...res.sources].sort()).toEqual([...round.puzzle.sources].sort());
      expect(res.wordIds.sort()).toEqual([...round.answerWordIds].sort());
    }
    expect(session.outcomes[0]).toMatchObject({ solved: true, answer: round.puzzle.target });
    expect(session.outcomes[0].usedSources?.sort()).toEqual([...round.puzzle.sources].sort());
    session.next(5000);
    expect(session.giveUp()).toMatchObject({ solved: false, usedSources: null });
    expect(session.done).toBe(true);
    expect(session.summary()).toMatchObject({ solved: 1, total: 2 });
  });
});

describe("raw anagrams", () => {
  it("builds racks with plenty of familiar words", () => {
    const rack = buildRack(lexicon, createRng(3), 1000);
    expect(rack.letters).toHaveLength(7);
    expect(rack.familiar.length).toBeGreaterThanOrEqual(12);
    expect(rack.all).toContain(rack.seed);
  });

  it("validates words against the rack", () => {
    const rack = { letters: [..."aeilrtv"], seed: "aeilrtv", all: [], familiar: [], difficulty: 1200 };
    const found = new Set(["rate"]);
    expect(checkRawWord("trail", rack, found, lexicon)).toMatchObject({ ok: true, points: 400 });
    expect(checkRawWord("rate", rack, found, lexicon)).toMatchObject({ ok: false, reason: "duplicate" });
    expect(checkRawWord("tree", rack, found, lexicon)).toMatchObject({ ok: false, reason: "not-in-rack" });
    expect(checkRawWord("ai", rack, found, lexicon)).toMatchObject({ ok: false, reason: "too-short" });
    expect(checkRawWord("tavril", rack, found, lexicon)).toMatchObject({ ok: false, reason: "not-a-word" });
    expect(wordsFromRack(getSignature("aeilrtv"), lexicon, 4)).toContain("trail");
  });
});
