"use client";
import { motion } from "motion/react";
import Link from "next/link";
import { useEffect, useEffectEvent } from "react";
import { soft } from "@/lib/motion";
import { StealDemo } from "../tiles/StealDemo";
import { TileWord } from "../tiles/TileWord";
import { Button } from "../ui/Button";
import { Icon } from "../ui/Icon";
import { Kbd } from "../ui/Kbd";

const RULES: { title: string; body: React.ReactNode }[] = [
  {
    title: "Combine",
    body: (
      <>
        Merge board words — and loose letters from the <span className="text-fg">pool</span> — into one new word.
      </>
    ),
  },
  {
    title: "Use every letter",
    body: (
      <>
        Exactly once. <span className="font-mono text-good">STORE + V → VOTERS</span> works;{" "}
        <span className="font-mono text-bad">STORE + S → STORES</span> doesn&apos;t — you must rearrange.
      </>
    ),
  },
  {
    title: "Type it, hit Enter",
    body: <>Clicking words is optional — it just marks what you&apos;re thinking. Wrong answers cost 2 seconds.</>,
  },
  {
    title: "Be quick",
    body: <>Fast steals score more and build your combo. Leave a steal too long and a rival grabs it.</>,
  },
];

export function SprintIntro({ ready, onStart }: { ready: boolean; onStart: () => void }) {
  const start = useEffectEvent(() => onStart());
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
      <motion.div className="mt-8 flex flex-col items-center text-center" initial={{ opacity: 0, y: 12 }} animate={{ opacity: 1, y: 0 }} transition={soft}>
        <span className="label">How to play</span>
        <div className="mt-4 flex flex-wrap justify-center gap-3">
          <TileWord word="steal" size={40} entrance jitter />
          <TileWord word="sprint" size={40} entrance delay={0.2} jitter />
        </div>
        <p className="mt-4 text-muted">60 seconds. A messy board. Find as many steals as you can.</p>
      </motion.div>

      <motion.div
        className="panel mt-8 overflow-hidden px-4 py-6"
        initial={{ opacity: 0, y: 16 }}
        animate={{ opacity: 1, y: 0 }}
        transition={{ ...soft, delay: 0.1 }}
      >
        <StealDemo size={30} />
        <p className="mt-2 text-center font-mono text-xs text-faint">FADE + LITERS → FEDERALIST</p>
      </motion.div>

      <ol className="mt-6 grid gap-3 sm:grid-cols-2">
        {RULES.map((r, i) => (
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

      <motion.div className="mt-8 flex flex-col items-center gap-3" initial={{ opacity: 0 }} animate={{ opacity: 1 }} transition={{ delay: 0.45 }}>
        <Button variant="primary" className="h-12 w-full max-w-xs text-base" onClick={onStart}>
          {ready ? "Start" : "Start (loading words…)"} <Icon name="arrow" size={18} />
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
