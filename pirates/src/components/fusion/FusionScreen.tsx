"use client";
import clsx from "clsx";
import { AnimatePresence, motion } from "motion/react";
import Link from "next/link";
import { useCallback, useEffect, useEffectEvent, useMemo, useRef, useState } from "react";
import { useAnimationFrame } from "@/hooks/useAnimationFrame";
import { useHiddenTime } from "@/hooks/useHiddenTime";
import { useIsTouch, useMediaQuery } from "@/hooks/useMediaQuery";
import { useTyping, type TypingApi } from "@/hooks/useTyping";
import { useGameData, type GameData } from "@/lib/data";
import { createRng, randomSeed } from "@/lib/engine/rng";
import { EMPTY_SELECTION, removePieces, selectionLength, tilesForTarget, toggleSelection, type Board, type Selection } from "@/lib/game/board";
import { FUSION_TIME_LIMIT_MS, FusionSession, type FusionOutcome, type FusionRound } from "@/lib/game/fusion";
import { tileGap } from "@/lib/game/layout";
import { snappy } from "@/lib/motion";
import type { SessionReport } from "@/lib/progress/player";
import type { SessionResult } from "@/lib/progress/types";
import { setSoundEnabled, sfx } from "@/lib/sound";
import { commitSession, usePlayer } from "@/lib/storage/player-store";
import { BoardView } from "../board/Board";
import type { ExitKind } from "../board/WordGroup";
import { AnswerBar, type Feedback } from "../game/AnswerBar";
import { Keyboard } from "../game/Keyboard";
import { ScorePops, type Pop } from "../game/ScorePop";
import { ModeIntro } from "../ModeIntro";
import { rejectMessage } from "../sprint/SprintScreen";
import { Tile } from "../tiles/Tile";
import { AnimatedNumber } from "../ui/AnimatedNumber";
import { Icon } from "../ui/Icon";
import { Kbd } from "../ui/Kbd";
import { LoadingTiles } from "../ui/LoadingTiles";
import { FusionResults, type FusionSummary } from "./FusionResults";
import { SoundToggle } from "../SoundToggle";

type Phase = "intro" | "playing" | "reveal" | "results";

interface Reveal {
  outcome: FusionOutcome;
  tiles: { id: string; letter: string }[];
}

function toSession(s: FusionSession, startedAt: number): SessionResult {
  const summary = s.summary();
  return {
    mode: "fusion",
    startedAt,
    durationMs: Date.now() - startedAt,
    score: summary.score,
    correct: summary.solved,
    wrong: summary.wrong,
    bestCombo: summary.bestStreak,
    solveTimesMs: summary.solveTimesMs,
    words: s.outcomes.filter((o) => o.solved).map((o) => o.answer!),
    fusions: summary.solved,
    triples: 0,
    ratingEvents: summary.ratingEvents,
    missed: summary.missed.map((o) => ({
      id: o.puzzle.id,
      type: o.puzzle.type,
      sources: o.puzzle.sources,
      loose: o.puzzle.loose,
      target: o.puzzle.target,
      answers: o.puzzle.answers,
      difficulty: o.puzzle.difficulty,
      availableMs: FUSION_TIME_LIMIT_MS,
    })),
    fusionStreak: summary.bestStreak,
    perfect: summary.solved === s.length,
  };
}

export function FusionScreen() {
  const { data, error, retry } = useGameData();
  const player = usePlayer();
  const isTouch = useIsTouch();
  const narrow = useMediaQuery("(max-width: 639px)");

  const [phase, setPhase] = useState<Phase>("intro");
  const [session, setSession] = useState<FusionSession | null>(null);
  const [round, setRound] = useState<FusionRound | null>(null);
  const [reveal, setReveal] = useState<Reveal | null>(null);
  const [selection, setSelection] = useState<Selection>(EMPTY_SELECTION);
  const [feedback, setFeedback] = useState<Feedback>(null);
  const [generation, setGeneration] = useState(0);
  const [pops, setPops] = useState<Pop[]>([]);
  const [outcomes, setOutcomes] = useState<FusionOutcome[]>([]);
  const [final, setFinal] = useState<{ report: SessionReport; summary: FusionSummary } | null>(null);
  const [exitKinds] = useState(() => new Map<string, ExitKind>());
  const counter = useRef(0);
  const sectionRef = useRef<HTMLElement>(null);
  const clockRef = useRef<HTMLDivElement>(null);
  const startedAt = useRef(0);
  // The reveal can be dismissed by its timer or by Enter; only the first may advance.
  const revealHandled = useRef(true);

  useEffect(() => {
    if (player) setSoundEnabled(player.settings.sound);
  }, [player]);

  // The board on screen: during a reveal, the two fused words have left it.
  const board: Board | null = useMemo(() => {
    if (!round) return null;
    return reveal ? removePieces(round.board, round.answerWordIds, []) : round.board;
  }, [round, reveal]);

  // ── Flow ─────────────────────────────────────────────────────────────────

  const finish = (s: FusionSession) => {
    const report = commitSession(toSession(s, startedAt.current));
    setFinal({ report, summary: s.summary() });
    setOutcomes([...s.outcomes]);
    setPhase("results");
    sfx.end();
  };

  const deal = (s: FusionSession, api?: TypingApi) => {
    exitKinds.clear();
    const r = s.next(performance.now());
    setRound(r);
    setReveal(null);
    setSelection(EMPTY_SELECTION);
    setFeedback(null);
    api?.clear();
    if (r) setPhase("playing");
    else finish(s);
  };

  const begin = (d: GameData) => {
    if (!player) return;
    const s = new FusionSession(d.bank, d.lexicon, createRng(randomSeed()), {
      // Open a touch below your rating; the session adapts board by board.
      rating: player.ratings.fusion.rating - 80,
      wordCount: narrow ? 8 : 10,
    });
    startedAt.current = Date.now();
    if (process.env.NODE_ENV !== "production") (window as unknown as { __fusion?: FusionSession }).__fusion = s;
    setSession(s);
    setOutcomes([]);
    setFinal(null);
    deal(s);
  };

  const showReveal = (s: FusionSession, outcome: FusionOutcome, r: FusionRound) => {
    const sourceTiles = r.answerWordIds.flatMap((id) => r.board.words.find((w) => w.id === id)!.tiles);
    for (const id of r.answerWordIds) exitKinds.set(id, "steal");
    const tiles = tilesForTarget(outcome.answer ?? outcome.puzzle.target, sourceTiles) ?? tilesForTarget(outcome.puzzle.target, sourceTiles) ?? [];
    revealHandled.current = false;
    setReveal({ outcome, tiles });
    setOutcomes([...s.outcomes]);
    setPhase("reveal");
  };

  const typing = useTyping({
    enabled: phase === "playing" && !!round,
    onSubmit: (text, api) => {
      if (!session || !round || reveal) return;
      const res = session.submit(text, selection, performance.now());
      const id = ++counter.current;
      if (!res.ok) {
        const msg = res.reason === "needs-two-words" ? "Fuse two board words — there are no loose letters here" : rejectMessage(res.reason, res.word, 0, res.diff);
        setFeedback({ id, tone: "bad", text: msg });
        api.markStale();
        sfx.wrong();
        return;
      }
      api.clear();
      setGeneration((g) => g + 1);
      setFeedback({ id, tone: "good", text: `${round.puzzle.sources.map((w) => w.toUpperCase()).join(" + ")} → ${res.word.toUpperCase()}` });
      sfx.steal(session.streak, 2);
      const rect = sectionRef.current?.getBoundingClientRect();
      if (rect) {
        setPops((p) => [...p, { id, x: rect.width / 2, y: rect.height / 2 - (narrow ? 60 : 90), points: res.points, label: `${(res.solveMs / 1000).toFixed(1)} sec` }]);
        window.setTimeout(() => setPops((p) => p.filter((x) => x.id !== id)), 1400);
      }
      showReveal(session, session.outcomes[session.outcomes.length - 1], round);
    },
    onEscape: () => {
      setSelection(EMPTY_SELECTION);
      setFeedback(null);
    },
  });

  const giveUp = () => {
    if (!session || !round || reveal) return;
    const outcome = session.giveUp();
    if (!outcome) return;
    typing.clear();
    setFeedback({ id: ++counter.current, tone: "info", text: `It was ${outcome.puzzle.sources.map((w) => w.toUpperCase()).join(" + ")} → ${outcome.puzzle.target.toUpperCase()}` });
    sfx.rival();
    showReveal(session, outcome, round);
  };

  const advance = () => {
    if (!session || revealHandled.current) return;
    revealHandled.current = true;
    if (session.done) finish(session);
    else deal(session, typing);
  };

  // After a reveal: move on automatically, or right away on Enter.
  const onRevealDone = useEffectEvent(() => advance());
  useEffect(() => {
    if (phase !== "reveal" || !reveal) return;
    const t = window.setTimeout(() => onRevealDone(), reveal.outcome.solved ? 1300 : 2600);
    const onKey = (e: KeyboardEvent) => {
      if (e.key === "Enter") {
        e.preventDefault();
        onRevealDone();
      }
    };
    const arm = window.setTimeout(() => window.addEventListener("keydown", onKey), 250);
    return () => {
      clearTimeout(t);
      clearTimeout(arm);
      window.removeEventListener("keydown", onKey);
    };
  }, [phase, reveal]);

  // Per-puzzle clock, painted directly; running out reveals the answer.
  useAnimationFrame((now) => {
    if (!session || !round) return;
    const left = Math.max(0, FUSION_TIME_LIMIT_MS - session.elapsed(now));
    if (clockRef.current) clockRef.current.style.transform = `scaleX(${left / FUSION_TIME_LIMIT_MS})`;
    if (left <= 0) giveUp();
  }, phase === "playing" && !!round);

  // A hidden tab doesn't eat the board's 30 seconds.
  useHiddenTime((ms) => session?.pauseFor(ms), phase === "playing");

  // Tab = show me the answer.
  const onTab = useEffectEvent(() => giveUp());
  useEffect(() => {
    if (phase !== "playing") return;
    const onKey = (e: KeyboardEvent) => {
      if (e.key === "Tab") {
        e.preventDefault();
        onTab();
      }
    };
    window.addEventListener("keydown", onKey);
    return () => window.removeEventListener("keydown", onKey);
  }, [phase]);

  const onToggle = useCallback((kind: "word" | "loose", id: string) => {
    setSelection((s) => {
      if (s.wordIds.includes(id)) sfx.deselect();
      else sfx.select();
      return toggleSelection(s, kind, id);
    });
  }, []);

  // ── Render ───────────────────────────────────────────────────────────────

  if (error) {
    return (
      <main className="grid min-h-dvh place-items-center p-6 text-center">
        <p className="text-muted">{error.message}</p>
        <button className="mt-4 text-accent underline" onClick={retry}>
          Try again
        </button>
      </main>
    );
  }

  if (phase === "intro") {
    const returning = (player?.stats.gamesByMode.fusion ?? 0) > 0;
    return (
      <ModeIntro
        title={["fusion", "vision"]}
        tagline="Ten boards. Each hides exactly one pair of words that fuse into a new word. Find it."
        demo={{ sources: ["coop", "agree"], target: "cooperage" }}
        compact={returning}
        rules={[
          { title: "Spot the pair", body: "Every board hides one clean two-word fusion. Everything else is a distraction." },
          { title: "Type the fusion", body: "Click the two words if it helps, type the new word, press Enter." },
          { title: "30 seconds each", body: "Faster solves score more. Stuck? Press Tab to see the answer." },
          { title: "Learn from misses", body: "Anything you miss goes to Review Mistakes for spaced practice." },
        ]}
        ready={Boolean(data && player)}
        onStart={() => data && begin(data)}
      />
    );
  }

  if (phase === "results" && final) {
    return <FusionResults summary={final.summary} outcomes={outcomes} report={final.report} onPlayAgain={() => data && begin(data)} />;
  }

  const selected = board ? selectionLength(board, selection) : 0;
  const shown = session ? Math.min(session.index + (reveal ? 0 : 1), session.length) : 1;

  return (
    <main className="mx-auto flex h-dvh w-full max-w-5xl flex-col overflow-hidden px-3 pt-3 sm:px-6 sm:pt-5">
      <header className="flex items-center gap-3 sm:gap-5">
        <Link href="/" className="grid h-9 w-9 shrink-0 place-items-center rounded-xl text-faint transition-colors hover:bg-white/5 hover:text-fg" aria-label="Quit to home">
          <Icon name="x" size={18} />
        </Link>
          <SoundToggle />
        <div className="flex min-w-0 flex-1 flex-col gap-2">
          <div className="flex items-baseline justify-between gap-3">
            <span className="label">
              Fusion Vision ·{" "}
              <span className="tabular text-muted">
                {shown}/{session?.length ?? 10}
              </span>
            </span>
            <span className="flex items-center gap-4">
              <AnimatePresence>
                {session && session.streak >= 2 && (
                  <motion.span
                    key={session.streak}
                    className="font-mono text-xs text-accent"
                    initial={{ scale: 1.5, opacity: 0 }}
                    animate={{ scale: 1, opacity: 1 }}
                    exit={{ opacity: 0 }}
                  >
                    {session.streak} in a row
                  </motion.span>
                )}
              </AnimatePresence>
              <AnimatedNumber value={session?.score ?? 0} className="tabular font-mono text-lg font-medium" />
            </span>
          </div>
          <ProgressDots total={session?.length ?? 10} outcomes={outcomes} active={session ? session.index : 0} />
          <div className="h-[3px] overflow-hidden rounded-full bg-line">
            <div ref={clockRef} className="h-full origin-left rounded-full bg-fg/70" style={{ transform: "scaleX(1)" }} />
          </div>
        </div>
      </header>

      <section ref={sectionRef} className="relative mt-4 min-h-0 flex-1">
        {board && round && (
          <BoardView
            board={board}
            selection={selection}
            onToggle={onToggle}
            seed={round.puzzle.difficulty * 31 + round.puzzle.target.length}
            capacity={narrow ? 50 : 66}
            longest={9}
            exitKinds={exitKinds}
            showPool={false}
          >
            <ScorePops pops={pops} />
            <AnimatePresence>
              {reveal && (
                <motion.div
                  key={reveal.outcome.puzzle.id}
                  className="pointer-events-none absolute inset-0 z-20 grid place-items-center"
                  exit={{ opacity: 0, scale: 0.92, filter: "blur(4px)", transition: { duration: 0.22 } }}
                >
                  <div className="flex flex-col items-center gap-3 rounded-3xl border border-line bg-ink/90 px-5 py-4 shadow-[0_20px_60px_-20px_rgba(0,0,0,.9)] backdrop-blur-md">
                    <div className="flex" style={{ gap: tileGap(narrow ? 28 : 46) }}>
                      {reveal.tiles.map((t, i) => (
                        <Tile
                          key={t.id}
                          layoutId={t.id}
                          layoutCrossfade={false}
                          letter={t.letter}
                          size={narrow ? 28 : 46}
                          tone={reveal.outcome.solved ? "good" : "won"}
                          transition={{ ...snappy, delay: i * 0.025 }}
                        />
                      ))}
                    </div>
                    <motion.span
                      className={clsx("font-mono text-xs", reveal.outcome.solved ? "text-good" : "text-muted")}
                      initial={{ opacity: 0, y: 6 }}
                      animate={{ opacity: 1, y: 0 }}
                      transition={{ delay: 0.3 }}
                    >
                      {reveal.outcome.solved ? `Solved in ${((reveal.outcome.solveMs ?? 0) / 1000).toFixed(1)}s` : "The fusion was…"}
                    </motion.span>
                  </div>
                </motion.div>
              )}
            </AnimatePresence>
          </BoardView>
        )}
        {!round && <LoadingTiles label="Dealing the board…" />}
      </section>

      <div className="shrink-0 pb-2 pt-3 sm:pb-6">
        <AnswerBar
          text={typing.text}
          stale={typing.stale}
          generation={generation}
          feedback={feedback}
          selectedLetters={selected}
          tile={narrow ? 26 : 34}
          placeholder="Type the fusion…"
          onClear={() => {
            typing.clear();
            setSelection(EMPTY_SELECTION);
          }}
          showHints={false}
        />
        {!isTouch && (
          <div className="mt-1 flex justify-center gap-4 text-xs text-faint">
            <span className="flex items-center gap-1.5">
              <Kbd>
                <Icon name="enter" size={11} strokeWidth={2.2} />
              </Kbd>
              answer
            </span>
            <span className="flex items-center gap-1.5">
              <Kbd>tab</Kbd> show me
            </span>
          </div>
        )}
      </div>
      {isTouch && (
        <div className="shrink-0">
          <div className="mb-1 flex justify-end px-2">
            <button className="rounded-lg px-3 py-1.5 text-xs text-muted active:bg-white/5" onClick={giveUp}>
              Show me
            </button>
          </div>
          <Keyboard onKey={typing.type} onBackspace={typing.backspace} onEnter={typing.pressEnter} onClear={typing.clear} enterLabel="Fuse" />
        </div>
      )}
    </main>
  );
}

function ProgressDots({ total, outcomes, active }: { total: number; outcomes: FusionOutcome[]; active: number }) {
  return (
    <div className="flex gap-1.5" aria-label={`${outcomes.filter((o) => o.solved).length} of ${total} solved`}>
      {Array.from({ length: total }, (_, i) => {
        const o = outcomes[i];
        return (
          <motion.span
            key={i}
            className={clsx("h-1.5 flex-1 rounded-full transition-colors", o ? (o.solved ? "bg-good" : "bg-bad/80") : i === active ? "bg-fg/40" : "bg-line")}
            initial={false}
            animate={{ scaleY: o ? [1, 2, 1] : 1 }}
            transition={{ duration: 0.3 }}
          />
        );
      })}
    </div>
  );
}
