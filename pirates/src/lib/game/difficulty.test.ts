import { describe, expect, it } from "vitest";
import { boardAdjustment, distractorSimilarity, letterOverlap } from "./difficulty";
import { getSignature } from "../engine/letters";

describe("board difficulty", () => {
  it("measures how much of a word the target could supply", () => {
    expect(letterOverlap("rage", getSignature("cooperage"))).toBe(1);
    expect(letterOverlap("tux", getSignature("cooperage"))).toBe(0);
    expect(letterOverlap("peek", getSignature("cooperage"))).toBe(0.75);
  });

  it("rates look-alike distractors as more similar", () => {
    expect(distractorSimilarity("cooperage", ["rage", "cope", "pear"])).toBe(1);
    expect(distractorSimilarity("cooperage", ["tux", "milk", "dizzy"])).toBeLessThan(0.3);
  });

  it("adds difficulty for crowded, look-alike boards only", () => {
    const plain = boardAdjustment("cooperage", 10, ["tux", "milk", "dizzy"]);
    expect(plain).toBe(0);
    expect(boardAdjustment("cooperage", 14, ["tux", "milk", "dizzy"])).toBe(32);
    expect(boardAdjustment("cooperage", 10, ["rage", "cope", "pear"])).toBe(90);
  });
});
