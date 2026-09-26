"use client";
import clsx from "clsx";
import { useRef } from "react";
import { Icon } from "../ui/Icon";

const ROWS = ["qwertyuiop", "asdfghjkl", "zxcvbnm"];

/** On-screen keyboard for touch devices (no OS keyboard popping over the board). */
export function Keyboard({
  onKey,
  onBackspace,
  onEnter,
  onClear,
  enterLabel = "Steal",
}: {
  onKey: (letter: string) => void;
  onBackspace: () => void;
  onEnter: () => void;
  onClear?: () => void;
  enterLabel?: string;
}) {
  const holdTimer = useRef<number | null>(null);
  const press = (fn: () => void) => (e: React.PointerEvent) => {
    e.preventDefault();
    fn();
    navigator.vibrate?.(4);
  };

  return (
    <div className="flex w-full select-none flex-col gap-[6px] px-1.5 pb-[max(8px,env(safe-area-inset-bottom))] pt-1" role="group" aria-label="Keyboard">
      {ROWS.map((row, r) => (
        <div key={row} className="flex justify-center gap-[5px]">
          {r === 2 && (
            <Key
              wide
              label="Backspace"
              onPointerDown={(e) => {
                e.preventDefault();
                onBackspace();
                holdTimer.current = window.setTimeout(() => onClear?.(), 450);
              }}
              onPointerUp={() => holdTimer.current && clearTimeout(holdTimer.current)}
              onPointerLeave={() => holdTimer.current && clearTimeout(holdTimer.current)}
            >
              <Icon name="backspace" size={20} />
            </Key>
          )}
          {[...row].map((ch) => (
            <Key key={ch} label={ch} onPointerDown={press(() => onKey(ch))}>
              {ch.toUpperCase()}
            </Key>
          ))}
          {r === 2 && (
            <Key wide accent label={enterLabel} onPointerDown={press(onEnter)}>
              <span className="text-[13px] font-semibold">{enterLabel}</span>
            </Key>
          )}
        </div>
      ))}
    </div>
  );
}

function Key({
  children,
  label,
  wide,
  accent,
  ...rest
}: { children: React.ReactNode; label: string; wide?: boolean; accent?: boolean } & React.ButtonHTMLAttributes<HTMLButtonElement>) {
  return (
    <button
      type="button"
      aria-label={label}
      className={clsx(
        "grid h-[46px] touch-manipulation place-items-center rounded-lg font-mono text-[17px] font-medium transition-[transform,background-color] duration-75 active:scale-95",
        wide ? "min-w-[52px] flex-[1.6] px-2" : "flex-1 max-w-[42px]",
        accent ? "bg-accent text-ink active:bg-accent-2" : "bg-ink-4 text-fg active:bg-line-2 shadow-[0_1.5px_0_#0a0a0c]",
      )}
      {...rest}
    >
      {children}
    </button>
  );
}
