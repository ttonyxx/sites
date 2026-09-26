"use client";
import clsx from "clsx";
import { motion } from "motion/react";
import { useEffect } from "react";
import { achievementById } from "@/lib/progress/achievements";
import type { SessionReport } from "@/lib/progress/player";
import { SKILLS, type AchievementId } from "@/lib/progress/types";
import { levelProgress, rankFor } from "@/lib/progress/xp";
import { pop, soft } from "@/lib/motion";
import { sfx } from "@/lib/sound";
import { SourcesRow, TileWord } from "../tiles/TileWord";
import { AnimatedNumber } from "../ui/AnimatedNumber";
import { Icon, type IconName } from "../ui/Icon";

export function Reveal({ children, delay = 0, className }: { children: React.ReactNode; delay?: number; className?: string }) {
  return (
    <motion.div className={className} initial={{ opacity: 0, y: 14 }} animate={{ opacity: 1, y: 0 }} transition={{ ...soft, delay }}>
      {children}
    </motion.div>
  );
}

export function StatGrid({ items, delay = 0 }: { items: { label: string; value: React.ReactNode; hint?: string }[]; delay?: number }) {
  return (
    <div className="grid grid-cols-2 gap-px overflow-hidden rounded-2xl border border-line bg-line sm:grid-cols-4">
      {items.map((it, i) => (
        <motion.div
          key={it.label}
          className="flex flex-col gap-1 bg-ink-2 px-4 py-3.5"
          initial={{ opacity: 0 }}
          animate={{ opacity: 1 }}
          transition={{ delay: delay + i * 0.06 }}
        >
          <span className="label">{it.label}</span>
          <span className="tabular font-mono text-xl font-medium">{it.value}</span>
          {it.hint && <span className="text-xs text-faint">{it.hint}</span>}
        </motion.div>
      ))}
    </div>
  );
}

export function RatingCard({ report, delay = 0 }: { report: SessionReport; delay?: number }) {
  const delta = report.overallAfter - report.overallBefore;
  const skills = SKILLS.filter((s) => report.skills[s.key]);
  return (
    <Reveal delay={delay} className="panel flex flex-col gap-3 px-5 py-4">
      <span className="label">Pirate Rating</span>
      <div className="flex flex-wrap items-baseline gap-x-3 gap-y-1">
        <span className="tabular font-mono text-lg text-faint">{report.overallBefore.toLocaleString("en-US")}</span>
        <Icon name="arrow" size={16} className="text-faint" />
        <AnimatedNumber value={report.overallAfter} from={report.overallBefore} className="tabular font-mono text-3xl font-semibold" stiffness={60} damping={20} />
        <Delta value={delta} className="text-base" />
      </div>
      {skills.length > 0 && (
        <div className="flex flex-wrap gap-2">
          {skills.map((s) => {
            const r = report.skills[s.key]!;
            return (
              <span key={s.key} className="flex items-center gap-1.5 rounded-lg border border-line bg-ink-3 px-2 py-1 text-xs text-muted">
                {s.label}
                <span className="tabular font-mono text-fg">{r.after}</span>
                <Delta value={r.after - r.before} />
              </span>
            );
          })}
        </div>
      )}
    </Reveal>
  );
}

export function Delta({ value, className }: { value: number; className?: string }) {
  if (value === 0) return <span className={clsx("tabular font-mono text-faint", className)}>±0</span>;
  const up = value > 0;
  return (
    <span className={clsx("tabular font-mono font-medium", up ? "text-good" : "text-bad", className)}>
      {up ? "▲" : "▼"}
      {Math.abs(value)}
    </span>
  );
}

export function XpCard({ report, delay = 0 }: { report: SessionReport; delay?: number }) {
  const before = levelProgress(report.xpBefore);
  const after = levelProgress(report.xpAfter);
  const leveled = after.level > before.level;
  return (
    <Reveal delay={delay} className="panel flex flex-col gap-3 px-5 py-4">
      <div className="flex items-baseline justify-between gap-3">
        <span className="label">Experience</span>
        <span className="tabular font-mono text-sm text-accent">+{report.xpGained} XP</span>
      </div>
      <div className="flex items-baseline gap-2">
        <span className="text-xl font-semibold">Level {after.level}</span>
        <span className="text-sm text-muted">{rankFor(after.level).name}</span>
        {leveled && (
          <motion.span
            className="ml-auto rounded-full bg-accent px-2 py-0.5 text-[11px] font-semibold uppercase tracking-wider text-ink"
            initial={{ scale: 0, rotate: -12 }}
            animate={{ scale: 1, rotate: 0 }}
            transition={{ ...pop, delay: delay + 0.6 }}
          >
            {report.rankAfter !== report.rankBefore ? `New rank: ${report.rankAfter}` : "Level up!"}
          </motion.span>
        )}
      </div>
      <div className="h-2 overflow-hidden rounded-full bg-line">
        <motion.div
          className="h-full rounded-full bg-gradient-to-r from-accent to-accent-2"
          initial={{ width: `${(leveled ? 0 : before.fraction) * 100}%` }}
          animate={{ width: `${Math.max(0.02, after.fraction) * 100}%` }}
          transition={{ duration: 1.1, ease: [0.22, 1, 0.36, 1], delay: delay + 0.2 }}
        />
      </div>
      <span className="tabular font-mono text-xs text-faint">
        {after.into.toLocaleString("en-US")} / {after.needed.toLocaleString("en-US")} to level {after.level + 1}
      </span>
    </Reveal>
  );
}

export function AchievementCard({ id, delay = 0, locked = false, celebrate = false }: { id: AchievementId; delay?: number; locked?: boolean; celebrate?: boolean }) {
  const a = achievementById(id);
  return (
    <motion.div
      className={clsx(
        "relative flex items-center gap-3 overflow-hidden rounded-2xl border px-4 py-3",
        locked ? "border-line bg-ink-2 opacity-55" : celebrate ? "border-accent/40 bg-accent/[0.06]" : "border-line bg-ink-2",
      )}
      initial={celebrate ? { opacity: 0, scale: 0.8, y: 16 } : { opacity: 0 }}
      animate={{ opacity: locked ? 0.55 : 1, scale: 1, y: 0 }}
      transition={{ ...pop, delay }}
    >
      {celebrate && (
        <motion.span
          className="pointer-events-none absolute inset-0"
          style={{ background: "linear-gradient(110deg, transparent 30%, rgba(255,208,122,.18) 50%, transparent 70%)", backgroundSize: "250% 100%" }}
          initial={{ backgroundPositionX: "120%" }}
          animate={{ backgroundPositionX: "-120%" }}
          transition={{ duration: 1.4, delay: delay + 0.2, ease: "easeInOut" }}
        />
      )}
      <span
        className={clsx(
          "grid h-10 w-10 shrink-0 place-items-center rounded-xl",
          locked ? "bg-ink-4 text-faint" : "bg-accent/15 text-accent shadow-[inset_0_0_0_1px_rgba(245,181,68,.25)]",
        )}
      >
        <Icon name={locked ? "lock" : (a.icon as IconName)} size={19} />
      </span>
      <span className="flex min-w-0 flex-col">
        <span className="text-sm font-semibold uppercase tracking-wide">{a.title}</span>
        <span className="text-xs text-muted">{a.description}</span>
      </span>
    </motion.div>
  );
}

export function NewAchievements({ ids, delay = 0 }: { ids: AchievementId[]; delay?: number }) {
  useEffect(() => {
    if (!ids.length) return;
    const t = window.setTimeout(() => sfx.achievement(), delay * 1000 + 200);
    return () => clearTimeout(t);
  }, [ids.length, delay]);
  if (!ids.length) return null;
  return (
    <div className="flex flex-col gap-3">
      <span className="label">Achievement{ids.length > 1 ? "s" : ""} unlocked</span>
      <div className="grid gap-3 sm:grid-cols-2">
        {ids.map((id, i) => (
          <AchievementCard key={id} id={id} delay={delay + i * 0.12} celebrate />
        ))}
      </div>
    </div>
  );
}

export interface MissedRow {
  id: string;
  sources: string[];
  loose: string;
  target: string;
  answers: string[];
  availableMs: number;
  reason?: string;
}

export function MissedList({ missed, delay = 0, emptyText = "Nothing slipped past you. Clean round." }: { missed: MissedRow[]; delay?: number; emptyText?: string }) {
  if (!missed.length) {
    return (
      <Reveal delay={delay} className="panel px-5 py-4 text-sm text-muted">
        {emptyText}
      </Reveal>
    );
  }
  return (
    <div className="flex flex-col gap-2.5">
      {missed.map((m, i) => (
        <Reveal key={m.id} delay={delay + i * 0.07} className="panel flex flex-col gap-3 px-4 py-3.5 sm:flex-row sm:items-center sm:justify-between">
          <div className="flex flex-wrap items-center gap-x-3 gap-y-2">
            <SourcesRow sources={m.sources} loose={m.loose} size={20} />
            <span className="font-mono text-faint">→</span>
            <TileWord word={m.target} size={20} tone="won" entrance delay={delay + i * 0.07 + 0.25} />
          </div>
          <div className="flex shrink-0 items-center gap-2 text-xs text-faint">
            {m.answers.length > 1 && (
              <span className="hidden max-w-[180px] truncate md:inline">also {m.answers.filter((a) => a !== m.target).slice(0, 2).join(", ").toUpperCase()}</span>
            )}
            <span className="tabular rounded-md bg-ink-4 px-2 py-1 font-mono text-muted">{(m.availableMs / 1000).toFixed(1)}s available</span>
            {m.reason === "rival" && <span className="rounded-md bg-bad/10 px-2 py-1 font-mono text-bad">rival</span>}
          </div>
        </Reveal>
      ))}
    </div>
  );
}

export function PersonalBests({ items }: { items: string[] }) {
  if (!items.length) return null;
  return (
    <div className="flex flex-wrap justify-center gap-2">
      {items.map((t, i) => (
        <motion.span
          key={t}
          className="flex items-center gap-1.5 rounded-full border border-accent/30 bg-accent/10 px-3 py-1 text-xs font-medium text-accent-2"
          initial={{ opacity: 0, scale: 0.6 }}
          animate={{ opacity: 1, scale: 1 }}
          transition={{ ...pop, delay: 0.5 + i * 0.1 }}
        >
          <Icon name="trophy" size={13} /> {t}
        </motion.span>
      ))}
    </div>
  );
}
