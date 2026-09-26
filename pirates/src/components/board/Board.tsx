"use client";
import { AnimatePresence } from "motion/react";
import { useCallback, useImperativeHandle, useMemo, useRef, type ReactNode, type Ref } from "react";
import { useElementSize } from "@/hooks/useElementSize";
import type { Board, Selection } from "@/lib/game/board";
import { boardTileSize, NARROW_BOARD, wordSize } from "@/lib/game/layout";
import { Pool } from "./Pool";
import { useScatterLayout } from "./useScatterLayout";
import { WordGroup, type ExitKinds } from "./WordGroup";

export interface BoardHandle {
  /** Centre (px, relative to the word area) of the given words, for score pops. */
  centerOf(wordIds: readonly string[]): { x: number; y: number } | null;
}

interface BoardViewProps {
  board: Board;
  selection: Selection;
  onToggle: (kind: "word" | "loose", id: string) => void;
  /** Layout seed (per game). */
  seed: number;
  /** Tiles the board must be able to hold (max words × typical length). */
  capacity: number;
  /** Longest word expected on the board. */
  longest?: number;
  exitKinds: ExitKinds;
  showPool?: boolean;
  /** Word / loose-letter ids to softly highlight (first-game hints). */
  hinted?: ReadonlySet<string>;
  /** Overlays drawn on top of the word area (score pops, countdown…). */
  children?: ReactNode;
  ref?: Ref<BoardHandle>;
}

/** The table: words scattered like physical tiles, with the pool of loose letters beneath. */
export function BoardView({ board, selection, onToggle, seed, capacity, longest = 11, exitKinds, showPool = true, hinted, children, ref }: BoardViewProps) {
  const areaRef = useRef<HTMLDivElement>(null);
  const { width, height } = useElementSize(areaRef);
  const narrow = width > 0 && width < NARROW_BOARD;
  const baseTile = width ? boardTileSize(width, height, capacity, longest, narrow ? 40 : 54) : 40;
  const items = useMemo(() => board.words.map((w) => ({ id: w.id, length: w.tiles.length })), [board.words]);
  const { placements, tile } = useScatterLayout(items, width, height, baseTile, seed, narrow ? 2 : 3.5);
  const poolTile = Math.round(Math.min(narrow ? 34 : 42, Math.max(26, tile * 0.86)));

  useImperativeHandle(
    ref,
    () => ({
      centerOf(ids) {
        let sx = 0;
        let sy = 0;
        let n = 0;
        for (const id of ids) {
          const p = placements.get(id);
          if (!p) continue;
          sx += p.cx * width;
          sy += p.cy * height;
          n++;
        }
        return n ? { x: sx / n, y: sy / n } : null;
      },
    }),
    [placements, width, height],
  );

  const orderOfInitial = useMemo(() => {
    const m = new Map<string, number>();
    board.words.filter((w) => w.addedAt === 0).forEach((w, i) => m.set(w.id, i));
    return m;
  }, [board.words]);

  const toggle = useCallback((kind: "word" | "loose", id: string) => onToggle(kind, id), [onToggle]);

  return (
    <div className="flex h-full min-h-0 flex-col gap-3">
      <div ref={areaRef} className="relative min-h-0 flex-1">
        {width > 0 && (
          <AnimatePresence custom={exitKinds}>
            {board.words.map((w) => {
              const p = placements.get(w.id);
              if (!p) return null;
              const initialIndex = orderOfInitial.get(w.id);
              return (
                <WordGroup
                  key={w.id}
                  word={w}
                  placement={p}
                  tile={tile}
                  width={width}
                  height={height}
                  selectedIndex={selection.wordIds.indexOf(w.id)}
                  onToggle={toggle}
                  hinted={hinted?.has(w.id)}
                  // Refills wait for a steal's tiles to land before dropping in.
                  enterDelay={initialIndex !== undefined ? 0.1 + initialIndex * 0.045 : 0.34}
                />
              );
            })}
          </AnimatePresence>
        )}
        {children}
      </div>
      {showPool && <Pool loose={board.loose} selectedIds={selection.looseIds} onToggle={toggle} tile={poolTile} exitKinds={exitKinds} hintedIds={hinted} />}
    </div>
  );
}

export { wordSize };
