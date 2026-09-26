/** Daily streak: consecutive local calendar days with at least one finished session. */
import type { StreakState } from "./types";

/** "YYYY-MM-DD" in the player's local time zone. */
export function localDateKey(date: Date = new Date()): string {
  const y = date.getFullYear();
  const m = String(date.getMonth() + 1).padStart(2, "0");
  const d = String(date.getDate()).padStart(2, "0");
  return `${y}-${m}-${d}`;
}

/** Whole days between two date keys (b − a), immune to DST and time zones. */
export function daysBetween(a: string, b: string): number {
  return Math.round((dayNumber(b) - dayNumber(a)));
}

function dayNumber(key: string): number {
  const [y, m, d] = key.split("-").map(Number);
  return Date.UTC(y, m - 1, d) / 86_400_000;
}

export function initialStreak(): StreakState {
  return { current: 0, best: 0, lastPlayedDate: null };
}

/** Record a finished session on `today`. */
export function recordPlay(streak: StreakState, today: string): StreakState {
  const last = streak.lastPlayedDate;
  if (last === today) return streak;
  const gap = last ? daysBetween(last, today) : Infinity;
  // Clock went backwards (travel, manual change): don't punish, just move the marker.
  if (gap < 0) return { ...streak, lastPlayedDate: today };
  const current = gap === 1 ? streak.current + 1 : 1;
  return { current, best: Math.max(streak.best, current), lastPlayedDate: today };
}

/** Streak as it stands today: still alive if you played today or yesterday. */
export function currentStreak(streak: StreakState, today: string): number {
  if (!streak.lastPlayedDate) return 0;
  const gap = daysBetween(streak.lastPlayedDate, today);
  return gap <= 1 ? streak.current : 0;
}

/** Played today already? (The streak flame is lit.) */
export function playedToday(streak: StreakState, today: string): boolean {
  return streak.lastPlayedDate === today;
}
