"use client";
import clsx from "clsx";
import { motion } from "motion/react";
import Link from "next/link";
import { currentStreak, localDateKey, playedToday } from "@/lib/progress/streak";
import { levelProgress, rankFor } from "@/lib/progress/xp";
import { setSoundEnabled } from "@/lib/sound";
import { playerStore, usePlayer } from "@/lib/storage/player-store";
import { Tile } from "./tiles/Tile";
import { Icon } from "./ui/Icon";

/** Logo, streak, level and sound toggle — shared by the non-game screens. */
export function TopBar({ back }: { back?: { href: string; label: string } }) {
  const player = usePlayer();
  const today = localDateKey();
  const streak = player ? currentStreak(player.streak, today) : null;
  const lit = player ? playedToday(player.streak, today) : false;
  const lvl = player ? levelProgress(player.xp) : null;
  const sound = player?.settings.sound ?? true;

  return (
    <header className="flex h-14 items-center justify-between gap-3">
      <div className="flex items-center gap-3">
        {back ? (
          <Link href={back.href} className="flex items-center gap-1.5 rounded-lg px-1 py-1 text-sm text-muted transition-colors hover:text-fg">
            <Icon name="back" size={16} /> {back.label}
          </Link>
        ) : (
          <Link href="/" className="group flex items-center gap-2.5" aria-label="Pirates Blitz home">
            <motion.span whileHover={{ rotate: -8, y: -2 }} transition={{ type: "spring", stiffness: 500, damping: 14 }}>
              <Tile letter="p" size={28} />
            </motion.span>
            <span className="text-[15px] font-semibold tracking-tight">
              Pirates <span className="font-mono text-[12px] font-medium tracking-[0.18em] text-accent">BLITZ</span>
            </span>
          </Link>
        )}
      </div>
      <div className="flex items-center gap-1.5 sm:gap-2">
        <span
          className={clsx(
            "flex h-8 items-center gap-1.5 rounded-lg border px-2.5 text-[13px] transition-colors",
            lit ? "border-accent/30 bg-accent/10 text-accent-2" : "border-line text-muted",
          )}
          title={lit ? "You've trained today" : "Train today to keep your streak"}
        >
          <Icon name="flame" size={15} className={lit ? "text-accent" : undefined} />
          <span className="tabular font-mono">{streak ?? "–"}</span>
        </span>
        <Link
          href="/stats"
          className="hidden h-8 items-center gap-2 rounded-lg border border-line px-2.5 text-[13px] text-muted transition-colors hover:border-line-2 hover:text-fg sm:flex"
          title="Level and stats"
        >
          <span className="font-mono tabular">Lv {lvl?.level ?? "–"}</span>
          <span className="relative h-1 w-10 overflow-hidden rounded-full bg-line">
            <motion.span
              className="absolute inset-y-0 left-0 rounded-full bg-accent"
              initial={{ width: 0 }}
              animate={{ width: `${(lvl?.fraction ?? 0) * 100}%` }}
              transition={{ duration: 0.8, delay: 0.3 }}
            />
          </span>
          <span className="hidden text-faint md:inline">{lvl ? rankFor(lvl.level).name : ""}</span>
        </Link>
        <button
          type="button"
          onClick={() => {
            setSoundEnabled(!sound);
            playerStore.updateSettings({ sound: !sound });
          }}
          className="grid h-8 w-8 place-items-center rounded-lg text-faint transition-colors hover:bg-white/5 hover:text-fg"
          aria-label={sound ? "Mute sounds" : "Unmute sounds"}
          aria-pressed={!sound}
        >
          <Icon name={sound ? "sound" : "mute"} size={17} />
        </button>
      </div>
    </header>
  );
}
