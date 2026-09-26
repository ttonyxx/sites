"use client";
import { motion } from "motion/react";
import { SKILLS, type SkillRatings } from "@/lib/progress/types";

const MIN = 600;
const MAX = 2000;

/** Five skill bars; widths map ratings 600–2000 onto the track. */
export function SkillBars({ ratings, delay = 0 }: { ratings: SkillRatings | null; delay?: number }) {
  return (
    <ul className="flex flex-col gap-3.5">
      {SKILLS.map((s, i) => {
        const r = ratings?.[s.key].rating ?? null;
        const pct = r === null ? 0 : Math.max(3, Math.min(100, ((r - MIN) / (MAX - MIN)) * 100));
        return (
          <li key={s.key} className="grid grid-cols-[104px_1fr_44px] items-center gap-3 sm:grid-cols-[112px_1fr_48px]" title={s.blurb}>
            <span className="truncate text-[13px] text-muted">{s.label}</span>
            <span className="relative h-2 overflow-hidden rounded-full bg-line">
              <motion.span
                className="absolute inset-y-0 left-0 rounded-full"
                style={{ background: "linear-gradient(90deg, rgba(245,181,68,.55), #f5b544)" }}
                initial={{ width: 0 }}
                animate={{ width: `${pct}%` }}
                transition={{ duration: 0.9, ease: [0.22, 1, 0.36, 1], delay: delay + i * 0.07 }}
              />
            </span>
            <span className="tabular text-right font-mono text-[13px]">{r ?? "—"}</span>
          </li>
        );
      })}
    </ul>
  );
}

/** Tiny line of the overall rating over recent sessions. */
export function Sparkline({ values, width = 160, height = 40 }: { values: number[]; width?: number; height?: number }) {
  if (values.length < 2) {
    return (
      <svg width={width} height={height} aria-hidden>
        <line x1={0} x2={width} y1={height / 2} y2={height / 2} stroke="currentColor" strokeOpacity={0.15} strokeDasharray="3 4" />
      </svg>
    );
  }
  const lo = Math.min(...values);
  const hi = Math.max(...values);
  const span = Math.max(20, hi - lo);
  const pts = values.map((v, i) => [(i / (values.length - 1)) * (width - 4) + 2, height - 4 - ((v - lo) / span) * (height - 8)] as const);
  const d = pts.map(([x, y], i) => `${i ? "L" : "M"}${x.toFixed(1)},${y.toFixed(1)}`).join(" ");
  const [lx, ly] = pts[pts.length - 1];
  return (
    <svg width={width} height={height} aria-hidden className="overflow-visible">
      <defs>
        <linearGradient id="spark" x1="0" x2="0" y1="0" y2="1">
          <stop offset="0" stopColor="#f5b544" stopOpacity="0.25" />
          <stop offset="1" stopColor="#f5b544" stopOpacity="0" />
        </linearGradient>
      </defs>
      <motion.path
        d={`${d} L${lx},${height} L2,${height} Z`}
        fill="url(#spark)"
        initial={{ opacity: 0 }}
        animate={{ opacity: 1 }}
        transition={{ delay: 0.6, duration: 0.6 }}
      />
      <motion.path
        d={d}
        fill="none"
        stroke="#f5b544"
        strokeWidth={1.75}
        strokeLinecap="round"
        strokeLinejoin="round"
        initial={{ pathLength: 0 }}
        animate={{ pathLength: 1 }}
        transition={{ duration: 1, ease: [0.22, 1, 0.36, 1], delay: 0.2 }}
      />
      <motion.circle cx={lx} cy={ly} r={3} fill="#f5b544" initial={{ scale: 0 }} animate={{ scale: 1 }} transition={{ delay: 1.1 }} />
    </svg>
  );
}
