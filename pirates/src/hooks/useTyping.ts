"use client";
import { useCallback, useEffect, useEffectEvent, useState } from "react";

export interface TypingApi {
  clear: () => void;
  markStale: () => void;
}

export interface TypingOptions {
  enabled: boolean;
  /** Called on Enter with the text and helpers to clear it or mark it stale. */
  onSubmit: (text: string, api: TypingApi) => void;
  onEscape?: () => void;
  /** Called for Space (e.g. shuffle a rack). */
  onSpace?: () => void;
  maxLength?: number;
  /** Return false to refuse a letter (e.g. not on the rack). Receives the text it would be appended to. */
  accept?: (text: string, letter: string) => boolean;
  /** Called when a letter is refused. */
  onRefuse?: (letter: string) => void;
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
export function useTyping({ enabled, onSubmit, onEscape, onSpace, maxLength = 16, accept, onRefuse }: TypingOptions) {
  const [state, setState] = useState<TypingState>({ text: "", stale: false });

  const type = (ch: string) => {
    const letter = ch.toLowerCase();
    if (!/^[a-z]$/.test(letter)) return;
    const base = state.stale ? "" : state.text;
    if (accept && !accept(base, letter)) {
      onRefuse?.(letter);
      return;
    }
    // Functional update so fast typing never drops a letter; `accept` is pure, so re-check it here.
    setState((s) => {
      const b = s.stale ? "" : s.text;
      if (b.length >= maxLength || (accept && !accept(b, letter))) return s;
      return { text: b + letter, stale: false };
    });
  };

  const backspace = useCallback(() => setState((s) => ({ text: s.text.slice(0, -1), stale: false })), []);
  const clear = useCallback(() => setState({ text: "", stale: false }), []);
  const markStale = useCallback(() => setState((s) => ({ ...s, stale: true })), []);
  const setText = useCallback((text: string) => setState({ text, stale: false }), []);

  // A stale answer was already rejected: Enter again would only repeat the penalty.
  const submit = useEffectEvent(() => {
    if (state.text && !state.stale) onSubmit(state.text, { clear, markStale });
  });
  const escape = useEffectEvent(() => {
    clear();
    onEscape?.();
  });
  const space = useEffectEvent(() => onSpace?.());

  const typeKey = useEffectEvent((key: string) => type(key));

  const onKey = useEffectEvent((e: KeyboardEvent) => {
    if (e.metaKey || e.ctrlKey || e.altKey) return;
    const target = e.target as HTMLElement | null;
    if (target && (target.tagName === "INPUT" || target.tagName === "TEXTAREA" || target.isContentEditable)) return;
    if (e.key === "Enter") {
      e.preventDefault();
      if (!e.repeat) submit();
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
      typeKey(e.key);
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
    if (state.text && !state.stale) onSubmit(state.text, { clear, markStale });
  };

  return { text: state.text, stale: state.stale, type, backspace, clear, markStale, setText, pressEnter };
}
