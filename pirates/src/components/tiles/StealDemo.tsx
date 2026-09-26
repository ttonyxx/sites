"use client";
import { LayoutGroup, motion } from "motion/react";
import { useEffect, useMemo, useState } from "react";
import { tilesForTarget, type Tile as TileData } from "@/lib/game/board";
import { tileGap } from "@/lib/game/layout";
import { snappy } from "@/lib/motion";
import { Tile } from "./Tile";

function tilesOf(word: string, prefix: string): TileData[] {
  return [...word].map((letter, i) => ({ id: `${prefix}${i}`, letter }));
}

/**
 * Looping demo of the core move: the same physical tiles leave their words
 * and rearrange into the steal (FADE + LITERS → FEDERALIST by default).
 */
export function StealDemo({
  sources = ["fade", "liters"],
  loose = "",
  target = "federalist",
  size = 34,
  id = "demo",
  interval = 2300,
}: {
  sources?: string[];
  loose?: string;
  target?: string;
  size?: number;
  id?: string;
  interval?: number;
}) {
  const [joined, setJoined] = useState(false);
  useEffect(() => {
    const t = window.setInterval(() => setJoined((j) => !j), interval);
    return () => clearInterval(t);
  }, [interval]);

  const groups = useMemo(() => sources.map((s, i) => tilesOf(s, `${id}-w${i}-`)), [sources, id]);
  const looseTiles = useMemo(() => tilesOf(loose, `${id}-l-`), [loose, id]);
  const targetTiles = useMemo(() => tilesForTarget(target, [...groups.flat(), ...looseTiles]) ?? [], [target, groups, looseTiles]);
  const gap = tileGap(size);

  return (
    <LayoutGroup id={id}>
      <div className="flex min-h-[120px] items-center justify-center" style={{ minHeight: size * 3 }}>
        {joined ? (
          <div className="flex" style={{ gap }}>
            {targetTiles.map((t, i) => (
              <Tile key={t.id} layoutId={t.id} layoutCrossfade={false} letter={t.letter} size={size} tone="won" transition={{ ...snappy, delay: i * 0.025 }} />
            ))}
          </div>
        ) : (
          <div className="flex flex-wrap items-center justify-center" style={{ gap: size * 0.5 }}>
            {groups.map((g, gi) => (
              <div key={gi} className="flex items-center" style={{ gap: size * 0.5 }}>
                {gi > 0 && <span className="font-mono text-faint">+</span>}
                <motion.div className="flex" style={{ gap, rotate: gi % 2 ? 2 : -2 }}>
                  {g.map((t, i) => (
                    <Tile key={t.id} layoutId={t.id} letter={t.letter} size={size} transition={{ ...snappy, delay: i * 0.02 }} />
                  ))}
                </motion.div>
              </div>
            ))}
            {looseTiles.length > 0 && (
              <div className="flex items-center" style={{ gap: size * 0.5 }}>
                <span className="font-mono text-faint">+</span>
                {looseTiles.map((t) => (
                  <Tile key={t.id} layoutId={t.id} letter={t.letter} size={size} tone="pool" transition={snappy} />
                ))}
              </div>
            )}
          </div>
        )}
      </div>
    </LayoutGroup>
  );
}
