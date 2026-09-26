"use client";
import { AnimatePresence, motion } from "motion/react";
import { useState } from "react";
import { Icon } from "../ui/Icon";

/** Native share sheet where available, clipboard otherwise. */
export function ShareButton({ text }: { text: string }) {
  const [copied, setCopied] = useState(false);
  const share = async () => {
    try {
      if (navigator.share && window.matchMedia("(pointer: coarse)").matches) {
        await navigator.share({ text });
        return;
      }
      await navigator.clipboard.writeText(text);
      setCopied(true);
      window.setTimeout(() => setCopied(false), 1600);
    } catch {
      // Share sheet dismissed or clipboard blocked: nothing to do.
    }
  };
  return (
    <button
      type="button"
      onClick={share}
      className="relative flex h-8 items-center gap-1.5 rounded-lg border border-line px-3 text-xs text-muted transition-colors hover:border-line-2 hover:text-fg"
    >
      <Icon name="arrow" size={13} className="-rotate-45" />
      <AnimatePresence mode="wait" initial={false}>
        <motion.span key={copied ? "copied" : "share"} initial={{ opacity: 0, y: 4 }} animate={{ opacity: 1, y: 0 }} exit={{ opacity: 0, y: -4 }} transition={{ duration: 0.12 }}>
          {copied ? "Copied" : "Share"}
        </motion.span>
      </AnimatePresence>
    </button>
  );
}
