"use client";
/**
 * Loads the dictionary and puzzle bank once per page load. The lexicon is a
 * static text file (~360 KB gzipped); puzzles/words are code-split JSON.
 * Every puzzle is re-verified with exact letter counts before use.
 */
import { useEffect, useState } from "react";
import { Lexicon } from "./engine/lexicon";
import type { Puzzle } from "./engine/puzzles";
import type { WordEntry } from "./engine/words";
import { PuzzleBank } from "./game/bank";

export const BASE_PATH = process.env.NEXT_PUBLIC_BASE_PATH ?? "";

export interface GameData {
  lexicon: Lexicon;
  bank: PuzzleBank;
}

let pending: Promise<GameData> | null = null;
let loaded: GameData | null = null;

export function loadGameData(): Promise<GameData> {
  if (loaded) return Promise.resolve(loaded);
  pending ??= (async () => {
    const [text, puzzles, words] = await Promise.all([
      fetch(`${BASE_PATH}/lexicon.txt`).then((r) => {
        if (!r.ok) throw new Error(`Couldn't load the dictionary (${r.status})`);
        return r.text();
      }),
      import("@data/puzzles.json").then((m) => m.default as Puzzle[]),
      import("@data/words.json").then((m) => m.default as WordEntry[]),
    ]);
    const lexicon = await Lexicon.fromTextAsync(text);
    const { bank, rejected } = PuzzleBank.verified(puzzles, words, lexicon);
    if (rejected.length) console.warn(`Dropped ${rejected.length} invalid puzzle(s)`, rejected.slice(0, 10));
    loaded = { lexicon, bank };
    return loaded;
  })();
  pending.catch(() => {
    pending = null; // allow a retry
  });
  return pending;
}

/** Start loading in the background (e.g. while the home screen is idle). */
export function preloadGameData(): void {
  void loadGameData().catch(() => {});
}

export function useGameData(): { data: GameData | null; error: Error | null; retry: () => void } {
  const [data, setData] = useState<GameData | null>(loaded);
  const [error, setError] = useState<Error | null>(null);
  const [attempt, setAttempt] = useState(0);
  useEffect(() => {
    if (loaded) return;
    let alive = true;
    loadGameData().then(
      (d) => alive && setData(d),
      (e: Error) => alive && setError(e),
    );
    return () => {
      alive = false;
    };
  }, [attempt]);
  return {
    data: data ?? loaded,
    error,
    retry: () => {
      setError(null);
      setAttempt((a) => a + 1);
    },
  };
}
