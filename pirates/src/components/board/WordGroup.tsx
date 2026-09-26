"use client";
import { AnimatePresence, motion, type Variants } from "motion/react";
import { memo, useMemo } from "react";
import { hashString } from "@/lib/engine/rng";
import type { BoardWord } from "@/lib/game/board";
import { tileGap, wordSize, type Placement } from "@/lib/game/layout";
import { pop, snappy, soft } from "@/lib/motion";
import { Tile } from "../tiles/Tile";

/** How a word leaves the board: into your haul (tiles fly), to a rival (yanked away), or swept off. */
export type ExitKind = "steal" | "rival" | "swept";
export type ExitKinds = ReadonlyMap<string, ExitKind>;

interface WordGroupProps {
  word: BoardWord;
  placement: Placement;
  tile: number;
  width: number;
  height: number;
  /** Position in the selection (0-based), or -1. */
  selectedIndex: number;
  onToggle: (kind: "word" | "loose", id: string) => void;
  /** Stagger for the entrance. */
  enterDelay?: number;
}

export function exitTransition(kind: ExitKind | undefined, y: number) {
  if (kind === "steal") return { opacity: 0, transition: { duration: 0 } };
  if (kind === "rival") {
    return { opacity: 0, y: y - 70, scale: 0.88, filter: "blur(3px)", transition: { duration: 0.5, ease: [0.55, 0, 0.9, 0.35] as const } };
  }
  return { opacity: 0, scale: 0.85, filter: "blur(2px)", transition: { duration: 0.4 } };
}

export const WordGroup = memo(function WordGroup({ word, placement, tile, width, height, selectedIndex, onToggle, enterDelay = 0 }: WordGroupProps) {
  const { w, h } = wordSize(word.tiles.length, tile);
  const x = placement.cx * width - w / 2;
  const y = placement.cy * height - h / 2;
  const selected = selectedIndex >= 0;
  const pad = Math.round(tile * 0.22);
  const seed = hashString(word.id);
  // AnimatePresence hands every leaving word the same `custom` (the exit-kind map); each looks itself up.
  const variants = useMemo<Variants>(() => ({ exit: (kinds?: ExitKinds) => exitTransition(kinds?.get(word.id), y) }), [word.id, y]);

  return (
    <motion.div
      className="absolute left-0 top-0"
      style={{ zIndex: selected ? 20 : 1 }}
      initial={{ x, y, rotate: placement.rotate }}
      animate={{ x, y, rotate: placement.rotate }}
      exit="exit"
      variants={variants}
      transition={soft}
    >
      <motion.button
        type="button"
        onPointerDown={(e) => e.preventDefault()}
        onClick={() => onToggle("word", word.id)}
        aria-pressed={selected}
        aria-label={`${word.word.toUpperCase()}${selected ? ", selected" : ""}`}
        className="relative flex cursor-pointer touch-manipulation rounded-xl outline-none focus-visible:ring-2 focus-visible:ring-accent"
        style={{ gap: tileGap(tile), padding: pad, margin: -pad }}
        animate={{ y: selected ? -Math.max(3, tile * 0.12) : 0 }}
        whileHover={{ y: selected ? -Math.max(4, tile * 0.14) : -Math.max(1.5, tile * 0.05) }}
        whileTap={{ scale: 0.97 }}
        transition={pop}
      >
        {word.tiles.map((t, i) => (
          <Tile
            key={t.id}
            layoutId={t.id}
            letter={t.letter}
            size={tile}
            selected={selected}
            initial={{ opacity: 0, y: -tile * 0.6, scale: 0.55, rotate: ((seed >> i) % 9) - 4 }}
            animate={{ opacity: 1, y: 0, scale: 1, rotate: 0 }}
            transition={{ ...snappy, delay: enterDelay + i * 0.028 }}
          />
        ))}
        <AnimatePresence>
          {selected && (
            <motion.span
              key="badge"
              className="pointer-events-none absolute grid place-items-center rounded-full bg-accent font-mono font-semibold text-ink shadow-[0_2px_10px_rgba(245,181,68,.5)]"
              style={{
                width: Math.max(16, tile * 0.42),
                height: Math.max(16, tile * 0.42),
                fontSize: Math.max(10, tile * 0.24),
                left: -Math.max(4, tile * 0.1),
                top: -Math.max(4, tile * 0.1),
              }}
              initial={{ scale: 0, rotate: -30 }}
              animate={{ scale: 1, rotate: 0 }}
              exit={{ scale: 0, opacity: 0 }}
              transition={pop}
            >
              {selectedIndex + 1}
            </motion.span>
          )}
        </AnimatePresence>
      </motion.button>
    </motion.div>
  );
});
