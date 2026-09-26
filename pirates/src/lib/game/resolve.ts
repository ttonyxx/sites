/**
 * Resolve a typed word against the board: which words and loose letters does
 * it consume? Selection is a hint, not a requirement — typing alone works, and
 * clicking words just tells the resolver which interpretation you meant.
 */
import { containsLetters, getSignature, letterDiff, normalizeWord, subtractLetters } from "../engine/letters";
import { isTrivialSteal, MIN_TARGET_LENGTH } from "../engine/puzzles";
import { isEmptySelection, selectionSignature, type Board, type BoardWord, type LooseLetter, type Selection } from "./board";

export type RejectReason =
  /** Fewer than MIN_TARGET_LENGTH letters. No penalty. */
  | "too-short"
  /** Not in the dictionary. */
  | "not-a-word"
  /** A real word, but the board can't make it. */
  | "no-match"
  /** Only makeable by tacking letters onto a word (STORE → STORES). No penalty. */
  | "must-rearrange"
  /** Only makeable from loose letters alone — a steal needs a board word. No penalty. */
  | "needs-word";

export const PENALIZED_REASONS: ReadonlySet<RejectReason> = new Set(["not-a-word", "no-match"]);

export interface StealPlan {
  word: string;
  wordIds: string[];
  looseIds: string[];
  sources: string[];
  /** Loose letters used, as a signature. */
  loose: string;
}

export type ResolveResult =
  | { ok: true; plan: StealPlan }
  | { ok: false; reason: RejectReason; word: string; diff?: { missing: string; extra: string } };

export interface ResolveOptions {
  /** Is this string a valid word? */
  isWord: (word: string) => boolean;
  /** Most board words one steal may combine. */
  maxWords?: number;
}

interface Option {
  words: BoardWord[];
  remainder: string;
}

export function resolveSteal(board: Board, input: string, selection: Selection, opts: ResolveOptions): ResolveResult {
  const word = normalizeWord(input);
  if (word.length < MIN_TARGET_LENGTH) return { ok: false, reason: "too-short", word };
  if (!opts.isWord(word)) return { ok: false, reason: "not-a-word", word };

  const target = getSignature(word);
  const looseSig = getSignature(board.loose.map((l) => l.letter).join(""));
  const fits = board.words.filter((w) => containsLetters(target, w.word));
  const maxWords = opts.maxWords ?? 4;

  const options: Option[] = [];
  let trivialOnly = false;
  const walk = (start: number, chosen: BoardWord[], remaining: string) => {
    if (chosen.length) {
      const needsLoose = chosen.length === 1;
      if ((!needsLoose || remaining.length > 0) && containsLetters(looseSig, remaining)) {
        if (isTrivialSteal(chosen.map((w) => w.word), word)) trivialOnly = true;
        else options.push({ words: chosen, remainder: remaining });
      }
    }
    if (chosen.length >= maxWords) return;
    for (let i = start; i < fits.length; i++) {
      const rest = subtractLetters(remaining, fits[i].word);
      if (rest !== null) walk(i + 1, [...chosen, fits[i]], rest);
    }
  };
  walk(0, [], target);

  if (!options.length) {
    if (trivialOnly) return { ok: false, reason: "must-rearrange", word };
    if (containsLetters(looseSig, target)) return { ok: false, reason: "needs-word", word };
    const diff = isEmptySelection(selection) ? undefined : letterDiff(selectionSignature(board, selection), word);
    return { ok: false, reason: "no-match", word, diff };
  }

  const selectedWords = new Set(selection.wordIds);
  const selectedLoose = board.loose.filter((l) => selection.looseIds.includes(l.id));
  const rank = (o: Option) => {
    const included = o.words.filter((w) => selectedWords.has(w.id)).length;
    const excluded = selectedWords.size - included;
    const looseHits = countLooseHits(o.remainder, selectedLoose);
    return 100 * included - 100 * excluded + 30 * looseHits + 10 * o.words.length - o.remainder.length;
  };
  const best = options.reduce((a, b) => (rank(b) > rank(a) ? b : a));

  return {
    ok: true,
    plan: {
      word,
      wordIds: best.words.map((w) => w.id),
      sources: best.words.map((w) => w.word),
      looseIds: pickLooseTiles(best.remainder, board.loose, selection.looseIds),
      loose: best.remainder,
    },
  };
}

function countLooseHits(remainder: string, selected: readonly LooseLetter[]): number {
  let rest = remainder;
  let hits = 0;
  for (const l of selected) {
    const next = subtractLetters(rest, l.letter);
    if (next !== null) {
      rest = next;
      hits++;
    }
  }
  return hits;
}

/** Choose which loose tiles supply `letters`: selected tiles first, then the oldest. */
function pickLooseTiles(letters: string, loose: readonly LooseLetter[], selectedIds: readonly string[]): string[] {
  const order = [...loose].sort((a, b) => {
    const sa = selectedIds.includes(a.id) ? 0 : 1;
    const sb = selectedIds.includes(b.id) ? 0 : 1;
    return sa - sb || a.addedAt - b.addedAt;
  });
  const out: string[] = [];
  const used = new Set<string>();
  for (const letter of letters) {
    const tile = order.find((l) => l.letter === letter && !used.has(l.id));
    if (tile) {
      used.add(tile.id);
      out.push(tile.id);
    }
  }
  return out;
}
