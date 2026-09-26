"use client";
import { motion } from "motion/react";
import { useRouter } from "next/navigation";
import { useEffect, useEffectEvent } from "react";
import type { FusionOutcome, FusionSession } from "@/lib/game/fusion";
import { soft } from "@/lib/motion";
import type { SessionReport } from "@/lib/progress/player";
import { NewAchievements, PersonalBests, RatingCard, Reveal, StatGrid, XpCard } from "../results/ResultPieces";
import { TileWord } from "../tiles/TileWord";
import { AnimatedNumber } from "../ui/AnimatedNumber";
import { Button, ButtonLink } from "../ui/Button";
import { Icon } from "../ui/Icon";

export type FusionSummary = ReturnType<FusionSession["summary"]>;

export function FusionResults({
  summary,
  outcomes,
  report,
  onPlayAgain,
}: {
  summary: FusionSummary;
  outcomes: FusionOutcome[];
  report: SessionReport;
  onPlayAgain: () => void;
}) {
  const router = useRouter();
  const onKey = useEffectEvent((e: KeyboardEvent) => {
    if (e.key === "Enter") {
      e.preventDefault();
      onPlayAgain();
    } else if (e.key === "Escape") router.push("/");
  });
  useEffect(() => {
    const handler = (e: KeyboardEvent) => onKey(e);
    const t = window.setTimeout(() => window.addEventListener("keydown", handler), 700);
    return () => {
      clearTimeout(t);
      window.removeEventListener("keydown", handler);
    };
  }, []);

  const perfect = summary.solved === summary.total;

  return (
    <main className="mx-auto flex w-full max-w-3xl flex-col gap-6 px-4 py-8 sm:py-12">
      <motion.header className="flex flex-col items-center text-center" initial={{ opacity: 0 }} animate={{ opacity: 1 }}>
        <span className="label">Fusion Vision</span>
        <motion.div className="mt-3 flex items-baseline gap-2" initial={{ scale: 0.7, opacity: 0 }} animate={{ scale: 1, opacity: 1 }} transition={soft}>
          <AnimatedNumber value={summary.solved} from={0} stiffness={50} damping={16} className="tabular font-mono text-7xl font-semibold" />
          <span className="font-mono text-3xl text-faint">/ {summary.total}</span>
        </motion.div>
        <span className="mt-2 text-sm text-muted">{perfect ? "Flawless. Every fusion found." : summary.solved >= 7 ? "Sharp eyes." : "Every miss is saved for review."}</span>
        <div className="mt-4">
          <PersonalBests items={report.personalBests} />
        </div>
      </motion.header>

      <StatGrid
        delay={0.15}
        items={[
          { label: "Accuracy", value: `${Math.round(summary.accuracy * 100)}%` },
          { label: "Median time", value: summary.medianMs ? `${(summary.medianMs / 1000).toFixed(1)}s` : "—" },
          { label: "Best streak", value: summary.bestStreak },
          { label: "Score", value: summary.score.toLocaleString("en-US") },
        ]}
      />

      <div className="grid gap-4 sm:grid-cols-2">
        <RatingCard report={report} delay={0.3} />
        <XpCard report={report} delay={0.38} />
      </div>

      <NewAchievements ids={report.newAchievements} delay={0.5} />

      <Reveal delay={0.45} className="flex flex-col gap-3">
        <span className="flex items-baseline justify-between">
          <span className="label">Board by board</span>
          {summary.missed.length > 0 && <span className="text-xs text-faint">Misses saved to Review Mistakes</span>}
        </span>
        <ol className="flex flex-col gap-2">
          {outcomes.map((o, i) => (
            <motion.li
              key={o.puzzle.id}
              className="flex flex-wrap items-center gap-x-3 gap-y-2 rounded-xl border border-line bg-ink-2 px-3 py-2.5"
              initial={{ opacity: 0, x: -8 }}
              animate={{ opacity: 1, x: 0 }}
              transition={{ ...soft, delay: 0.5 + i * 0.04 }}
            >
              <span className="tabular w-5 font-mono text-xs text-faint">{i + 1}</span>
              <span className="font-mono text-xs uppercase text-muted">{o.puzzle.sources.join(" + ")}</span>
              <span className="font-mono text-xs text-faint">→</span>
              <TileWord word={o.answer ?? o.puzzle.target} size={17} tone={o.solved ? "won" : "bad"} />
              <span className="ml-auto flex items-center gap-2 font-mono text-xs">
                {o.solved ? (
                  <span className="text-good">{((o.solveMs ?? 0) / 1000).toFixed(1)}s</span>
                ) : (
                  <span className="text-bad">missed</span>
                )}
                {o.wrong > 0 && <span className="text-faint">{o.wrong}✗</span>}
              </span>
            </motion.li>
          ))}
        </ol>
      </Reveal>

      <Reveal delay={0.7} className="sticky bottom-0 -mx-4 mt-2 flex flex-col items-center gap-2 bg-gradient-to-t from-ink via-ink/95 to-transparent px-4 pb-4 pt-6 sm:flex-row sm:justify-center sm:gap-3 sm:pb-6 sm:pt-8">
        <Button variant="primary" className="h-12 w-full text-base sm:w-auto sm:min-w-[200px]" onClick={onPlayAgain}>
          <Icon name="refresh" size={17} /> Ten more
        </Button>
        <div className="flex w-full gap-2 sm:w-auto sm:gap-3">
          {summary.missed.length > 0 && (
            <ButtonLink href="/review" className="h-11 flex-1 sm:h-12 sm:flex-none">
              Review mistakes
            </ButtonLink>
          )}
          <ButtonLink href="/" variant="ghost" className="h-11 flex-1 sm:h-12 sm:flex-none">
            Home
          </ButtonLink>
        </div>
      </Reveal>
    </main>
  );
}
