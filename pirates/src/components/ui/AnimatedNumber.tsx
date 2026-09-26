"use client";
import { motion, useSpring, useTransform } from "motion/react";
import { useEffect } from "react";

const defaultFormat = (n: number) => Math.round(n).toLocaleString("en-US");

/** A number that springs to its new value (score counters, ratings). */
export function AnimatedNumber({
  value,
  format = defaultFormat,
  className,
  from,
  stiffness = 120,
  damping = 24,
}: {
  value: number;
  format?: (n: number) => string;
  className?: string;
  /** Start here on mount instead of at `value` (count-up effect). */
  from?: number;
  stiffness?: number;
  damping?: number;
}) {
  const spring = useSpring(from ?? value, { stiffness, damping });
  const text = useTransform(spring, (v) => format(v));
  useEffect(() => {
    spring.set(value);
  }, [spring, value]);
  return <motion.span className={className}>{text}</motion.span>;
}
