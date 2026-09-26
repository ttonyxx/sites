"use client";
import { motion } from "motion/react";
import Link from "next/link";
import { useEffect, useEffectEvent } from "react";
import { soft } from "@/lib/motion";
import { StealDemo } from "./tiles/StealDemo";
import { TileWord } from "./tiles/TileWord";
import { Button } from "./ui/Button";
import { Icon } from "./ui/Icon";
import { Kbd } from "./ui/Kbd";

interface ModeIntroProps {
  /** Title words, rendered as tiles. */
  title: string[];
  tagline: string;
  rules: { title: string; body: React.ReactNode }[];
  demo?: { sources: string[]; loose?: string; target: string };
  /** Returning players get a short card instead of the full rules. */
  compact?: boolean;
  ready: boolean;
  onStart: () => void;
  startLabel?: string;
}

/** The pre-game card for a mode: title in tiles, a demo, rules, Enter to start. */
export function ModeIntro({ title, tagline, rules, demo, compact, ready, onStart, startLabel = "Start" }: ModeIntroProps) {
  const start = useEffectEvent(() => {
    if (ready) onStart();
  });
  useEffect(() => {
    const onKey = (e: KeyboardEvent) => {
      if (e.key === "Enter") {
        e.preventDefault();
        start();
      }
    };
    window.addEventListener("keydown", onKey);
    return () => window.removeEventListener("keydown", onKey);
  }, []);

  return (
    <main className="mx-auto flex min-h-dvh w-full max-w-2xl flex-col px-4 py-6 sm:py-10">
      <Link href="/" className="flex w-fit items-center gap-1.5 text-sm text-faint transition-colors hover:text-fg">
        <Icon name="back" size={16} /> Home
      </Link>
      <motion.div className="mt-10 flex flex-col items-center text-center" initial={{ opacity: 0, y: 12 }} animate={{ opacity: 1, y: 0 }} transition={soft}>
        <div className="flex flex-wrap justify-center gap-3">
          {title.map((w, i) => (
            <TileWord key={w} word={w} size={compact ? 34 : 40} entrance delay={i * 0.2} jitter />
          ))}
        </div>
        <p className="mt-5 max-w-md text-muted">{tagline}</p>
      </motion.div>

      {demo && !compact && (
        <motion.div className="panel mt-8 overflow-hidden px-4 py-6" initial={{ opacity: 0, y: 16 }} animate={{ opacity: 1, y: 0 }} transition={{ ...soft, delay: 0.1 }}>
          <StealDemo sources={demo.sources} loose={demo.loose} target={demo.target} size={30} id={`intro-${title.join("-")}`} />
          <p className="mt-2 text-center font-mono text-xs uppercase text-faint">
            {demo.sources.join(" + ")}
            {demo.loose ? ` + ${demo.loose}` : ""} → {demo.target}
          </p>
        </motion.div>
      )}

      {!compact && (
        <ol className="mt-6 grid gap-3 sm:grid-cols-2">
          {rules.map((r, i) => (
            <motion.li
              key={r.title}
              className="panel px-4 py-3.5"
              initial={{ opacity: 0, y: 12 }}
              animate={{ opacity: 1, y: 0 }}
              transition={{ ...soft, delay: 0.18 + i * 0.06 }}
            >
              <div className="flex items-center gap-2 text-sm font-medium">
                <span className="grid h-5 w-5 place-items-center rounded-md bg-accent/15 font-mono text-[11px] text-accent">{i + 1}</span>
                {r.title}
              </div>
              <p className="mt-1.5 text-sm leading-relaxed text-muted">{r.body}</p>
            </motion.li>
          ))}
        </ol>
      )}

      <motion.div
        className="mt-10 flex flex-col items-center gap-3"
        initial={{ opacity: 0 }}
        animate={{ opacity: 1 }}
        transition={{ delay: compact ? 0.2 : 0.45 }}
      >
        <Button variant="primary" className="h-12 w-full max-w-xs text-base" onClick={onStart} disabled={!ready}>
          {ready ? startLabel : "Loading words…"} <Icon name="arrow" size={18} />
        </Button>
        <span className="hidden items-center gap-1.5 text-xs text-faint sm:flex">
          or press
          <Kbd>
            <Icon name="enter" size={11} strokeWidth={2.2} />
          </Kbd>
        </span>
      </motion.div>
    </main>
  );
}
