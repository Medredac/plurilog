'use client';

import React, { useState } from 'react';
import { Sparkles } from 'lucide-react';

interface OutOfCreditsModalProps {
  isOpen: boolean;
  onClose: () => void;
}

export const OutOfCreditsModal: React.FC<OutOfCreditsModalProps> = ({ isOpen, onClose }) => {
  const [isRedirecting, setIsRedirecting] = useState(false);

  const handleUpgrade = async () => {
    setIsRedirecting(true);
    try {
      const res = await fetch('/api/stripe/checkout', { method: 'POST' });
      const data = await res.json();
      if (data.url) {
        window.location.href = data.url;
      } else {
        console.error('[Upgrade] No checkout URL returned:', data);
        setIsRedirecting(false);
      }
    } catch (err) {
      console.error('[Upgrade] Failed to start checkout:', err);
      setIsRedirecting(false);
    }
  };

  if (!isOpen) return null;

  return (
    <div className="fixed inset-0 z-50 flex items-center justify-center p-4">
      <div 
        onClick={onClose} 
        className="fixed inset-0 bg-black/20 backdrop-blur-xs transition-opacity" 
      />
      <div className="relative w-full max-w-sm rounded-2xl bg-white border border-zinc-200/90 p-6 shadow-xl z-10 animate-in fade-in zoom-in-95 duration-150 text-center">
        <div className="w-12 h-12 rounded-full bg-amber-50 border border-amber-200/80 flex items-center justify-center mx-auto mb-4">
          <Sparkles className="w-5 h-5 text-amber-600" />
        </div>
        <h3 className="text-base font-semibold text-zinc-900 tracking-tight mb-2">
          You've used your free trial
        </h3>
        <p className="text-xs sm:text-sm text-zinc-500 leading-relaxed mb-6">
          Upgrade to Plus for $6/month to keep this conversation going — and every one after it.
        </p>
        <div className="flex flex-col gap-2.5">
          <button
            type="button"
            onClick={handleUpgrade}
            disabled={isRedirecting}
            className="w-full px-4 py-2.5 rounded-xl text-sm font-medium text-white bg-[#4880E6] hover:bg-[#3a6fd0] transition-colors cursor-pointer shadow-sm disabled:opacity-60"
          >
            {isRedirecting ? 'Redirecting…' : 'Upgrade to Plus'}
          </button>
          <button
            type="button"
            onClick={onClose}
            className="w-full px-4 py-2 rounded-xl text-xs font-medium text-zinc-500 hover:text-zinc-800 hover:bg-zinc-100 transition-colors cursor-pointer"
          >
            Maybe later
          </button>
        </div>
      </div>
    </div>
  );
};
