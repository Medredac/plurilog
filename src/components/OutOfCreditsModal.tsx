'use client';
import React, { useState, useEffect } from 'react';
import { Check } from 'lucide-react';

interface OutOfCreditsModalProps {
  isOpen: boolean;
  onClose: () => void;
}

export const OutOfCreditsModal: React.FC<OutOfCreditsModalProps> = ({ isOpen, onClose }) => {
  const [isRedirecting, setIsRedirecting] = useState(false);

  useEffect(() => {
    const handlePageShow = (event: PageTransitionEvent) => {
      if (event.persisted) {
        setIsRedirecting(false);
      }
    };
    window.addEventListener('pageshow', handlePageShow);
    return () => window.removeEventListener('pageshow', handlePageShow);
  }, []);

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
      <div onClick={onClose} className="fixed inset-0 bg-black/20 backdrop-blur-xs transition-opacity" />
      <div className="relative w-full max-w-xs rounded-2xl bg-white border border-zinc-200/90 p-6 shadow-xl z-10 animate-in fade-in zoom-in-95 duration-150">
        <div className="flex items-center gap-2 mb-3">
          <img src="/logo.svg" alt="Plurilog" className="w-6 h-6" />
          <span className="text-xs font-medium text-zinc-500">You've used all your free credit</span>
        </div>
        <h3 className="text-2xl font-semibold text-zinc-900 tracking-tight mb-1.5">
          Upgrade to Plus
        </h3>
        <p className="text-sm text-zinc-500 leading-relaxed mb-5">
          To keep the conversation going.
        </p>
        <div className="bg-zinc-50 border border-zinc-200/80 rounded-xl p-4 mb-5 text-left">
          <div className="flex items-baseline gap-1 mb-0.5">
            <span className="text-2xl font-semibold text-zinc-900">$16</span>
            <span className="text-xs text-zinc-500">/ month</span>
          </div>
          <p className="text-[11px] text-zinc-400 mb-3">Plurilog Plus</p>
          <div className="space-y-2">
            <div className="flex items-start gap-2">
              <Check className="w-3.5 h-3.5 text-emerald-600 mt-0.5 shrink-0" />
              <span className="text-xs text-zinc-700">File upload</span>
            </div>
            <div className="flex items-start gap-2">
              <Check className="w-3.5 h-3.5 text-emerald-600 mt-0.5 shrink-0" />
              <span className="text-xs text-zinc-700">Image upload</span>
            </div>
            <div className="flex items-start gap-2">
              <Check className="w-3.5 h-3.5 text-emerald-600 mt-0.5 shrink-0" />
              <span className="text-xs text-zinc-700">More extensive use</span>
            </div>
          </div>
        </div>
        <div className="flex flex-col gap-2.5">
          <button
            type="button"
            onClick={handleUpgrade}
            disabled={isRedirecting}
            className="w-full px-4 py-2.5 rounded-xl text-sm font-medium text-white bg-zinc-900 hover:bg-zinc-800 transition-colors cursor-pointer shadow-sm disabled:opacity-60"
          >
            {isRedirecting ? 'Redirecting…' : 'Upgrade'}
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
