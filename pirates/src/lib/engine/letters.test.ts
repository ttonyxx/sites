import { describe, expect, it } from "vitest";
import {
  areExactAnagrams,
  canCombine,
  combineSignatures,
  combineWords,
  containsLetters,
  getSignature,
  letterCounts,
  countsToSignature,
  letterDiff,
  longestCommonSubstring,
  normalizeWord,
  subSignatures,
  subtractLetters,
} from "./letters";

describe("getSignature", () => {
  it("sorts letters alphabetically", () => {
    expect(getSignature("COOPERAGE")).toBe("aceegoopr");
    expect(getSignature("pirates")).toBe("aeiprst");
  });

  it("ignores case and non-letters", () => {
    expect(getSignature("CoOp")).toBe(getSignature("coop"));
    expect(getSignature(" co-op! ")).toBe("coop");
    expect(normalizeWord("Fade 2")).toBe("fade");
  });

  it("keeps duplicate letters", () => {
    expect(getSignature("balloon")).toBe("abllnoo");
    expect(getSignature("aaa")).toBe("aaa");
  });

  it("handles empty and single letters", () => {
    expect(getSignature("")).toBe("");
    expect(getSignature("Q")).toBe("q");
  });
});

describe("exact anagram checks", () => {
  it("COOP + AGREE == COOPERAGE", () => {
    expect(combineWords("COOP", "AGREE")).toBe(getSignature("COOPERAGE"));
    expect(canCombine(["COOP", "AGREE"], "COOPERAGE")).toBe(true);
  });

  it("FADE + LITERS == FEDERALIST", () => {
    expect(combineWords("FADE", "LITERS")).toBe(getSignature("FEDERALIST"));
    expect(canCombine(["fade", "liters"], "federalist")).toBe(true);
  });

  it("IRATE + VIAL != VARIETAL (an extra I)", () => {
    expect(canCombine(["IRATE", "VIAL"], "VARIETAL")).toBe(false);
    expect(letterDiff(combineWords("irate", "vial"), "varietal")).toEqual({ missing: "", extra: "i" });
  });

  it("rejects missing letters and extra letters", () => {
    expect(canCombine(["coop", "agree"], "cooperages")).toBe(false); // needs an S
    expect(canCombine(["coop", "agree", "s"], "cooperage")).toBe(false); // S left over
  });

  it("counts loose letters", () => {
    expect(canCombine(["store"], "voters", "v")).toBe(true);
    expect(canCombine(["store"], "voters", "vv")).toBe(false);
    expect(canCombine(["agree"], "grenade", "nd")).toBe(true);
  });

  it("recognises anagrams", () => {
    expect(areExactAnagrams("pirates", "PARTIES")).toBe(true);
    expect(areExactAnagrams("pirates", "traipse")).toBe(true);
    expect(areExactAnagrams("pirate", "parties")).toBe(false);
  });

  it("is sensitive to duplicate counts", () => {
    expect(areExactAnagrams("aab", "abb")).toBe(false);
    expect(canCombine(["coop"], "coopo", "o")).toBe(true);
    expect(canCombine(["cop"], "coop", "")).toBe(false);
  });
});

describe("combineSignatures", () => {
  it("merges sorted signatures", () => {
    expect(combineSignatures("coop", "aeegr")).toBe("aceegoopr");
    expect(combineSignatures("", "abc", "")).toBe("abc");
    expect(combineSignatures("aa", "a", "b")).toBe("aaab");
  });
});

describe("subtractLetters", () => {
  it("removes letters with multiplicity", () => {
    expect(subtractLetters("cooperage", "coop")).toBe("aeegr");
    expect(subtractLetters("coop", "cop")).toBe("o");
    expect(subtractLetters("balloon", "lol")).toBe("abno");
  });

  it("returns null when letters are missing", () => {
    expect(subtractLetters("cop", "coop")).toBeNull(); // only one O
    expect(subtractLetters("store", "v")).toBeNull();
    expect(subtractLetters("", "a")).toBeNull();
  });

  it("handles removing everything or nothing", () => {
    expect(subtractLetters("store", "rotes")).toBe("");
    expect(subtractLetters("store", "")).toBe("eorst");
  });

  it("containsLetters mirrors subtraction", () => {
    expect(containsLetters("federalist", "fade")).toBe(true);
    expect(containsLetters("fade", "federalist")).toBe(false);
  });
});

describe("letterDiff", () => {
  it("reports missing and extra letters", () => {
    expect(letterDiff("coopagree", "cooperage")).toEqual({ missing: "", extra: "" });
    expect(letterDiff("coopagree", "cooperages")).toEqual({ missing: "s", extra: "" });
    expect(letterDiff("storev", "store")).toEqual({ missing: "", extra: "v" });
    expect(letterDiff("abc", "abd")).toEqual({ missing: "d", extra: "c" });
  });
});

describe("helpers", () => {
  it("round-trips letter counts", () => {
    expect(countsToSignature(letterCounts("Cooperage"))).toBe("aceegoopr");
  });

  it("enumerates distinct sub-multisets", () => {
    expect(subSignatures("aab").sort()).toEqual(["", "a", "aa", "aab", "ab", "b"]);
    expect(subSignatures("aab", 2, 2).sort()).toEqual(["aa", "ab"]);
    expect(new Set(subSignatures("aceegoopr")).size).toBe(subSignatures("aceegoopr").length);
  });

  it("finds the longest common substring", () => {
    expect(longestCommonSubstring("coop", "cooperage")).toBe(4);
    expect(longestCommonSubstring("liters", "federalist")).toBe(2);
    expect(longestCommonSubstring("abc", "xyz")).toBe(0);
  });
});
