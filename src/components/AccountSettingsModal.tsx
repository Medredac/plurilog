'use client';
import React, { useState, useEffect } from 'react';
import { X, Check } from 'lucide-react';
import { createClient } from '@/utils/supabase/client';

interface AccountSettingsModalProps {
  isOpen: boolean;
  onClose: () => void;
  displayName: string;
  userEmail?: string;
  userAvatarUrl?: string;
  userPlan: 'free' | 'paid';
  onNameUpdated?: (newName: string) => void;
}

export const AccountSettingsModal: React.FC<AccountSettingsModalProps> = ({
  isOpen,
  onClose,
  displayName,
  userEmail,
  userAvatarUrl,
  userPlan,
  onNameUpdated,
}) => {
  const [nameInput, setNameInput] = useState(displayName);
  const [isSavingName, setIsSavingName] = useState(false);
  const [isRedirectingCard, setIsRedirectingCard] = useState(false);
  const [isRedirectingPromo, setIsRedirectingPromo] = useState(false);
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

  if (!isOpen) return null;

  return (
    <div className="fixed inset-0 z-50 flex items-center justify-center p-4">
      <div onClick={onClose} className="fixed inset-0 bg-black/20 backdrop-blur-xs transition-opacity" />
      <div className="relative w-full max-w-md rounded-2xl bg-white border border-zinc-200/90 shadow-xl z-10 animate-in fade-in zoom-in-95 duration-150 overflow-hidden">
        <div className="flex items-center justify-between px-6 py-4 border-b border-zinc-100">
          <h3 className="text-base font-semibold text-zinc-900 tracking-tight">Account settings</h3>
          <button
            onClick={onClose}
            className="p-1 rounded-lg text-zinc-400 hover:text-zinc-700 hover:bg-zinc-100 transition-colors cursor-pointer"
          >
            <X className="w-4 h-4" />
          </button>
        </div>

        <div className="p-6 max-w-sm mx-auto">
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
                  className="text-sm font-medium text-zinc-900 bg-transparent border-b border-transparent hover:border-zinc-200 focus:border-zinc-400 focus:outline-none py-0.5 w-full transition-colors"
                />
                {nameInput.trim() && nameInput.trim() !== displayName && (
                  <button
                    type="button"
                    onClick={handleSaveName}
                    disabled={isSavingName}
                    className="text-xs font-medium text-zinc-900 underline hover:no-underline cursor-pointer shrink-0"
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
            onClick={() => {}}
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
                  <p className="text-xs text-zinc-500">{userPlan === 'paid' ? '$16 / month' : '$0 / month'}</p>
                </div>
              </div>
              <button
                type="button"
                onClick={userPlan === 'paid' ? () => {} : () => handleUpgrade(setIsRedirectingCard)}
                disabled={userPlan === 'free' && isRedirectingCard}
                className="px-3.5 py-1.5 rounded-full text-xs font-medium text-white bg-zinc-900 hover:bg-zinc-800 transition-colors cursor-pointer disabled:opacity-60"
              >
                {userPlan === 'paid' ? 'Manage subscription' : (isRedirectingCard ? 'Redirecting…' : 'Upgrade')}
              </button>
            </div>

            {userPlan === 'free' && (
              <div className="mt-4 rounded-2xl border border-amber-200/80 bg-amber-50/40 p-5">
                <h4 className="text-lg font-semibold text-zinc-900 mb-1">Upgrade to Plus</h4>
                <p className="text-sm text-zinc-500 mb-1">Unlock more from every conversation.</p>
                <p className="text-sm font-medium text-zinc-900 mb-4">$16/month</p>
                <div className="space-y-2 text-left max-w-[220px] mb-5">
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
                <button
                  type="button"
                  onClick={() => handleUpgrade(setIsRedirectingPromo)}
                  disabled={isRedirectingPromo}
                  className="w-full px-4 py-2.5 rounded-xl text-sm font-semibold text-zinc-900 bg-amber-400 hover:bg-amber-500 transition-colors cursor-pointer disabled:opacity-60"
                >
                  {isRedirectingPromo ? 'Redirecting…' : 'Upgrade to Plus'}
                </button>
              </div>
            )}
          </div>
        </div>
      </div>
    </div>
  );
};
