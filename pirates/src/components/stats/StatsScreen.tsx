"use client";
import clsx from "clsx";
import { motion } from "motion/react";
import { useState } from "react";
import { soft } from "@/lib/motion";
import { ACHIEVEMENTS } from "@/lib/progress/achievements";
import { averageSolveMs, lastRatingDelta } from "@/lib/progress/player";
import { overallRating } from "@/lib/progress/ratings";
import { activeCount } from "@/lib/progress/review";
import { currentStreak, localDateKey } from "@/lib/progress/streak";
import { SKILLS, type GameMode } from "@/lib/progress/types";
import { levelProgress, nextRank, RANKS, rankFor } from "@/lib/progress/xp";
import { playerStore, usePlayer } from "@/lib/storage/player-store";
import { Sparkline } from "../home/Charts";
import { AchievementCard, Delta } from "../results/ResultPieces";
import { TopBar } from "../TopBar";
import { TileWord } from "../tiles/TileWord";
import { AnimatedNumber } from "../ui/AnimatedNumber";
import { Button } from "../ui/Button";

const MODE_LABEL: Record<GameMode, string> = { sprint: "Steal Sprint", fusion: "Fusion Vision", anagram: "Raw Anagrams", review: "Review" };

function ago(at: number): string {
  const m = Math.round((Date.now() - at) / 60_000);
  if (m < 1) return "just now";
  if (m < 60) return `${m}m ago`;
  const h = Math.round(m / 60);
  if (h < 24) return `${h}h ago`;
  const d = Math.round(h / 24);
  return d === 1 ? "yesterday" : `${d}d ago`;
}

const fade = (delay: number) => ({ initial: { opacity: 0, y: 14 }, animate: { opacity: 1, y: 0 }, transition: { ...soft, delay } });

export function StatsScreen() {
  const player = usePlayer();
  const [confirmReset, setConfirmReset] = useState(false);
  if (!player) return <main className="min-h-dvh" />;

  const s = player.stats;
  const rating = overallRating(player.ratings);
  const delta = lastRatingDelta(player);
  const lvl = levelProgress(player.xp);
  const rank = rankFor(lvl.level);
  const upcoming = nextRank(lvl.level);
  const avg = averageSolveMs(s);
  const accuracy = s.correctAnswers + s.wrongAnswers ? s.correctAnswers / (s.correctAnswers + s.wrongAnswers) : null;
  const unlocked = ACHIEVEMENTS.filter((a) => player.achievements[a.id]).length;
  const history = player.ratingHistory.map((h) => h.overall);

  const records: { label: string; value: React.ReactNode }[] = [
    { label: "Best Sprint", value: s.bestSprintScore ? s.bestSprintScore.toLocaleString("en-US") : "—" },
    { label: "Longest combo", value: s.longestCombo ? `${s.longestCombo}×` : "—" },
    { label: "Words stolen", value: s.wordsStolen.toLocaleString("en-US") },
    { label: "Accuracy", value: accuracy === null ? "—" : `${Math.round(accuracy * 100)}%` },
    { label: "Avg solve", value: avg ? `${(avg / 1000).toFixed(1)}s` : "—" },
    { label: "Fastest solve", value: s.fastestSolveMs ? `${(s.fastestSolveMs / 1000).toFixed(2)}s` : "—" },
    { label: "Fusions", value: s.fusionsMade },
    { label: "Triples", value: s.triplesMade },
    { label: "Best Fusion Vision", value: s.bestFusionScore ? s.bestFusionScore.toLocaleString("en-US") : "—" },
    { label: "Best Raw Anagrams", value: s.bestAnagramScore ? s.bestAnagramScore.toLocaleString("en-US") : "—" },
    { label: "Sessions", value: s.gamesPlayed },
    { label: "Best streak", value: `${player.streak.best} day${player.streak.best === 1 ? "" : "s"}` },
  ];

  return (
    <main className="mx-auto flex w-full max-w-5xl flex-col px-4 pb-16 sm:px-6">
      <TopBar back={{ href: "/", label: "Home" }} />

      <motion.section className="mt-6 grid gap-4 lg:grid-cols-[1.2fr_1fr]" {...fade(0)}>
        <div className="panel flex flex-col justify-between gap-6 px-6 py-5">
          <div className="flex items-start justify-between gap-4">
            <div className="flex flex-col gap-1.5">
              <span className="label">Pirate Rating</span>
              <div className="flex items-baseline gap-3">
                <AnimatedNumber value={rating} from={history.at(-2) ?? rating} className="tabular font-mono text-5xl font-semibold tracking-tight" stiffness={50} damping={18} />
                {delta !== null && <Delta value={delta} className="text-base" />}
              </div>
              <span className="text-xs text-faint">Local skill rating vs puzzle difficulty — not a ranking against other players (yet).</span>
            </div>
          </div>
          <div className="text-accent">
            <Sparkline values={history.slice(-40)} width={520} height={80} />
          </div>
        </div>

        <div className="panel flex flex-col gap-4 px-6 py-5">
          <div className="flex items-baseline justify-between">
            <span className="label">Level</span>
            <span className="tabular font-mono text-xs text-faint">{player.xp.toLocaleString("en-US")} XP</span>
          </div>
          <div className="flex items-baseline gap-3">
            <span className="text-4xl font-semibold">{lvl.level}</span>
            <span className="text-lg text-muted">{rank.name}</span>
          </div>
          <div className="h-2 overflow-hidden rounded-full bg-line">
            <motion.div
              className="h-full rounded-full bg-gradient-to-r from-accent to-accent-2"
              initial={{ width: 0 }}
              animate={{ width: `${Math.max(0.02, lvl.fraction) * 100}%` }}
              transition={{ duration: 1, ease: [0.22, 1, 0.36, 1], delay: 0.2 }}
            />
          </div>
          <span className="tabular font-mono text-xs text-faint">
            {lvl.into.toLocaleString("en-US")} / {lvl.needed.toLocaleString("en-US")} to level {lvl.level + 1}
            {upcoming ? ` · ${upcoming.name} at level ${upcoming.minLevel}` : ""}
          </span>
          <ol className="mt-1 flex flex-wrap gap-1.5">
            {RANKS.map((r) => (
              <li
                key={r.name}
                className={clsx(
                  "rounded-md border px-2 py-1 text-[11px]",
                  r.name === rank.name ? "border-accent/50 bg-accent/10 text-accent-2" : lvl.level >= r.minLevel ? "border-line text-muted" : "border-line text-faint opacity-60",
                )}
              >
                {r.name}
              </li>
            ))}
          </ol>
        </div>
      </motion.section>

      <motion.section className="mt-8" {...fade(0.08)}>
        <h2 className="label mb-3">Skills</h2>
        <div className="grid gap-3 sm:grid-cols-2 lg:grid-cols-5">
          {SKILLS.map((sk, i) => {
            const r = player.ratings[sk.key];
            const pct = Math.max(3, Math.min(100, ((r.rating - 600) / 1400) * 100));
            return (
              <motion.div key={sk.key} className="panel flex flex-col gap-3 px-4 py-4" initial={{ opacity: 0, y: 10 }} animate={{ opacity: 1, y: 0 }} transition={{ ...soft, delay: 0.12 + i * 0.05 }}>
                <span className="text-[13px] text-muted">{sk.label}</span>
                <span className="tabular font-mono text-3xl font-semibold">{r.rating}</span>
                <span className="relative h-1.5 overflow-hidden rounded-full bg-line">
                  <motion.span
                    className="absolute inset-y-0 left-0 rounded-full bg-accent"
                    initial={{ width: 0 }}
                    animate={{ width: `${pct}%` }}
                    transition={{ duration: 0.9, ease: [0.22, 1, 0.36, 1], delay: 0.2 + i * 0.06 }}
                  />
                </span>
                <span className="text-[11px] leading-snug text-faint">
                  {sk.blurb}
                  <br />
                  peak {r.peak} · {r.games} session{r.games === 1 ? "" : "s"}
                </span>
              </motion.div>
            );
          })}
        </div>
      </motion.section>

      <motion.section className="mt-8" {...fade(0.14)}>
        <h2 className="label mb-3">Records</h2>
        <div className="grid grid-cols-2 gap-px overflow-hidden rounded-2xl border border-line bg-line sm:grid-cols-3 lg:grid-cols-4">
          {records.map((r) => (
            <div key={r.label} className="flex flex-col gap-1 bg-ink-2 px-4 py-3.5">
              <span className="label">{r.label}</span>
              <span className="tabular font-mono text-lg">{r.value}</span>
            </div>
          ))}
        </div>
        {s.longestWord && (
          <div className="mt-4 flex flex-wrap items-center gap-3">
            <span className="label">Longest word</span>
            <TileWord word={s.longestWord} size={22} tone="won" />
          </div>
        )}
      </motion.section>

      <motion.section className="mt-8" {...fade(0.2)}>
        <div className="mb-3 flex items-baseline justify-between">
          <h2 className="label">Achievements</h2>
          <span className="tabular font-mono text-xs text-faint">
            {unlocked}/{ACHIEVEMENTS.length}
          </span>
        </div>
        <div className="grid gap-3 sm:grid-cols-2 lg:grid-cols-3">
          {ACHIEVEMENTS.map((a, i) => (
            <AchievementCard key={a.id} id={a.id} locked={!player.achievements[a.id]} delay={0.25 + i * 0.03} />
          ))}
        </div>
      </motion.section>

      <motion.section className="mt-8" {...fade(0.26)}>
        <div className="mb-3 flex items-baseline justify-between">
          <h2 className="label">Recent sessions</h2>
          <span className="text-xs text-faint">
            {currentStreak(player.streak, localDateKey())}-day streak · {activeCount(player.missed)} steals to review
          </span>
        </div>
        {player.history.length === 0 ? (
          <div className="panel px-5 py-4 text-sm text-muted">No sessions yet.</div>
        ) : (
          <div className="overflow-hidden rounded-2xl border border-line">
            <table className="w-full text-left text-sm">
              <thead className="bg-ink-3 text-faint">
                <tr>
                  <th className="px-4 py-2.5 font-normal">Mode</th>
                  <th className="px-4 py-2.5 text-right font-normal">Score</th>
                  <th className="hidden px-4 py-2.5 text-right font-normal sm:table-cell">Correct</th>
                  <th className="px-4 py-2.5 text-right font-normal">Rating</th>
                  <th className="hidden px-4 py-2.5 text-right font-normal sm:table-cell">When</th>
                </tr>
              </thead>
              <tbody>
                {player.history.slice(0, 15).map((h) => (
                  <tr key={h.id} className="border-t border-line bg-ink-2/50">
                    <td className="px-4 py-2.5">{MODE_LABEL[h.mode]}</td>
                    <td className="tabular px-4 py-2.5 text-right font-mono">{h.score.toLocaleString("en-US")}</td>
                    <td className="tabular hidden px-4 py-2.5 text-right font-mono sm:table-cell">{h.correct}</td>
                    <td className="px-4 py-2.5 text-right">
                      <span className="tabular font-mono">{h.overallAfter}</span> <Delta value={h.overallAfter - h.overallBefore} className="text-xs" />
                    </td>
                    <td className="hidden px-4 py-2.5 text-right text-faint sm:table-cell">{ago(h.at)}</td>
                  </tr>
                ))}
              </tbody>
            </table>
          </div>
        )}
      </motion.section>

      <motion.section className="mt-12 flex flex-col items-start gap-3 border-t border-line pt-6" {...fade(0.3)}>
        <span className="label">Data</span>
        <p className="max-w-lg text-sm text-faint">Progress is saved in this browser only. Clearing site data or switching devices starts fresh.</p>
        {confirmReset ? (
          <div className="flex items-center gap-2">
            <Button
              className="border-bad/40 text-bad hover:border-bad"
              onClick={() => {
                playerStore.reset();
                setConfirmReset(false);
              }}
            >
              Yes, erase everything
            </Button>
            <Button variant="ghost" onClick={() => setConfirmReset(false)}>
              Cancel
            </Button>
          </div>
        ) : (
          <Button variant="ghost" className="-ml-4 text-faint" onClick={() => setConfirmReset(true)}>
            Reset progress…
          </Button>
        )}
      </motion.section>
    </main>
  );
}
