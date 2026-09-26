import type { SVGProps } from "react";

const paths = {
  x: "M6 6l12 12M18 6L6 18",
  back: "M15 5l-7 7 7 7",
  arrow: "M5 12h14M13 6l6 6-6 6",
  enter: "M20 5v7a3 3 0 0 1-3 3H6M10 10l-5 5 5 5",
  backspace: "M9 6h10a2 2 0 0 1 2 2v8a2 2 0 0 1-2 2H9l-6-6 6-6zM12 10l4 4M16 10l-4 4",
  bolt: "M13 3L5 13.5h6L10 21l8-10.5h-6L13 3z",
  flame: "M12 3c1 3.5 5 5.5 5 10a5 5 0 0 1-10 0c0-2.2 1-3.6 2.2-4.8.2 1.7 1 2.8 2.3 3.3C11 9 11 6 12 3z",
  fuse: "M4 12h5M15 12h5M9 8l3 4-3 4M15 8l-3 4 3 4",
  triple: "M4 7h6v4H4zM14 7h6v4h-6zM9 15h6v4H9z",
  monster: "M3 17V9l3 3 3-5 3 5 3-5 3 5 3-3v8z",
  hundred: "M5 8v8M9 8h3v8H9zM15 8h3v8h-3z",
  coins: "M12 7c4 0 7-1.3 7-3s-3-3-7-3-7 1.3-7 3 3 3 7 3zM5 4v5c0 1.7 3 3 7 3s7-1.3 7-3V4M5 9v5c0 1.7 3 3 7 3s7-1.3 7-3V9",
  target: "M12 21a9 9 0 1 0 0-18 9 9 0 0 0 0 18zM12 16a4 4 0 1 0 0-8 4 4 0 0 0 0 8zM12 12h.01",
  letters: "M4 18l4-12 4 12M5.5 14h5M14 6h4a3 3 0 0 1 0 6h-4zM14 12h5a3 3 0 0 1 0 6h-5z",
  undo: "M9 14L4 9l5-5M4 9h11a5 5 0 0 1 0 10h-4",
  calendar: "M5 5h14v15H5zM5 10h14M9 3v4M15 3v4",
  blood: "M12 3s6 6.5 6 11a6 6 0 0 1-12 0c0-4.5 6-11 6-11z",
  sound: "M5 10v4h4l5 4V6l-5 4H5zM17 9a4 4 0 0 1 0 6M19.5 6.5a8 8 0 0 1 0 11",
  mute: "M5 10v4h4l5 4V6l-5 4H5zM17 9l5 6M22 9l-5 6",
  chart: "M4 20V10M10 20V4M16 20v-7M22 20H2",
  eye: "M2 12s3.5-7 10-7 10 7 10 7-3.5 7-10 7S2 12 2 12zM12 15a3 3 0 1 0 0-6 3 3 0 0 0 0 6z",
  shuffle: "M3 7h4l10 10h4M3 17h4l3-3M14 10l3-3h4M18 4l3 3-3 3M18 14l3 3-3 3",
  refresh: "M20 11a8 8 0 1 0-2.3 5.7M20 4v7h-7",
  trophy: "M8 21h8M12 17v4M7 4h10v5a5 5 0 0 1-10 0zM17 5h3v2a3 3 0 0 1-3 3M7 5H4v2a3 3 0 0 0 3 3",
  lock: "M6 11h12v9H6zM8.5 11V8a3.5 3.5 0 0 1 7 0v3",
  sparkle: "M12 3v4M12 17v4M3 12h4M17 12h4M6 6l2.5 2.5M15.5 15.5L18 18M6 18l2.5-2.5M15.5 8.5L18 6",
  play: "M8 5v14l11-7z",
} as const;

export type IconName = keyof typeof paths;

export function Icon({ name, size = 18, strokeWidth = 1.8, ...rest }: { name: IconName; size?: number; strokeWidth?: number } & SVGProps<SVGSVGElement>) {
  return (
    <svg
      width={size}
      height={size}
      viewBox="0 0 24 24"
      fill="none"
      stroke="currentColor"
      strokeWidth={strokeWidth}
      strokeLinecap="round"
      strokeLinejoin="round"
      aria-hidden
      {...rest}
    >
      <path d={paths[name]} />
    </svg>
  );
}
