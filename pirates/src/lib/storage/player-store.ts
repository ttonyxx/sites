"use client";
/**
 * The one place React reads and writes player progress.
 *
 *   const player = usePlayer();              // null until hydrated from storage
 *   const report = commitSession(result);    // apply a finished game
 *
 * Built on useSyncExternalStore; also follows changes made in other tabs.
 */
import { useSyncExternalStore } from "react";
import { applySession, type SessionReport } from "../progress/player";
import type { PlayerData, PlayerSettings, SessionResult } from "../progress/types";
import { browserStore } from "./kv";
import { createLocalPlayerRepository, type PlayerRepository } from "./player-repository";

let repo: PlayerRepository | null = null;
let current: PlayerData | null = null;
const listeners = new Set<() => void>();

function repository(): PlayerRepository {
  repo ??= createLocalPlayerRepository(browserStore());
  return repo;
}

function ensureLoaded(): PlayerData {
  if (!current) {
    current = repository().load();
    if (typeof window !== "undefined") {
      window.addEventListener("storage", (e) => {
        if (e.key === repository().key) {
          current = repository().load();
          emit();
        }
      });
    }
  }
  return current;
}

function emit() {
  for (const l of listeners) l();
}

function set(next: PlayerData) {
  current = next;
  repository().save(next);
  emit();
}

export const playerStore = {
  subscribe(listener: () => void) {
    listeners.add(listener);
    return () => listeners.delete(listener);
  },
  get(): PlayerData {
    return ensureLoaded();
  },
  /** Apply a finished session and persist it. */
  commitSession(result: SessionResult): SessionReport {
    const { player, report } = applySession(ensureLoaded(), result);
    set(player);
    return report;
  },
  updateSettings(patch: Partial<PlayerSettings>) {
    const p = ensureLoaded();
    set({ ...p, settings: { ...p.settings, ...patch } });
  },
  reset() {
    current = repository().reset();
    emit();
  },
  /** Swap the backing repository (tests, or a future remote backend). */
  useRepository(next: PlayerRepository) {
    repo = next;
    current = null;
    emit();
  },
};

/** Current player, or null during server render / hydration (render a skeleton). */
export function usePlayer(): PlayerData | null {
  return useSyncExternalStore(playerStore.subscribe, playerStore.get, () => null);
}

export const commitSession = playerStore.commitSession;
