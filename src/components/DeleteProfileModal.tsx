'use client';

import React, { useState, useEffect } from 'react';
import { AlertCircle, Loader2 } from 'lucide-react';

interface DeleteProfileModalProps {
  isOpen: boolean;
  onClose: () => void;
  onDeletionComplete: () => void;
}

type ModalStep = 'confirm' | 'active_plus' | 'canceling_plus';

export const DeleteProfileModal: React.FC<DeleteProfileModalProps> = ({
  isOpen,
  onClose,
  onDeletionComplete,
}) => {
  const [step, setStep] = useState<ModalStep>('confirm');
  const [isLoading, setIsLoading] = useState(false);
  const [isRedirectingPortal, setIsRedirectingPortal] = useState(false);
  const [errorMessage, setErrorMessage] = useState<string | null>(null);
  const [currentPeriodEnd, setCurrentPeriodEnd] = useState<string | null>(null);

  // Reset state on open
  useEffect(() => {
    if (isOpen) {
      setStep('confirm');
      setIsLoading(false);
      setIsRedirectingPortal(false);
      setErrorMessage(null);
      setCurrentPeriodEnd(null);
    }
  }, [isOpen]);

  // Handle ESC key press (only if not currently deleting)
  useEffect(() => {
    const handleKeyDown = (e: KeyboardEvent) => {
      if (e.key === 'Escape' && isOpen && !isLoading && !isRedirectingPortal) {
        onClose();
      }
    };
    window.addEventListener('keydown', handleKeyDown);
    return () => window.removeEventListener('keydown', handleKeyDown);
  }, [isOpen, isLoading, isRedirectingPortal, onClose]);

  if (!isOpen) return null;

  const formatDate = (isoDate: string | null) => {
    if (!isoDate) return null;
    try {
      return new Date(isoDate).toLocaleDateString('en-US', {
        month: 'short',
        day: 'numeric',
        year: 'numeric',
      });
    } catch {
      return null;
    }
  };

  const handleInitialDelete = async () => {
    setIsLoading(true);
    setErrorMessage(null);

    try {
      const res = await fetch('/api/user/delete', {
        method: 'POST',
        headers: { 'Content-Type': 'application/json' },
        body: JSON.stringify({}),
      });

      const data = await res.json();

      if (!res.ok && !data.code) {
        setErrorMessage(data.message || 'Failed to process request. Please try again.');
        setIsLoading(false);
        return;
      }

      if (data.code === 'active_subscription_must_be_canceled') {
        setIsLoading(false);
        setStep('active_plus');
        return;
      }

      if (data.code === 'canceling_subscription_confirmation_required') {
        setCurrentPeriodEnd(data.currentPeriodEnd || null);
        setIsLoading(false);
        setStep('canceling_plus');
        return;
      }

      if (data.success) {
        onDeletionComplete();
        return;
      }

      setErrorMessage('Failed to delete account. Please try again.');
      setIsLoading(false);
    } catch (err) {
      console.error('[Delete Profile] Request failed:', err);
      setErrorMessage('Network error. Please check your connection and try again.');
      setIsLoading(false);
    }
  };

  const handleConfirmCancelingDelete = async () => {
    setIsLoading(true);
    setErrorMessage(null);

    try {
      const res = await fetch('/api/user/delete', {
        method: 'POST',
        headers: { 'Content-Type': 'application/json' },
        body: JSON.stringify({ confirmCanceling: true }),
      });

      const data = await res.json();

      if (!res.ok && !data.code) {
        setErrorMessage(data.message || 'Failed to process request. Please try again.');
        setIsLoading(false);
        return;
      }

      if (data.code === 'active_subscription_must_be_canceled') {
        setIsLoading(false);
        setStep('active_plus');
        return;
      }

      if (data.success) {
        onDeletionComplete();
        return;
      }

      setErrorMessage('Failed to delete account. Please try again.');
      setIsLoading(false);
    } catch (err) {
      console.error('[Delete Profile] Confirm canceling failed:', err);
      setErrorMessage('Network error. Please check your connection and try again.');
      setIsLoading(false);
    }
  };

  const handleManagePortal = async () => {
    setIsRedirectingPortal(true);
    setErrorMessage(null);
    try {
      const res = await fetch('/api/stripe/portal', { method: 'POST' });
      const data = await res.json();
      if (data.url) {
        window.location.href = data.url;
      } else {
        setErrorMessage('Unable to open subscription management. Please try again.');
        setIsRedirectingPortal(false);
      }
    } catch (err) {
      console.error('[Portal] Failed to open billing portal:', err);
      setErrorMessage('Unable to open subscription management. Please try again.');
      setIsRedirectingPortal(false);
    }
  };

  const formattedPeriodEnd = formatDate(currentPeriodEnd);

  return (
    <div className="fixed inset-0 z-50 flex items-center justify-center p-4">
      {/* Backdrop */}
      <div
        onClick={() => {
          if (!isLoading && !isRedirectingPortal) {
            onClose();
          }
        }}
        className="fixed inset-0 bg-black/20 backdrop-blur-xs transition-opacity"
      />

      {/* Modal Dialog */}
      <div className="relative w-full max-w-sm rounded-2xl bg-white border border-zinc-200/90 p-5 sm:p-6 shadow-xl z-10 animate-in fade-in zoom-in-95 duration-150 max-h-[calc(100dvh-2rem)] overflow-y-auto flex flex-col">
        {errorMessage && (
          <div className="p-3 mb-4 rounded-xl bg-red-50 border border-red-200/80 text-red-800 text-xs flex items-start gap-2 shadow-2xs">
            <AlertCircle className="w-4 h-4 text-red-600 shrink-0 mt-0.5" />
            <p className="leading-relaxed break-words">{errorMessage}</p>
          </div>
        )}

        {/* STEP 1: INITIAL CONFIRMATION */}
        {step === 'confirm' && (
          <>
            <h3 className="text-base font-semibold text-zinc-900 tracking-tight mb-2">
              Delete profile?
            </h3>
            <p className="text-xs sm:text-sm text-zinc-500 leading-relaxed mb-5">
              Permanently deleting your profile will remove your conversations, uploaded files and images, documents, memory, and account data. This cannot be undone.
            </p>
            <div className="flex items-center justify-end gap-2.5">
              <button
                type="button"
                onClick={onClose}
                disabled={isLoading}
                className="px-3.5 py-2.5 rounded-xl text-xs font-medium text-zinc-600 hover:text-zinc-900 active:bg-zinc-100 transition-colors cursor-pointer border border-zinc-200/80 flex items-center target-secondary disabled:opacity-50"
              >
                Cancel
              </button>
              <button
                type="button"
                onClick={handleInitialDelete}
                disabled={isLoading}
                className="px-4 py-2.5 rounded-xl text-xs font-medium text-white bg-red-600 hover:bg-red-700 active:bg-red-800 transition-colors cursor-pointer shadow-2xs flex items-center gap-1.5 target-secondary disabled:opacity-50"
              >
                {isLoading && <Loader2 className="w-3.5 h-3.5 animate-spin" />}
                <span>{isLoading ? 'Checking…' : 'Delete profile'}</span>
              </button>
            </div>
          </>
        )}

        {/* STEP 2A: ACTIVE / PAST_DUE PLUS SUBSCRIPTION BLOCKED */}
        {step === 'active_plus' && (
          <>
            <h3 className="text-base font-semibold text-zinc-900 tracking-tight mb-2">
              Active Plus subscription
            </h3>
            <p className="text-xs sm:text-sm text-zinc-500 leading-relaxed mb-5">
              You have an active Plus subscription. Please cancel your subscription first, then come back to delete your profile.
            </p>
            <div className="flex items-center justify-end gap-2.5">
              <button
                type="button"
                onClick={onClose}
                disabled={isRedirectingPortal}
                className="px-3.5 py-2.5 rounded-xl text-xs font-medium text-zinc-600 hover:text-zinc-900 active:bg-zinc-100 transition-colors cursor-pointer border border-zinc-200/80 flex items-center target-secondary disabled:opacity-50"
              >
                Cancel
              </button>
              <button
                type="button"
                onClick={handleManagePortal}
                disabled={isRedirectingPortal}
                className="px-4 py-2.5 rounded-xl text-xs font-medium text-white bg-zinc-900 hover:bg-zinc-800 active:bg-zinc-700 transition-colors cursor-pointer shadow-2xs flex items-center gap-1.5 target-secondary disabled:opacity-50"
              >
                {isRedirectingPortal && <Loader2 className="w-3.5 h-3.5 animate-spin" />}
                <span>{isRedirectingPortal ? 'Redirecting…' : 'Update subscription'}</span>
              </button>
            </div>
          </>
        )}

        {/* STEP 2B: CANCELING PLUS WARNING */}
        {step === 'canceling_plus' && (
          <>
            <h3 className="text-base font-semibold text-zinc-900 tracking-tight mb-2">
              Delete profile now?
            </h3>
            <p className="text-xs sm:text-sm text-zinc-500 leading-relaxed mb-5">
              {formattedPeriodEnd
                ? `Your current Plus subscription expires on ${formattedPeriodEnd}. If you delete your profile now, you will lose access immediately. This cannot be undone.`
                : 'Your Plus subscription is scheduled to end at the end of the current billing period. If you delete your profile now, you will lose access immediately. This cannot be undone.'}
            </p>
            <div className="flex items-center justify-end gap-2.5">
              <button
                type="button"
                onClick={onClose}
                disabled={isLoading}
                className="px-3.5 py-2.5 rounded-xl text-xs font-medium text-zinc-600 hover:text-zinc-900 active:bg-zinc-100 transition-colors cursor-pointer border border-zinc-200/80 flex items-center target-secondary disabled:opacity-50"
              >
                Cancel
              </button>
              <button
                type="button"
                onClick={handleConfirmCancelingDelete}
                disabled={isLoading}
                className="px-4 py-2.5 rounded-xl text-xs font-medium text-white bg-red-600 hover:bg-red-700 active:bg-red-800 transition-colors cursor-pointer shadow-2xs flex items-center gap-1.5 target-secondary disabled:opacity-50"
              >
                {isLoading && <Loader2 className="w-3.5 h-3.5 animate-spin" />}
                <span>{isLoading ? 'Deleting…' : 'Delete profile anyway'}</span>
              </button>
            </div>
          </>
        )}
      </div>
    </div>
  );
};
