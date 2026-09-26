"use client";
import clsx from "clsx";
import { AnimatePresence, motion, useAnimationControls } from "motion/react";
import { useEffect, useRef } from "react";
import { useElementSize } from "@/hooks/useElementSize";
import { pop, shake } from "@/lib/motion";
import { Tile } from "../tiles/Tile";
import { Kbd } from "../ui/Kbd";
import { Icon } from "../ui/Icon";

export type Feedback = { id: number; tone: "good" | "bad" | "info"; text: string } | null;

interface AnswerBarProps {
  text: string;
  stale: boolean;
  /** Bumped on every submission so the typed tiles leave together. */
  generation: number;
  feedback: Feedback;
  /** Letters currently selected on the board (for the n/m counter), or 0. */
  selectedLetters: number;
  tile: number;
  placeholder?: string;
  onClear?: () => void;
  showHints?: boolean;
  /** Not accepting input right now (hides the caret). */
  disabled?: boolean;
}

/** The answer line: what you've typed, as small tiles, plus a feedback line. */
export function AnswerBar({ text, stale, generation, feedback, selectedLetters, tile, placeholder = "Type a steal…", onClear, showHints = true, disabled }: AnswerBarProps) {
  const controls = useAnimationControls();
  const barRef = useRef<HTMLDivElement>(null);
  const { width } = useElementSize(barRef);
  // Shrink typed tiles so long words always fit between the side controls.
  const fitted = width && text.length ? Math.floor((width - 132) / (text.length * 1.12)) : tile;
  const size = Math.max(16, Math.min(tile, fitted));
  useEffect(() => {
    if (feedback?.tone === "bad") void controls.start(shake);
  }, [feedback, controls]);

  const tone = feedback?.tone === "good" && !text ? "good" : stale ? "bad" : "won";
  const counter = selectedLetters > 0 ? `${text.length}/${selectedLetters}` : null;
  const counterOk = selectedLetters > 0 && text.length === selectedLetters;

  return (
    <div className="flex flex-col items-center gap-2">
      <motion.div
        ref={barRef}
        animate={controls}
        className={clsx(
          "relative flex w-full max-w-3xl items-center justify-center rounded-2xl border px-3 transition-colors duration-200",
          feedback?.tone === "bad" && stale ? "border-bad/50 bg-bad/[0.04]" : "border-line bg-ink-2/80",
          feedback?.tone === "good" && !text && "border-good/40",
        )}
        style={{ minHeight: tile + 26 }}
      >
        <div className="flex items-center justify-center px-14 py-3" style={{ gap: Math.max(2, size * 0.1) }}>
          <AnimatePresence mode="popLayout">
            {text.length === 0 && (
              <motion.span
                key="placeholder"
                className="select-none text-[15px] text-faint"
                initial={{ opacity: 0 }}
                animate={{ opacity: 1 }}
                exit={{ opacity: 0, transition: { duration: 0.08 } }}
              >
                {placeholder}
              </motion.span>
            )}
            {[...text].map((ch, i) => (
              <Tile
                key={`${generation}-${i}`}
                letter={ch}
                size={size}
                tone={tone}
                className={stale ? "opacity-60" : undefined}
                initial={{ scale: 0.4, y: 8, opacity: 0 }}
                animate={{ scale: 1, y: 0, opacity: 1 }}
                exit={{ scale: 0.7, y: -10, opacity: 0, transition: { duration: 0.14 } }}
                transition={pop}
              />
            ))}
          </AnimatePresence>
          {!stale && !disabled && <span className="ml-0.5 w-[2px] shrink-0 animate-caret rounded bg-accent" style={{ height: size * 0.8 }} aria-hidden />}
        </div>
        <div className="absolute right-3 flex items-center gap-2">
          {counter && (
            <span className={clsx("tabular font-mono text-xs", counterOk ? "text-good" : "text-faint")} title="Letters typed / letters selected">
              {counter}
            </span>
          )}
          {onClear && (text || selectedLetters > 0) && (
            <button
              type="button"
              onPointerDown={(e) => e.preventDefault()}
              onClick={onClear}
              className="grid h-7 w-7 place-items-center rounded-lg text-faint transition-colors hover:bg-white/5 hover:text-fg"
              aria-label="Clear"
            >
              <Icon name="x" size={15} />
            </button>
          )}
        </div>
      </motion.div>
      <div className="flex h-5 items-center justify-center text-[13px]" role="status" aria-live="polite">
        <AnimatePresence mode="wait">
          {feedback ? (
            <motion.span
              key={feedback.id}
              className={clsx(feedback.tone === "bad" ? "text-bad" : feedback.tone === "good" ? "text-good" : "text-muted")}
              initial={{ opacity: 0, y: 4 }}
              animate={{ opacity: 1, y: 0 }}
              exit={{ opacity: 0, y: -4, transition: { duration: 0.12 } }}
            >
              {feedback.text}
            </motion.span>
          ) : showHints ? (
            <motion.span key="hints" className="hidden items-center gap-3 text-faint sm:flex" initial={{ opacity: 0 }} animate={{ opacity: 1 }} exit={{ opacity: 0 }}>
              <span className="flex items-center gap-1.5">
                <Kbd>
                  <Icon name="enter" size={11} strokeWidth={2.2} />
                </Kbd>{" "}
                steal
              </span>
              <span className="flex items-center gap-1.5">
                <Kbd>esc</Kbd> clear
              </span>
              <span>click words to mark them (optional)</span>
            </motion.span>
          ) : null}
        </AnimatePresence>
      </div>
    </div>
  );
}
