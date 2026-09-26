"use client";
import { MotionConfig } from "motion/react";
import type { ReactNode } from "react";

/** App-wide client providers. Motion honours the OS "reduce motion" setting. */
export function Providers({ children }: { children: ReactNode }) {
  return <MotionConfig reducedMotion="user">{children}</MotionConfig>;
}
