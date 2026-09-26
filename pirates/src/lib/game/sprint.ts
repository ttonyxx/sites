/**
 * Steal Sprint — the primary mode, as a framework-free game engine.
 *
 * A 60-second round on a living board: planted steals (from the puzzle bank,
 * near the player's adaptive difficulty) sit among everyday distractor words,
 * a new pool letter flips every few seconds, and a "rival" snatches planted
 * steals that sit untouched for too long. Every available steal is tracked
 * so the results screen can show exactly what was missed and for how long.
 *
 * The UI passes wall-clock timestamps (performance.now()); internally the game
 * runs on its own clock so it can pause when the tab is hidden.
 */
import { combineSignatures, getSignature } from "../engine/letters";
import type { Lexicon } from "../engine/lexicon";
import { computeDifficulty, featuresFor, isTrivialSteal, puzzleId, puzzleTypeFor, type Puzzle, type PuzzleType } from "../engine/puzzles";
import { createRng, type Rng } from "../engine/rng";
import type { MissedInput, RatingEvent } from "../progress/types";
import { sprintTypeWeights, type PuzzleBank } from "./bank";
import { IdGen, makeLoose, makeWord, removePieces, tilesForTarget, type Board, type Selection, type Tile } from "./board";
import { boardAdjustment } from "./difficulty";
import { findOpportunities, opportunityKey, type Opportunity } from "./opportunities";
import { PENALIZED_REASONS, resolveSteal, type RejectReason, type StealPlan } from "./resolve";
import { nextCombo, scoreSteal, SCORING, type ScoreBreakdown } from "./scoring";

export interface SprintConfig {
  durationMs: number;
  /** Board keeps at least this many words. */
  minWords: number;
  maxWords: number;
  maxLoose: number;
  looseIntervalMs: number;
  /** Planted steals to keep available at once. */
  plantedTarget: number;
  initialPlants: number;
  /** Starting difficulty cursor (usually the player's rating). */
  startRating: number;
  seed: number;
  /** Disable the rival (tests, gentle mode). */
  rival: boolean;
}

export const DEFAULT_SPRINT_CONFIG: SprintConfig = {
  durationMs: 60_000,
  minWords: 11,
  maxWords: 14,
  maxLoose: 7,
  looseIntervalMs: 6_500,
  plantedTarget: 2,
  initialPlants: 3,
  startRating: 1000,
  seed: 1,
  rival: true,
};

export interface StolenWord {
  id: string;
  word: string;
  /** The source tiles, rearranged into the new word. */
  tiles: Tile[];
  sources: string[];
  loose: string;
  points: number;
  at: number;
}

export interface MissedSteal extends MissedInput {
  planted: boolean;
  reason: "rival" | "swept" | "end";
}

export type SprintEvent =
  | { type: "steal"; stolen: StolenWord; breakdown: ScoreBreakdown; combo: number; solveMs: number; wordIds: string[]; looseIds: string[] }
  | { type: "reject"; reason: RejectReason; word: string; penaltyMs: number; diff?: { missing: string; extra: string } }
  | { type: "rival"; sources: string[]; loose: string; target: string; wordIds: string[]; looseIds: string[] }
  | { type: "flip"; letterId: string }
  | { type: "end" };

export interface SprintView {
  status: "playing" | "over";
  board: Board;
  pile: StolenWord[];
  score: number;
  combo: number;
  bestCombo: number;
  /** Game-clock ms of the last success (combo timer), or null. */
  lastSuccessAt: number | null;
  steals: number;
}

export interface SprintResult {
  score: number;
  steals: number;
  /** Penalized wrong answers (not-a-word / can't make it). */
  wrong: number;
  accuracy: number;
  avgSolveMs: number | null;
  fastestSolveMs: number | null;
  bestCombo: number;
  durationMs: number;
  pile: StolenWord[];
  /** Most instructive misses, best first. */
  missed: MissedSteal[];
  ratingEvents: RatingEvent[];
  solveTimesMs: number[];
  fusions: number;
  triples: number;
}

interface Planted {
  puzzle: Puzzle;
  wordIds: string[];
  at: number;
}

interface Tracked {
  opp: Opportunity;
  firstSeen: number;
}

// Bananagrams-style letter distribution for pool flips.
const LETTER_BAG = Object.entries({
  a: 13, b: 3, c: 3, d: 6, e: 18, f: 3, g: 4, h: 3, i: 12, j: 2, k: 2, l: 5, m: 3,
  n: 8, o: 11, p: 3, q: 2, r: 9, s: 6, t: 9, u: 6, v: 3, w: 3, x: 2, y: 3, z: 2,
}).flatMap(([letter, n]) => Array<string>(n).fill(letter));
const ALPHABET = "abcdefghijklmnopqrstuvwxyz";
const OPENING_LETTERS = [..."eeeaaiioorrsstnld"];

const MISS_MIN_AVAILABLE_MS = 3_000;
/** How many of a round's misses are shown on the results screen and saved to Review Mistakes. */
export const SPRINT_MISSES_SAVED = 5;
const HELP_AFTER_MS = 15_000;
const CURSOR_MIN = 650;
const CURSOR_MAX = 2300;

export class SprintGame {
  readonly config: SprintConfig;
  private readonly bank: PuzzleBank;
  private readonly lexicon: Lexicon;
  private readonly rng: Rng;
  private readonly ids = new IdGen("s");

  private status: "idle" | "playing" | "paused" | "over" = "idle";
  private wallStart = 0;
  private pausedAt = 0;
  private pausedTotal = 0;
  private endsAt = 0;

  private board: Board = { words: [], loose: [] };
  private pile: StolenWord[] = [];
  private score = 0;
  private combo = 0;
  private bestCombo = 0;
  private lastSuccessAt: number | null = null;
  private lastProgressAt = 0;
  private lastStealAt = 0;
  private lastRivalAt = -Infinity;
  private nextFlipAt = 0;
  private cursor: number;

  private opps = new Map<string, Tracked>();
  private planted = new Map<string, Planted>();
  private usedPuzzles = new Set<string>();
  private missed: MissedSteal[] = [];
  private ratingEvents: RatingEvent[] = [];
  private solveTimes: number[] = [];
  private wrong = 0;
  private fusions = 0;
  private triples = 0;

  private cachedView: SprintView | null = null;
  private listeners = new Set<() => void>();
  private eventListeners = new Set<(e: SprintEvent) => void>();

  constructor(bank: PuzzleBank, lexicon: Lexicon, config: Partial<SprintConfig> = {}) {
    this.config = { ...DEFAULT_SPRINT_CONFIG, ...config };
    this.bank = bank;
    this.lexicon = lexicon;
    this.rng = createRng(this.config.seed);
    this.cursor = clampCursor(this.config.startRating);
  }

  // ── Public API ────────────────────────────────────────────────────────────

  start(now: number): void {
    if (this.status !== "idle") return;
    this.status = "playing";
    this.wallStart = now;
    this.endsAt = this.config.durationMs;
    this.nextFlipAt = this.config.looseIntervalMs;

    for (let i = 0; i < this.config.initialPlants; i++) this.plant(0, this.cursor - 60 * i);
    this.addDistractors(0, this.config.minWords + 1 - this.board.words.length);
    // Open with one friendly letter; the pool fills up as the round goes on.
    this.addLoose(0, this.rng.pick(OPENING_LETTERS));
    this.refresh(0, "add");
    this.changed();
  }

  /** Advance the clock: pool flips, the rival, help for a stuck player, and the end of the round. */
  tick(now: number): void {
    if (this.status !== "playing") return;
    const g = this.gameNow(now);
    if (g >= this.endsAt) {
      this.finish(now);
      return;
    }
    let dirty = false;
    if (g >= this.nextFlipAt) {
      this.nextFlipAt += this.config.looseIntervalMs;
      this.flip(g);
      dirty = true;
    }
    if (this.config.rival && this.rival(g)) dirty = true;
    if (g - this.lastProgressAt > HELP_AFTER_MS) {
      this.lastProgressAt = g;
      this.cursor = clampCursor(this.cursor - 60);
      if (this.plantedAliveCount() < this.config.plantedTarget + 1 && this.plant(g, this.cursor - 150)) {
        this.refresh(g, "add");
        dirty = true;
      }
    }
    if (dirty) this.changed();
  }

  submit(input: string, selection: Selection, now: number): { ok: true; points: number } | { ok: false; reason: RejectReason } {
    if (this.status !== "playing") return { ok: false, reason: "no-match" };
    const g = this.gameNow(now);
    const res = resolveSteal(this.board, input, selection, { isWord: (w) => this.lexicon.has(w) });

    if (!res.ok) {
      const penalized = PENALIZED_REASONS.has(res.reason);
      if (penalized) {
        this.wrong++;
        this.combo = 0;
        this.endsAt -= SCORING.wrongPenaltyMs;
        this.cursor = clampCursor(this.cursor - 10);
      }
      this.emit({ type: "reject", reason: res.reason, word: res.word, penaltyMs: penalized ? SCORING.wrongPenaltyMs : 0, diff: res.diff });
      this.changed();
      if (g >= this.endsAt) this.finish(now);
      return { ok: false, reason: res.reason };
    }

    const points = this.applySteal(res.plan, g);
    return { ok: true, points };
  }

  /** Freeze the clock (e.g. the tab was hidden). */
  pause(now: number): void {
    if (this.status !== "playing") return;
    this.status = "paused";
    this.pausedAt = now;
  }

  resume(now: number): void {
    if (this.status !== "paused") return;
    this.pausedTotal += now - this.pausedAt;
    this.status = "playing";
  }

  get isPaused(): boolean {
    return this.status === "paused";
  }

  get isOver(): boolean {
    return this.status === "over";
  }

  /** Game-clock ms remaining. */
  remainingMs(now: number): number {
    if (this.status === "idle") return this.config.durationMs;
    if (this.status === "over") return 0;
    const g = this.status === "paused" ? this.gameNow(this.pausedAt) : this.gameNow(now);
    return Math.max(0, this.endsAt - g);
  }

  /** Game-clock time for a wall-clock timestamp. */
  gameNow(now: number): number {
    return now - this.wallStart - this.pausedTotal;
  }

  finish(now: number): void {
    if (this.status === "over" || this.status === "idle") return;
    const g = Math.min(this.gameNow(this.status === "paused" ? this.pausedAt : now), this.endsAt);
    this.status = "over";
    for (const t of this.opps.values()) this.noteMiss(t, g, "end");
    this.opps.clear();
    this.emit({ type: "end" });
    this.changed();
  }

  view(): SprintView {
    if (!this.cachedView) {
      this.cachedView = {
        status: this.status === "over" ? "over" : "playing",
        board: this.board,
        pile: this.pile,
        score: this.score,
        combo: this.combo,
        bestCombo: this.bestCombo,
        lastSuccessAt: this.lastSuccessAt,
        steals: this.pile.length,
      };
    }
    return this.cachedView;
  }

  subscribe(listener: () => void): () => void {
    this.listeners.add(listener);
    return () => this.listeners.delete(listener);
  }

  onEvent(listener: (e: SprintEvent) => void): () => void {
    this.eventListeners.add(listener);
    return () => this.eventListeners.delete(listener);
  }

  /** Game-clock ms since the last steal (or the start of the round). */
  idleMs(now: number): number {
    return this.status === "playing" ? this.gameNow(now) - this.lastStealAt : 0;
  }

  /** The easiest intended steal on the board right now, for first-game hints. */
  hint(): { wordIds: string[]; looseIds: string[]; target: string } | null {
    let best: Planted | null = null;
    for (const p of this.planted.values()) {
      if (!this.opps.has(opportunityKey(p.wordIds, p.puzzle.loose))) continue;
      if (!best || p.puzzle.difficulty < best.puzzle.difficulty) best = p;
    }
    if (!best) return null;
    const looseIds: string[] = [];
    for (const letter of best.puzzle.loose) {
      const tile = this.board.loose.find((l) => l.letter === letter && !looseIds.includes(l.id));
      if (tile) looseIds.push(tile.id);
    }
    return { wordIds: best.wordIds, looseIds, target: best.puzzle.target };
  }

  /** Available steals right now (debugging, hints, tests). */
  opportunities(): Opportunity[] {
    return [...this.opps.values()].map((t) => t.opp);
  }

  result(): SprintResult {
    const attempts = this.pile.length + this.wrong;
    const solves = this.solveTimes;
    return {
      score: this.score,
      steals: this.pile.length,
      wrong: this.wrong,
      accuracy: attempts ? this.pile.length / attempts : 0,
      avgSolveMs: solves.length ? solves.reduce((a, b) => a + b, 0) / solves.length : null,
      fastestSolveMs: solves.length ? Math.min(...solves) : null,
      bestCombo: this.bestCombo,
      durationMs: this.config.durationMs,
      pile: this.pile,
      missed: rankMissed(this.missed),
      ratingEvents: this.ratingEvents,
      solveTimesMs: solves,
      fusions: this.fusions,
      triples: this.triples,
    };
  }

  // ── Steals ────────────────────────────────────────────────────────────────

  private applySteal(plan: StealPlan, g: number): number {
    const words = plan.wordIds.map((id) => this.board.words.find((w) => w.id === id)!);
    const looseTiles = plan.looseIds.map((id) => this.board.loose.find((l) => l.id === id)!);
    const tiles = tilesForTarget(plan.word, [...words.flatMap((w) => w.tiles), ...looseTiles])!;

    const key = opportunityKey(plan.wordIds, plan.loose);
    const availableSince = this.opps.get(key)?.firstSeen ?? Math.max(...words.map((w) => w.addedAt), ...looseTiles.map((l) => l.addedAt));
    const solveMs = Math.max(250, g - availableSince);
    const { difficulty } = this.difficultyOf(plan);

    this.combo = nextCombo(this.combo, this.lastSuccessAt, g);
    this.bestCombo = Math.max(this.bestCombo, this.combo);
    this.lastSuccessAt = g;
    this.lastProgressAt = g;
    this.lastStealAt = g;

    const breakdown = scoreSteal({ sourceCount: plan.sources.length, targetLength: plan.word.length, solveMs, combo: this.combo, difficulty });
    this.score += breakdown.total;
    this.solveTimes.push(solveMs);
    if (plan.sources.length === 2) this.fusions++;
    if (plan.sources.length >= 3) this.triples++;

    const stolen: StolenWord = {
      id: this.ids.next(),
      word: plan.word,
      tiles,
      sources: plan.sources,
      loose: plan.loose,
      points: breakdown.total,
      at: g,
    };
    this.pile = [stolen, ...this.pile];
    this.board = removePieces(this.board, plan.wordIds, plan.looseIds);
    for (const [id, p] of this.planted) if (p.wordIds.some((w) => plan.wordIds.includes(w))) this.planted.delete(id);

    // Ratings: the steal itself, long words, and how quickly it was spotted.
    const skill = plan.sources.length === 1 ? "steals" : "fusion";
    this.ratingEvents.push({ skill, difficulty, score: 1 });
    if (plan.word.length >= 8) this.ratingEvents.push({ skill: "longWords", difficulty, score: 1 });
    const scan = Math.min(1, Math.max(0, (14_000 - solveMs) / 11_000));
    this.ratingEvents.push({ skill: "boardScan", difficulty, score: scan, weight: 0.6 });

    this.cursor = clampCursor(this.cursor + 30 + 20 * scan);

    this.refresh(g, "player");
    this.refill(g);
    this.emit({ type: "steal", stolen, breakdown, combo: this.combo, solveMs, wordIds: plan.wordIds, looseIds: plan.looseIds });
    this.changed();
    return breakdown.total;
  }

  /** Rating-scale difficulty of what the player just made, adjusted for a crowded, look-alike board. */
  private difficultyOf(plan: StealPlan): { difficulty: number; planted: boolean } {
    const others = this.board.words.filter((w) => !plan.wordIds.includes(w.id)).map((w) => w.word);
    const boardAdj = boardAdjustment(plan.word, this.board.words.length, others);
    for (const p of this.planted.values()) {
      const same = p.wordIds.length === plan.wordIds.length && p.wordIds.every((id) => plan.wordIds.includes(id)) && p.puzzle.loose === plan.loose;
      if (same) return { difficulty: p.puzzle.difficulty + boardAdj, planted: true };
    }
    const sig = combineSignatures(...plan.sources.map(getSignature), plan.loose);
    const answers = [plan.word, ...this.lexicon.anagrams(sig).filter((w) => w !== plan.word && this.lexicon.isPlayable(w))];
    return { difficulty: computeDifficulty(featuresFor(plan.sources, plan.loose, answers, this.lexicon)) + boardAdj, planted: false };
  }

  // ── Board upkeep ──────────────────────────────────────────────────────────

  /**
   * Plant a puzzle near `target` difficulty. Prefers puzzles that fit on the
   * board as-is; only if none does is an old unplanted word swept to make room.
   * Returns false if nothing could be planted.
   */
  private plant(g: number, target: number): boolean {
    return this.tryPlant(g, target, 0) || this.tryPlant(g, target, 3);
  }

  private tryPlant(g: number, target: number, overflow: number): boolean {
    const onBoard = new Set(this.board.words.map((w) => w.word));
    const inPile = new Set(this.pile.map((s) => s.word));
    // Room we could make by sweeping old words that aren't part of a planted steal.
    const plantedWordIds = new Set([...this.planted.values()].flatMap((p) => p.wordIds));
    const sweepable = overflow ? this.board.words.filter((w) => !plantedWordIds.has(w.id)).length : 0;
    const puzzle = this.bank.pick({
      rng: this.rng,
      types: sprintTypeWeights(target),
      target,
      exclude: (p) =>
        this.usedPuzzles.has(p.id) ||
        p.sources.some((s) => onBoard.has(s)) ||
        inPile.has(p.target) ||
        this.board.words.length + p.sources.length > this.config.maxWords + Math.min(overflow, sweepable),
    });
    if (!puzzle) return false;
    this.usedPuzzles.add(puzzle.id);

    // Make room: sweep the oldest unplanted words / letters.
    this.makeRoom(g, puzzle.sources.length, puzzle.loose.length);

    const words = puzzle.sources.map((s) => makeWord(this.ids, s, g, puzzle.id));
    this.board = { ...this.board, words: [...this.board.words, ...this.rng.shuffle(words)] };
    for (const letter of puzzle.loose) this.addLoose(g, letter, puzzle.id);
    this.planted.set(puzzle.id, { puzzle, wordIds: words.map((w) => w.id), at: g });
    return true;
  }

  private makeRoom(g: number, words: number, letters: number) {
    const plantedWordIds = new Set([...this.planted.values()].flatMap((p) => p.wordIds));
    let sweptWords: string[] = [];
    const overflowWords = this.board.words.length + words - this.config.maxWords;
    if (overflowWords > 0) {
      sweptWords = this.board.words
        .filter((w) => !plantedWordIds.has(w.id))
        .sort((a, b) => a.addedAt - b.addedAt)
        .slice(0, overflowWords)
        .map((w) => w.id);
    }
    let sweptLoose: string[] = [];
    const overflowLoose = this.board.loose.length + letters - this.config.maxLoose;
    if (overflowLoose > 0) {
      const plantedLetters = this.plantedLooseIds();
      sweptLoose = [...this.board.loose]
        .sort((a, b) => Number(plantedLetters.has(a.id)) - Number(plantedLetters.has(b.id)) || a.addedAt - b.addedAt)
        .slice(0, overflowLoose)
        .map((l) => l.id);
    }
    if (sweptWords.length || sweptLoose.length) {
      this.board = removePieces(this.board, sweptWords, sweptLoose);
      this.refresh(g, "swept");
    }
  }

  /** Loose tiles that currently belong to a living planted puzzle. */
  private plantedLooseIds(): Set<string> {
    const ids = new Set<string>();
    for (const p of this.planted.values()) {
      const need = [...p.puzzle.loose];
      for (const l of this.board.loose) {
        const i = need.indexOf(l.letter);
        if (i >= 0 && l.plantedId === p.puzzle.id) {
          ids.add(l.id);
          need.splice(i, 1);
        }
      }
    }
    return ids;
  }

  private addDistractors(g: number, count: number) {
    if (count <= 0) return;
    const exclude = new Set([...this.board.words.map((w) => w.word), ...this.pile.map((s) => s.word)]);
    const planted = [...this.planted.values()];
    const similarTo = this.cursor > 1350 && planted.length ? getSignature(this.rng.pick(planted).puzzle.target) : undefined;
    const maxLength = this.config.maxWords <= 11 ? 6 : 7;
    for (const word of this.bank.distractors(count, { rng: this.rng, exclude, similarTo, maxLength })) {
      const w = makeWord(this.ids, word, g);
      const at = this.rng.int(0, this.board.words.length);
      const words = [...this.board.words];
      words.splice(at, 0, w);
      this.board = { ...this.board, words };
    }
  }

  private addLoose(g: number, letter: string, plantedId?: string) {
    this.board = { ...this.board, loose: [...this.board.loose, makeLoose(this.ids, letter, g, plantedId)] };
  }

  /** Flip a new pool letter, sometimes one that opens a fresh steal. */
  private flip(g: number) {
    this.makeRoom(g, 0, 1);
    const letter = this.rng.next() < 0.5 ? (this.helpfulLetter() ?? this.rng.pick(LETTER_BAG)) : this.rng.pick(LETTER_BAG);
    this.addLoose(g, letter);
    this.refresh(g, "add");
    this.emit({ type: "flip", letterId: this.board.loose[this.board.loose.length - 1].id });
  }

  private helpfulLetter(): string | undefined {
    const counts = new Map<string, number>();
    const inPool = new Set(this.board.loose.map((l) => l.letter));
    for (const w of this.board.words) {
      const sig = getSignature(w.word);
      for (const ch of ALPHABET) {
        const hits = this.lexicon
          .anagrams(combineSignatures(sig, ch))
          .filter((a) => a.length >= 5 && this.lexicon.isPlayable(a, 4) && !isTrivialSteal([w.word], a)).length;
        if (hits) counts.set(ch, (counts.get(ch) ?? 0) + hits);
      }
    }
    return this.rng.weighted([...counts.keys()], (ch) => counts.get(ch)! * (inPool.has(ch) ? 0.3 : 1));
  }

  /** Keep the board full and make sure there is always something to steal. */
  private refill(g: number) {
    let guard = 0;
    while (this.plantedAliveCount() < this.config.plantedTarget && guard++ < 4) {
      if (!this.plant(g, this.cursor + this.rng.int(-80, 80))) break;
      // plantedAliveCount() reads the opportunity cache, so bring it up to date before counting again.
      this.refresh(g, "add");
    }
    this.addDistractors(g, this.config.minWords - this.board.words.length);
    this.refresh(g, "add");
    if (!this.hasNotableOpportunity() && this.plant(g, this.cursor - 200)) this.refresh(g, "add");
  }

  /** Planted (intended) steals currently available on the board. */
  plantedAliveCount(): number {
    let n = 0;
    for (const p of this.planted.values()) if (this.opps.has(opportunityKey(p.wordIds, p.puzzle.loose))) n++;
    return n;
  }

  private hasNotableOpportunity(): boolean {
    for (const t of this.opps.values()) if (t.opp.tier >= 4 || t.opp.answers[0].length >= 6) return true;
    return false;
  }

  // ── Rival ─────────────────────────────────────────────────────────────────

  /** A rival pirate grabs a planted steal nobody took. Returns true if it acted. */
  private rival(g: number): boolean {
    if (g < 12_000 || this.endsAt - g < 6_000 || g - this.lastRivalAt < 12_000) return false;
    for (const [id, p] of this.planted) {
      const tracked = this.opps.get(opportunityKey(p.wordIds, p.puzzle.loose));
      if (!tracked) continue;
      const alive = g - tracked.firstSeen;
      if (alive < rivalDelay(p.puzzle.difficulty)) continue;

      const looseIds: string[] = [];
      for (const letter of p.puzzle.loose) {
        const tile = this.board.loose.find((l) => l.letter === letter && !looseIds.includes(l.id));
        if (tile) looseIds.push(tile.id);
      }
      this.noteMiss(tracked, g, "rival");
      this.opps.delete(tracked.opp.key);
      this.planted.delete(id);
      this.board = removePieces(this.board, p.wordIds, looseIds);
      this.lastRivalAt = g;
      this.cursor = clampCursor(this.cursor - 45);
      this.refresh(g, "swept");
      this.refill(g);
      this.emit({ type: "rival", sources: p.puzzle.sources, loose: p.puzzle.loose, target: p.puzzle.target, wordIds: p.wordIds, looseIds });
      return true;
    }
    return false;
  }

  // ── Opportunity tracking ──────────────────────────────────────────────────

  /**
   * Recompute available steals. Steals that vanish because the player used
   * their pieces aren't misses; ones swept away (or left at the end) are.
   */
  private refresh(g: number, cause: "player" | "swept" | "add") {
    const found = findOpportunities(this.board, this.lexicon, { minTier: 3, maxWords: 3, maxLoose: 2 });
    const next = new Map<string, Tracked>();
    for (const opp of found) next.set(opp.key, { opp, firstSeen: this.opps.get(opp.key)?.firstSeen ?? g });
    if (cause === "swept") for (const [key, t] of this.opps) if (!next.has(key)) this.noteMiss(t, g, "swept");
    this.opps = next;
    // Planted puzzles whose pieces were used elsewhere are no longer "planted".
    for (const [id, p] of this.planted) {
      const wordsLeft = p.wordIds.every((wid) => this.board.words.some((w) => w.id === wid));
      if (!wordsLeft) this.planted.delete(id);
    }
  }

  private noteMiss(t: Tracked, g: number, reason: MissedSteal["reason"]) {
    const availableMs = g - t.firstSeen;
    if (availableMs < MISS_MIN_AVAILABLE_MS) return;
    const { opp } = t;
    const plantedEntry = [...this.planted.values()].find(
      (p) => p.wordIds.length === opp.wordIds.length && p.wordIds.every((id) => opp.wordIds.includes(id)) && p.puzzle.loose === opp.loose,
    );
    const target = plantedEntry?.puzzle.target ?? opp.answers[0];
    // Incidental steals only count if they're familiar and not sprawling three-word combos.
    const notable = plantedEntry || (opp.tier >= 4 && opp.sources.length <= 2 && (target.length >= 6 || opp.sources.length === 2));
    if (!notable) return;
    const answers = plantedEntry?.puzzle.answers ?? opp.answers;
    const type: PuzzleType = plantedEntry?.puzzle.type ?? puzzleTypeFor(opp.sources.length, opp.loose.length);
    const difficulty =
      plantedEntry?.puzzle.difficulty ?? computeDifficulty(featuresFor(opp.sources, opp.loose, answers, this.lexicon));
    this.missed.push({
      id: plantedEntry?.puzzle.id ?? puzzleId(opp.sources, opp.loose, target),
      type,
      sources: opp.sources,
      loose: opp.loose,
      target,
      answers,
      difficulty,
      availableMs,
      planted: Boolean(plantedEntry),
      reason,
    });
    // Only intended steals left alone for a good while count against the rating, and lightly.
    if (plantedEntry && availableMs >= 10_000) {
      this.ratingEvents.push({ skill: opp.sources.length === 1 ? "steals" : "fusion", difficulty, score: 0, weight: 0.3 });
      this.ratingEvents.push({ skill: "boardScan", difficulty, score: 0, weight: 0.2 });
      if (target.length >= 8) this.ratingEvents.push({ skill: "longWords", difficulty, score: 0, weight: 0.2 });
    }
  }

  // ── Plumbing ──────────────────────────────────────────────────────────────

  private emit(e: SprintEvent) {
    for (const l of this.eventListeners) l(e);
  }

  private changed() {
    this.cachedView = null;
    for (const l of this.listeners) l();
  }
}

function clampCursor(x: number): number {
  return Math.min(CURSOR_MAX, Math.max(CURSOR_MIN, x));
}

/** How long a planted steal survives before the rival takes it (harder = longer). */
export function rivalDelay(difficulty: number): number {
  return 18_000 + Math.min(1, Math.max(0, (difficulty - 1000) / 1000)) * 8_000;
}

/**
 * Order misses by how instructive they are. Duplicates go, and each board
 * word is used at most once so one busy word can't flood the list.
 */
export function rankMissed(missed: readonly MissedSteal[]): MissedSteal[] {
  const value = (m: MissedSteal) =>
    (m.planted ? 1000 : 0) + m.target.length * 30 + m.sources.length * 40 + Math.min(m.availableMs, 20_000) / 200;
  const seen = new Set<string>();
  const usedWords = new Set<string>();
  return [...missed]
    .sort((a, b) => value(b) - value(a))
    .filter((m) => {
      const key = getSignature(m.target);
      if (seen.has(key) || seen.has(m.id) || m.sources.some((s) => usedWords.has(s))) return false;
      seen.add(key);
      seen.add(m.id);
      for (const s of m.sources) usedWords.add(s);
      return true;
    });
}
