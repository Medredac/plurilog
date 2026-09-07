'use client';

import React, { useEffect } from 'react';
import { X } from 'lucide-react';

interface ImageLightboxProps {
  isOpen: boolean;
  onClose: () => void;
  imageUrl: string | null;
  altText?: string;
}

export const ImageLightbox: React.FC<ImageLightboxProps> = ({
  isOpen,
  onClose,
  imageUrl,
  altText = 'Expanded image preview',
}) => {
  // Close on Escape key press
  useEffect(() => {
    if (!isOpen) return;

    const handleKeyDown = (e: KeyboardEvent) => {
      if (e.key === 'Escape') {
        onClose();
      }
    };

    window.addEventListener('keydown', handleKeyDown);
    return () => window.removeEventListener('keydown', handleKeyDown);
  }, [isOpen, onClose]);

  if (!isOpen || !imageUrl) return null;

  return (
    <div className="fixed inset-0 z-50 flex items-center justify-center p-3 sm:p-6 animate-in fade-in duration-150">
      {/* Dark backdrop */}
      <div
        onClick={onClose}
        className="fixed inset-0 bg-black/80 backdrop-blur-sm transition-opacity cursor-pointer"
      />

      {/* Close button (Viewport-fixed with safe-area padding for mobile landscape safety) */}
      <button
        type="button"
        onClick={(e) => {
          e.stopPropagation();
          onClose();
        }}
        className="fixed top-[max(0.75rem,env(safe-area-inset-top))] right-[max(0.75rem,env(safe-area-inset-right))] lg:top-5 lg:right-5 z-20 p-2 lg:p-1.5 rounded-full bg-zinc-900/80 text-zinc-300 hover:text-white hover:bg-zinc-800 active:bg-zinc-700 transition-colors cursor-pointer border border-white/15 shadow-xl min-h-[40px] min-w-[40px] flex items-center justify-center"
        title="Close preview"
        aria-label="Close preview"
      >
        <X className="w-5 h-5" />
      </button>

      {/* Image Container */}
      <div className="relative max-w-4xl max-h-[85dvh] z-10 flex flex-col items-center justify-center animate-in zoom-in-95 duration-150">
        {/* Displayed Image */}
        <img
          src={imageUrl}
          alt={altText}
          className="max-h-[85dvh] max-w-full rounded-xl object-contain shadow-2xl border border-white/10 select-none"
        />
      </div>
    </div>
  );
};
