'use client';
import React, { useState, useEffect } from 'react';
import { X, Check } from 'lucide-react';
import { createClient } from '@/utils/supabase/client';
import { ResetPasswordModal } from './ResetPasswordModal';

interface AccountSettingsModalProps {
  isOpen: boolean;
  onClose: () => void;
  displayName: string;
  userEmail?: string;
  userAvatarUrl?: string;
  userPlan: 'free' | 'paid';
  onNameUpdated?: (newName: string) => void;
  periodResetAt?: string | null;
  planStatus?: string | null;
}

export const AccountSettingsModal: React.FC<AccountSettingsModalProps> = ({
  isOpen,
  onClose,
  displayName,
  userEmail,
  userAvatarUrl,
  userPlan,
  onNameUpdated,
  periodResetAt,
  planStatus,
}) => {
  const [nameInput, setNameInput] = useState(displayName);
  const [isSavingName, setIsSavingName] = useState(false);
  const [isRedirectingCard, setIsRedirectingCard] = useState(false);
  const [isRedirectingPromo, setIsRedirectingPromo] = useState(false);
  const [isResetPasswordOpen, setIsResetPasswordOpen] = useState(false);
  const initial = displayName.charAt(0).toUpperCase();

  useEffect(() => {
    setNameInput(displayName);
  }, [displayName, isOpen]);

  useEffect(() => {
    if (isOpen) {
      setIsRedirectingCard(false);
      setIsRedirectingPromo(false);
    }
  }, [isOpen]);

  useEffect(() => {
    const handlePageShow = (event: PageTransitionEvent) => {
      if (event.persisted) {
        setIsRedirectingCard(false);
        setIsRedirectingPromo(false);
      }
    };
    window.addEventListener('pageshow', handlePageShow);
    return () => window.removeEventListener('pageshow', handlePageShow);
  }, []);

  const handleSaveName = async () => {
    const trimmed = nameInput.trim();
    if (!trimmed || trimmed === displayName) return;
    setIsSavingName(true);
    try {
      const supabase = createClient();
      const { error } = await supabase.auth.updateUser({ data: { display_name: trimmed } });
      if (!error) {
        onNameUpdated?.(trimmed);
      } else {
        console.error('[Account Settings] Failed to update name:', error);
      }
    } catch (err) {
      console.error('[Account Settings] Failed to update name:', err);
    } finally {
      setIsSavingName(false);
    }
  };

  const handleUpgrade = async (setLoading: (v: boolean) => void) => {
    setLoading(true);
    try {
      const res = await fetch('/api/stripe/checkout', { method: 'POST' });
      const data = await res.json();
      if (data.url) {
        window.location.href = data.url;
      } else {
        setLoading(false);
      }
    } catch {
      setLoading(false);
    }
  };

  const handleManagePortal = async () => {
    setIsRedirectingCard(true);
    const portalWindow = window.open('', '_blank');
    if (portalWindow) {
      portalWindow.opener = null;
    }

    try {
      const res = await fetch('/api/stripe/portal', { method: 'POST' });
      const data = await res.json();
      if (data.url) {
        if (portalWindow) {
          portalWindow.location.href = data.url;
        } else {
          window.location.href = data.url;
        }
      } else {
        console.error('[Portal] No portal URL returned:', data);
        portalWindow?.close();
      }
    } catch (err) {
      console.error('[Portal] Failed to open portal:', err);
      portalWindow?.close();
    } finally {
      setIsRedirectingCard(false);
    }
  };

  if (!isOpen) return null;

  return (
    <div className="fixed inset-0 z-50 flex items-center justify-center p-4">
      <div onClick={onClose} className="fixed inset-0 bg-black/20 backdrop-blur-xs transition-opacity" />
      {/* Modal Card */}
      <div className="relative w-full max-w-md rounded-2xl bg-white border border-zinc-200/90 shadow-xl z-10 animate-in fade-in zoom-in-95 duration-150 overflow-hidden max-h-[calc(100dvh-2rem)] flex flex-col">
        <div className="flex items-center justify-between px-6 py-4 border-b border-zinc-100 shrink-0">
          <h3 className="text-base font-semibold text-zinc-900 tracking-tight">Account settings</h3>
          <button
            onClick={onClose}
            className="p-2 rounded-lg text-zinc-400 hover:text-zinc-700 active:bg-zinc-100 transition-colors cursor-pointer flex items-center justify-center target-primary"
            title="Close modal"
            aria-label="Close modal"
          >
            <X className="w-4 h-4" />
          </button>
        </div>

        <div className="p-6 max-w-sm mx-auto w-full overflow-y-auto min-h-0 flex-1">
          {/* Profile block */}
          <div className="flex items-center gap-3 mb-6">
            <div className="w-12 h-12 rounded-full bg-amber-50/80 text-amber-900 flex items-center justify-center font-semibold text-base border border-amber-200/80 shrink-0 overflow-hidden">
              {userAvatarUrl ? (
                <img src={userAvatarUrl} alt={displayName} className="w-full h-full object-cover" />
              ) : (
                initial
              )}
            </div>
            <div className="min-w-0 flex-1">
              <div className="flex items-center gap-2">
                <input
                  type="text"
                  value={nameInput}
                  onChange={(e) => setNameInput(e.target.value)}
                  className="text-sm touch-input-safe font-medium text-zinc-900 bg-transparent border-b border-transparent hover:border-zinc-200 focus:border-zinc-400 focus:outline-none py-0.5 w-full transition-colors"
                />
                {nameInput.trim() && nameInput.trim() !== displayName && (
                  <button
                    type="button"
                    onClick={handleSaveName}
                    disabled={isSavingName}
                    className="text-xs font-medium text-zinc-900 underline hover:no-underline cursor-pointer shrink-0 target-secondary"
                  >
                    {isSavingName ? 'Saving…' : 'Save'}
                  </button>
                )}
              </div>
              <p className="text-xs text-zinc-500 truncate mt-0.5">{userEmail}</p>
            </div>
          </div>
          <button
            type="button"
            onClick={() => setIsResetPasswordOpen(true)}
            className="text-xs font-medium text-zinc-600 hover:text-zinc-900 underline hover:no-underline cursor-pointer"
          >
            Reset password
          </button>

          {/* Billing block */}
          <div className="border-t border-zinc-100 mt-6 pt-6">
            <p className="text-xs font-medium text-zinc-500 mb-2">Current plan</p>
            <div className="bg-zinc-50 border border-zinc-200/80 rounded-2xl p-4 flex items-center justify-between">
              <div className="flex items-center gap-2.5">
                <img src="/logo.svg" alt="Plurilog" className="w-7 h-7" />
                <div>
                  <p className="text-sm font-medium text-zinc-900">{userPlan === 'paid' ? 'Plus' : 'Free'}</p>
                  <p className="text-xs text-zinc-500">{userPlan === 'paid' ? '$19 / month' : '$0 / month'}</p>
                </div>
              </div>
              <button
                type="button"
                onClick={userPlan === 'paid' ? handleManagePortal : () => handleUpgrade(setIsRedirectingCard)}
                disabled={isRedirectingCard}
                className="px-3.5 py-1.5 rounded-full text-xs font-medium text-white bg-zinc-900 hover:bg-zinc-800 transition-colors cursor-pointer disabled:opacity-60"
              >
                {isRedirectingCard ? 'Redirecting…' : (userPlan === 'paid' ? 'Manage subscription' : 'Upgrade')}
              </button>
            </div>

            {userPlan === 'paid' && periodResetAt && (
              <p className="text-xs text-zinc-500 mt-2">
                {planStatus === 'canceling' ? 'Expires' : 'Renews'} {new Date(periodResetAt).toLocaleDateString('en-US', { month: 'short', day: 'numeric', year: 'numeric' })}
              </p>
            )}

            {userPlan === 'free' && (
              <div className="mt-4 relative rounded-2xl border-2 border-amber-300 bg-amber-50/40 p-6 sm:p-8 flex flex-col justify-between shadow-sm hover:border-amber-400 transition-colors">
                <div>
                  <div className="flex items-center justify-between gap-2 mb-2">
                    <h4 className="text-lg font-semibold text-zinc-900">Plus</h4>
                    <span className="px-2.5 py-0.5 rounded-full bg-amber-100 text-amber-900 text-xs font-medium border border-amber-200/80">
                      Recommended
                    </span>
                  </div>
                  <div className="flex items-baseline gap-1.5 mb-2">
                    <span className="text-3xl sm:text-4xl font-bold tracking-tight text-zinc-900">$19</span>
                    <span className="text-xs sm:text-sm text-zinc-500 font-medium">/ month</span>
                  </div>
                  <p className="text-xs sm:text-sm text-zinc-600 leading-relaxed mb-6">
                    For ongoing use of Plurilog.
                  </p>
                  <ul className="space-y-3 text-xs sm:text-sm text-zinc-700 mb-8">
                    <li className="flex items-start gap-2.5">
                      <div className="w-4 h-4 rounded-full bg-amber-100 border border-amber-200/80 flex items-center justify-center text-amber-900 shrink-0 mt-0.5">
                        <Check className="w-2.5 h-2.5 stroke-[2.5]" />
                      </div>
                      <span className="font-medium">Everything in Free</span>
                    </li>
                    <li className="flex items-start gap-2.5">
                      <div className="w-4 h-4 rounded-full bg-amber-100 border border-amber-200/80 flex items-center justify-center text-amber-900 shrink-0 mt-0.5">
                        <Check className="w-2.5 h-2.5 stroke-[2.5]" />
                      </div>
                      <span>Monthly usage refreshed every billing cycle</span>
                    </li>
                    <li className="flex items-start gap-2.5">
                      <div className="w-4 h-4 rounded-full bg-amber-100 border border-amber-200/80 flex items-center justify-center text-amber-900 shrink-0 mt-0.5">
                        <Check className="w-2.5 h-2.5 stroke-[2.5]" />
                      </div>
                      <span>ChatGPT, Claude and Gemini available</span>
                    </li>
                    <li className="flex items-start gap-2.5">
                      <div className="w-4 h-4 rounded-full bg-amber-100 border border-amber-200/80 flex items-center justify-center text-amber-900 shrink-0 mt-0.5">
                        <Check className="w-2.5 h-2.5 stroke-[2.5]" />
                      </div>
                      <span>Shared memory, files and retrieval</span>
                    </li>
                    <li className="flex items-start gap-2.5">
                      <div className="w-4 h-4 rounded-full bg-amber-100 border border-amber-200/80 flex items-center justify-center text-amber-900 shrink-0 mt-0.5">
                        <Check className="w-2.5 h-2.5 stroke-[2.5]" />
                      </div>
                      <span>Cancel anytime</span>
                    </li>
                  </ul>
                </div>
                <button
                  type="button"
                  onClick={() => handleUpgrade(setIsRedirectingPromo)}
                  disabled={isRedirectingPromo}
                  className="w-full py-3 px-4 rounded-xl bg-zinc-900 hover:bg-zinc-800 text-white font-medium text-sm transition-all cursor-pointer shadow-sm hover:shadow disabled:opacity-60"
                >
                  {isRedirectingPromo ? 'Redirecting…' : 'Get Plus'}
                </button>
              </div>
            )}
          </div>
        </div>
      </div>

      <ResetPasswordModal
        isOpen={isResetPasswordOpen}
        onClose={() => setIsResetPasswordOpen(false)}
        initialEmail={userEmail}
      />
    </div>
  );
};
