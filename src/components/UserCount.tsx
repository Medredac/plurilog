'use client';

import { useEffect, useRef } from 'react';
import { animate, motion, useInView, useMotionValue, useReducedMotion, useTransform } from 'motion/react';

export function UserCount() {
  const ref = useRef<HTMLParagraphElement>(null);
  const visible = useInView(ref, { once: true });
  const reduceMotion = useReducedMotion();
  const count = useMotionValue(200);
  const rounded = useTransform(count, value => Math.round(value));

  useEffect(() => {
    if (!visible || reduceMotion) return;
    const animation = animate(0, 200, {
      duration: 0.9,
      ease: 'easeOut',
      onUpdate: value => count.set(value),
    });
    return () => animation.stop();
  }, [visible, reduceMotion, count]);

  return (
    <p ref={ref} className="mt-4 text-xs text-zinc-500" aria-label="Join 200+ users">
      <span aria-hidden="true">
        Join <span className="inline-block min-w-[3ch] text-right tabular-nums">{reduceMotion ? '200' : <motion.span>{rounded}</motion.span>}</span>+ users
      </span>
    </p>
  );
}
