"use client";
import { AnimatePresence, motion } from "motion/react";
import type { ScoreBreakdown } from "@/lib/game/scoring";

export interface Pop {
  id: number;
  x: number;
  y: number;
  points: number;
  breakdown?: ScoreBreakdown;
  label?: string;
}

/** Floating "+340" with the multipliers that earned it, rising from where the steal happened. */
export function ScorePops({ pops }: { pops: readonly Pop[] }) {
  return (
    <div className="pointer-events-none absolute inset-0 z-30">
      <AnimatePresence>
        {pops.map((p) => (
          <motion.span
            key={`ring-${p.id}`}
            className="absolute rounded-full border-2 border-accent/70"
            style={{ left: p.x, top: p.y, width: 80, height: 80, marginLeft: -40, marginTop: -40, boxShadow: "0 0 30px rgba(245,181,68,.35)" }}
            initial={{ scale: 0.3, opacity: 0.9 }}
            animate={{ scale: 3.2, opacity: 0 }}
            transition={{ duration: 0.6, ease: [0.16, 1, 0.3, 1] }}
          />
        ))}
        {pops.map((p) => (
          <motion.div
            key={p.id}
            className="absolute flex -translate-x-1/2 -translate-y-1/2 flex-col items-center gap-1"
            style={{ left: p.x, top: p.y }}
            initial={{ opacity: 0, y: 0, scale: 0.6 }}
            animate={{ opacity: [0, 1, 1, 0], y: [0, -22, -44, -62], scale: [0.6, 1.08, 1, 0.96] }}
            transition={{ duration: 1.25, times: [0, 0.14, 0.72, 1], ease: "easeOut" }}
          >
            <span className="tabular rounded-xl bg-ink/85 px-3 py-1.5 font-mono text-[26px] font-semibold leading-none text-accent shadow-[0_8px_30px_-6px_rgba(0,0,0,.8),0_0_24px_-4px_rgba(245,181,68,.35)] ring-1 ring-accent/40 backdrop-blur-md">
              +{p.points.toLocaleString("en-US")}
            </span>
            <span className="flex gap-1.5">
              {p.label && <Chip>{p.label}</Chip>}
              {p.breakdown && p.breakdown.speedMultiplier > 1.05 && <Chip>Speed ×{p.breakdown.speedMultiplier.toFixed(1)}</Chip>}
              {p.breakdown && p.breakdown.comboMultiplier > 1 && <Chip>Combo ×{p.breakdown.comboMultiplier.toFixed(2).replace(/0$/, "")}</Chip>}
            </span>
          </motion.div>
        ))}
      </AnimatePresence>
    </div>
  );
}

function Chip({ children }: { children: React.ReactNode }) {
  return (
    <span className="rounded-md border border-accent/25 bg-ink/90 px-1.5 py-0.5 font-mono text-[10px] font-medium uppercase tracking-wider text-accent-2 backdrop-blur">
      {children}
    </span>
  );
}
