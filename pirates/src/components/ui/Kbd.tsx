import clsx from "clsx";
import type { ReactNode } from "react";

export function Kbd({ children, className }: { children: ReactNode; className?: string }) {
  return (
    <kbd
      className={clsx(
        "inline-grid min-w-[1.6em] place-items-center rounded-md border border-line-2 bg-ink-4 px-1.5 py-0.5 font-mono text-[11px] leading-none text-muted shadow-[0_1.5px_0_#2a2a30]",
        className,
      )}
    >
      {children}
    </kbd>
  );
}
