"use client";
import clsx from "clsx";
import { motion } from "motion/react";
import { hashString } from "@/lib/engine/rng";
import { tileGap } from "@/lib/game/layout";
import { snappy } from "@/lib/motion";
import { Tile, type TileTone } from "./Tile";

export interface TileWordProps {
  word: string;
  size: number;
  tone?: TileTone;
  className?: string;
  /** Drop the tiles in one by one. */
  entrance?: boolean;
  delay?: number;
  /** Tiny per-tile tilt so rows look hand-placed. */
  jitter?: boolean;
  label?: string;
}

/** A word spelled in tiles, for display (results, review cards, headings). */
export function TileWord({ word, size, tone = "word", className, entrance, delay = 0, jitter, label }: TileWordProps) {
  const letters = [...word.toLowerCase()];
  return (
    <span
      className={clsx("inline-flex", className)}
      style={{ gap: tileGap(size) }}
      role="img"
      aria-label={label ?? word.toUpperCase()}
    >
      {letters.map((ch, i) => {
        const tilt = jitter ? ((hashString(word + i) % 7) - 3) * 0.6 : 0;
        return (
          <Tile
            key={i}
            letter={ch}
            size={size}
            tone={tone}
            initial={entrance ? { opacity: 0, y: -size * 0.5, scale: 0.6, rotate: tilt * 4 } : false}
            animate={{ opacity: 1, y: 0, scale: 1, rotate: tilt }}
            transition={{ ...snappy, delay: entrance ? delay + i * 0.035 : 0 }}
          />
        );
      })}
    </span>
  );
}

/** Sources and loose letters, e.g. COOP + AGREE (+ V), as small tiles. */
export function SourcesRow({ sources, loose, size, className }: { sources: string[]; loose: string; size: number; className?: string }) {
  return (
    <span className={clsx("inline-flex flex-wrap items-center", className)} style={{ gap: size * 0.4 }}>
      {sources.map((s, i) => (
        <span key={s + i} className="inline-flex items-center" style={{ gap: size * 0.4 }}>
          {i > 0 && <Plus size={size} />}
          <TileWord word={s} size={size} jitter />
        </span>
      ))}
      {loose && (
        <span className="inline-flex items-center" style={{ gap: size * 0.4 }}>
          <Plus size={size} />
          <span className="inline-flex" style={{ gap: size * 0.3 }}>
            {[...loose].map((l, i) => (
              <Tile key={i} letter={l} size={size} tone="pool" />
            ))}
          </span>
        </span>
      )}
    </span>
  );
}

export function Plus({ size }: { size: number }) {
  return (
    <motion.span className="font-mono text-faint select-none" style={{ fontSize: Math.max(12, size * 0.6) }} aria-hidden>
      +
    </motion.span>
  );
}
