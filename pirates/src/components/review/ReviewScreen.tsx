"use client";
import clsx from "clsx";
import { AnimatePresence, LayoutGroup, motion } from "motion/react";
import Link from "next/link";
import { useEffect, useEffectEvent, useMemo, useRef, useState } from "react";
import { useIsTouch, useMediaQuery } from "@/hooks/useMediaQuery";
import { touchNow, useNow } from "@/hooks/useNow";
import { useTyping } from "@/hooks/useTyping";
import { useGameData } from "@/lib/data";
import { canCombine, letterDiff, normalizeWord, combineWords } from "@/lib/engine/letters";
import { bandLabel, isTrivialSteal } from "@/lib/engine/puzzles";
import { tilesForTarget, type Tile as TileData } from "@/lib/game/board";
import { tileGap } from "@/lib/game/layout";
import { snappy, soft } from "@/lib/motion";
import type { SessionReport } from "@/lib/progress/player";
import { activeCount, reviewQueue } from "@/lib/progress/review";
import type { MissedPuzzle, SessionResult } from "@/lib/progress/types";
import { setSoundEnabled, sfx } from "@/lib/sound";
import { commitSession, playerStore, usePlayer } from "@/lib/storage/player-store";
import { AnswerBar, type Feedback } from "../game/AnswerBar";
import { Keyboard } from "../game/Keyboard";
import { NewAchievements, Reveal as RevealIn, StatGrid, XpCard } from "../results/ResultPieces";
import { TopBar } from "../TopBar";
import { Tile } from "../tiles/Tile";
import { TileWord } from "../tiles/TileWord";
import { Button, ButtonLink } from "../ui/Button";
import { Icon } from "../ui/Icon";
import { Kbd } from "../ui/Kbd";

type Phase = "overview" | "card" | "done";

interface CardResult {
  id: string;
  solved: boolean;
  solveMs: number | null;
  revealed: boolean;
}

const REVEAL_AFTER_MS = 12_000;

function timeAgo(ms: number): string {
  const m = Math.round(ms / 60_000);
  if (m < 1) return "just now";
  if (m < 60) return `${m}m ago`;
  const h = Math.round(m / 60);
  if (h < 24) return `${h}h ago`;
  return `${Math.round(h / 24)}d ago`;
}

/** Tiles for a card: each source word, then the loose letters, with stable ids. */
function cardTiles(card: MissedPuzzle): { words: TileData[][]; loose: TileData[] } {
  return {
    words: card.sources.map((s, wi) => [...s].map((letter, i) => ({ id: `${card.id}:w${wi}:${i}`, letter }))),
    loose: [...card.loose].map((letter, i) => ({ id: `${card.id}:l:${i}`, letter })),
  };
}

export function ReviewScreen() {
  const player = usePlayer();
  const { data } = useGameData();
  const isTouch = useIsTouch();
  const narrow = useMediaQuery("(max-width: 639px)");

  const [phase, setPhase] = useState<Phase>("overview");
  const [queue, setQueue] = useState<MissedPuzzle[]>([]);
  const [index, setIndex] = useState(0);
  const [outcome, setOutcome] = useState<{ solved: boolean; word: string; ms: number | null } | null>(null);
  const [results, setResults] = useState<CardResult[]>([]);
  const [feedback, setFeedback] = useState<Feedback>(null);
  const [generation, setGeneration] = useState(0);
  const [canReveal, setCanReveal] = useState(false);
  const [report, setReport] = useState<SessionReport | null>(null);
  const cardStart = useRef(0);
  const wrongTotal = useRef(0);
  const counter = useRef(0);
  const startedAt = useRef(0);

  useEffect(() => {
    if (player) setSoundEnabled(player.settings.sound);
  }, [player]);

  const now = useNow();
  const due = useMemo(() => (player && now ? reviewQueue(player.missed, now, 10) : []), [player, now]);
  const card = phase === "card" ? queue[index] : undefined;
  const tiles = useMemo(() => (card ? cardTiles(card) : null), [card]);

  const start = () => {
    if (!due.length) return;
    setQueue(due);
    setIndex(0);
    setResults([]);
    setReport(null);
    wrongTotal.current = 0;
    startedAt.current = touchNow();
    openCard();
    setPhase("card");
  };

  const openCard = () => {
    setOutcome(null);
    setFeedback(null);
    setCanReveal(false);
    cardStart.current = performance.now();
  };

  // Reveal unlocks after a first attempt, or after a while.
  useEffect(() => {
    if (phase !== "card" || outcome) return;
    const t = window.setTimeout(() => setCanReveal(true), REVEAL_AFTER_MS);
    return () => clearTimeout(t);
  }, [phase, index, outcome]);

  const record = (r: CardResult) => {
    setResults((rs) => [...rs, r]);
    playerStore.recordReviewCard(r.id, r);
  };

  const typing = useTyping({
    enabled: phase === "card" && !outcome,
    onSubmit: (text, api) => {
      if (!card) return;
      const word = normalizeWord(text);
      const id = ++counter.current;
      const valid = data ? data.lexicon.has(word) : card.answers.includes(word);
      const exact = canCombine(card.sources, word, card.loose);
      if (valid && exact && !isTrivialSteal(card.sources, word)) {
        const ms = performance.now() - cardStart.current;
        setOutcome({ solved: true, word, ms });
        record({ id: card.id, solved: true, solveMs: ms, revealed: false });
        setFeedback({ id, tone: "good", text: `Solved in ${(ms / 1000).toFixed(1)}s` });
        setGeneration((g) => g + 1);
        api.clear();
        sfx.steal(Math.min(results.filter((r) => r.solved).length + 1, 8), card.sources.length);
        return;
      }
      wrongTotal.current++;
      setCanReveal(true);
      api.markStale();
      sfx.wrong();
      if (!exact) {
        const d = letterDiff(combineWords(...card.sources, card.loose), word);
        const parts = [d.missing && `needs ${d.missing.toUpperCase()}`, d.extra && `${d.extra.toUpperCase()} unused`].filter(Boolean);
        setFeedback({ id, tone: "bad", text: `Use every letter exactly once — ${parts.join(", ")}` });
      } else if (!valid) setFeedback({ id, tone: "bad", text: `${word.toUpperCase()} isn't in the word list` });
      else setFeedback({ id, tone: "bad", text: "That just extends a word — rearrange it" });
    },
  });

  const reveal = () => {
    if (!card || outcome) return;
    setOutcome({ solved: false, word: card.target, ms: null });
    record({ id: card.id, solved: false, solveMs: null, revealed: true });
    setFeedback({ id: ++counter.current, tone: "info", text: card.answers.length > 1 ? `Also: ${card.answers.slice(1, 4).join(", ").toUpperCase()}` : "Now you'll see it next time" });
    typing.clear();
    sfx.rival();
  };

  const skip = () => {
    if (!card || outcome) return;
    const r: CardResult = { id: card.id, solved: false, solveMs: null, revealed: false };
    const all = [...results, r];
    setResults(all);
    playerStore.recordReviewCard(r.id, r);
    next(all);
  };

  const finish = (all: CardResult[]) => {
    const solved = all.filter((r) => r.solved);
    const result: SessionResult = {
      mode: "review",
      startedAt: startedAt.current,
      durationMs: touchNow() - startedAt.current,
      score: solved.length * 100,
      correct: solved.length,
      wrong: wrongTotal.current,
      bestCombo: 0,
      solveTimesMs: solved.map((r) => r.solveMs!),
      words: [],
      fusions: 0,
      triples: 0,
      ratingEvents: [],
      missed: [],
      reviewed: all,
      reviewApplied: true,
    };
    setReport(commitSession(result));
    setPhase("done");
    sfx.end();
  };

  const next = (all: CardResult[] = results) => {
    if (index + 1 >= queue.length) {
      finish(all);
      return;
    }
    setIndex((i) => i + 1);
    openCard();
  };

  // Enter moves on once the card is resolved; Tab reveals.
  const onKey = useEffectEvent((e: KeyboardEvent) => {
    if (phase === "overview" && e.key === "Enter") {
      e.preventDefault();
      start();
    } else if (phase === "card" && outcome && e.key === "Enter") {
      e.preventDefault();
      next();
    } else if (phase === "card" && !outcome && e.key === "Tab") {
      e.preventDefault();
      if (canReveal) reveal();
    }
  });
  useEffect(() => {
    const handler = (e: KeyboardEvent) => onKey(e);
    window.addEventListener("keydown", handler);
    return () => window.removeEventListener("keydown", handler);
  }, []);

  // ── Overview ─────────────────────────────────────────────────────────────

  if (phase === "overview") {
    const total = player ? Object.keys(player.missed).length : 0;
    const active = player ? activeCount(player.missed) : 0;
    return (
      <main className="mx-auto flex min-h-dvh w-full max-w-3xl flex-col px-4 pb-16 sm:px-6">
        <TopBar back={{ href: "/", label: "Home" }} />
        <motion.div className="mt-8 flex flex-col items-center text-center" initial={{ opacity: 0, y: 12 }} animate={{ opacity: 1, y: 0 }} transition={soft}>
          <div className="flex flex-wrap justify-center gap-3">
            <TileWord word="review" size={narrow ? 32 : 40} entrance jitter />
          </div>
          <p className="mt-5 max-w-md text-muted">
            Steals you missed come back here. Repeated misses and ones you&apos;ve never solved show up first; ones you nail quickly fade away.
          </p>
        </motion.div>

        {player && due.length === 0 ? (
          <RevealIn delay={0.15} className="panel mt-10 flex flex-col items-center gap-4 px-6 py-10 text-center">
            <TileWord word="clear" size={30} tone="good" entrance delay={0.2} />
            <p className="text-muted">{total ? "Nothing due — every missed steal is mastered." : "No mistakes saved yet. Play a round and anything you miss will land here."}</p>
            <ButtonLink href="/play/sprint" variant="primary">
              Play Steal Sprint
            </ButtonLink>
          </RevealIn>
        ) : (
          <>
            <RevealIn delay={0.12} className="mt-8 flex items-baseline justify-between">
              <span className="label">
                {due.length} card{due.length === 1 ? "" : "s"} up next
              </span>
              <span className="text-xs text-faint">{active} still being learned</span>
            </RevealIn>
            <ul className="mt-3 flex flex-col gap-2">
              {due.map((c, i) => (
                <motion.li
                  key={c.id}
                  className="flex items-center justify-between gap-3 rounded-xl border border-line bg-ink-2 px-4 py-3"
                  initial={{ opacity: 0, y: 8 }}
                  animate={{ opacity: 1, y: 0 }}
                  transition={{ ...soft, delay: 0.15 + i * 0.04 }}
                >
                  <span className="flex flex-wrap items-center gap-2 font-mono text-sm uppercase">
                    {c.sources.join(" + ")}
                    {c.loose && <span className="text-faint">+ {c.loose.toUpperCase()}</span>}
                    <span className="text-faint">→ ?</span>
                  </span>
                  <span className="flex shrink-0 items-center gap-2 font-mono text-[11px] text-faint">
                    <span className="hidden sm:inline">{bandLabel(c.band)}</span>
                    {c.misses > 1 && <span className="rounded bg-bad/10 px-1.5 py-0.5 text-bad">missed {c.misses}×</span>}
                    {c.solves > 0 && <span className="rounded bg-good/10 px-1.5 py-0.5 text-good">solved {c.solves}×</span>}
                  </span>
                </motion.li>
              ))}
            </ul>
            <RevealIn delay={0.3} className="mt-8 flex flex-col items-center gap-3">
              <Button variant="primary" className="h-12 w-full max-w-xs text-base" onClick={start} disabled={!player || !due.length}>
                Start review <Icon name="arrow" size={18} />
              </Button>
              <span className="hidden items-center gap-1.5 text-xs text-faint sm:flex">
                or press
                <Kbd>
                  <Icon name="enter" size={11} strokeWidth={2.2} />
                </Kbd>
              </span>
            </RevealIn>
          </>
        )}
      </main>
    );
  }

  // ── Done ─────────────────────────────────────────────────────────────────

  if (phase === "done") {
    const solved = results.filter((r) => r.solved);
    const avg = solved.length ? solved.reduce((s, r) => s + r.solveMs!, 0) / solved.length : null;
    return (
      <main className="mx-auto flex w-full max-w-3xl flex-col gap-6 px-4 py-8 sm:py-12">
        <motion.header className="flex flex-col items-center text-center" initial={{ opacity: 0, y: 12 }} animate={{ opacity: 1, y: 0 }} transition={soft}>
          <span className="label">Review complete</span>
          <div className="mt-3 flex items-baseline gap-2">
            <span className="tabular font-mono text-7xl font-semibold">{solved.length}</span>
            <span className="font-mono text-3xl text-faint">/ {results.length}</span>
          </div>
          <span className="mt-2 text-sm text-muted">{solved.length === results.length ? "Every one found. They'll fade from your deck." : "Revealed cards come back sooner."}</span>
        </motion.header>
        <StatGrid
          delay={0.1}
          items={[
            { label: "Solved", value: solved.length },
            { label: "Revealed", value: results.filter((r) => r.revealed).length },
            { label: "Avg time", value: avg ? `${(avg / 1000).toFixed(1)}s` : "—" },
            { label: "Still learning", value: player ? activeCount(player.missed) : "—" },
          ]}
        />
        {report && (
          <>
            <XpCard report={report} delay={0.2} />
            <NewAchievements ids={report.newAchievements} delay={0.3} />
          </>
        )}
        <RevealIn delay={0.35} className="mt-2 flex flex-col items-center gap-3 sm:flex-row sm:justify-center">
          <Button variant="primary" className="h-12 w-full sm:w-auto sm:min-w-[200px]" onClick={() => setPhase("overview")}>
            Back to deck
          </Button>
          <ButtonLink href="/play/sprint" className="h-12 w-full sm:w-auto">
            Steal Sprint
          </ButtonLink>
          <ButtonLink href="/" variant="ghost" className="h-12">
            Home
          </ButtonLink>
        </RevealIn>
      </main>
    );
  }

  // ── Card ─────────────────────────────────────────────────────────────────

  if (!card || !tiles) return null;
  const size = narrow ? 34 : 50;
  const all = [...tiles.words.flat(), ...tiles.loose];
  const formed = outcome ? tilesForTarget(outcome.word, all) : null;

  return (
    <main className="mx-auto flex h-dvh w-full max-w-3xl flex-col overflow-hidden px-4 pt-3 sm:px-6 sm:pt-5">
      <header className="flex items-center gap-3">
        <Link href="/" className="grid h-9 w-9 place-items-center rounded-xl text-faint transition-colors hover:bg-white/5 hover:text-fg" aria-label="Quit to home">
          <Icon name="x" size={18} />
        </Link>
        <div className="flex flex-1 flex-col gap-2">
          <div className="flex items-baseline justify-between">
            <span className="label">
              Review · <span className="tabular text-muted">{index + 1}/{queue.length}</span>
            </span>
            <span className="font-mono text-[11px] text-faint">{bandLabel(card.band)}</span>
          </div>
          <div className="flex gap-1.5">
            {queue.map((q, i) => (
              <span
                key={q.id}
                className={clsx(
                  "h-1.5 flex-1 rounded-full transition-colors",
                  results[i] ? (results[i].solved ? "bg-good" : "bg-bad/70") : i === index ? "bg-fg/40" : "bg-line",
                )}
              />
            ))}
          </div>
        </div>
      </header>

      <section className="flex min-h-0 flex-1 flex-col items-center justify-center gap-6 py-6">
        <AnimatePresence mode="wait">
          <motion.div
            key={card.id}
            className="flex w-full flex-col items-center gap-6 text-center"
            initial={{ opacity: 0, y: 24, scale: 0.98 }}
            animate={{ opacity: 1, y: 0, scale: 1 }}
            exit={{ opacity: 0, y: -16, transition: { duration: 0.18 } }}
            transition={soft}
          >
            <div className="flex flex-col items-center gap-2">
              <span className="font-mono text-[11px] font-semibold uppercase tracking-[0.2em] text-bad">You missed this</span>
              <span className="text-sm text-muted">
                You had <span className="tabular font-mono text-fg">{(card.availableMs / 1000).toFixed(1)}</span> seconds
                {card.misses > 1 ? ` · missed ${card.misses}×` : ""} · {timeAgo(now - card.lastMissedAt)}
              </span>
            </div>

            <LayoutGroup id={`review-${card.id}`}>
              <div className="flex min-h-[140px] flex-col items-center justify-center gap-5">
                {!outcome ? (
                  <div className="flex flex-wrap items-center justify-center" style={{ gap: size * 0.45 }}>
                    {tiles.words.map((w, wi) => (
                      <span key={wi} className="flex items-center" style={{ gap: size * 0.45 }}>
                        {wi > 0 && <span className="font-mono text-xl text-faint">+</span>}
                        <span className="flex" style={{ gap: tileGap(size), rotate: `${wi % 2 ? 1.5 : -1.5}deg` }}>
                          {w.map((t, i) => (
                            <Tile
                              key={t.id}
                              layoutId={t.id}
                              letter={t.letter}
                              size={size}
                              initial={{ opacity: 0, y: -20 }}
                              animate={{ opacity: 1, y: 0 }}
                              transition={{ ...snappy, delay: 0.1 + wi * 0.1 + i * 0.03 }}
                            />
                          ))}
                        </span>
                      </span>
                    ))}
                    {tiles.loose.length > 0 && (
                      <span className="flex items-center" style={{ gap: size * 0.45 }}>
                        <span className="font-mono text-xl text-faint">+</span>
                        {tiles.loose.map((t) => (
                          <Tile key={t.id} layoutId={t.id} letter={t.letter} size={size} tone="pool" initial={{ rotateY: -90 }} animate={{ rotateY: 0 }} transition={{ ...snappy, delay: 0.3 }} />
                        ))}
                      </span>
                    )}
                  </div>
                ) : (
                  <div className="flex flex-col items-center gap-3">
                    <div className="flex" style={{ gap: tileGap(size) }}>
                      {(formed ?? []).map((t, i) => (
                        <Tile key={t.id} layoutId={t.id} layoutCrossfade={false} letter={t.letter} size={size} tone={outcome.solved ? "good" : "won"} transition={{ ...snappy, delay: i * 0.025 }} />
                      ))}
                    </div>
                    <motion.span className={clsx("font-mono text-xs uppercase tracking-[0.16em]", outcome.solved ? "text-good" : "text-muted")} initial={{ opacity: 0 }} animate={{ opacity: 1 }} transition={{ delay: 0.3 }}>
                      {outcome.solved ? "Nice — that's the steal" : "The steal"}
                    </motion.span>
                  </div>
                )}
              </div>
            </LayoutGroup>
          </motion.div>
        </AnimatePresence>
      </section>

      <div className="shrink-0 pb-2 sm:pb-6">
        <AnswerBar
          text={typing.text}
          stale={typing.stale}
          generation={generation}
          feedback={feedback}
          selectedLetters={0}
          tile={narrow ? 26 : 34}
          placeholder={outcome ? "Press Enter for the next card" : "Find the steal…"}
          disabled={Boolean(outcome)}
          onClear={typing.clear}
          showHints={false}
        />
        <div className="mt-1 flex items-center justify-center gap-2">
          {outcome ? (
            <Button variant="primary" className="h-10" onClick={() => next()}>
              {index + 1 >= queue.length ? "Finish" : "Next card"} <Icon name="arrow" size={16} />
            </Button>
          ) : (
            <>
              <Button variant="ghost" className="h-10" onClick={reveal} disabled={!canReveal} title={canReveal ? "Show the answer" : "Try once first"}>
                <Icon name="eye" size={16} /> Reveal {!isTouch && <Kbd>tab</Kbd>}
              </Button>
              <Button variant="ghost" className="h-10" onClick={skip}>
                Skip
              </Button>
            </>
          )}
        </div>
      </div>
      {isTouch && !outcome && (
        <div className="shrink-0">
          <Keyboard onKey={typing.type} onBackspace={typing.backspace} onEnter={typing.pressEnter} onClear={typing.clear} enterLabel="Check" />
        </div>
      )}
    </main>
  );
}
