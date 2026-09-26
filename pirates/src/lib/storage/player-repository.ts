/**
 * Where PlayerData lives. The local implementation serializes to one
 * localStorage key; a remote one (Supabase, etc.) can implement the same
 * interface and the rest of the app won't notice.
 */
import { createPlayer, normalizePlayer } from "../progress/player";
import type { PlayerData } from "../progress/types";
import type { KeyValueStore } from "./kv";

export interface PlayerRepository {
  load(): PlayerData;
  save(player: PlayerData): void;
  reset(): PlayerData;
  /** Storage key, so other tabs' changes can be detected. */
  readonly key: string;
}

export const PLAYER_KEY = "pirates-blitz:player:v1";

export function createLocalPlayerRepository(kv: KeyValueStore, key: string = PLAYER_KEY): PlayerRepository {
  return {
    key,
    load() {
      const raw = kv.get(key);
      if (!raw) return createPlayer();
      try {
        return normalizePlayer(JSON.parse(raw));
      } catch {
        return createPlayer();
      }
    },
    save(player) {
      kv.set(key, JSON.stringify(player));
    },
    reset() {
      const fresh = createPlayer();
      kv.set(key, JSON.stringify(fresh));
      return fresh;
    },
  };
}
