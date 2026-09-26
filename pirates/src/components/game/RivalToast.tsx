"use client";
import { AnimatePresence, motion } from "motion/react";
import { soft } from "@/lib/motion";
import { SourcesRow, TileWord } from "../tiles/TileWord";

export interface RivalNote {
  id: number;
  sources: string[];
  loose: string;
  target: string;
}

/** "A rival grabbed COOP + AGREE → COOPERAGE" — steals you let sit too long. */
export function RivalToast({ note, tile = 16 }: { note: RivalNote | null; tile?: number }) {
  return (
    <div className="pointer-events-none absolute inset-x-0 top-1 z-30 flex justify-center">
      <AnimatePresence>
        {note && (
          <motion.div
            key={note.id}
            className="flex items-center gap-2.5 rounded-full border border-bad/30 bg-ink-2/95 px-3 py-1.5 shadow-[0_10px_30px_-10px_rgba(0,0,0,.8)] backdrop-blur"
            initial={{ opacity: 0, y: -16, scale: 0.95 }}
            animate={{ opacity: 1, y: 0, scale: 1 }}
            exit={{ opacity: 0, y: -10, transition: { duration: 0.2 } }}
            transition={soft}
            role="status"
          >
            <span className="font-mono text-[10px] font-semibold uppercase tracking-[0.14em] text-bad">Rival stole</span>
            <SourcesRow sources={note.sources} loose={note.loose} size={tile} />
            <span className="font-mono text-xs text-faint">→</span>
            <TileWord word={note.target} size={tile} tone="bad" />
          </motion.div>
        )}
      </AnimatePresence>
    </div>
  );
}
