'use client';

import React from 'react';
import { X, Image as ImageIcon, FileText, FileCode } from 'lucide-react';

interface UploadFileDrawerProps {
  isOpen: boolean;
  onClose: () => void;
}

export const UploadFileDrawer: React.FC<UploadFileDrawerProps> = ({ isOpen, onClose }) => {
  if (!isOpen) return null;

  return (
    <div className="fixed inset-0 z-50 flex items-end justify-center sm:p-4">
      {/* Backdrop */}
      <div
        onClick={onClose}
        className="fixed inset-0 bg-black/20 backdrop-blur-xs transition-opacity"
      />

      {/* Drawer Card */}
      <div className="relative w-full max-w-md rounded-t-2xl sm:rounded-2xl bg-white border border-zinc-200/90 p-5 pb-7 sm:pb-5 shadow-2xl z-10 animate-in slide-in-from-bottom duration-200">
        {/* Header */}
        <div className="flex items-center justify-between mb-4">
          <h3 className="text-sm font-semibold text-zinc-900">Upload file</h3>
          <button
            type="button"
            onClick={onClose}
            className="p-1 rounded-lg text-zinc-400 hover:text-zinc-700 hover:bg-zinc-100 transition-colors cursor-pointer"
            title="Close"
          >
            <X className="w-4 h-4" />
          </button>
        </div>

        {/* Options */}
        <div className="grid grid-cols-3 gap-2.5">
          <button
            type="button"
            className="flex flex-col items-center justify-center gap-2 p-3.5 rounded-xl border border-zinc-200/80 bg-zinc-50 hover:bg-zinc-100 text-zinc-800 text-xs font-medium transition-all cursor-pointer shadow-2xs"
          >
            <ImageIcon className="w-5 h-5 text-zinc-600" />
            <span>Image</span>
          </button>

          <button
            type="button"
            className="flex flex-col items-center justify-center gap-2 p-3.5 rounded-xl border border-zinc-200/80 bg-zinc-50 hover:bg-zinc-100 text-zinc-800 text-xs font-medium transition-all cursor-pointer shadow-2xs"
          >
            <FileText className="w-5 h-5 text-zinc-600" />
            <span>PDF</span>
          </button>

          <button
            type="button"
            disabled
            className="flex flex-col items-center justify-center gap-2 p-3.5 rounded-xl border border-zinc-200/50 bg-zinc-100/50 text-zinc-400 text-xs font-medium cursor-not-allowed opacity-50 select-none"
            title="Word Doc support coming soon"
          >
            <FileCode className="w-5 h-5 text-zinc-400" />
            <span>Word Doc</span>
          </button>
        </div>
      </div>
    </div>
  );
};
