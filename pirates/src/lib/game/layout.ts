/**
 * Scatter layout for the board: words sit at organic, slightly rotated
 * positions like tiles on a table — never overlapping, and existing words
 * never jump when others come and go.
 *
 * Positions are stored normalized (centre as a fraction of the board) so a
 * resize just scales them; only words that stop fitting get re-placed.
 * Placement uses best-candidate sampling (Mitchell): try many random spots,
 * keep the one furthest from its neighbours.
 */
import { createRng, hashString } from "../engine/rng";

export interface Placement {
  /** Centre x as a fraction of board width. */
  cx: number;
  /** Centre y as a fraction of board height. */
  cy: number;
  /** Degrees. */
  rotate: number;
}

export interface LayoutItem {
  id: string;
  length: number;
}

export interface LayoutParams {
  width: number;
  height: number;
  /** Tile edge in px. */
  tile: number;
  /** Seed so the same board always lays out the same way. */
  seed: number;
  /** Max rotation either way, degrees. */
  maxRotate: number;
}

interface Rect {
  x0: number;
  y0: number;
  x1: number;
  y1: number;
}

/** Below this width the initial layout flows in loose rows instead of scattering. */
export const NARROW_BOARD = 620;

export function tileGap(tile: number): number {
  return Math.max(2, Math.round(tile * 0.07));
}

/** Pixel size of a word's tiles (unrotated). */
export function wordSize(length: number, tile: number): { w: number; h: number } {
  return { w: length * tile + (length - 1) * tileGap(tile), h: tile };
}

/** Space kept clear around each word (room for the lift, selection ring and badge). */
function margin(tile: number): number {
  return tile * 0.32;
}

/**
 * Tile size for a board of this size that must hold `capacity` tiles in total
 * (e.g. max words × average length) and a word of `longest` letters.
 */
export function boardTileSize(width: number, height: number, capacity: number, longest: number, maxTile = 54): number {
  const byArea = Math.sqrt((width * height * 0.3) / Math.max(1, capacity));
  const byWidth = (width - 24) / (longest + 1.2);
  return Math.floor(Math.max(18, Math.min(maxTile, byArea, byWidth)));
}

function rectFor(p: Placement, length: number, params: LayoutParams): Rect {
  const { w, h } = wordSize(length, params.tile);
  const rad = (Math.abs(p.rotate) * Math.PI) / 180;
  const rw = w * Math.cos(rad) + h * Math.sin(rad);
  const rh = w * Math.sin(rad) + h * Math.cos(rad);
  const m = margin(params.tile);
  const cx = p.cx * params.width;
  const cy = p.cy * params.height;
  return { x0: cx - rw / 2 - m, y0: cy - rh / 2 - m, x1: cx + rw / 2 + m, y1: cy + rh / 2 + m };
}

/** Separation between two rects (negative = overlap depth). */
function separation(a: Rect, b: Rect): number {
  const dx = Math.max(b.x0 - a.x1, a.x0 - b.x1);
  const dy = Math.max(b.y0 - a.y1, a.y0 - b.y1);
  return dx > 0 || dy > 0 ? Math.hypot(Math.max(dx, 0), Math.max(dy, 0)) : Math.max(dx, dy);
}

function inBounds(r: Rect, params: LayoutParams): boolean {
  const slack = margin(params.tile) * 0.6; // margins may hang slightly past the edge
  return r.x0 >= -slack && r.y0 >= -slack && r.x1 <= params.width + slack && r.y1 <= params.height + slack;
}

/**
 * Place every item, keeping previous placements that still fit.
 * Returns a new map (ids not in `items` are dropped).
 */
export function placeWords(items: readonly LayoutItem[], previous: ReadonlyMap<string, Placement>, params: LayoutParams): Map<string, Placement> {
  const out = new Map<string, Placement>();
  const placed: Rect[] = [];

  const keep: LayoutItem[] = [];
  const fresh: LayoutItem[] = [];
  for (const it of items) (previous.has(it.id) ? keep : fresh).push(it);

  for (const it of keep) {
    const p = previous.get(it.id)!;
    const r = rectFor(p, it.length, params);
    // Neighbours may share breathing room, but tiles must never touch.
    if (inBounds(r, params) && placed.every((o) => separation(r, o) > 1 - 2 * margin(params.tile))) {
      out.set(it.id, p);
      placed.push(r);
    } else {
      fresh.push(it);
    }
  }

  // Narrow boards start from a jittered row flow; scattering wastes too much space there.
  if (placed.length === 0 && params.width < NARROW_BOARD) {
    const flowed = flowPlace(fresh, params);
    if (!hasOverlaps(fresh, flowed, params)) return flowed;
  }

  fresh.sort((a, b) => b.length - a.length || a.id.localeCompare(b.id));
  for (const it of fresh) {
    const p = bestSpot(it, placed, params);
    out.set(it.id, p);
    placed.push(rectFor(p, it.length, params));
  }
  return out;
}

function bestSpot(item: LayoutItem, placed: readonly Rect[], params: LayoutParams): Placement {
  const rng = createRng(hashString(item.id) ^ params.seed);
  // Long words tilt less: a slanted 9-letter word eats a lot of vertical space.
  const rotate = (rng.next() * 2 - 1) * params.maxRotate * Math.min(1, 4 / item.length);
  const { w, h } = wordSize(item.length, params.tile);
  const m = margin(params.tile);
  const halfW = Math.min(params.width / 2, w / 2 + m);
  const halfH = Math.min(params.height / 2, h / 2 + m);
  const spanX = Math.max(0, params.width - 2 * halfW);
  const spanY = Math.max(0, params.height - 2 * halfH);
  const tilesClear = 1 - 2 * m;

  let best: Placement | null = null;
  let bestScore = -Infinity;
  let bestNearest = -Infinity;
  const consider = (cx: number, cy: number) => {
    const cand = { cx, cy, rotate };
    const r = rectFor(cand, item.length, params);
    let nearest = Infinity;
    for (const o of placed) nearest = Math.min(nearest, separation(r, o));
    // Spread out, but don't hug the edges: a gentle pull toward the middle.
    const pull = Math.hypot(cx - 0.5, (cy - 0.5) * 0.8) * params.tile * 0.9;
    const score = Math.min(nearest, params.tile * 2.2) - pull;
    if (score > bestScore) {
      bestScore = score;
      bestNearest = nearest;
      best = cand;
    }
    return nearest;
  };

  for (let i = 0; i < 160; i++) {
    const nearest = consider((halfW + rng.next() * spanX) / params.width, (halfH + rng.next() * spanY) / params.height);
    if (i >= 40 && nearest >= params.tile * 0.6) break;
  }
  // Crowded board: sweep a fine grid so any gap that exists gets found.
  if (bestNearest <= tilesClear) {
    const step = Math.max(4, params.tile / 4);
    for (let y = 0; y <= spanY; y += step) for (let x = 0; x <= spanX; x += step) consider((halfW + x) / params.width, (halfH + y) / params.height);
  }
  return best!;
}

/**
 * Pack words into rows like loosely placed tiles: random gaps, rows spread
 * over the full height with a little vertical wobble and tilt.
 */
function flowPlace(items: readonly LayoutItem[], params: LayoutParams): Map<string, Placement> {
  const rng = createRng(params.seed ^ 0x9e3779b9);
  const m = margin(params.tile);
  const order = rng.shuffle(items);
  const rows: { item: LayoutItem; w: number }[][] = [[]];
  let used = 0;
  for (const item of order) {
    const w = wordSize(item.length, params.tile).w + 2 * m;
    if (used + w > params.width && rows[rows.length - 1].length) {
      rows.push([]);
      used = 0;
    }
    rows[rows.length - 1].push({ item, w });
    used += w;
  }
  const out = new Map<string, Placement>();
  const rowH = params.height / rows.length;
  rows.forEach((row, r) => {
    const total = row.reduce((s, x) => s + x.w, 0);
    const free = Math.max(0, params.width - total);
    // Split the free space unevenly between the gaps (including both ends).
    const weights = Array.from({ length: row.length + 1 }, () => 0.4 + rng.next());
    const wsum = weights.reduce((a, b) => a + b, 0);
    let x = (free * weights[0]) / wsum;
    const wobble = Math.max(0, rowH - params.tile - 2 * m) * 0.5;
    row.forEach(({ item, w }, i) => {
      const cy = (r + 0.5) * rowH + (rng.next() * 2 - 1) * wobble;
      const rotate = (rng.next() * 2 - 1) * params.maxRotate * Math.min(1, 4 / item.length);
      out.set(item.id, { cx: (x + w / 2) / params.width, cy: cy / params.height, rotate });
      x += w + (free * weights[i + 1]) / wsum;
    });
  });
  return out;
}

/** True when the tiles of these placements collide (margins may overlap). */
export function placementFits(items: readonly LayoutItem[], placements: ReadonlyMap<string, Placement>, params: LayoutParams): boolean {
  return !hasOverlaps(items, placements, params);
}

/** Any overlapping words? (tests + resize checks) */
export function hasOverlaps(items: readonly LayoutItem[], placements: ReadonlyMap<string, Placement>, params: LayoutParams): boolean {
  const rects = items.map((it) => rectFor(placements.get(it.id)!, it.length, params));
  const shrink = margin(params.tile) * 2 - 1; // words may share their margins, not their tiles
  for (let i = 0; i < rects.length; i++)
    for (let j = i + 1; j < rects.length; j++) if (separation(rects[i], rects[j]) < -shrink) return true;
  return false;
}

/**
 * Place words at the given tile size; if the board is too crowded for that,
 * shrink tiles a step at a time and lay everything out again.
 */
export function fitLayout(
  items: readonly LayoutItem[],
  previous: ReadonlyMap<string, Placement>,
  params: LayoutParams,
  minTile = 16,
): { placements: Map<string, Placement>; tile: number } {
  let tile = params.tile;
  let placements = placeWords(items, previous, params);
  while (hasOverlaps(items, placements, { ...params, tile }) && tile > minTile) {
    tile = Math.max(minTile, Math.floor(tile * 0.92));
    placements = placeWords(items, new Map(), { ...params, tile });
  }
  return { placements, tile };
}
