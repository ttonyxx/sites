"use client";
import { useState } from "react";
import { fitLayout, type LayoutItem, type Placement } from "@/lib/game/layout";

interface LayoutState {
  key: string;
  sizeKey: string;
  placements: Map<string, Placement>;
  tile: number;
}

/**
 * Keeps word placements stable across board changes: existing words stay put,
 * new words find free space, and the tile size only shrinks if the board
 * genuinely can't fit (reset on resize).
 */
export function useScatterLayout(
  items: readonly LayoutItem[],
  width: number,
  height: number,
  baseTile: number,
  seed: number,
  maxRotate: number,
): { placements: Map<string, Placement>; tile: number } {
  const sizeKey = `${width}x${height}:${baseTile}`;
  const key = `${sizeKey}|${items.map((i) => i.id).join(",")}`;
  const [state, setState] = useState<LayoutState>({ key: "", sizeKey: "", placements: new Map(), tile: baseTile });

  if (width > 0 && height > 0 && state.key !== key) {
    const resized = state.sizeKey !== sizeKey;
    const tile = resized ? baseTile : state.tile;
    const { placements, tile: fitted } = fitLayout(items, state.placements, { width, height, tile, seed, maxRotate });
    const next = { key, sizeKey, placements, tile: fitted };
    setState(next);
    return next;
  }
  return state;
}
