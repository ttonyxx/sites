"use client";
import { motion } from "motion/react";
import { useRouter } from "next/navigation";
import { useEffect, useEffectEvent } from "react";
import { SPRINT_MISSES_SAVED, type SprintResult } from "@/lib/game/sprint";
import type { SessionReport } from "@/lib/progress/player";
import { activeCount } from "@/lib/progress/review";
import { soft } from "@/lib/motion";
import { usePlayer } from "@/lib/storage/player-store";
import { MissedList, NewAchievements, PersonalBests, RatingCard, Reveal, StatGrid, XpCard } from "../results/ResultPieces";
import { ShareButton } from "../results/ShareButton";
import { TileWord } from "../tiles/TileWord";
import { AnimatedNumber } from "../ui/AnimatedNumber";
import { Button, ButtonLink } from "../ui/Button";
import { Icon } from "../ui/Icon";
import { Kbd } from "../ui/Kbd";

export function SprintResults({ result, report, onPlayAgain }: { result: SprintResult; report: SessionReport; onPlayAgain: () => void }) {
  const router = useRouter();
  const player = usePlayer();
  const reviewCount = player ? activeCount(player.missed) : 0;

  const onKey = useEffectEvent((e: KeyboardEvent) => {
    if (e.key === "Enter") {
      e.preventDefault();
      onPlayAgain();
    } else if (e.key.toLowerCase() === "r" && reviewCount > 0) {
      router.push("/review");
    } else if (e.key === "Escape") {
      router.push("/");
    }
  });
  useEffect(() => {
    // Small delay so the Enter that ended the round doesn't instantly restart.
    const handler = (e: KeyboardEvent) => onKey(e);
    const t = window.setTimeout(() => window.addEventListener("keydown", handler), 700);
    return () => {
      clearTimeout(t);
      window.removeEventListener("keydown", handler);
    };
  }, []);

  const avg = result.avgSolveMs;
  const shown = result.missed.slice(0, SPRINT_MISSES_SAVED);
  const longest = [...result.pile].sort((a, b) => b.word.length - a.word.length)[0];
  const shareText = [
    `Pirates Blitz · Steal Sprint`,
    `${result.score.toLocaleString("en-US")} pts · ${result.steals} steal${result.steals === 1 ? "" : "s"} · best combo ${result.bestCombo}×`,
    longest ? `Longest steal: ${longest.sources.join(" + ").toUpperCase()}${longest.loose ? ` + ${longest.loose.toUpperCase()}` : ""} → ${longest.word.toUpperCase()}` : null,
    `Pirate Rating ${report.overallAfter.toLocaleString("en-US")}`,
    `https://tonyxin.com/sites/pirates/`,
  ]
    .filter(Boolean)
    .join("\n");

  return (
    <main className="mx-auto flex w-full max-w-3xl flex-col gap-6 px-4 py-8 sm:py-12">
      <motion.header className="flex flex-col items-center text-center" initial={{ opacity: 0 }} animate={{ opacity: 1 }}>
        <span className="label">Steal Sprint · Score</span>
        <motion.div initial={{ scale: 0.7, opacity: 0 }} animate={{ scale: 1, opacity: 1 }} transition={{ ...soft, delay: 0.05 }}>
          <AnimatedNumber
            value={result.score}
            from={0}
            stiffness={40}
            damping={18}
            className="tabular mt-2 block font-mono text-6xl font-semibold tracking-tight sm:text-7xl"
          />
        </motion.div>
        <div className="mt-4 flex flex-col items-center gap-3">
          <PersonalBests items={report.personalBests} />
          <ShareButton text={shareText} />
        </div>
      </motion.header>

      <StatGrid
        delay={0.15}
        items={[
          { label: "Steals", value: result.steals },
          { label: "Accuracy", value: result.steals + result.wrong ? `${Math.round(result.accuracy * 100)}%` : "—" },
          { label: "Avg solve", value: avg ? `${(avg / 1000).toFixed(1)}s` : "—" },
          { label: "Best combo", value: `${result.bestCombo}×` },
        ]}
      />

      <div className="grid gap-4 sm:grid-cols-2">
        <RatingCard report={report} delay={0.3} />
        <XpCard report={report} delay={0.38} />
      </div>

      <NewAchievements ids={report.newAchievements} delay={0.5} />

      {result.pile.length > 0 && (
        <Reveal delay={0.45} className="flex flex-col gap-3">
          <span className="label">Your haul</span>
          <div className="flex flex-wrap gap-x-4 gap-y-3">
            {result.pile
              .slice()
              .reverse()
              .map((w, i) => (
                <TileWord key={w.id} word={w.word} size={20} tone="won" entrance delay={0.5 + i * 0.05} />
              ))}
          </div>
        </Reveal>
      )}

      <section className="flex flex-col gap-3">
        <Reveal delay={0.55} className="flex items-baseline justify-between">
          <span className="label">Missed steals</span>
          {shown.length > 0 && <span className="text-xs text-faint">Saved to Review Mistakes</span>}
        </Reveal>
        <MissedList missed={shown} delay={0.6} />
      </section>

      <Reveal delay={0.7} className="sticky bottom-0 -mx-4 mt-2 flex flex-col items-center gap-2 bg-gradient-to-t from-ink via-ink/95 to-transparent px-4 pb-4 pt-6 sm:flex-row sm:justify-center sm:gap-3 sm:pb-6 sm:pt-8">
        <Button variant="primary" className="h-12 w-full text-base sm:w-auto sm:min-w-[200px]" onClick={onPlayAgain}>
          <Icon name="refresh" size={17} /> Play again
          <Kbd className="ml-1 hidden border-ink/20 bg-ink/10 text-ink/70 shadow-none sm:inline-grid">
            <Icon name="enter" size={12} strokeWidth={2.2} />
          </Kbd>
        </Button>
        <div className="flex w-full gap-2 sm:w-auto sm:gap-3">
          <ButtonLink href="/review" className="h-11 flex-1 sm:h-12 sm:flex-none" aria-disabled={reviewCount === 0}>
            Review mistakes{reviewCount > 0 && <span className="tabular rounded-md bg-accent/15 px-1.5 font-mono text-xs text-accent">{reviewCount}</span>}
          </ButtonLink>
          <ButtonLink href="/" variant="ghost" className="h-11 flex-1 sm:h-12 sm:flex-none">
            Home
          </ButtonLink>
        </div>
      </Reveal>
    </main>
  );
}
