"use client";
import { useCallback, useEffect, useEffectEvent, useState } from "react";

export interface TypingOptions {
  enabled: boolean;
  onSubmit: (text: string) => void;
  onEscape?: () => void;
  /** Called for Space (e.g. shuffle a rack). */
  onSpace?: () => void;
  maxLength?: number;
}

interface TypingState {
  text: string;
  /** After a rejected answer: Backspace edits it, but the next letter starts fresh. */
  stale: boolean;
}

/**
 * Keyboard input captured at the window level, so typing works immediately
 * and clicking the board never "loses focus".
 */
export function useTyping({ enabled, onSubmit, onEscape, onSpace, maxLength = 16 }: TypingOptions) {
  const [state, setState] = useState<TypingState>({ text: "", stale: false });

  const type = useCallback(
    (ch: string) => {
      const letter = ch.toLowerCase();
      if (!/^[a-z]$/.test(letter)) return;
      setState((s) => ({
        text: s.stale ? letter : s.text.length >= maxLength ? s.text : s.text + letter,
        stale: false,
      }));
    },
    [maxLength],
  );

  const backspace = useCallback(() => setState((s) => ({ text: s.text.slice(0, -1), stale: false })), []);
  const clear = useCallback(() => setState({ text: "", stale: false }), []);
  const markStale = useCallback(() => setState((s) => ({ ...s, stale: true })), []);
  const setText = useCallback((text: string) => setState({ text, stale: false }), []);

  const submit = useEffectEvent(() => {
    if (state.text) onSubmit(state.text);
  });
  const escape = useEffectEvent(() => {
    clear();
    onEscape?.();
  });
  const space = useEffectEvent(() => onSpace?.());

  const onKey = useEffectEvent((e: KeyboardEvent) => {
    if (e.metaKey || e.ctrlKey || e.altKey) return;
    const target = e.target as HTMLElement | null;
    if (target && (target.tagName === "INPUT" || target.tagName === "TEXTAREA" || target.isContentEditable)) return;
    if (e.key === "Enter") {
      e.preventDefault();
      submit();
    } else if (e.key === "Escape") {
      e.preventDefault();
      escape();
    } else if (e.key === "Backspace") {
      e.preventDefault();
      backspace();
    } else if (e.key === " ") {
      e.preventDefault();
      space();
    } else if (e.key.length === 1 && /^[a-z]$/i.test(e.key)) {
      e.preventDefault();
      type(e.key);
    }
  });

  useEffect(() => {
    if (!enabled) return;
    const handler = (e: KeyboardEvent) => onKey(e);
    window.addEventListener("keydown", handler);
    return () => window.removeEventListener("keydown", handler);
  }, [enabled]);

  /** For on-screen keyboards / buttons (same semantics as the physical Enter key). */
  const pressEnter = () => {
    if (state.text) onSubmit(state.text);
  };

  return { text: state.text, stale: state.stale, type, backspace, clear, markStale, setText, pressEnter };
}
