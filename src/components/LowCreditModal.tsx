'use client';
import React, { useState, useEffect } from 'react';

interface LowCreditModalProps {
  isOpen: boolean;
  onClose: () => void;
}

export const LowCreditModal: React.FC<LowCreditModalProps> = ({ isOpen, onClose }) => {
  const [isRedirecting, setIsRedirecting] = useState(false);

  useEffect(() => {
    const handlePageShow = (event: PageTransitionEvent) => {
      if (event.persisted) setIsRedirecting(false);
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
        setIsRedirecting(false);
      }
    } catch {
      setIsRedirecting(false);
    }
  };

  if (!isOpen) return null;

  return (
    <div className="fixed inset-0 z-50 flex items-center justify-center p-4">
      <div onClick={onClose} className="fixed inset-0 bg-black/20 backdrop-blur-xs transition-opacity" />
      <div className="relative w-full max-w-sm rounded-2xl bg-white border border-zinc-200/90 p-5 shadow-xl z-10 animate-in fade-in zoom-in-95 duration-150">
        <p className="text-sm font-semibold text-zinc-900 mb-1">You've used almost all your free credit</p>
        <p className="text-xs text-zinc-500 leading-relaxed mb-4">
          Upgrade to Plus to keep going without interruption.
        </p>
        <div className="flex items-center justify-end gap-2.5">
          <button
            type="button"
            onClick={onClose}
            className="px-3.5 py-2 rounded-xl text-xs font-medium text-zinc-500 hover:text-zinc-800 hover:bg-zinc-100 transition-colors cursor-pointer"
          >
            Maybe later
          </button>
          <button
            type="button"
            onClick={handleUpgrade}
            disabled={isRedirecting}
            className="px-4 py-2 rounded-xl text-xs font-medium text-white bg-zinc-900 hover:bg-zinc-800 transition-colors cursor-pointer disabled:opacity-60"
          >
            {isRedirecting ? 'Redirecting…' : 'Upgrade'}
          </button>
        </div>
      </div>
    </div>
  );
};
