/**
 * Fusion Vision: 10 boards of 8–12 words, each hiding exactly one intended
 * two-word fusion. We verify no *other* pair on the board also fuses into a
 * familiar word, so there's one clean answer to find.
 */
import { combineSignatures, getSignature } from "../engine/letters";
import type { Lexicon } from "../engine/lexicon";
import { isTrivialSteal, type Puzzle } from "../engine/puzzles";
import type { Rng } from "../engine/rng";
import type { RatingEvent } from "../progress/types";
import type { PuzzleBank } from "./bank";
import { IdGen, makeWord, type Board, type Selection } from "./board";
import { PENALIZED_REASONS, resolveSteal, type RejectReason } from "./resolve";
import { fusionScore } from "./scoring";

export const FUSION_SESSION_LENGTH = 10;
export const FUSION_TIME_LIMIT_MS = 30_000;

export interface FusionRound {
  puzzle: Puzzle;
  board: Board;
  /** Board word ids of the two sources. */
  answerWordIds: [string, string];
}

/** Other familiar fusions among the board's words (should be none besides the answer). */
export function otherFusions(words: readonly string[], lexicon: Lexicon, answerPair: readonly [string, string]): string[] {
  const found: string[] = [];
  for (let i = 0; i < words.length; i++) {
    for (let j = i + 1; j < words.length; j++) {
      const pair = [words[i], words[j]];
      if (pair.includes(answerPair[0]) && pair.includes(answerPair[1])) continue;
      const sig = combineSignatures(getSignature(pair[0]), getSignature(pair[1]));
      for (const w of lexicon.anagrams(sig)) {
        if (lexicon.isPlayable(w, 3) && !isTrivialSteal(pair, w)) found.push(w);
      }
    }
  }
  return found;
}

export function buildFusionRound(
  bank: PuzzleBank,
  lexicon: Lexicon,
  rng: Rng,
  opts: { rating: number; used: ReadonlySet<string>; wordCount: number; ids: IdGen },
): FusionRound | null {
  for (let attempt = 0; attempt < 8; attempt++) {
    const puzzle = bank.pick({
      rng,
      types: { fusion: 1 },
      target: opts.rating + rng.int(-60, 90),
      exclude: (p) => opts.used.has(p.id),
    });
    if (!puzzle) return null;

    // Harder puzzles get sneakier distractors (sharing letters with the answer).
    const similarTo = puzzle.difficulty > 1300 ? getSignature(puzzle.target) : undefined;
    const exclude = new Set([...puzzle.sources, ...puzzle.answers]);
    const words = [...puzzle.sources];
    for (const d of bank.distractors(opts.wordCount * 2, { rng, exclude, similarTo, maxLength: 7 })) {
      if (words.length >= opts.wordCount) break;
      const candidate = [...words, d];
      if (otherFusions(candidate, lexicon, [puzzle.sources[0], puzzle.sources[1]]).length === 0) words.push(d);
    }
    if (words.length < Math.min(8, opts.wordCount)) continue;

    const boardWords = rng.shuffle(words).map((w) => makeWord(opts.ids, w, 0, puzzle.sources.includes(w) ? puzzle.id : undefined));
    const a = boardWords.find((w) => w.word === puzzle.sources[0])!;
    const b = boardWords.find((w) => w.word === puzzle.sources[1])!;
    return { puzzle, board: { words: boardWords, loose: [] }, answerWordIds: [a.id, b.id] };
  }
  return null;
}

// ── Session ──────────────────────────────────────────────────────────────────

export interface FusionOutcome {
  puzzle: Puzzle;
  solved: boolean;
  /** What the player typed when they solved it (may be another valid fusion). */
  answer: string | null;
  solveMs: number | null;
  wrong: number;
  points: number;
  boardSize: number;
}

export type FusionSubmit =
  | { ok: true; word: string; points: number; solveMs: number; wordIds: string[] }
  | { ok: false; reason: RejectReason | "needs-two-words"; word: string; diff?: { missing: string; extra: string } };

/**
 * Ten Fusion Vision boards in a row. Pure state machine; the UI drives time.
 */
export class FusionSession {
  readonly length: number;
  private readonly bank: PuzzleBank;
  private readonly lexicon: Lexicon;
  private readonly rng: Rng;
  private readonly ids = new IdGen("f");
  private readonly used = new Set<string>();
  private rating: number;
  private round: FusionRound | null = null;
  private roundStart = 0;
  private wrongThisRound = 0;
  readonly outcomes: FusionOutcome[] = [];
  streak = 0;
  bestStreak = 0;
  score = 0;

  constructor(bank: PuzzleBank, lexicon: Lexicon, rng: Rng, opts: { rating: number; length?: number; wordCount?: number }) {
    this.bank = bank;
    this.lexicon = lexicon;
    this.rng = rng;
    this.rating = opts.rating;
    this.length = opts.length ?? FUSION_SESSION_LENGTH;
    this.wordCount = opts.wordCount ?? 10;
  }

  private readonly wordCount: number;

  get current(): FusionRound | null {
    return this.round;
  }

  get index(): number {
    return this.outcomes.length;
  }

  get done(): boolean {
    return this.outcomes.length >= this.length;
  }

  /** Deal the next board. */
  next(now: number): FusionRound | null {
    if (this.done) return null;
    const round = buildFusionRound(this.bank, this.lexicon, this.rng, {
      rating: this.rating,
      used: this.used,
      wordCount: this.wordCount,
      ids: this.ids,
    });
    if (!round) return null;
    this.used.add(round.puzzle.id);
    this.round = round;
    this.roundStart = now;
    this.wrongThisRound = 0;
    return round;
  }

  elapsed(now: number): number {
    return now - this.roundStart;
  }

  /** Don't count time the player wasn't looking (tab hidden). */
  pauseFor(ms: number): void {
    this.roundStart += ms;
  }

  submit(input: string, selection: Selection, now: number): FusionSubmit {
    const round = this.round;
    if (!round) return { ok: false, reason: "no-match", word: input };
    const res = resolveSteal(round.board, input, selection, { isWord: (w) => this.lexicon.has(w), maxWords: 2 });
    if (!res.ok) {
      if (PENALIZED_REASONS.has(res.reason)) this.wrongThisRound++;
      return res;
    }
    if (res.plan.sources.length !== 2) {
      this.wrongThisRound++;
      return { ok: false, reason: "needs-two-words", word: res.plan.word };
    }
    const solveMs = Math.max(300, now - this.roundStart);
    const points = fusionScore(res.plan.word.length, solveMs, round.puzzle.difficulty);
    this.finishRound({ solved: true, answer: res.plan.word, solveMs, points });
    return { ok: true, word: res.plan.word, points, solveMs, wordIds: res.plan.wordIds };
  }

  /** Time ran out or the player gave up. */
  giveUp(): FusionOutcome | null {
    if (!this.round) return null;
    return this.finishRound({ solved: false, answer: null, solveMs: null, points: 0 });
  }

  private finishRound(r: { solved: boolean; answer: string | null; solveMs: number | null; points: number }): FusionOutcome {
    const round = this.round!;
    const outcome: FusionOutcome = { puzzle: round.puzzle, wrong: this.wrongThisRound, boardSize: round.board.words.length, ...r };
    this.outcomes.push(outcome);
    this.score += r.points;
    if (r.solved) {
      this.streak++;
      this.bestStreak = Math.max(this.bestStreak, this.streak);
      this.rating += 35;
    } else {
      this.streak = 0;
      this.rating -= 45;
    }
    this.round = null;
    return outcome;
  }

  /** Aggregate for the results screen and progress system. */
  summary() {
    const solved = this.outcomes.filter((o) => o.solved);
    const times = solved.map((o) => o.solveMs!).sort((a, b) => a - b);
    const median = times.length ? (times.length % 2 ? times[(times.length - 1) / 2] : (times[times.length / 2 - 1] + times[times.length / 2]) / 2) : null;
    const wrong = this.outcomes.reduce((s, o) => s + o.wrong, 0);
    const ratingEvents: RatingEvent[] = [];
    for (const o of this.outcomes) {
      const difficulty = o.puzzle.difficulty + 8 * (o.boardSize - 10);
      const speed = o.solveMs === null ? 0 : Math.min(1, Math.max(0, (25_000 - o.solveMs) / 20_000));
      const score = o.solved ? 0.6 + 0.4 * speed : 0;
      ratingEvents.push({ skill: "fusion", difficulty, score });
      if (o.puzzle.target.length >= 8) ratingEvents.push({ skill: "longWords", difficulty, score, weight: 0.5 });
    }
    return {
      solved: solved.length,
      total: this.outcomes.length,
      accuracy: this.outcomes.length ? solved.length / this.outcomes.length : 0,
      medianMs: median,
      solveTimesMs: times,
      wrong,
      bestStreak: this.bestStreak,
      score: this.score,
      ratingEvents,
      missed: this.outcomes.filter((o) => !o.solved),
    };
  }
}
