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
    <div className="fixed inset-0 z-50 flex items-center justify-center p-4 sm:p-6 animate-in fade-in duration-150">
      {/* Dark backdrop */}
      <div
        onClick={onClose}
        className="fixed inset-0 bg-black/75 backdrop-blur-sm transition-opacity cursor-pointer"
      />

      {/* Image Container */}
      <div className="relative max-w-4xl max-h-[90vh] z-10 flex flex-col items-center justify-center animate-in zoom-in-95 duration-150">
        {/* Close button */}
        <button
          type="button"
          onClick={onClose}
          className="absolute -top-11 right-0 p-1.5 rounded-full bg-zinc-900/80 text-zinc-300 hover:text-white hover:bg-zinc-800 transition-colors cursor-pointer border border-white/10 shadow-lg"
          title="Close preview"
        >
          <X className="w-5 h-5" />
        </button>

        {/* Displayed Image */}
        <img
          src={imageUrl}
          alt={altText}
          className="max-h-[85vh] max-w-full rounded-xl object-contain shadow-2xl border border-white/10 select-none"
        />
      </div>
    </div>
  );
};
