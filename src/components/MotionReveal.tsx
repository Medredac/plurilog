'use client';

import React from 'react';
import { motion, useReducedMotion } from 'motion/react';

interface MotionRevealProps {
  children: React.ReactNode;
  className?: string;
  delay?: number;
  as?: 'div' | 'section';
}

export function MotionReveal({
  children,
  className,
  delay = 0,
  as = 'div',
}: MotionRevealProps) {
  const shouldReduceMotion = useReducedMotion();

  const motionProps = {
    initial: {
      opacity: shouldReduceMotion ? 1 : 0,
      y: shouldReduceMotion ? 0 : 12,
      filter: shouldReduceMotion ? 'blur(0px)' : 'blur(4px)',
    },
    whileInView: {
      opacity: 1,
      y: 0,
      filter: 'blur(0px)',
    },
    viewport: {
      once: false,
      amount: 0.05,
      margin: '0px',
    },
    transition: {
      duration: shouldReduceMotion ? 0.15 : 0.32,
      delay: shouldReduceMotion ? 0 : delay,
      ease: [0.21, 0.47, 0.32, 0.98] as const,
    },
    className,
  };

  if (as === 'section') {
    return <motion.section {...motionProps}>{children}</motion.section>;
  }

  return <motion.div {...motionProps}>{children}</motion.div>;
}
