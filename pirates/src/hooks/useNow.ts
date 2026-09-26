"use client";
import { useSyncExternalStore } from "react";

/**
 * A coarse wall clock for rendering things like "3h ago" or ordering a review
 * queue. Updates every 30s; reading it keeps render pure.
 */
let now = 0;
let timer: number | null = null;
const listeners = new Set<() => void>();

function subscribe(cb: () => void) {
  listeners.add(cb);
  if (timer === null) {
    timer = window.setInterval(() => {
      now = Date.now();
      for (const l of listeners) l();
    }, 30_000);
  }
  return () => {
    listeners.delete(cb);
    if (!listeners.size && timer !== null) {
      clearInterval(timer);
      timer = null;
    }
  };
}

function snapshot() {
  if (!now) now = Date.now();
  return now;
}

export function useNow(): number {
  return useSyncExternalStore(subscribe, snapshot, () => 0);
}

/** Refresh the shared clock now (e.g. when starting a new session). */
export function touchNow(): number {
  now = Date.now();
  for (const l of listeners) l();
  return now;
}
