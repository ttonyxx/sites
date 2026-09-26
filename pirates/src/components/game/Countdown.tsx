"use client";
import { AnimatePresence, motion } from "motion/react";
import { useEffect, useEffectEvent, useState } from "react";
import { sfx } from "@/lib/sound";
import { Tile } from "../tiles/Tile";

const STEPS = ["3", "2", "1", "go"];
const STEP_MS = 620;

/** 3 · 2 · 1 · GO in big tiles. Calls onDone when GO lands. */
export function Countdown({ onDone, size = 96 }: { onDone: () => void; size?: number }) {
  const [step, setStep] = useState(0);
  const done = useEffectEvent(onDone);

  useEffect(() => {
    sfx.countdown(step === STEPS.length - 1);
    if (step === STEPS.length - 1) {
      done();
      return;
    }
    const t = window.setTimeout(() => setStep((s) => s + 1), STEP_MS);
    return () => clearTimeout(t);
  }, [step]);

  const label = STEPS[step];
  return (
    <div className="pointer-events-none absolute inset-0 z-40 grid place-items-center" style={{ perspective: 800 }}>
      <AnimatePresence mode="popLayout">
        <motion.div
          key={label}
          className="flex gap-2"
          initial={{ rotateX: -90, scale: 0.5, opacity: 0, y: -30 }}
          animate={{ rotateX: 0, scale: 1, opacity: 1, y: 0 }}
          exit={{ scale: 1.5, opacity: 0, filter: "blur(6px)", transition: { duration: 0.25 } }}
          transition={{ type: "spring", stiffness: 420, damping: 22 }}
        >
          {[...label].map((ch, i) => (
            <Tile key={i} letter={ch} size={label === "go" ? size * 0.9 : size} tone={label === "go" ? "good" : "word"} />
          ))}
        </motion.div>
      </AnimatePresence>
    </div>
  );
}
