import { describe, expect, it } from "vitest";
import { createRng } from "../engine/rng";
import { boardTileSize, fitLayout, hasOverlaps, placeWords, type LayoutParams } from "./layout";

function items(n: number, seed = 1) {
  const rng = createRng(seed);
  return Array.from({ length: n }, (_, i) => ({ id: `w${i}`, length: rng.int(3, 9) }));
}

describe("board layout", () => {
  const desktop: LayoutParams = { width: 1000, height: 520, tile: boardTileSize(1000, 520, 84, 11), seed: 3, maxRotate: 3.5 };
  const mobile: LayoutParams = { width: 360, height: 430, tile: boardTileSize(360, 430, 66, 10), seed: 3, maxRotate: 2 };

  it("sizes tiles to the board", () => {
    expect(desktop.tile).toBeGreaterThanOrEqual(38);
    expect(desktop.tile).toBeLessThanOrEqual(54);
    expect(mobile.tile).toBeGreaterThanOrEqual(22);
    expect(mobile.tile).toBeLessThan(desktop.tile);
  });

  it.each([
    ["desktop", desktop, 14],
    ["mobile", mobile, 10],
  ] as const)("places %s boards without overlaps", (_, params, n) => {
    for (let seed = 1; seed <= 20; seed++) {
      const list = items(n, seed);
      const placed = placeWords(list, new Map(), { ...params, seed });
      expect(placed.size).toBe(n);
      expect(hasOverlaps(list, placed, params)).toBe(false);
      for (const p of placed.values()) {
        expect(p.cx).toBeGreaterThan(0);
        expect(p.cx).toBeLessThan(1);
        expect(Math.abs(p.rotate)).toBeLessThanOrEqual(params.maxRotate);
      }
    }
  });

  it("shrinks tiles when a board is too crowded to fit", () => {
    for (let seed = 1; seed <= 20; seed++) {
      const list = items(14, seed);
      const { placements, tile } = fitLayout(list, new Map(), { ...mobile, seed });
      expect(tile).toBeLessThanOrEqual(mobile.tile);
      expect(hasOverlaps(list, placements, { ...mobile, tile })).toBe(false);
    }
  });

  it("keeps existing words where they are when the board changes", () => {
    const list = items(12);
    const first = placeWords(list, new Map(), desktop);
    const next = [...list.slice(2), { id: "new1", length: 7 }, { id: "new2", length: 4 }];
    const second = placeWords(next, first, desktop);
    for (const it of list.slice(2)) expect(second.get(it.id)).toEqual(first.get(it.id));
    expect(second.has("w0")).toBe(false);
    expect(hasOverlaps(next, second, desktop)).toBe(false);
  });

  it("is deterministic", () => {
    const list = items(10);
    expect(placeWords(list, new Map(), desktop)).toEqual(placeWords(list, new Map(), desktop));
  });
});
