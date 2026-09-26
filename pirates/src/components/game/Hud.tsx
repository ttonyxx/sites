"use client";
import clsx from "clsx";
import { AnimatePresence, motion } from "motion/react";
import { useRef } from "react";
import { useAnimationFrame } from "@/hooks/useAnimationFrame";
import { pop } from "@/lib/motion";
import { AnimatedNumber } from "../ui/AnimatedNumber";

function formatClock(ms: number): string {
  if (ms <= 10_000) return (Math.ceil(ms / 100) / 10).toFixed(1);
  const s = Math.ceil(ms / 1000);
  return `${Math.floor(s / 60)}:${String(s % 60).padStart(2, "0")}`;
}

/**
 * Countdown clock + thin progress bar. Painted straight to the DOM each frame
 * so the rest of the screen never re-renders for the timer.
 */
export function Timer({
  getRemaining,
  total,
  running,
  onSecond,
}: {
  getRemaining: () => number;
  total: number;
  running: boolean;
  /** Called once per whole second remaining (for last-seconds ticks). */
  onSecond?: (secondsLeft: number) => void;
}) {
  const textRef = useRef<HTMLSpanElement>(null);
  const barRef = useRef<HTMLDivElement>(null);
  const wrapRef = useRef<HTMLDivElement>(null);
  const lastSecond = useRef<number | null>(null);

  useAnimationFrame(() => {
    const ms = getRemaining();
    if (textRef.current) textRef.current.textContent = formatClock(ms);
    if (barRef.current) barRef.current.style.transform = `scaleX(${Math.max(0, Math.min(1, ms / total))})`;
    if (wrapRef.current) wrapRef.current.dataset.urgent = ms <= 10_000 ? "true" : "false";
    const sec = Math.ceil(ms / 1000);
    if (sec !== lastSecond.current) {
      lastSecond.current = sec;
      onSecond?.(sec);
    }
  }, running);

  return (
    <div ref={wrapRef} className="group flex min-w-[88px] flex-col gap-1.5" data-urgent="false">
      <span className="label">Time</span>
      <span
        ref={textRef}
        className="tabular font-mono text-[26px] leading-none font-medium tracking-tight text-fg transition-colors group-data-[urgent=true]:text-bad sm:text-[30px]"
      >
        {formatClock(total)}
      </span>
      <div className="h-[3px] w-full overflow-hidden rounded-full bg-line">
        <div
          ref={barRef}
          className="h-full origin-left rounded-full bg-fg/80 transition-colors group-data-[urgent=true]:bg-bad"
          style={{ transform: "scaleX(1)" }}
        />
      </div>
    </div>
  );
}

/** Combo counter with a draining bar showing how long the chain stays alive. */
export function ComboMeter({ combo, getFraction, running }: { combo: number; getFraction: () => number; running: boolean }) {
  const barRef = useRef<HTMLDivElement>(null);
  useAnimationFrame(() => {
    if (barRef.current) barRef.current.style.transform = `scaleX(${getFraction()})`;
  }, running && combo >= 1);

  const hot = combo >= 5;
  const blazing = combo >= 10;
  return (
    <div className="flex min-w-[96px] flex-col items-center gap-1.5">
      <span className="label">Combo</span>
      <div className="relative h-[30px]">
        <AnimatePresence mode="popLayout" initial={false}>
          <motion.span
            key={combo}
            className={clsx(
              "tabular block font-mono text-[26px] leading-none font-semibold sm:text-[30px]",
              combo < 2 ? "text-faint" : hot ? "text-accent" : "text-fg",
            )}
            style={blazing ? { textShadow: "0 0 18px rgba(245,181,68,.55)" } : undefined}
            initial={{ scale: 1.7, opacity: 0, y: -4 }}
            animate={{ scale: 1, opacity: 1, y: 0 }}
            exit={{ scale: 0.6, opacity: 0 }}
            transition={pop}
          >
            ×{Math.max(combo, 0)}
          </motion.span>
        </AnimatePresence>
      </div>
      <div className="h-[3px] w-16 overflow-hidden rounded-full bg-line">
        <div ref={barRef} className={clsx("h-full origin-left rounded-full", hot ? "bg-accent" : "bg-fg/70")} style={{ transform: "scaleX(0)" }} />
      </div>
    </div>
  );
}

export function ScoreDisplay({ score }: { score: number }) {
  return (
    <div className="flex min-w-[88px] flex-col items-end gap-1.5">
      <span className="label">Score</span>
      <AnimatedNumber value={score} className="tabular font-mono text-[26px] leading-none font-medium tracking-tight sm:text-[30px]" stiffness={170} damping={26} />
      <div className="h-[3px]" />
    </div>
  );
}
