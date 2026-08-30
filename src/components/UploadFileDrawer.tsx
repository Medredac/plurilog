'use client';

import React, { useEffect, useRef } from 'react';
import { Image as ImageIcon, FileText, FileCode } from 'lucide-react';

interface UploadFileDrawerProps {
  isOpen: boolean;
  onClose: () => void;
  triggerRef?: React.RefObject<HTMLButtonElement | null>;
}

export const UploadFileDrawer: React.FC<UploadFileDrawerProps> = ({
  isOpen,
  onClose,
  triggerRef,
}) => {
  const menuRef = useRef<HTMLDivElement>(null);

  // Close popover when clicking outside
  useEffect(() => {
    if (!isOpen) return;

    const handleClickOutside = (event: MouseEvent) => {
      if (
        menuRef.current &&
        !menuRef.current.contains(event.target as Node) &&
        (!triggerRef?.current || !triggerRef.current.contains(event.target as Node))
      ) {
        onClose();
      }
    };

    document.addEventListener('mousedown', handleClickOutside);
    return () => {
      document.removeEventListener('mousedown', handleClickOutside);
    };
  }, [isOpen, onClose, triggerRef]);

  if (!isOpen) return null;

  return (
    <div
      ref={menuRef}
      className="absolute bottom-full left-0 mb-2 w-44 bg-white rounded-xl border border-zinc-200/90 shadow-lg p-1.5 z-50 animate-in fade-in zoom-in-95 duration-100"
    >
      {/* Header */}
      <div className="px-2.5 py-2 border-b border-zinc-100 mb-1">
        <p className="text-sm font-medium text-zinc-700">Upload file</p>
      </div>

      {/* Menu Items */}
      <div className="space-y-0.5 text-sm text-zinc-600">
        <button
          type="button"
          className="w-full flex items-center gap-2.5 px-2.5 py-2 rounded-lg hover:bg-zinc-50 text-zinc-600 hover:text-zinc-800 transition-colors cursor-pointer text-left"
        >
          <ImageIcon className="w-4 h-4 text-zinc-400" />
          <span className="font-normal">Image</span>
        </button>

        <button
          type="button"
          className="w-full flex items-center gap-2.5 px-2.5 py-2 rounded-lg hover:bg-zinc-50 text-zinc-600 hover:text-zinc-800 transition-colors cursor-pointer text-left"
        >
          <FileText className="w-4 h-4 text-zinc-400" />
          <span className="font-normal">PDF</span>
        </button>

        <button
          type="button"
          disabled
          className="w-full flex items-center gap-2.5 px-2.5 py-2 rounded-lg text-zinc-300 cursor-not-allowed text-left opacity-50 select-none"
        >
          <FileCode className="w-4 h-4 text-zinc-300" />
          <span className="font-normal">Word Doc</span>
        </button>
      </div>
    </div>
  );
};
