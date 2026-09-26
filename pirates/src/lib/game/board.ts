/**
 * Board model: words made of letter tiles, plus loose letters in the pool.
 *
 * Tiles keep a stable id for their whole life, so when a steal happens the UI
 * can fly the *same* tiles from the board into the new word.
 */
import { combineSignatures, getSignature } from "../engine/letters";

export interface Tile {
  id: string;
  /** Lowercase letter. */
  letter: string;
}

export interface BoardWord {
  id: string;
  word: string;
  tiles: Tile[];
  /** Game-clock ms when it appeared. */
  addedAt: number;
  /** Puzzle id when this word was planted as part of an intended steal. */
  plantedId?: string;
}

export interface LooseLetter extends Tile {
  addedAt: number;
  plantedId?: string;
}

export interface Board {
  words: BoardWord[];
  loose: LooseLetter[];
}

/** What the player has clicked, in click order. */
export interface Selection {
  wordIds: string[];
  looseIds: string[];
}

export const EMPTY_BOARD: Board = { words: [], loose: [] };
export const EMPTY_SELECTION: Selection = { wordIds: [], looseIds: [] };

export class IdGen {
  private n = 0;
  constructor(private readonly prefix: string) {}
  next(): string {
    return `${this.prefix}${(this.n++).toString(36)}`;
  }
}

export function makeTiles(ids: IdGen, word: string): Tile[] {
  return [...word.toLowerCase()].map((letter) => ({ id: ids.next(), letter }));
}

export function makeWord(ids: IdGen, word: string, addedAt: number, plantedId?: string): BoardWord {
  const w = word.toLowerCase();
  return { id: ids.next(), word: w, tiles: makeTiles(ids, w), addedAt, ...(plantedId ? { plantedId } : {}) };
}

export function makeLoose(ids: IdGen, letter: string, addedAt: number, plantedId?: string): LooseLetter {
  return { id: ids.next(), letter: letter.toLowerCase(), addedAt, ...(plantedId ? { plantedId } : {}) };
}

/**
 * Rearrange the source tiles to spell `target`. Each target letter takes the
 * first unused tile with that letter, so letters keep their relative order
 * where possible (it reads as a rearrangement rather than a shuffle).
 * Returns null if the tiles don't spell the target exactly.
 */
export function tilesForTarget(target: string, sourceTiles: readonly Tile[]): Tile[] | null {
  if (getSignature(target) !== getSignature(sourceTiles.map((t) => t.letter).join(""))) return null;
  const used = new Set<string>();
  const out: Tile[] = [];
  for (const letter of target.toLowerCase()) {
    const tile = sourceTiles.find((t) => t.letter === letter && !used.has(t.id));
    if (!tile) return null;
    used.add(tile.id);
    out.push(tile);
  }
  return out;
}

export function removePieces(board: Board, wordIds: readonly string[], looseIds: readonly string[]): Board {
  if (!wordIds.length && !looseIds.length) return board;
  const w = new Set(wordIds);
  const l = new Set(looseIds);
  return {
    words: wordIds.length ? board.words.filter((x) => !w.has(x.id)) : board.words,
    loose: looseIds.length ? board.loose.filter((x) => !l.has(x.id)) : board.loose,
  };
}

export function toggleSelection(sel: Selection, kind: "word" | "loose", id: string): Selection {
  const key = kind === "word" ? "wordIds" : "looseIds";
  const list = sel[key];
  const next = list.includes(id) ? list.filter((x) => x !== id) : [...list, id];
  return { ...sel, [key]: next };
}

/** Drop ids that are no longer on the board. Returns the same object if nothing changed. */
export function pruneSelection(sel: Selection, board: Board): Selection {
  const words = new Set(board.words.map((w) => w.id));
  const loose = new Set(board.loose.map((l) => l.id));
  const wordIds = sel.wordIds.filter((id) => words.has(id));
  const looseIds = sel.looseIds.filter((id) => loose.has(id));
  if (wordIds.length === sel.wordIds.length && looseIds.length === sel.looseIds.length) return sel;
  return { wordIds, looseIds };
}

export function isEmptySelection(sel: Selection): boolean {
  return sel.wordIds.length === 0 && sel.looseIds.length === 0;
}

/** All letters currently selected, as one signature. */
export function selectionSignature(board: Board, sel: Selection): string {
  const words = sel.wordIds.map((id) => board.words.find((w) => w.id === id)?.word ?? "");
  const loose = sel.looseIds.map((id) => board.loose.find((l) => l.id === id)?.letter ?? "").join("");
  return combineSignatures(...words.map(getSignature), getSignature(loose));
}

export function selectionLength(board: Board, sel: Selection): number {
  return selectionSignature(board, sel).length;
}
