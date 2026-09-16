'use client';

import React, { useEffect, useRef } from 'react';
import { motion, AnimatePresence, useReducedMotion, type Variants } from 'motion/react';
import { X } from 'lucide-react';

interface DemoVideoModalProps {
  isOpen: boolean;
  onClose: () => void;
}

const backdropVariants: Variants = {
  initial: { opacity: 0 },
  animate: {
    opacity: 1,
    transition: { duration: 0.2, ease: 'easeOut' },
  },
  exit: {
    opacity: 0,
    transition: { duration: 0.17, ease: 'easeIn' },
  },
};

const cardVariants: Variants = {
  initial: (reduce: boolean | null) => ({
    opacity: 0,
    scale: reduce ? 1 : 0.96,
    y: reduce ? 0 : 12,
  }),
  animate: (reduce: boolean | null) => ({
    opacity: 1,
    scale: 1,
    y: 0,
    transition: {
      duration: reduce ? 0.1 : 0.22,
      ease: [0.16, 1, 0.3, 1] as const,
    },
  }),
  exit: (reduce: boolean | null) => ({
    opacity: 0,
    scale: reduce ? 1 : 0.97,
    y: reduce ? 0 : 8,
    transition: {
      duration: reduce ? 0.1 : 0.16,
      ease: [0.4, 0, 0.2, 1] as const,
    },
  }),
};

export const DemoVideoModal: React.FC<DemoVideoModalProps> = ({ isOpen, onClose }) => {
  const shouldReduceMotion = useReducedMotion();
  const videoRef = useRef<HTMLVideoElement>(null);

  const handleClose = () => {
    if (videoRef.current) {
      videoRef.current.pause();
    }
    onClose();
  };

  // Pause playback immediately when isOpen becomes false
  useEffect(() => {
    if (!isOpen && videoRef.current) {
      videoRef.current.pause();
    }
  }, [isOpen]);

  // Close on Escape key press
  useEffect(() => {
    const handleKeyDown = (e: KeyboardEvent) => {
      if (e.key === 'Escape' && isOpen) {
        handleClose();
      }
    };
    if (isOpen) {
      window.addEventListener('keydown', handleKeyDown);
    }
    return () => window.removeEventListener('keydown', handleKeyDown);
  }, [isOpen]);

  return (
    <AnimatePresence>
      {isOpen && (
        <div className="fixed inset-0 z-50 flex items-center justify-center p-3 sm:p-6 md:p-10">
          {/* Dark Translucent Backdrop */}
          <motion.div
            variants={backdropVariants}
            initial="initial"
            animate="animate"
            exit="exit"
            onClick={handleClose}
            className="fixed inset-0 bg-black/80 backdrop-blur-sm cursor-pointer"
            aria-hidden="true"
          />

          {/* Modal Container */}
          <motion.div
            custom={shouldReduceMotion}
            variants={cardVariants}
            initial="initial"
            animate="animate"
            exit="exit"
            className="relative w-full max-w-5xl max-h-[calc(100dvh-4.5rem)] z-10 flex flex-col items-center justify-center"
          >
            {/* Close Button */}
            <button
              type="button"
              onClick={handleClose}
              className="absolute -top-11 right-0 sm:-right-2 p-2 rounded-full text-zinc-300 hover:text-white bg-black/50 hover:bg-black/75 transition-colors cursor-pointer flex items-center justify-center focus:outline-none focus-visible:ring-2 focus-visible:ring-white/60"
              aria-label="Close demo video"
            >
              <X className="w-5 h-5" />
            </button>

            {/* Video Wrapper */}
            <div className="w-full max-h-[calc(100dvh-4.5rem)] rounded-2xl sm:rounded-3xl overflow-hidden shadow-2xl bg-black flex items-center justify-center">
              <video
                ref={videoRef}
                src="/plurivid3.mp4"
                controls
                playsInline
                preload="metadata"
                className="w-full h-auto max-h-[calc(100dvh-4.5rem)] aspect-video object-contain rounded-2xl sm:rounded-3xl block"
              />
            </div>
          </motion.div>
        </div>
      )}
    </AnimatePresence>
  );
};
