"use client";
import { motion } from "motion/react";
import { Tile } from "../tiles/Tile";

/** Three tiles hopping in turn — shown while the dictionary loads. */
export function LoadingTiles({ label = "Loading…" }: { label?: string }) {
  return (
    <div className="absolute inset-0 z-40 grid place-items-center" role="status" aria-live="polite">
      <div className="flex flex-col items-center gap-5">
        <div className="flex gap-2">
          {["a", "b", "c"].map((l, i) => (
            <Tile
              key={l}
              letter={l}
              size={40}
              animate={{ y: [0, -14, 0], rotate: [0, i % 2 ? 6 : -6, 0] }}
              transition={{ duration: 0.7, repeat: Infinity, delay: i * 0.12, ease: "easeInOut", repeatDelay: 0.25 }}
            />
          ))}
        </div>
        <motion.span className="text-sm text-muted" initial={{ opacity: 0 }} animate={{ opacity: 1 }} transition={{ delay: 0.2 }}>
          {label}
        </motion.span>
      </div>
    </div>
  );
}
