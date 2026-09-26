"use client";
import { AnimatePresence, motion } from "motion/react";
import Link from "next/link";
import { useSearchParams } from "next/navigation";
import { useCallback, useEffect, useEffectEvent, useMemo, useRef, useState, useSyncExternalStore } from "react";
import { useAnimationFrame } from "@/hooks/useAnimationFrame";
import { useIsTouch, useMediaQuery } from "@/hooks/useMediaQuery";
import { useTyping } from "@/hooks/useTyping";
import { useGameData, type GameData } from "@/lib/data";
import { randomSeed } from "@/lib/engine/rng";
import { EMPTY_SELECTION, pruneSelection, selectionLength, toggleSelection, type Selection } from "@/lib/game/board";
import type { RejectReason } from "@/lib/game/resolve";
import { SCORING } from "@/lib/game/scoring";
import { SprintGame, type SprintEvent, type SprintResult } from "@/lib/game/sprint";
import type { SessionReport } from "@/lib/progress/player";
import type { PlayerData, SessionResult } from "@/lib/progress/types";
import { setSoundEnabled, sfx } from "@/lib/sound";
import { commitSession, usePlayer } from "@/lib/storage/player-store";
import { BoardView, type BoardHandle } from "../board/Board";
import type { ExitKind } from "../board/WordGroup";
import { AnswerBar, type Feedback } from "../game/AnswerBar";
import { Countdown } from "../game/Countdown";
import { ComboMeter, ScoreDisplay, Timer } from "../game/Hud";
import { Keyboard } from "../game/Keyboard";
import { RivalToast, type RivalNote } from "../game/RivalToast";
import { ScorePops, type Pop } from "../game/ScorePop";
import { StolenPile } from "../game/StolenPile";
import { Tile } from "../tiles/Tile";
import { Icon } from "../ui/Icon";
import { LoadingTiles } from "../ui/LoadingTiles";
import { SoundToggle } from "../SoundToggle";
import { SprintIntro } from "./SprintIntro";
import { SprintResults } from "./SprintResults";

type Phase = "intro" | "countdown" | "playing" | "over" | "results";

const noopSubscribe = () => () => {};
/** First-round players who haven't stolen anything for this long get a glowing hint. */
const HINT_AFTER_MS = 9_000;

export function sprintStartRating(player: PlayerData): number {
  const r = player.ratings;
  return Math.round((r.steals.rating + r.fusion.rating + r.boardScan.rating) / 3);
}

function toSession(result: SprintResult, startedAt: number): SessionResult {
  return {
    mode: "sprint",
    startedAt,
    durationMs: result.durationMs,
    score: result.score,
    correct: result.steals,
    wrong: result.wrong,
    bestCombo: result.bestCombo,
    solveTimesMs: result.solveTimesMs,
    words: result.pile.map((w) => w.word),
    fusions: result.fusions,
    triples: result.triples,
    ratingEvents: result.ratingEvents,
    // The most instructive few go to Review Mistakes.
    missed: result.missed.slice(0, 4).map((m) => ({
      id: m.id,
      type: m.type,
      sources: m.sources,
      loose: m.loose,
      target: m.target,
      answers: m.answers,
      difficulty: m.difficulty,
      availableMs: m.availableMs,
    })),
  };
}

export function rejectMessage(reason: RejectReason, word: string, penaltyMs: number, diff?: { missing: string; extra: string }): string {
  const W = word.toUpperCase();
  const penalty = penaltyMs ? ` · −${penaltyMs / 1000}s` : "";
  switch (reason) {
    case "too-short":
      return "Steals need at least 4 letters";
    case "not-a-word":
      return `${W} isn't in the word list${penalty}`;
    case "must-rearrange":
      return `${W} just extends a word — rearrange the letters`;
    case "needs-word":
      return "A steal has to use at least one board word";
    case "no-match": {
      if (diff && (diff.missing || diff.extra)) {
        const parts = [diff.missing && `needs ${diff.missing.toUpperCase()}`, diff.extra && `${diff.extra.toUpperCase()} left over`].filter(Boolean);
        return `Selected letters don't match — ${parts.join(", ")}${penalty}`;
      }
      return `Can't make ${W} from the board${penalty}`;
    }
  }
}

export function SprintScreen() {
  const { data, error, retry } = useGameData();
  const player = usePlayer();
  const isTouch = useIsTouch();
  const narrow = useMediaQuery("(max-width: 639px)");

  const [phase, setPhase] = useState<Phase | null>(null);
  const [game, setGame] = useState<SprintGame | null>(null);
  const [outcome, setOutcome] = useState<{ result: SprintResult; report: SessionReport } | null>(null);
  const [selection, setSelection] = useState<Selection>(EMPTY_SELECTION);
  const [feedback, setFeedback] = useState<Feedback>(null);
  const [generation, setGeneration] = useState(0);
  const [pops, setPops] = useState<Pop[]>([]);
  const [rival, setRival] = useState<RivalNote | null>(null);
  const [penaltyId, setPenaltyId] = useState(0);
  const [paused, setPaused] = useState(false);
  const [hint, setHint] = useState<{ wordIds: string[]; looseIds: string[] } | null>(null);
  const firstGame = useRef(false);
  // Key of the hint last shown, so a rAF frame racing the re-render can't show it twice.
  const lastHintKey = useRef("");
  const [exitKinds] = useState(() => new Map<string, ExitKind>());
  const boardRef = useRef<BoardHandle>(null);
  const startedAt = useRef(0);
  const counter = useRef(0);

  const wantsIntro = useSearchParams().get("intro") === "1";
  const current: Phase | null = phase ?? (player ? (wantsIntro || player.stats.gamesByMode.sprint === 0 ? "intro" : "countdown") : null);

  useEffect(() => {
    if (player) setSoundEnabled(player.settings.sound);
  }, [player]);

  const view = useSyncExternalStore(
    useMemo(() => (game ? (cb: () => void) => game.subscribe(cb) : noopSubscribe), [game]),
    () => game?.view() ?? null,
    () => null,
  );
  const board = view?.board;
  const activeSelection = useMemo(() => (board ? pruneSelection(selection, board) : selection), [selection, board]);
  // A hint only stands while all of its pieces are still on the board.
  const hinted = useMemo(() => {
    if (!hint || !board) return undefined;
    const alive = hint.wordIds.every((id) => board.words.some((w) => w.id === id)) && hint.looseIds.every((id) => board.loose.some((l) => l.id === id));
    return alive ? new Set([...hint.wordIds, ...hint.looseIds]) : undefined;
  }, [hint, board]);

  // ── Input ─────────────────────────────────────────────────────────────────

  const typing = useTyping({
    enabled: current === "playing" && !paused,
    onSubmit: (text) => {
      if (!game) return;
      game.submit(text, activeSelection, performance.now());
    },
    onEscape: () => {
      setSelection(EMPTY_SELECTION);
      setFeedback(null);
    },
  });

  // ── Game lifecycle ────────────────────────────────────────────────────────

  const startGame = (d: GameData) => {
    if (!player) return;
    const seed = randomSeed();
    const g = new SprintGame(d.bank, d.lexicon, {
      seed,
      startRating: sprintStartRating(player),
      minWords: narrow ? 8 : 11,
      maxWords: narrow ? 10 : 14,
      initialPlants: narrow ? 2 : 3,
    });
    exitKinds.clear();
    typing.clear();
    // New players get a nudge if they're stuck in their very first round.
    firstGame.current = player.stats.gamesByMode.sprint === 0;
    lastHintKey.current = "";
    setHint(null);
    setSelection(EMPTY_SELECTION);
    setFeedback(null);
    setPops([]);
    setRival(null);
    setOutcome(null);
    setGame(g);
    startedAt.current = Date.now();
    g.start(performance.now());
    setPhase("playing");
  };

  const restart = () => {
    setGame(null);
    setOutcome(null);
    setPhase("countdown");
  };

  useAnimationFrame(
    (now) => {
      if (!game) return;
      game.tick(now);
      if (firstGame.current && !hinted && !game.isOver && game.idleMs(now) > HINT_AFTER_MS) {
        const h = game.hint();
        const key = h ? [...h.wordIds, ...h.looseIds].join(",") : "";
        if (h && key !== lastHintKey.current) {
          lastHintKey.current = key;
          setHint(h);
          setFeedback({ id: ++counter.current, tone: "info", text: `Stuck? The glowing ${h.looseIds.length ? "pieces" : "words"} combine into a new word` });
        }
      }
    },
    current === "playing" && !!game && !paused,
  );

  const finish = useEffectEvent(() => {
    if (!game) return;
    const result = game.result();
    const report = commitSession(toSession(result, startedAt.current));
    setOutcome({ result, report });
    setPhase("over");
    window.setTimeout(() => setPhase("results"), 1100);
  });

  const onEvent = useEffectEvent((e: SprintEvent) => {
    const id = ++counter.current;
    switch (e.type) {
      case "steal": {
        setHint(null);
        for (const wid of e.wordIds) exitKinds.set(wid, "steal");
        for (const lid of e.looseIds) exitKinds.set(lid, "steal");
        const at = boardRef.current?.centerOf(e.wordIds);
        if (at) {
          const n = e.stolen.sources.length;
          const label = n >= 3 ? "Triple" : n === 2 ? (e.stolen.loose ? "Fusion+" : "Fusion") : undefined;
          setPops((p) => [...p, { id, x: at.x, y: at.y, points: e.breakdown.total, breakdown: e.breakdown, label }]);
          window.setTimeout(() => setPops((p) => p.filter((x) => x.id !== id)), 1400);
        }
        setSelection(EMPTY_SELECTION);
        typing.clear();
        setGeneration((g) => g + 1);
        const src = e.stolen.sources.map((s) => s.toUpperCase()).join(" + ") + (e.stolen.loose ? ` + ${e.stolen.loose.toUpperCase()}` : "");
        setFeedback({ id, tone: "good", text: `${src} → ${e.stolen.word.toUpperCase()}` });
        sfx.steal(e.combo, e.stolen.sources.length);
        break;
      }
      case "reject": {
        setFeedback({ id, tone: e.penaltyMs ? "bad" : "info", text: rejectMessage(e.reason, e.word, e.penaltyMs, e.diff) });
        typing.markStale();
        if (e.penaltyMs) {
          setPenaltyId(id);
          sfx.wrong();
        } else sfx.soft();
        break;
      }
      case "rival": {
        for (const wid of e.wordIds) exitKinds.set(wid, "rival");
        for (const lid of e.looseIds) exitKinds.set(lid, "rival");
        setRival({ id, sources: e.sources, loose: e.loose, target: e.target });
        window.setTimeout(() => setRival((r) => (r?.id === id ? null : r)), 2800);
        sfx.rival();
        break;
      }
      case "flip":
        sfx.flip();
        break;
      case "end":
        sfx.end();
        finish();
        break;
    }
  });

  useEffect(() => {
    if (!game) return;
    // Dev-only handle for automated QA (reading available steals, etc.).
    if (process.env.NODE_ENV !== "production") (window as unknown as { __sprint?: SprintGame }).__sprint = game;
    return game.onEvent((e) => onEvent(e));
  }, [game]);

  // Pause when the tab is hidden; resume on the next key/tap.
  useEffect(() => {
    if (!game) return;
    const onVisibility = () => {
      if (document.hidden && !game.isOver) {
        game.pause(performance.now());
        setPaused(true);
      }
    };
    document.addEventListener("visibilitychange", onVisibility);
    return () => document.removeEventListener("visibilitychange", onVisibility);
  }, [game]);

  const resume = useCallback(() => {
    if (!game) return;
    game.resume(performance.now());
    setPaused(false);
  }, [game]);

  useEffect(() => {
    if (!paused) return;
    const onKey = (e: KeyboardEvent) => {
      e.preventDefault();
      resume();
    };
    window.addEventListener("keydown", onKey, { once: true });
    return () => window.removeEventListener("keydown", onKey);
  }, [paused, resume]);

  const onToggle = useCallback(
    (kind: "word" | "loose", id: string) => {
      setSelection((s) => {
        const was = kind === "word" ? s.wordIds.includes(id) : s.looseIds.includes(id);
        if (was) sfx.deselect();
        else sfx.select();
        return toggleSelection(s, kind, id);
      });
    },
    [],
  );

  const onSecond = useCallback(
    (s: number) => {
      if (s <= 5 && s > 0 && current === "playing") sfx.tick();
    },
    [current],
  );

  // ── Render ────────────────────────────────────────────────────────────────

  if (error) {
    return (
      <Centered>
        <p className="text-muted">{error.message}</p>
        <button className="mt-4 text-accent underline" onClick={retry}>
          Try again
        </button>
      </Centered>
    );
  }

  if (current === "results" && outcome) {
    return <SprintResults result={outcome.result} report={outcome.report} onPlayAgain={restart} />;
  }

  if (current === "intro") {
    return <SprintIntro ready={Boolean(data)} onStart={() => setPhase("countdown")} />;
  }

  const answerTile = narrow ? 26 : 34;
  const pileTile = narrow ? 17 : 21;
  const selected = board ? selectionLength(board, activeSelection) : 0;

  return (
    <main className="mx-auto flex h-dvh w-full max-w-6xl flex-col overflow-hidden px-3 pt-3 sm:px-6 sm:pt-5">
      <header className="relative flex items-start justify-between gap-2">
        <div className="flex items-start gap-1 sm:gap-2">
          <Link
            href="/"
            className="mt-0.5 grid h-9 w-9 place-items-center rounded-xl text-faint transition-colors hover:bg-white/5 hover:text-fg"
            aria-label="Quit to home"
          >
            <Icon name="x" size={18} />
          </Link>
          <SoundToggle />
          <div className="relative">
            <Timer
              getRemaining={() => (game ? game.remainingMs(performance.now()) : 60_000)}
              total={60_000}
              running={current === "playing" && !paused}
              onSecond={onSecond}
            />
            <AnimatePresence>
              {penaltyId > 0 && (
                <motion.span
                  key={penaltyId}
                  className="pointer-events-none absolute left-full top-5 ml-2 font-mono text-sm font-semibold text-bad"
                  initial={{ opacity: 0, y: 0, scale: 0.8 }}
                  animate={{ opacity: [0, 1, 1, 0], y: [0, -4, -12, -18], scale: 1 }}
                  transition={{ duration: 1 }}
                  onAnimationComplete={() => setPenaltyId(0)}
                >
                  −2s
                </motion.span>
              )}
            </AnimatePresence>
          </div>
        </div>
        <ComboMeter
          combo={view?.combo ?? 0}
          running={current === "playing" && !paused}
          getFraction={() => {
            if (!game || !view || view.lastSuccessAt === null || view.combo < 1) return 0;
            const elapsed = game.gameNow(performance.now()) - view.lastSuccessAt;
            return Math.max(0, 1 - elapsed / SCORING.comboWindowMs);
          }}
        />
        <ScoreDisplay score={view?.score ?? 0} />
      </header>

      <section className="relative mt-3 min-h-0 flex-1 sm:mt-5">
        {board && (
          <BoardView
            ref={boardRef}
            board={board}
            selection={activeSelection}
            onToggle={onToggle}
            seed={game?.config.seed ?? 1}
            capacity={narrow ? 58 : 84}
            longest={narrow ? 9 : 11}
            exitKinds={exitKinds}
            hinted={hinted}
          >
            <ScorePops pops={pops} />
            <RivalToast note={rival} tile={narrow ? 13 : 16} />
          </BoardView>
        )}
        {current === "countdown" && (data ? <Countdown onDone={() => startGame(data)} size={narrow ? 72 : 104} /> : <LoadingTiles label="Shuffling the tiles…" />)}
        <AnimatePresence>
          {paused && (
            <motion.button
              className="absolute inset-0 z-50 grid place-items-center rounded-2xl bg-ink/70 backdrop-blur-xl"
              initial={{ opacity: 0 }}
              animate={{ opacity: 1 }}
              exit={{ opacity: 0 }}
              onClick={resume}
            >
              <span className="flex flex-col items-center gap-3">
                <span className="text-lg font-medium">Paused</span>
                <span className="text-sm text-muted">Press any key or tap to resume</span>
              </span>
            </motion.button>
          )}
          {current === "over" && (
            <motion.div
              className="absolute inset-0 z-50 grid place-items-center rounded-2xl bg-ink/60 backdrop-blur-md"
              initial={{ opacity: 0 }}
              animate={{ opacity: 1 }}
            >
              <div className="flex gap-2">
                {[..."time"].map((ch, i) => (
                  <Tile
                    key={i}
                    letter={ch}
                    size={narrow ? 60 : 84}
                    initial={{ y: -80, rotate: (i - 1.5) * 12, opacity: 0 }}
                    animate={{ y: 0, rotate: (i - 1.5) * 2, opacity: 1 }}
                    transition={{ type: "spring", stiffness: 500, damping: 18, delay: i * 0.06 }}
                  />
                ))}
              </div>
            </motion.div>
          )}
        </AnimatePresence>
      </section>

      <div className="mt-2 shrink-0">
        <StolenPile pile={view?.pile ?? []} tile={pileTile} />
      </div>

      <div className="shrink-0 pb-2 pt-1 sm:pb-6">
        <AnswerBar
          text={typing.text}
          stale={typing.stale}
          generation={generation}
          feedback={feedback}
          selectedLetters={selected}
          tile={answerTile}
          onClear={() => {
            typing.clear();
            setSelection(EMPTY_SELECTION);
          }}
          showHints={!isTouch}
        />
      </div>

      {isTouch && (
        <div className="shrink-0">
          <Keyboard onKey={typing.type} onBackspace={typing.backspace} onEnter={typing.pressEnter} onClear={typing.clear} />
        </div>
      )}
    </main>
  );
}

function Centered({ children }: { children: React.ReactNode }) {
  return <main className="grid min-h-dvh place-items-center p-6 text-center">{children}</main>;
}
