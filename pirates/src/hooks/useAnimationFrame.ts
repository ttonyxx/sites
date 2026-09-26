"use client";
import { useEffect, useEffectEvent } from "react";

/** Run `callback(now)` every animation frame while `active`. */
export function useAnimationFrame(callback: (now: number) => void, active = true) {
  const onFrame = useEffectEvent(callback);
  useEffect(() => {
    if (!active) return;
    let id = 0;
    const loop = (now: number) => {
      onFrame(now);
      id = requestAnimationFrame(loop);
    };
    id = requestAnimationFrame(loop);
    return () => cancelAnimationFrame(id);
  }, [active]);
}
