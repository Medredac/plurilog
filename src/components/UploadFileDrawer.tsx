'use client';

import React, { useEffect, useRef } from 'react';
import { Camera, Image as ImageIcon, Upload } from 'lucide-react';

interface UploadFileDrawerProps {
  isOpen: boolean;
  onClose: () => void;
  triggerRef?: React.RefObject<HTMLButtonElement | null>;
  onTakePhotoClick: () => void;
  onUploadImageClick: () => void;
  onUploadFileClick: () => void;
}

export const UploadFileDrawer: React.FC<UploadFileDrawerProps> = ({
  isOpen,
  onClose,
  triggerRef,
  onTakePhotoClick,
  onUploadImageClick,
  onUploadFileClick,
}) => {
  const menuRef = useRef<HTMLDivElement>(null);

  // Close popover when clicking outside
  useEffect(() => {
    if (!isOpen) return;

    const handleClickOutside = (event: MouseEvent | PointerEvent) => {
      if (
        menuRef.current &&
        !menuRef.current.contains(event.target as Node) &&
        (!triggerRef?.current || !triggerRef.current.contains(event.target as Node))
      ) {
        onClose();
      }
    };

    document.addEventListener('pointerdown', handleClickOutside);
    return () => {
      document.removeEventListener('pointerdown', handleClickOutside);
    };
  }, [isOpen, onClose, triggerRef]);

  return (
    <div
      ref={menuRef}
      aria-hidden={!isOpen}
      className={`absolute bottom-full left-0 mb-2 w-44 max-h-[calc(100dvh-5rem)] overflow-y-auto bg-white rounded-xl border border-zinc-200/90 shadow-lg p-1.5 z-50 space-y-0.5 origin-bottom-left transition-all duration-150 ease-out ${
        isOpen
          ? 'opacity-100 scale-100 translate-y-0 pointer-events-auto'
          : 'opacity-0 scale-95 translate-y-1 pointer-events-none'
      }`}
    >
      <button
        type="button"
        tabIndex={isOpen ? 0 : -1}
        onClick={() => {
          onTakePhotoClick();
          onClose();
        }}
        className="w-full flex lg:hidden items-center gap-2.5 px-3 py-2 rounded-lg hover:bg-zinc-50 active:bg-zinc-100 text-zinc-600 hover:text-zinc-800 transition-colors cursor-pointer text-left text-sm target-secondary"
      >
        <Camera className="w-4 h-4 text-zinc-400 shrink-0" />
        <span className="font-normal">Take photo</span>
      </button>

      <button
        type="button"
        tabIndex={isOpen ? 0 : -1}
        onClick={() => {
          onUploadImageClick();
          onClose();
        }}
        className="w-full flex items-center gap-2.5 px-3 py-2 rounded-lg hover:bg-zinc-50 active:bg-zinc-100 text-zinc-600 hover:text-zinc-800 transition-colors cursor-pointer text-left text-sm target-secondary"
      >
        <ImageIcon className="w-4 h-4 text-zinc-400 shrink-0" />
        <span className="font-normal">Upload Image</span>
      </button>

      <button
        type="button"
        tabIndex={isOpen ? 0 : -1}
        onClick={() => {
          onUploadFileClick();
          onClose();
        }}
        className="w-full flex items-center gap-2.5 px-3 py-2 rounded-lg hover:bg-zinc-50 active:bg-zinc-100 text-zinc-600 hover:text-zinc-800 transition-colors cursor-pointer text-left text-sm target-secondary"
      >
        <Upload className="w-4 h-4 text-zinc-400 shrink-0" />
        <span className="font-normal">Upload file</span>
      </button>
    </div>
  );
};
