'use client';

import React, { useEffect, useState } from 'react';
import { Check, ExternalLink, KeyRound, X } from 'lucide-react';
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

const PLAN_FEATURES = [
  'Everything in Free',
  'Monthly usage refreshed every billing cycle',
  'ChatGPT, Claude and Gemini available',
  'Shared memory, files and retrieval',
  'Cancel anytime',
];

const RobotHeads = () => (
  <div className="pointer-events-none absolute -top-[23px] right-4 flex items-end -space-x-2.5" aria-hidden="true">
    <img src="/robot-head-claude@3x.png" alt="" className="h-[35px] w-[33px] object-contain" />
    <img src="/robot-head-chatgpt@3x.png" alt="" className="h-[35px] w-[33px] object-contain" />
    <img src="/robot-head-gemini@3x.png" alt="" className="h-[35px] w-[33px] object-contain" />
  </div>
);

const FeatureList = () => (
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
);

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

  const billingDate = periodResetAt
    ? new Date(periodResetAt).toLocaleDateString('en-US', {
        month: 'long',
        day: 'numeric',
        year: 'numeric',
      })
    : null;

  const hasNameChange = Boolean(nameInput.trim() && nameInput.trim() !== displayName);

  if (!isOpen) return null;

  return (
    <div className="fixed inset-0 z-50 flex items-center justify-center p-3 sm:p-4">
      <button
        type="button"
        onClick={onClose}
        className="fixed inset-0 cursor-default bg-[rgba(28,27,26,0.26)] backdrop-blur-[1px]"
        aria-label="Close account settings"
      />

      <div className="relative z-10 flex max-h-[calc(100dvh-1.5rem)] w-full max-w-[470px] flex-col overflow-hidden rounded-[18px] border border-[#E2E0DB] bg-white dashboard-menu-shadow animate-in fade-in zoom-in-95 duration-150">
        <div className="flex items-center justify-between px-5 pb-3 pt-4 sm:px-6 sm:pt-5">
          <h3 className="text-[15px] font-semibold tracking-tight text-[#1C1B1A]">
            Account settings
          </h3>
          <button
            type="button"
            onClick={onClose}
            className="flex h-9 w-9 cursor-pointer items-center justify-center rounded-[10px] text-[#8A867D] transition-colors hover:bg-[#F4F3F0] hover:text-[#1C1B1A]"
            title="Close modal"
            aria-label="Close modal"
          >
            <X className="h-3.5 w-3.5" />
          </button>
        </div>

        <div className="min-h-0 flex-1 overflow-y-auto px-5 pb-5 sm:px-6 sm:pb-6">
          <div className="flex min-h-[66px] items-center gap-3 rounded-[14px] border border-[#E7E5E0] bg-white px-3 py-2.5">
            <div className="flex h-10 w-10 shrink-0 items-center justify-center overflow-hidden rounded-full border border-white bg-[#D3E0F8] text-[12px] font-medium text-[#1C1B1A]">
              {userAvatarUrl ? (
                <img src={userAvatarUrl} alt={displayName} className="h-full w-full object-cover" />
              ) : (
                initial
              )}
            </div>

            <div className="min-w-0 flex-1">
              <input
                type="text"
                value={nameInput}
                onChange={(e) => setNameInput(e.target.value)}
                aria-label="Display name"
                className="w-full border-b border-transparent bg-transparent py-0.5 text-[13px] font-medium leading-5 text-[#1C1B1A] outline-none transition-colors hover:border-[#E2E0DB] focus:border-[#D9D6CF]"
              />
              <p className="truncate text-[11px] leading-4 text-[#6A675F]">{userEmail}</p>
            </div>

            <div className="flex shrink-0 items-center gap-1.5">
              {hasNameChange && (
                <button
                  type="button"
                  onClick={handleSaveName}
                  disabled={isSavingName}
                  className="h-9 cursor-pointer rounded-[10px] px-3 text-[11px] font-medium text-[#1C1B1A] transition-colors hover:bg-[#F4F3F0] disabled:cursor-not-allowed disabled:opacity-50"
                >
                  {isSavingName ? 'Saving…' : 'Save'}
                </button>
              )}
              <button
                type="button"
                onClick={() => setIsResetPasswordOpen(true)}
                className="inline-flex h-9 cursor-pointer items-center gap-1.5 rounded-[10px] border border-[#E2E0DB] bg-white px-3 text-[11px] font-medium text-[#1C1B1A] transition-colors hover:bg-[#F7F6F3]"
              >
                <KeyRound className="h-3 w-3" aria-hidden="true" />
                <span className="hidden xs:inline">Reset password</span>
                <span className="xs:hidden">Reset</span>
              </button>
            </div>
          </div>

          <p className="mb-2 mt-5 text-[10px] font-medium uppercase tracking-[0.14em] text-[#6A675F]">
            Your plan
          </p>

          {userPlan === 'free' ? (
            <>
              <div className="flex min-h-[44px] items-center justify-between gap-3 rounded-[12px] bg-[#F4F3F0] px-3 py-2">
                <div className="flex min-w-0 items-center gap-2.5">
                  <img src="/logo.svg" alt="" className="h-[22px] w-[22px] shrink-0 object-contain" />
                  <div className="flex min-w-0 items-baseline gap-2">
                    <span className="text-[13px] font-medium text-[#1C1B1A]">Free</span>
                    <span className="text-[11px] text-[#6A675F]">$0 / month</span>
                  </div>
                </div>
                <span className="shrink-0 text-[10px] text-[#8A867D]">Your current plan</span>
              </div>

              <div className="relative mt-6 rounded-[16px] border border-[#8A867D] bg-white px-5 pb-4 pt-5">
                <RobotHeads />

                <div className="mb-2 flex items-center gap-2">
                  <h4 className="text-[14px] font-semibold text-[#1C1B1A]">Plus</h4>
                  <span className="rounded-full bg-[#F6D3C9] px-2 py-0.5 text-[9px] font-medium text-[#1C1B1A]">
                    Recommended
                  </span>
                </div>

                <div className="mb-1 flex items-end gap-1.5">
                  <span className="text-[29px] font-semibold leading-none tracking-[-0.03em] text-[#1C1B1A]">$19</span>
                  <span className="pb-0.5 text-[11px] text-[#6A675F]">/ month</span>
                </div>

                <p className="mb-4 text-[11px] leading-5 text-[#6A675F]">
                  For ongoing use of Plurilog.
                </p>

                <FeatureList />

                <button
                  type="button"
                  onClick={() => handleUpgrade(setIsRedirectingPromo)}
                  disabled={isRedirectingPromo}
                  className="mt-5 flex h-11 w-full cursor-pointer items-center justify-center rounded-[10px] bg-[#1C1B1A] px-4 text-[12px] font-medium text-white transition-colors hover:bg-[#2A2927] disabled:cursor-not-allowed disabled:opacity-60"
                >
                  {isRedirectingPromo ? 'Redirecting…' : 'Get Plus'}
                </button>
              </div>
            </>
          ) : (
            <div className="relative mt-5 rounded-[16px] border border-[#8A867D] bg-white">
              <RobotHeads />

              <div className="flex items-center justify-between gap-3 px-4 py-3.5">
                <div className="flex min-w-0 items-start gap-2.5">
                  <img src="/logo.svg" alt="" className="mt-0.5 h-[22px] w-[22px] shrink-0 object-contain" />
                  <div className="min-w-0">
                    <div className="flex items-baseline gap-1.5">
                      <span className="text-[13px] font-semibold text-[#1C1B1A]">Plus</span>
                      <span className="text-[11px] text-[#6A675F]">· $19 / month</span>
                    </div>
                    {billingDate && (
                      <p className="mt-0.5 text-[10px] leading-4 text-[#6A675F]">
                        {planStatus === 'canceling' ? 'Expires' : 'Renews'} on {billingDate}
                      </p>
                    )}
                  </div>
                </div>

                <button
                  type="button"
                  onClick={handleManagePortal}
                  disabled={isRedirectingCard}
                  className="inline-flex h-9 shrink-0 cursor-pointer items-center gap-1.5 rounded-[10px] border border-[#E2E0DB] bg-white px-3 text-[11px] font-medium text-[#1C1B1A] transition-colors hover:bg-[#F7F6F3] disabled:cursor-not-allowed disabled:opacity-60"
                >
                  <span>{isRedirectingCard ? 'Redirecting…' : 'Manage'}</span>
                  {!isRedirectingCard && <ExternalLink className="h-3 w-3" aria-hidden="true" />}
                </button>
              </div>

              <div className="border-t border-[#E7E5E0] px-4 pb-4 pt-3">
                <p className="mb-3 text-[10px] font-medium text-[#6A675F]">Included in your plan</p>
                <FeatureList />
              </div>
            </div>
          )}
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
