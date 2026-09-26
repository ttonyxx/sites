/** Loaded puzzle set + board vocabulary, with difficulty-targeted selection. */
import { getSignature, subtractLetters } from "../engine/letters";
import type { Lexicon } from "../engine/lexicon";
import { puzzleProblem, type Puzzle, type PuzzleType } from "../engine/puzzles";
import type { Rng } from "../engine/rng";
import type { WordEntry } from "../engine/words";

export type TypeWeights = Partial<Record<PuzzleType, number>>;

export interface PickOptions {
  rng: Rng;
  types: TypeWeights;
  /** Desired difficulty (rating scale). */
  target: number;
  /** Initial ± window around target; widened if nothing fits. */
  spread?: number;
  /** Return true to skip a puzzle (already used, clashes with the board…). */
  exclude?: (p: Puzzle) => boolean;
}

export interface DistractorOptions {
  rng: Rng;
  /** Words that must not be picked (already on the board, in the pile…). */
  exclude: ReadonlySet<string>;
  minLength?: number;
  maxLength?: number;
  minFamiliarity?: number;
  /** Prefer words whose letters overlap this signature (sneakier boards). */
  similarTo?: string;
}

export class PuzzleBank {
  readonly puzzles: readonly Puzzle[];
  readonly words: readonly WordEntry[];
  private readonly byType: Record<PuzzleType, Puzzle[]>;
  private readonly byId: Map<string, Puzzle>;

  constructor(puzzles: readonly Puzzle[], words: readonly WordEntry[]) {
    this.puzzles = puzzles;
    this.words = words;
    this.byType = { steal: [], fusion: [], "fusion-plus": [], triple: [] };
    for (const p of puzzles) this.byType[p.type].push(p);
    this.byId = new Map(puzzles.map((p) => [p.id, p]));
  }

  /**
   * Build a bank, re-verifying every puzzle with exact letter counts and
   * dropping any that fail (the build gate should make this a no-op).
   */
  static verified(puzzles: readonly Puzzle[], words: readonly WordEntry[], lexicon?: Lexicon): { bank: PuzzleBank; rejected: string[] } {
    const rejected: string[] = [];
    const ok = puzzles.filter((p) => {
      const problem = puzzleProblem(p, lexicon);
      if (problem) rejected.push(`${p.id}: ${problem}`);
      return !problem;
    });
    return { bank: new PuzzleBank(ok, words.filter((w) => w.signature === getSignature(w.word))), rejected };
  }

  get(id: string): Puzzle | undefined {
    return this.byId.get(id);
  }

  ofType(type: PuzzleType): readonly Puzzle[] {
    return this.byType[type];
  }

  pick(opts: PickOptions): Puzzle | undefined {
    const { rng, target } = opts;
    const exclude = opts.exclude ?? (() => false);
    const typeOrder = orderTypes(opts.types, rng);
    for (const spread of [opts.spread ?? 150, 300, 600, 5000]) {
      for (const type of typeOrder) {
        const pool = this.byType[type].filter((p) => Math.abs(p.difficulty - target) <= spread && !exclude(p));
        const choice = rng.weighted(pool, (p) => 1 / (1 + Math.abs(p.difficulty - target) / 100));
        if (choice) return choice;
      }
    }
    return undefined;
  }

  distractors(count: number, opts: DistractorOptions): string[] {
    const { rng } = opts;
    const minLen = opts.minLength ?? 3;
    const maxLen = opts.maxLength ?? 7;
    const minFam = opts.minFamiliarity ?? 0.85;
    const taken = new Set(opts.exclude);
    const out: string[] = [];
    for (let attempt = 0; out.length < count && attempt < count * 60; attempt++) {
      const w = rng.pick(this.words);
      if (w.length < minLen || w.length > maxLen || w.familiarity < minFam || taken.has(w.word)) continue;
      if (opts.similarTo && rng.next() < 0.6 && overlap(w.signature, opts.similarTo) < 0.5) continue;
      taken.add(w.word);
      out.push(w.word);
    }
    return out;
  }
}

/** Fraction of `sig`'s letters that also appear in `other`. */
function overlap(sig: string, other: string): number {
  let rest = other;
  let hits = 0;
  for (const ch of sig) {
    const next = subtractLetters(rest, ch);
    if (next !== null) {
      rest = next;
      hits++;
    }
  }
  return sig.length ? hits / sig.length : 0;
}

/** Types in a weighted-random order (heavier types tend to come first). */
function orderTypes(weights: TypeWeights, rng: Rng): PuzzleType[] {
  const remaining = (Object.keys(weights) as PuzzleType[]).filter((t) => (weights[t] ?? 0) > 0);
  const order: PuzzleType[] = [];
  while (remaining.length) {
    const t = rng.weighted(remaining, (x) => weights[x] ?? 0)!;
    order.push(t);
    remaining.splice(remaining.indexOf(t), 1);
  }
  return order;
}

/** How the mix of puzzle types shifts as the player gets stronger. */
export function sprintTypeWeights(rating: number): TypeWeights {
  if (rating < 1050) return { steal: 0.7, fusion: 0.3 };
  if (rating < 1300) return { steal: 0.5, fusion: 0.35, "fusion-plus": 0.15 };
  if (rating < 1550) return { steal: 0.4, fusion: 0.35, "fusion-plus": 0.18, triple: 0.07 };
  return { steal: 0.32, fusion: 0.36, "fusion-plus": 0.2, triple: 0.12 };
}
