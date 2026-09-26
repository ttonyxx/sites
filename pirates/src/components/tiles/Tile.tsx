"use client";
import clsx from "clsx";
import { motion, type HTMLMotionProps } from "motion/react";
import { memo, type CSSProperties } from "react";

export type TileTone = "word" | "pool" | "won" | "good" | "bad" | "ghost";

export interface TileProps extends Omit<HTMLMotionProps<"div">, "children"> {
  letter: string;
  /** Edge length in px. */
  size: number;
  tone?: TileTone;
  selected?: boolean;
}

/** One Bananagrams-style letter tile. */
export const Tile = memo(function Tile({ letter, size, tone = "word", selected, className, style, ...rest }: TileProps) {
  return (
    <motion.div
      className={clsx("tile", className)}
      data-tone={tone}
      data-selected={selected ? "true" : undefined}
      data-small={size < 30 ? "true" : undefined}
      style={{ ["--t" as string]: `${size}px`, ...style } as CSSProperties}
      aria-hidden
      {...rest}
    >
      <span>{letter}</span>
    </motion.div>
  );
});
