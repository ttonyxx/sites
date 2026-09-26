"use client";
import { LayoutGroup, motion } from "motion/react";
import { useEffect, useState } from "react";
import { Tile } from "../tiles/Tile";

/** Same seven tiles, three words — the whole game in one loop. */
const WORDS = ["pirates", "parties", "traipse"];

export function AnagramHero({ size }: { size: number }) {
  const [index, setIndex] = useState(0);
  useEffect(() => {
    const t = window.setInterval(() => setIndex((i) => (i + 1) % WORDS.length), 2600);
    return () => clearInterval(t);
  }, []);
  const word = WORDS[index];

  return (
    <div className="flex flex-col items-center gap-4">
      <LayoutGroup id="hero">
        <h1 className="flex" style={{ gap: Math.round(size * 0.1) }} aria-label="Pirates">
          {[...word].map((letter, i) => (
            <motion.span
              key={letter}
              layout
              className="block"
              transition={{ type: "spring", stiffness: 380, damping: 26, delay: i * 0.015 }}
              whileHover={{ y: -size * 0.12, rotate: i % 2 ? 3 : -3, transition: { type: "spring", stiffness: 600, damping: 15 } }}
            >
              <Tile
                letter={letter}
                size={size}
                initial={{ opacity: 0, y: -size, rotate: (i - 3) * 9 }}
                // The tilt changes with each word, so the little toss replays on every shuffle.
                animate={{ opacity: 1, y: 0, rotate: [null, (((i * 37 + index * 11) % 9) - 4) * 1.4, 0] }}
                transition={{
                  opacity: { duration: 0.3, delay: 0.1 + i * 0.06 },
                  y: { type: "spring", stiffness: 420, damping: 20, delay: 0.1 + i * 0.06 },
                  rotate: { duration: 0.55, ease: "easeOut" },
                }}
              />
            </motion.span>
          ))}
        </h1>
      </LayoutGroup>
      <div className="flex items-center gap-2 font-mono text-[11px] uppercase tracking-[0.2em] text-faint">
        {WORDS.map((w, i) => (
          <span key={w} className="flex items-center gap-2">
            {i > 0 && <span aria-hidden>⇄</span>}
            <span className={i === index ? "text-accent transition-colors" : "transition-colors"}>{w}</span>
          </span>
        ))}
      </div>
    </div>
  );
}
