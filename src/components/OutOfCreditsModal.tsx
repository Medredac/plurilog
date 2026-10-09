'use client';

import React, { useEffect, useState } from 'react';
import { usePlusOffer } from '@/hooks/usePlusOffer';
import { Check, X } from 'lucide-react';

interface OutOfCreditsModalProps {
  isOpen: boolean;
  onClose: () => void;
  variant?: 'out' | 'low';
}

const PLAN_FEATURES = [
  'Everything in Free',
  'Monthly usage refreshed every billing cycle',
  'ChatGPT, Claude and Gemini available',
  'Shared memory, files and retrieval',
  'Cancel anytime',
];

const RobotHeads = () => (
  <div
    className="pointer-events-none absolute -top-[23px] right-4 flex items-end -space-x-2.5"
    aria-hidden="true"
  >
    <img src="/robot-head-claude@3x.png" alt="" className="h-[35px] w-[33px] object-contain" />
    <img src="/robot-head-chatgpt@3x.png" alt="" className="h-[35px] w-[33px] object-contain" />
    <img src="/robot-head-gemini@3x.png" alt="" className="h-[35px] w-[33px] object-contain" />
  </div>
);

export const OutOfCreditsModal: React.FC<OutOfCreditsModalProps> = ({
  isOpen,
  onClose,
  variant = 'out',
}) => {
  const { offer, error: offerError } = usePlusOffer(isOpen);
  const [checkoutError, setCheckoutError] = useState<string | null>(null);
  const [isRedirecting, setIsRedirecting] = useState(false);

  useEffect(() => {
    if (isOpen) setIsRedirecting(false);
  }, [isOpen]);

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
      setCheckoutError(null);
      const res = await fetch('/api/stripe/checkout', { method: 'POST' });
      const data = await res.json();
      if (res.ok && data.url) {
        window.location.href = data.url;
      } else {
        setCheckoutError(data.error || 'Unable to start checkout. Please try again.');
        console.error('[Upgrade] No checkout URL returned:', data);
        setIsRedirecting(false);
      }
    } catch (err) {
      setCheckoutError('Unable to start checkout. Please try again.');
      console.error('[Upgrade] Failed to start checkout:', err);
      setIsRedirecting(false);
    }
  };

  if (!isOpen) return null;

  return (
    <div className="fixed inset-0 z-50 flex items-center justify-center p-3 sm:p-4">
      <button
        type="button"
        onClick={onClose}
        className="fixed inset-0 cursor-default bg-[rgba(28,27,26,0.26)] backdrop-blur-[1px]"
        aria-label="Close upgrade prompt"
      />

      <div className="relative z-10 flex max-h-[calc(100dvh-1.5rem)] w-full max-w-[420px] flex-col overflow-hidden rounded-[18px] border border-[#E2E0DB] bg-white dashboard-menu-shadow animate-in fade-in zoom-in-95 duration-150">
        <div className="flex items-start justify-between gap-4 px-5 pb-3 pt-4 sm:px-6 sm:pt-5">
          <div className="min-w-0">
            <div className="mb-2 flex items-center gap-2">
              <img src="/logo.svg" alt="" className="h-[22px] w-[22px] shrink-0 object-contain" />
              <span className="text-[11px] font-medium text-[#6A675F]">
                {variant === 'low'
                  ? 'You’ve used almost all your free credit'
                  : 'You’ve used all your free credit'}
              </span>
            </div>
            <h3 className="text-[22px] font-semibold tracking-[-0.02em] text-[#1C1B1A]">
              Keep the conversation going
            </h3>
            <p className="mt-1 text-[12px] leading-5 text-[#6A675F]">
              Upgrade to Plus for refreshed monthly usage and continued access to the full panel.
            </p>
          </div>

          <button
            type="button"
            onClick={onClose}
            className="flex h-9 w-9 shrink-0 cursor-pointer items-center justify-center rounded-[10px] text-[#8A867D] transition-colors hover:bg-[#F4F3F0] hover:text-[#1C1B1A]"
            title="Close"
            aria-label="Close"
          >
            <X className="h-3.5 w-3.5" />
          </button>
        </div>

        <div className="min-h-0 flex-1 overflow-y-auto px-5 pb-5 pt-3 sm:px-6 sm:pb-6">
          <div className="relative mt-3 rounded-[16px] border border-[#8A867D] bg-white px-5 pb-4 pt-5">
            <RobotHeads />

            <div className="mb-2 flex items-center gap-2">
              <h4 className="text-[14px] font-semibold text-[#1C1B1A]">Plus</h4>
              <span className="rounded-full bg-[#F6D3C9] px-2 py-0.5 text-[9px] font-medium text-[#1C1B1A]">
                {offer?.label || 'Plus'}
              </span>
            </div>

            <div className="mb-1 flex items-end gap-1.5">
              <span className="text-[29px] font-semibold leading-none tracking-[-0.03em] text-[#1C1B1A]">
                {offer?.amount != null ? `$${offer.amount}` : '…'}
              </span>
              <span className="pb-0.5 text-[11px] text-[#6A675F]">/ month</span>
            </div>

            <p className="mb-4 text-[12px] leading-5 text-[#6A675F]">
              {offer?.terms || (offerError ? 'Pricing unavailable.' : 'Loading your price…')}
            </p>

            {(offerError || checkoutError) && (
              <p role="alert" className="mb-3 text-[12px] text-red-700">{offerError || checkoutError}</p>
            )}
            <ul className="space-y-2.5 text-[12px] leading-5 text-[#1C1B1A]">
              {PLAN_FEATURES.map((feature) => (
                <li key={feature} className="flex items-start gap-2">
                  <span className="mt-[2px] inline-flex h-4 w-4 shrink-0 items-center justify-center rounded-full bg-[#1C1B1A] text-white">
                    <Check className="h-2.5 w-2.5 stroke-[2.5]" />
                  </span>
                  <span>{feature}</span>
                </li>
              ))}
            </ul>

            <button
              type="button"
              onClick={handleUpgrade}
              disabled={isRedirecting || !offer?.canSubscribe}
              className="mt-5 flex h-11 w-full cursor-pointer items-center justify-center rounded-[10px] bg-[#1C1B1A] px-4 text-[12px] font-medium text-white transition-colors hover:bg-[#2A2927] disabled:cursor-not-allowed disabled:opacity-60"
            >
              {isRedirecting ? 'Redirecting…' : 'Get Plus'}
            </button>
          </div>

          <button
            type="button"
            onClick={onClose}
            className="mt-3 flex h-10 w-full cursor-pointer items-center justify-center rounded-[10px] text-[11px] font-medium text-[#6A675F] transition-colors hover:bg-[#F4F3F0] hover:text-[#1C1B1A]"
          >
            Maybe later
          </button>
        </div>
      </div>
    </div>
  );
};
