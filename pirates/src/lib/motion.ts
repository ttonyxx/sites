/** Shared motion presets so the whole app moves with one personality: quick, springy, never floaty. */
import type { Transition } from "motion/react";

/** Tiles flying into place (~250ms, tiny overshoot). */
export const snappy: Transition = { type: "spring", stiffness: 560, damping: 36, mass: 0.7 };
/** Panels and page content. */
export const soft: Transition = { type: "spring", stiffness: 260, damping: 28 };
/** Little bumps: combo counter, score ticks, badges. */
export const pop: Transition = { type: "spring", stiffness: 700, damping: 17 };
/** Very quick UI feedback. */
export const quick: Transition = { duration: 0.15, ease: [0.22, 1, 0.36, 1] };

export const fadeUp = {
  initial: { opacity: 0, y: 12 },
  animate: { opacity: 1, y: 0 },
  exit: { opacity: 0, y: -8 },
};

/** Stagger children by `step` seconds. */
export const stagger = (step = 0.05, delay = 0) => ({
  animate: { transition: { staggerChildren: step, delayChildren: delay } },
});

export const shake = {
  x: [0, -10, 9, -7, 6, -3, 2, 0],
  transition: { duration: 0.34, ease: "easeOut" as const },
};
