'use client';

import React, { useEffect, useRef } from 'react';
import { Upload } from 'lucide-react';

interface UploadFileDrawerProps {
  isOpen: boolean;
  onClose: () => void;
  triggerRef?: React.RefObject<HTMLButtonElement | null>;
  onUploadClick: () => void;
}

export const UploadFileDrawer: React.FC<UploadFileDrawerProps> = ({
  isOpen,
  onClose,
  triggerRef,
  onUploadClick,
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

  const handleClick = () => {
    onUploadClick();
    onClose();
  };

  return (
    <div
      ref={menuRef}
      className="absolute bottom-full left-0 mb-2 w-40 bg-white rounded-xl border border-zinc-200/90 shadow-lg p-1.5 z-50 animate-in fade-in zoom-in-95 duration-100"
    >
      <button
        type="button"
        onClick={handleClick}
        className="w-full flex items-center gap-2.5 px-2.5 py-2 rounded-lg hover:bg-zinc-50 text-zinc-600 hover:text-zinc-800 transition-colors cursor-pointer text-left text-sm"
      >
        <Upload className="w-4 h-4 text-zinc-400" />
        <span className="font-normal">Upload file</span>
      </button>
    </div>
  );
};
