"use client";
import clsx from "clsx";
import { motion } from "motion/react";
import { useRouter } from "next/navigation";
import { useEffect, useEffectEvent } from "react";
import type { Rack } from "@/lib/game/anagram";
import { soft } from "@/lib/motion";
import type { SessionReport } from "@/lib/progress/player";
import { NewAchievements, PersonalBests, RatingCard, Reveal, StatGrid, XpCard } from "../results/ResultPieces";
import { TileWord } from "../tiles/TileWord";
import { AnimatedNumber } from "../ui/AnimatedNumber";
import { Button, ButtonLink } from "../ui/Button";
import { Icon } from "../ui/Icon";
import type { FoundWord } from "./AnagramScreen";

export function AnagramResults({
  rack,
  found,
  report,
  wrong,
  onPlayAgain,
}: {
  rack: Rack;
  found: FoundWord[];
  report: SessionReport;
  wrong: number;
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

  const score = found.reduce((s, f) => s + f.points, 0);
  const foundSet = new Set(found.map((f) => f.word));
  const longest = [...found].sort((a, b) => b.word.length - a.word.length)[0];
  const missed = rack.familiar.filter((w) => !foundSet.has(w)).slice(0, 14);
  const coverage = rack.familiar.length ? Math.round((rack.familiar.filter((w) => foundSet.has(w)).length / rack.familiar.length) * 100) : 0;
  const sorted = [...found].sort((a, b) => b.word.length - a.word.length || a.word.localeCompare(b.word));

  return (
    <main className="mx-auto flex w-full max-w-3xl flex-col gap-6 px-4 py-8 sm:py-12">
      <motion.header className="flex flex-col items-center text-center" initial={{ opacity: 0 }} animate={{ opacity: 1 }}>
        <span className="label">Raw Anagrams · Score</span>
        <motion.div initial={{ scale: 0.7, opacity: 0 }} animate={{ scale: 1, opacity: 1 }} transition={soft}>
          <AnimatedNumber value={score} from={0} stiffness={40} damping={18} className="tabular mt-2 block font-mono text-6xl font-semibold tracking-tight sm:text-7xl" />
        </motion.div>
        <div className="mt-5">
          <TileWord word={rack.seed} size={30} entrance delay={0.2} jitter label={`Rack word ${rack.seed.toUpperCase()}`} />
        </div>
        <span className="mt-3 text-xs text-faint">The rack spelled {rack.seed.toUpperCase()}{foundSet.has(rack.seed) ? " — and you found it." : "."}</span>
        <div className="mt-4">
          <PersonalBests items={report.personalBests} />
        </div>
      </motion.header>

      <StatGrid
        delay={0.15}
        items={[
          { label: "Words", value: found.length },
          { label: "Longest", value: longest ? longest.word.toUpperCase() : "—" },
          { label: "Coverage", value: `${coverage}%`, hint: "of common words" },
          { label: "Misfires", value: wrong },
        ]}
      />

      <div className="grid gap-4 sm:grid-cols-2">
        <RatingCard report={report} delay={0.3} />
        <XpCard report={report} delay={0.38} />
      </div>

      <NewAchievements ids={report.newAchievements} delay={0.5} />

      <div className="grid gap-4 sm:grid-cols-2">
        <Reveal delay={0.45} className="panel flex flex-col gap-3 px-5 py-4">
          <span className="label">You found</span>
          {sorted.length === 0 ? (
            <span className="text-sm text-muted">Nothing this time — try starting from common endings like -ER, -ED, -ING.</span>
          ) : (
            <div className="flex flex-wrap gap-x-3 gap-y-1.5">
              {sorted.map((f) => (
                <span key={f.word} className={clsx("font-mono text-sm uppercase", f.word.length >= 6 ? "text-accent-2" : "text-fg")}>
                  {f.word}
                </span>
              ))}
            </div>
          )}
        </Reveal>
        <Reveal delay={0.5} className="panel flex flex-col gap-3 px-5 py-4">
          <span className="label">You could have had</span>
          <div className="flex flex-wrap gap-x-3 gap-y-1.5">
            {missed.map((w) => (
              <span key={w} className={clsx("font-mono text-sm uppercase", w.length >= 6 ? "text-muted" : "text-faint")}>
                {w}
              </span>
            ))}
          </div>
        </Reveal>
      </div>

      <Reveal delay={0.6} className="sticky bottom-0 -mx-4 mt-2 flex flex-col items-center gap-3 bg-gradient-to-t from-ink via-ink/95 to-transparent px-4 pb-6 pt-8 sm:flex-row sm:justify-center">
        <Button variant="primary" className="h-12 w-full text-base sm:w-auto sm:min-w-[200px]" onClick={onPlayAgain}>
          <Icon name="refresh" size={17} /> New rack
        </Button>
        <ButtonLink href="/play/sprint" className="h-12 w-full sm:w-auto">
          Steal Sprint
        </ButtonLink>
        <ButtonLink href="/" variant="ghost" className="h-12">
          Home
        </ButtonLink>
      </Reveal>
    </main>
  );
}
