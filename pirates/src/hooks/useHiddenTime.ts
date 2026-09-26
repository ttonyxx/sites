"use client";
import { useEffect, useEffectEvent } from "react";

/**
 * Calls `onResume(hiddenMs)` when the tab comes back after being hidden, so
 * clocks can be shifted instead of silently running out in the background.
 */
export function useHiddenTime(onResume: (hiddenMs: number) => void, active = true) {
  const resume = useEffectEvent(onResume);
  useEffect(() => {
    if (!active) return;
    let hiddenAt: number | null = null;
    const onChange = () => {
      if (document.hidden) hiddenAt = performance.now();
      else if (hiddenAt !== null) {
        resume(performance.now() - hiddenAt);
        hiddenAt = null;
      }
    };
    document.addEventListener("visibilitychange", onChange);
    return () => document.removeEventListener("visibilitychange", onChange);
  }, [active]);
}
