"use client";
import { AnimatePresence, motion } from "motion/react";
import { memo } from "react";
import type { StolenWord } from "@/lib/game/sprint";
import { tileGap } from "@/lib/game/layout";
import { snappy, soft } from "@/lib/motion";
import { Tile } from "../tiles/Tile";

/**
 * Your haul: stolen words, newest first. Tiles arrive by flying from the board
 * (shared layoutIds), so nothing here may clip — overflow runs off the right
 * edge under a fade instead of scrolling.
 */
export const StolenPile = memo(function StolenPile({ pile, tile }: { pile: readonly StolenWord[]; tile: number }) {
  return (
    <div className="relative flex min-h-0 items-center gap-3">
      <span className="label shrink-0">
        Haul <span className="tabular text-muted">{pile.length}</span>
      </span>
      <div className="flex min-w-0 flex-1 items-center gap-3 py-2" style={{ minHeight: tile + 16 }}>
        {pile.length === 0 && <span className="text-xs text-faint">Nothing yet — your steals land here</span>}
        <AnimatePresence initial={false}>
          {pile.slice(0, 24).map((w, wi) => (
            <motion.div key={w.id} layout="position" transition={soft} className="flex shrink-0" style={{ gap: tileGap(tile) }}>
              {w.tiles.map((t, i) => (
                <Tile
                  key={t.id}
                  layoutId={t.id}
                  letter={t.letter}
                  size={tile}
                  tone="won"
                  initial={false}
                  layoutCrossfade={false}
                  transition={wi === 0 ? { ...snappy, delay: i * 0.018 } : snappy}
                />
              ))}
            </motion.div>
          ))}
        </AnimatePresence>
      </div>
      <div className="pointer-events-none absolute inset-y-0 right-0 w-16 bg-gradient-to-l from-ink to-transparent" aria-hidden />
    </div>
  );
});
