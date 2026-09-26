"use client";
import clsx from "clsx";
import { motion } from "motion/react";
import Link from "next/link";
import { useRouter } from "next/navigation";
import { useEffect, useEffectEvent } from "react";
import { useMediaQuery } from "@/hooks/useMediaQuery";
import { preloadGameData } from "@/lib/data";
import { soft } from "@/lib/motion";
import { lastRatingDelta } from "@/lib/progress/player";
import { overallRating } from "@/lib/progress/ratings";
import { activeCount } from "@/lib/progress/review";
import { currentStreak, localDateKey, playedToday } from "@/lib/progress/streak";
import { usePlayer } from "@/lib/storage/player-store";
import { Delta } from "../results/ResultPieces";
import { TopBar } from "../TopBar";
import { Tile } from "../tiles/Tile";
import { AnimatedNumber } from "../ui/AnimatedNumber";
import { Icon, type IconName } from "../ui/Icon";
import { Kbd } from "../ui/Kbd";
import { AnagramHero } from "./AnagramHero";
import { FluidSparkline, SkillBars } from "./Charts";

const item = (delay: number) => ({
  initial: { opacity: 0, y: 16 },
  animate: { opacity: 1, y: 0 },
  transition: { ...soft, delay },
});

export function HomeScreen() {
  const router = useRouter();
  const player = usePlayer();
  const small = useMediaQuery("(max-width: 639px)");
  const today = localDateKey();

  useEffect(() => {
    const idle = window.requestIdleCallback ?? ((cb: () => void) => window.setTimeout(cb, 400));
    idle(() => preloadGameData());
  }, []);

  const onKey = useEffectEvent((e: KeyboardEvent) => {
    if (e.metaKey || e.ctrlKey || e.altKey) return;
    if (e.key === "Enter") router.push("/play/sprint");
  });
  useEffect(() => {
    const handler = (e: KeyboardEvent) => onKey(e);
    window.addEventListener("keydown", handler);
    return () => window.removeEventListener("keydown", handler);
  }, []);

  const rating = player ? overallRating(player.ratings) : null;
  const delta = player ? lastRatingDelta(player) : null;
  const streak = player ? currentStreak(player.streak, today) : 0;
  const doneToday = player ? playedToday(player.streak, today) : false;
  const reviewCount = player ? activeCount(player.missed) : 0;
  const history = player?.ratingHistory.slice(-24).map((h) => h.overall) ?? [];
  const firstTime = player ? player.stats.gamesPlayed === 0 : false;

  return (
    <main className="mx-auto flex w-full max-w-5xl flex-col px-4 pb-16 sm:px-6">
      <TopBar />

      <motion.section className="flex flex-col items-center pb-10 pt-8 text-center sm:pb-14 sm:pt-12" {...item(0)}>
        <AnagramHero size={small ? 42 : 72} />
        <p className="mt-6 max-w-md text-[15px] leading-relaxed text-muted">
          Same tiles, new word. Train the one skill that wins at Pirates: <span className="text-fg">seeing the steal</span> before anyone else.
        </p>
      </motion.section>

      <div className="grid gap-4 lg:grid-cols-[1.35fr_1fr]">
        <div className="flex flex-col gap-4">
          {/* Primary call to action */}
          <motion.div {...item(0.08)}>
            <Link
              href="/play/sprint"
              className="group relative block overflow-hidden rounded-[22px] border border-accent/35 bg-gradient-to-b from-accent/[0.09] to-accent/[0.02] p-5 outline-none transition-colors hover:border-accent/60 focus-visible:ring-2 focus-visible:ring-accent sm:p-6"
            >
              <SprintCardDecor />
              <div className="relative flex flex-col gap-5">
                <div className="flex items-center justify-between">
                  <span className="label !text-accent/80">Today&apos;s training</span>
                  {doneToday && (
                    <span className="flex items-center gap-1 rounded-full bg-good/10 px-2 py-0.5 text-[11px] font-medium text-good">
                      <Icon name="flame" size={12} /> streak kept
                    </span>
                  )}
                </div>
                <div>
                  <h2 className="text-[28px] font-semibold leading-none tracking-tight sm:text-[34px]">Steal Sprint</h2>
                  <p className="mt-2 text-sm text-muted">60 seconds · Adaptive difficulty · {firstTime ? "Start here" : "Beat your best"}</p>
                </div>
                <div className="flex items-center gap-3">
                  <span className="inline-flex h-12 items-center gap-2 rounded-xl bg-accent px-5 text-[15px] font-semibold text-ink shadow-[0_1px_0_rgba(255,255,255,.35)_inset,0_12px_32px_-12px_rgba(245,181,68,.7)] transition-transform group-hover:scale-[1.03] group-active:scale-[0.98]">
                    <Icon name="play" size={16} strokeWidth={0} fill="currentColor" /> Play
                  </span>
                  <span className="hidden items-center gap-1.5 text-xs text-faint sm:flex">
                    or press
                    <Kbd>
                      <Icon name="enter" size={11} strokeWidth={2.2} />
                    </Kbd>
                  </span>
                  {player && player.stats.bestSprintScore > 0 && (
                    <span className="ml-auto text-right">
                      <span className="label block">Best</span>
                      <span className="tabular font-mono text-sm">{player.stats.bestSprintScore.toLocaleString("en-US")}</span>
                    </span>
                  )}
                </div>
              </div>
            </Link>
          </motion.div>

          {/* Rating */}
          <motion.div className="panel flex items-end justify-between gap-4 px-5 py-4" {...item(0.14)}>
            <div className="flex flex-col gap-1">
              <span className="label">Pirate Rating</span>
              <div className="flex items-baseline gap-3">
                {rating === null ? (
                  <span className="h-9 w-24 animate-pulse rounded-md bg-ink-4" />
                ) : (
                  <AnimatedNumber value={rating} from={rating - (delta ?? 0)} className="tabular font-mono text-[36px] font-semibold leading-none tracking-tight" stiffness={50} damping={18} />
                )}
                {delta !== null && <Delta value={delta} className="text-sm" />}
              </div>
              <span className="text-xs text-faint">
                {player && player.stats.gamesPlayed > 0 ? `${player.stats.gamesPlayed} session${player.stats.gamesPlayed === 1 ? "" : "s"} played` : "Play a round to calibrate"}
              </span>
            </div>
            <FluidSparkline values={history} height={44} className="w-[110px] shrink-0 text-accent sm:w-[170px]" />
          </motion.div>
        </div>

        <div className="flex flex-col gap-4">
          <motion.div className="panel px-5 py-4" {...item(0.2)}>
            <div className="mb-4 flex items-center justify-between">
              <span className="label">Skills</span>
              <Link href="/stats" className="text-xs text-faint transition-colors hover:text-fg">
                Details →
              </Link>
            </div>
            <SkillBars ratings={player?.ratings ?? null} delay={0.3} />
          </motion.div>

          <motion.div className="panel flex items-center gap-4 px-5 py-4" {...item(0.26)}>
            <span
              className={clsx(
                "grid h-11 w-11 shrink-0 place-items-center rounded-xl",
                doneToday ? "bg-accent/15 text-accent" : "bg-ink-4 text-faint",
              )}
            >
              <Icon name="flame" size={22} />
            </span>
            <div className="flex flex-col">
              <span className="text-[15px] font-medium">
                <span className="tabular font-mono">{streak}</span> day streak
              </span>
              <span className="text-xs text-faint">
                {doneToday ? "Trained today — see you tomorrow" : streak > 0 ? "Play today to keep it alive" : "Play any mode to start one"}
                {player && player.streak.best > 1 ? ` · best ${player.streak.best}` : ""}
              </span>
            </div>
          </motion.div>
        </div>
      </div>

      <motion.nav className="mt-4 grid grid-cols-2 gap-3 sm:grid-cols-4" {...item(0.32)} aria-label="Other modes">
        <ModeCard href="/play/fusion" icon="fuse" title="Fusion Vision" blurb="Spot the two words that fuse" />
        <ModeCard href="/play/anagram" icon="letters" title="Raw Anagrams" blurb="30s of pure unscrambling" />
        <ModeCard href="/review" icon="undo" title="Review Mistakes" blurb="Steals you missed" badge={reviewCount || undefined} />
        <ModeCard href="/stats" icon="chart" title="Stats" blurb="Ratings, bests, badges" />
      </motion.nav>

      <motion.footer className="mt-12 flex flex-wrap items-center justify-between gap-3 text-xs text-faint" {...item(0.4)}>
        <span>
          Pirates is a real-time anagram game: flip letters, make words, steal your opponents&apos; words by rearranging them.
        </span>
        <Link href="/play/sprint?intro=1" className="transition-colors hover:text-fg">
          How to play →
        </Link>
      </motion.footer>
    </main>
  );
}

function ModeCard({ href, icon, title, blurb, badge }: { href: string; icon: IconName; title: string; blurb: string; badge?: number }) {
  return (
    <Link
      href={href}
      className="group relative flex flex-col gap-3 rounded-2xl border border-line bg-ink-2/60 p-4 outline-none transition-[border-color,background-color,transform] duration-200 hover:-translate-y-0.5 hover:border-line-2 hover:bg-ink-3 focus-visible:ring-2 focus-visible:ring-accent"
    >
      <span className="flex items-center justify-between">
        <span className="grid h-9 w-9 place-items-center rounded-xl bg-ink-4 text-muted transition-colors group-hover:text-accent">
          <Icon name={icon} size={18} />
        </span>
        {badge !== undefined && (
          <motion.span
            className="tabular rounded-full bg-accent px-2 py-0.5 font-mono text-[11px] font-semibold text-ink"
            initial={{ scale: 0 }}
            animate={{ scale: 1 }}
            transition={{ type: "spring", stiffness: 600, damping: 15, delay: 0.6 }}
          >
            {badge}
          </motion.span>
        )}
      </span>
      <span>
        <span className="block text-[15px] font-medium">{title}</span>
        <span className="mt-0.5 block text-xs text-faint">{blurb}</span>
      </span>
    </Link>
  );
}

/** A few tiles drifting in the corner of the Sprint card. */
function SprintCardDecor() {
  const tiles = [
    { l: "s", x: "70%", y: 80, r: -8, d: 0 },
    { l: "t", x: "77%", y: 60, r: 6, d: 0.4 },
    { l: "e", x: "84%", y: 84, r: 12, d: 0.8 },
    { l: "a", x: "88%", y: 54, r: -5, d: 1.2 },
    { l: "l", x: "92%", y: 100, r: 9, d: 1.6 },
  ];
  return (
    <div className="pointer-events-none absolute inset-0 hidden sm:block" aria-hidden>
      {tiles.map((t) => (
        <motion.div
          key={t.l}
          className="absolute"
          style={{ left: t.x, top: t.y }}
          initial={{ opacity: 0, rotate: t.r }}
          animate={{ opacity: 0.9, y: [0, -6, 0], rotate: [t.r, t.r + 4, t.r] }}
          transition={{ opacity: { delay: 0.5 + t.d * 0.2 }, y: { duration: 4, repeat: Infinity, ease: "easeInOut", delay: t.d }, rotate: { duration: 5, repeat: Infinity, ease: "easeInOut", delay: t.d } }}
        >
          <Tile letter={t.l} size={30} />
        </motion.div>
      ))}
    </div>
  );
}
