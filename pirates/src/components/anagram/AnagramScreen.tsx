"use client";
import clsx from "clsx";
import { AnimatePresence, LayoutGroup, motion, useAnimationControls } from "motion/react";
import Link from "next/link";
import { useEffect, useMemo, useRef, useState } from "react";
import { useAnimationFrame } from "@/hooks/useAnimationFrame";
import { useHiddenTime } from "@/hooks/useHiddenTime";
import { useIsTouch, useMediaQuery } from "@/hooks/useMediaQuery";
import { useTyping } from "@/hooks/useTyping";
import { useGameData, type GameData } from "@/lib/data";
import { subtractLetters } from "@/lib/engine/letters";
import { createRng, randomSeed } from "@/lib/engine/rng";
import { buildRack, checkRawWord, rackPar, RAW_DURATION_MS, type Rack } from "@/lib/game/anagram";
import { tileGap } from "@/lib/game/layout";
import { pop, snappy } from "@/lib/motion";
import type { SessionReport } from "@/lib/progress/player";
import type { SessionResult } from "@/lib/progress/types";
import { setSoundEnabled, sfx } from "@/lib/sound";
import { commitSession, usePlayer } from "@/lib/storage/player-store";
import { AnswerBar, type Feedback } from "../game/AnswerBar";
import { Countdown } from "../game/Countdown";
import { Timer } from "../game/Hud";
import { Keyboard } from "../game/Keyboard";
import { ModeIntro } from "../ModeIntro";
import { Tile } from "../tiles/Tile";
import { AnimatedNumber } from "../ui/AnimatedNumber";
import { Icon } from "../ui/Icon";
import { Kbd } from "../ui/Kbd";
import { AnagramResults } from "./AnagramResults";
import { SoundToggle } from "../SoundToggle";

type Phase = "intro" | "countdown" | "playing" | "results";

export interface FoundWord {
  word: string;
  points: number;
  at: number;
}

const REASONS: Record<string, string> = {
  "too-short": "Words need at least 3 letters",
  "not-in-rack": "Those letters aren't all on the rack",
  "not-a-word": "isn't in the word list",
  duplicate: "Already found",
};

export function AnagramScreen() {
  const { data, error, retry } = useGameData();
  const player = usePlayer();
  const isTouch = useIsTouch();
  const narrow = useMediaQuery("(max-width: 639px)");

  const [phase, setPhase] = useState<Phase>("intro");
  const [rack, setRack] = useState<Rack | null>(null);
  const [order, setOrder] = useState<number[]>([0, 1, 2, 3, 4, 5, 6]);
  const [found, setFound] = useState<FoundWord[]>([]);
  const [feedback, setFeedback] = useState<Feedback>(null);
  const [generation, setGeneration] = useState(0);
  // A ref, not state: a hidden-tab shift must land before the next animation frame reads it.
  const endsAt = useRef(0);
  const [final, setFinal] = useState<{ report: SessionReport; rack: Rack; found: FoundWord[]; wrong: number } | null>(null);
  const wrong = useRef(0);
  // rAF can fire again before React re-renders; commit each round exactly once.
  const finished = useRef(false);
  const startedAt = useRef(0);
  const counter = useRef(0);
  const rng = useMemo(() => createRng(randomSeed()), []);
  const rackControls = useAnimationControls();

  useEffect(() => {
    if (player) setSoundEnabled(player.settings.sound);
  }, [player]);

  const score = found.reduce((s, f) => s + f.points, 0);
  const foundSet = useMemo(() => new Set(found.map((f) => f.word)), [found]);

  const shuffle = () => {
    setOrder((o) => rng.shuffle(o));
    sfx.select();
  };

  const typing = useTyping({
    enabled: phase === "playing",
    maxLength: 7,
    accept: (text, letter) => (rack ? subtractLetters(rack.letters.join(""), text + letter) !== null : false),
    onRefuse: () => {
      void rackControls.start({ x: [0, -6, 5, -3, 0], transition: { duration: 0.22 } });
      sfx.soft();
    },
    onSubmit: (text, api) => {
      if (!rack || !data) return;
      const res = checkRawWord(text, rack, foundSet, data.lexicon);
      const id = ++counter.current;
      if (!res.ok) {
        if (res.reason === "not-a-word") wrong.current++;
        setFeedback({ id, tone: res.reason === "duplicate" ? "info" : "bad", text: res.reason === "not-a-word" ? `${res.word.toUpperCase()} ${REASONS[res.reason]}` : REASONS[res.reason] });
        api.markStale();
        if (res.reason === "duplicate") sfx.soft();
        else sfx.wrong();
        return;
      }
      setFound((f) => [{ word: res.word, points: res.points, at: performance.now() }, ...f]);
      setFeedback({ id, tone: "good", text: `${res.word.toUpperCase()} +${res.points}` });
      setGeneration((g) => g + 1);
      api.clear();
      sfx.steal(Math.min(res.word.length - 2, 8), res.word.length >= 7 ? 3 : 1);
    },
    onSpace: () => shuffle(),
    onEscape: () => setFeedback(null),
  });

  // Which rack tiles the typed text is using (first free tile of each letter, in display order).
  const used = useMemo(() => {
    const out = new Set<number>();
    if (!rack || typing.stale) return out;
    for (const ch of typing.text) {
      const i = order.find((idx) => rack.letters[idx] === ch && !out.has(idx));
      if (i !== undefined) out.add(i);
    }
    return out;
  }, [rack, order, typing.text, typing.stale]);

  const begin = (d: GameData) => {
    if (!player) return;
    const avoid = new Set<string>();
    const r = buildRack(d.lexicon, rng, player.ratings.rawAnagrams.rating, avoid);
    setRack(r);
    setOrder(rng.shuffle([0, 1, 2, 3, 4, 5, 6]));
    setFound([]);
    setFeedback(null);
    setFinal(null);
    wrong.current = 0;
    finished.current = false;
    typing.clear();
    setPhase("countdown");
  };

  const onCountdownDone = () => {
    startedAt.current = Date.now();
    endsAt.current = performance.now() + RAW_DURATION_MS;
    setPhase("playing");
  };

  const finish = () => {
    if (!rack || phase !== "playing" || finished.current) return;
    finished.current = true;
    const par = rackPar(rack);
    const performance01 = Math.min(1, score / Math.max(1, par * 1.25));
    const result: SessionResult = {
      mode: "anagram",
      startedAt: startedAt.current,
      durationMs: RAW_DURATION_MS,
      score,
      correct: found.length,
      wrong: wrong.current,
      bestCombo: 0,
      solveTimesMs: [],
      words: found.map((f) => f.word),
      fusions: 0,
      triples: 0,
      ratingEvents: [{ skill: "rawAnagrams", difficulty: rack.difficulty, score: performance01, weight: 1.5 }],
      missed: [],
      rawWords: found.length,
    };
    const report = commitSession(result);
    setFinal({ report, rack, found, wrong: wrong.current });
    sfx.end();
    setPhase("results");
  };

  useAnimationFrame((now) => {
    if (now >= endsAt.current) finish();
  }, phase === "playing");

  // A hidden tab doesn't run the rack's clock down.
  useHiddenTime((ms) => {
    endsAt.current += ms;
  }, phase === "playing");

  const clickTile = (idx: number) => {
    if (!rack || used.has(idx)) return;
    typing.type(rack.letters[idx]);
    sfx.select();
  };

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
    return (
      <ModeIntro
        title={["raw", "anagrams"]}
        tagline="Seven letters, thirty seconds. Find as many words as you can — longer words are worth far more."
        compact={(player?.stats.gamesByMode.anagram ?? 0) > 0}
        rules={[
          { title: "Any word, 3+ letters", body: "Use each rack letter at most once per word." },
          { title: "Length pays", body: "3 → 100, 5 → 400, 7 → 1,100 plus a bonus for using the whole rack." },
          {
            title: "Shuffle",
            body: (
              <>
                Press <span className="text-fg">Space</span> to shuffle the rack and see it fresh.
              </>
            ),
          },
          { title: "Tap or type", body: "Click rack tiles or type. Backspace undoes, Enter submits." },
        ]}
        ready={Boolean(data && player)}
        onStart={() => data && begin(data)}
      />
    );
  }

  if (phase === "results" && final) {
    return <AnagramResults rack={final.rack} found={final.found} report={final.report} wrong={final.wrong} onPlayAgain={() => data && begin(data)} />;
  }

  const tile = narrow ? 44 : 68;
  const byLength = groupByLength(found);

  return (
    <main className="mx-auto flex h-dvh w-full max-w-4xl flex-col overflow-hidden px-3 pt-3 sm:px-6 sm:pt-5">
      <header className="flex items-start justify-between gap-3">
        <div className="flex items-start gap-3 sm:gap-5">
          <Link href="/" className="mt-0.5 grid h-9 w-9 place-items-center rounded-xl text-faint transition-colors hover:bg-white/5 hover:text-fg" aria-label="Quit to home">
            <Icon name="x" size={18} />
          </Link>
          <SoundToggle />
          <Timer getRemaining={() => (phase === "playing" ? Math.max(0, endsAt.current - performance.now()) : RAW_DURATION_MS)} total={RAW_DURATION_MS} running={phase === "playing"} />
        </div>
        <div className="flex flex-col items-center gap-1.5">
          <span className="label">Words</span>
          <span className="tabular font-mono text-[22px] font-medium leading-none min-[380px]:text-[26px] sm:text-[30px]">{found.length}</span>
        </div>
        <div className="flex min-w-[64px] flex-col items-end gap-1.5 sm:min-w-[88px]">
          <span className="label">Score</span>
          <AnimatedNumber
            value={score}
            className="tabular font-mono text-[22px] font-medium leading-none min-[380px]:text-[26px] sm:text-[30px]"
            stiffness={170}
            damping={26}
          />
        </div>
      </header>

      <section className="relative flex min-h-0 flex-1 flex-col items-center justify-center gap-8 py-4">
        {phase === "countdown" && <Countdown onDone={onCountdownDone} size={narrow ? 72 : 96} />}
        {rack && phase === "playing" && (
          <>
            <motion.div animate={rackControls} className="flex flex-col items-center gap-4">
              <LayoutGroup id="rack">
                <div className="flex" style={{ gap: tileGap(tile) * 1.6 }}>
                  {order.map((idx, pos) => (
                    <motion.button
                      key={idx}
                      layout
                      type="button"
                      transition={snappy}
                      onPointerDown={(e) => e.preventDefault()}
                      onClick={() => clickTile(idx)}
                      className="touch-manipulation rounded-xl outline-none"
                      aria-label={`Letter ${rack.letters[idx].toUpperCase()}${used.has(idx) ? ", used" : ""}`}
                      whileHover={used.has(idx) ? undefined : { y: -4 }}
                      whileTap={{ scale: 0.94 }}
                    >
                      <Tile
                        letter={rack.letters[idx]}
                        size={tile}
                        tone={used.has(idx) ? "ghost" : "word"}
                        initial={{ y: -40, opacity: 0, rotate: (pos - 3) * 6 }}
                        animate={{ y: used.has(idx) ? 6 : 0, opacity: 1, rotate: 0, scale: used.has(idx) ? 0.92 : 1 }}
                        transition={{ ...pop, delay: 0 }}
                      />
                    </motion.button>
                  ))}
                </div>
              </LayoutGroup>
              <button
                type="button"
                onClick={shuffle}
                className="flex items-center gap-2 rounded-lg px-3 py-1.5 text-xs text-faint transition-colors hover:bg-white/5 hover:text-fg"
              >
                <Icon name="shuffle" size={14} /> Shuffle <Kbd className="hidden sm:inline-grid">space</Kbd>
              </button>
            </motion.div>

            <div className="flex w-full max-w-3xl flex-wrap items-start justify-center gap-x-6 gap-y-3 overflow-y-auto px-2" style={{ maxHeight: narrow ? 170 : 260 }}>
              {found.length === 0 && <span className="text-sm text-faint">Your words collect here, longest first.</span>}
              {byLength.map(([len, words]) => (
                <div key={len} className="flex flex-col items-center gap-1.5">
                  <span className="label">{len} letters</span>
                  <div className="flex flex-col items-center gap-1">
                    <AnimatePresence initial={false}>
                      {words.map((f) => (
                        <motion.span
                          key={f.word}
                          layout
                          className={clsx("font-mono text-sm uppercase tracking-wide", len >= 6 ? "text-accent-2" : "text-fg")}
                          initial={{ opacity: 0, scale: 0.6, y: -6 }}
                          animate={{ opacity: 1, scale: 1, y: 0 }}
                          transition={pop}
                        >
                          {f.word}
                        </motion.span>
                      ))}
                    </AnimatePresence>
                  </div>
                </div>
              ))}
            </div>
          </>
        )}
      </section>

      <div className="shrink-0 pb-2 sm:pb-6">
        <AnswerBar
          text={typing.text}
          stale={typing.stale}
          generation={generation}
          feedback={feedback}
          selectedLetters={0}
          tile={narrow ? 26 : 34}
          placeholder="Type a word…"
          onClear={typing.clear}
          showHints={false}
        />
      </div>
      {isTouch && (
        <div className="shrink-0">
          <Keyboard onKey={typing.type} onBackspace={typing.backspace} onEnter={typing.pressEnter} onClear={typing.clear} enterLabel="Enter" />
        </div>
      )}
    </main>
  );
}

function groupByLength(found: FoundWord[]): [number, FoundWord[]][] {
  const m = new Map<number, FoundWord[]>();
  for (const f of found) {
    const list = m.get(f.word.length) ?? [];
    list.push(f);
    m.set(f.word.length, list);
  }
  return [...m.entries()].sort((a, b) => b[0] - a[0]);
}

