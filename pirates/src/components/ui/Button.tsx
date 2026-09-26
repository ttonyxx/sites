"use client";
import clsx from "clsx";
import { motion, type HTMLMotionProps } from "motion/react";
import Link from "next/link";
import type { ReactNode } from "react";
import { pop } from "@/lib/motion";

type Variant = "primary" | "secondary" | "ghost";

const styles: Record<Variant, string> = {
  primary:
    "bg-accent text-ink font-semibold shadow-[0_1px_0_rgba(255,255,255,.35)_inset,0_10px_30px_-10px_rgba(245,181,68,.55)] hover:bg-accent-2",
  secondary: "bg-ink-4 text-fg border border-line-2 hover:border-faint hover:bg-[#23232a]",
  ghost: "text-muted hover:text-fg hover:bg-white/5",
};

const base =
  "relative inline-flex select-none items-center justify-center gap-2 rounded-xl px-4 h-11 text-sm transition-colors outline-none focus-visible:ring-2 focus-visible:ring-accent focus-visible:ring-offset-2 focus-visible:ring-offset-ink disabled:opacity-40 disabled:pointer-events-none";

export function Button({
  variant = "secondary",
  className,
  children,
  ...rest
}: { variant?: Variant; children: ReactNode } & HTMLMotionProps<"button">) {
  return (
    <motion.button whileTap={{ scale: 0.97 }} transition={pop} className={clsx(base, styles[variant], className)} {...rest}>
      {children}
    </motion.button>
  );
}

const MotionLink = motion.create(Link);

export function ButtonLink({
  href,
  variant = "secondary",
  className,
  children,
  ...rest
}: { href: string; variant?: Variant; children: ReactNode; className?: string } & Omit<HTMLMotionProps<"a">, "href">) {
  return (
    <MotionLink href={href} whileTap={{ scale: 0.97 }} transition={pop} className={clsx(base, styles[variant], className)} {...rest}>
      {children}
    </MotionLink>
  );
}
