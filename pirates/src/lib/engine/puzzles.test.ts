import fs from "node:fs";
import path from "node:path";
import { describe, expect, it } from "vitest";
import { Lexicon, parseLexicon, serializeLexicon, type TierKey } from "./lexicon";
import {
  bandFor,
  computeDifficulty,
  isTrivialSteal,
  puzzleId,
  puzzleProblem,
  scrambleOf,
  type DifficultyFeatures,
  type Puzzle,
} from "./puzzles";
import { verifyDataset } from "./verify";
import puzzles from "@data/puzzles.json";
import words from "@data/words.json";
import curated from "@data/curated.json";
import type { WordEntry } from "./words";

const lexicon = Lexicon.fromText(fs.readFileSync(path.join(__dirname, "../../../public/lexicon.txt"), "utf8"));

const make = (sources: string[], loose: string, target: string, extra: Partial<Puzzle> = {}): Puzzle => ({
  id: puzzleId(sources, loose, target),
  type: sources.length === 1 ? "steal" : sources.length === 2 ? (loose ? "fusion-plus" : "fusion") : "triple",
  sources,
  loose,
  target,
  answers: [target],
  difficulty: 1200,
  band: "medium",
  ...extra,
});

describe("puzzle validation", () => {
  it("accepts exact-letter puzzles", () => {
    expect(puzzleProblem(make(["coop", "agree"], "", "cooperage"), lexicon)).toBeNull();
    expect(puzzleProblem(make(["fade", "liters"], "", "federalist"), lexicon)).toBeNull();
    expect(puzzleProblem(make(["store"], "v", "voters"), lexicon)).toBeNull();
  });

  it("rejects mismatched letters", () => {
    expect(puzzleProblem(make(["irate", "vial"], "", "varietal"))).toMatch(/letters don't match/);
    expect(puzzleProblem(make(["coop", "agree"], "s", "cooperage"))).toMatch(/letters don't match/);
  });

  it("rejects a lone word with no added letters", () => {
    expect(puzzleProblem(make(["store"], "", "rotes"))).toMatch(/loose letter/);
  });

  it("rejects answers that just extend the source", () => {
    expect(puzzleProblem(make(["store"], "s", "stores"))).toMatch(/rearrange/);
    expect(puzzleProblem(make(["irate"], "p", "pirate"))).toMatch(/rearrange/);
  });

  it("rejects unsorted loose letters and wrong types", () => {
    expect(puzzleProblem(make(["agree"], "nd", "grenade"))).toMatch(/signature/);
    expect(puzzleProblem({ ...make(["coop", "agree"], "", "cooperage"), type: "steal" })).toMatch(/type/);
  });

  it("rejects words missing from the lexicon", () => {
    expect(puzzleProblem(make(["coop", "agree"], "", "cooperage", { answers: ["cooperage", "ceageroop"] }), lexicon)).toMatch(
      /lexicon/,
    );
  });
});

describe("isTrivialSteal", () => {
  it("flags plain extensions and compounds", () => {
    expect(isTrivialSteal(["store"], "stores")).toBe(true);
    expect(isTrivialSteal(["bath", "room"], "bathroom")).toBe(true);
  });

  it("allows real rearrangements", () => {
    expect(isTrivialSteal(["store"], "voters")).toBe(false);
    expect(isTrivialSteal(["coop", "agree"], "cooperage")).toBe(false); // COOP survives, AGREE doesn't
  });
});

describe("difficulty", () => {
  const base: DifficultyFeatures = {
    targetLength: 7,
    sourceCount: 1,
    looseCount: 1,
    targetTier: 5,
    sourceTier: 5,
    scramble: 0.5,
    answerCount: 1,
  };

  it("rises with length, sources, obscurity and scrambling", () => {
    const d = computeDifficulty(base);
    expect(computeDifficulty({ ...base, targetLength: 10 })).toBeGreaterThan(d);
    expect(computeDifficulty({ ...base, sourceCount: 2, looseCount: 0 })).toBeGreaterThan(d);
    expect(computeDifficulty({ ...base, targetTier: 2 })).toBeGreaterThan(d);
    expect(computeDifficulty({ ...base, scramble: 0.9 })).toBeGreaterThan(d);
  });

  it("falls when several answers work", () => {
    expect(computeDifficulty({ ...base, answerCount: 3 })).toBeLessThan(computeDifficulty(base));
  });

  it("buckets into bands", () => {
    expect(bandFor(900)).toBe("easy");
    expect(bandFor(1200)).toBe("medium");
    expect(bandFor(1500)).toBe("hard");
    expect(bandFor(1900)).toBe("insane");
  });

  it("measures scramble", () => {
    expect(scrambleOf(["coop", "agree"], "cooperage")).toBeCloseTo(1 - 4 / 9);
    expect(scrambleOf(["fade", "liters"], "federalist")).toBeCloseTo(0.8);
  });
});

describe("lexicon", () => {
  it("round-trips the front-coded format", () => {
    const entries = new Map<string, TierKey>([
      ["abandon", 5],
      ["abandoned", 5],
      ["aardvark", 5],
      ["cooperage", 2],
      ["snatch", "x"],
    ]);
    const parsed = new Map(parseLexicon(serializeLexicon(entries)));
    expect(parsed).toEqual(entries);
  });

  it("answers membership, tiers and anagram lookups", () => {
    expect(lexicon.has("COOPERAGE")).toBe(true);
    expect(lexicon.has("ceageroop")).toBe(false);
    expect(lexicon.anagrams("aeiprst")).toEqual(expect.arrayContaining(["pirates", "parties", "traipse"]));
    expect(lexicon.isPlayable("agree", 5)).toBe(true);
  });

  it("never accepts hard-blocked slurs and never plants soft-blocked words", () => {
    expect(lexicon.has("faggot")).toBe(false);
    expect(lexicon.has("snatch")).toBe(true);
    expect(lexicon.isPlayable("snatch")).toBe(false);
  });
});

describe("shipped dataset", () => {
  const shipped = puzzles as Puzzle[];

  it("every puzzle and board word passes exact-letter verification", () => {
    const report = verifyDataset(shipped, words as WordEntry[], lexicon);
    expect(report.problems).toEqual([]);
    expect(report.puzzles).toBeGreaterThan(1000);
    expect(report.words).toBeGreaterThan(500);
  });

  it("includes every curated classic", () => {
    for (const c of curated as { sources: string[]; target: string }[]) {
      expect(shipped.some((p) => p.target === c.target && p.sources.join() === c.sources.join())).toBe(true);
    }
  });

  it("covers every puzzle type and difficulty band", () => {
    const types = new Set(shipped.map((p) => p.type));
    const bands = new Set(shipped.map((p) => p.band));
    expect([...types].sort()).toEqual(["fusion", "fusion-plus", "steal", "triple"]);
    expect([...bands].sort()).toEqual(["easy", "hard", "insane", "medium"]);
  });

  it("never plants blocked words", () => {
    for (const p of shipped) for (const w of [...p.sources, p.target]) expect(lexicon.isPlayable(w)).toBe(true);
  });
});
