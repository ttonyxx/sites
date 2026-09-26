"use client";
import { AnimatePresence, motion, type Variants } from "motion/react";
import { memo, useMemo } from "react";
import type { LooseLetter } from "@/lib/game/board";
import { pop, snappy } from "@/lib/motion";
import { Tile } from "../tiles/Tile";
import { HintGlow, type ExitKind, type ExitKinds } from "./WordGroup";

interface PoolProps {
  loose: readonly LooseLetter[];
  selectedIds: readonly string[];
  onToggle: (kind: "word" | "loose", id: string) => void;
  tile: number;
  exitKinds: ExitKinds;
  hintedIds?: ReadonlySet<string>;
}

/** The pool of face-up loose letters. New letters flip over as they arrive. */
export const Pool = memo(function Pool({ loose, selectedIds, onToggle, tile, exitKinds, hintedIds }: PoolProps) {
  return (
    <div
      className="relative flex items-center gap-3 rounded-2xl border border-line/80 bg-black/25 px-3 shadow-[inset_0_2px_14px_rgba(0,0,0,0.55)]"
      style={{ minHeight: tile + 22 }}
    >
      <span className="label shrink-0 select-none" style={{ writingMode: tile < 30 ? "horizontal-tb" : undefined }}>
        Pool
      </span>
      <div className="flex flex-1 flex-wrap items-center py-2.5" style={{ gap: Math.max(6, tile * 0.22), perspective: 700 }}>
        <AnimatePresence mode="popLayout" custom={exitKinds}>
          {loose.map((l) => (
            <PoolTile key={l.id} letter={l} tile={tile} selected={selectedIds.includes(l.id)} onToggle={onToggle} hinted={hintedIds?.has(l.id)} />
          ))}
        </AnimatePresence>
        {loose.length === 0 && (
          <motion.span className="text-xs text-faint" initial={{ opacity: 0 }} animate={{ opacity: 1 }}>
            Empty — a new letter flips every few seconds
          </motion.span>
        )}
      </div>
    </div>
  );
});

function exitFor(kind: ExitKind | undefined) {
  if (kind === "steal") return { opacity: 0, transition: { duration: 0 } };
  if (kind === "rival") return { opacity: 0, y: -40, transition: { duration: 0.4 } };
  return { opacity: 0, scale: 0.6, rotateY: 90, transition: { duration: 0.3 } };
}

// popLayout needs a ref on each child to lift exiting tiles out of the flow.
const PoolTile = memo(function PoolTile({
  letter,
  tile,
  selected,
  onToggle,
  hinted,
  ref,
}: {
  letter: LooseLetter;
  tile: number;
  selected: boolean;
  onToggle: (kind: "word" | "loose", id: string) => void;
  hinted?: boolean;
  ref?: React.Ref<HTMLButtonElement>;
}) {
  const variants = useMemo<Variants>(() => ({ exit: (kinds?: ExitKinds) => exitFor(kinds?.get(letter.id)) }), [letter.id]);
  return (
    <motion.button
      ref={ref}
      layout
      type="button"
      onPointerDown={(e) => e.preventDefault()}
      onClick={() => onToggle("loose", letter.id)}
      aria-pressed={selected}
      aria-label={`Loose letter ${letter.letter.toUpperCase()}${selected ? ", selected" : ""}`}
      className="relative cursor-pointer touch-manipulation rounded-lg outline-none focus-visible:ring-2 focus-visible:ring-accent"
      exit="exit"
      variants={variants}
      animate={{ y: selected ? -Math.max(3, tile * 0.12) : 0 }}
      whileHover={{ y: selected ? -Math.max(4, tile * 0.14) : -2 }}
      whileTap={{ scale: 0.95 }}
      transition={pop}
    >
      <AnimatePresence>{hinted && !selected && <HintGlow key="hint" radius={Math.round(tile * 0.22)} />}</AnimatePresence>
      <Tile
        layoutId={letter.id}
        letter={letter.letter}
        size={tile}
        tone="pool"
        selected={selected}
        initial={{ rotateY: -110, scale: 0.7, opacity: 0 }}
        animate={{ rotateY: 0, scale: 1, opacity: 1 }}
        transition={snappy}
      />
    </motion.button>
  );
});
