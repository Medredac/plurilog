'use client';

import { useEffect, useRef, useState } from 'react';
import type { PlusOffer } from '@/lib/plusPricing';
import { OutOfCreditsModal } from './OutOfCreditsModal';

interface Props {
  userId: string;
  eligible: boolean;
  blocked: boolean;
  onUpgrade: () => void;
}

export function PlusPromotionPrompt({ userId, eligible, blocked, onUpgrade }: Props) {
  const [offer, setOffer] = useState<PlusOffer | null>(null);
  const [isRenewal, setIsRenewal] = useState(false);
  const [dismissed, setDismissed] = useState(false);
  const dialog = useRef<HTMLDialogElement>(null);
  const clicked = useRef(false);
  const key = `plurilog-plus-promotion-9-3-v1:${userId}`;

  useEffect(() => {
    if (!eligible) return;
    const controller = new AbortController();
    const save = async () => {
      const response = await fetch('/api/user/plus-promotion', { method: 'POST', signal: controller.signal });
      if (!response.ok) throw new Error('Preference sync failed');
    };
    const load = async () => {
      let local: string | null = null;
      try { local = localStorage.getItem(key); } catch { /* Account state still works. */ }
      if (local) {
        // Retry a dismissal that could not reach the server on the previous visit.
        if (local === 'pending') {
          await save();
          try { localStorage.setItem(key, 'saved'); } catch { /* Optional local cache. */ }
        }
        return;
      }
      const response = await fetch('/api/user/plus-promotion', { cache: 'no-store', signal: controller.signal });
      if (!response.ok) return; // A failed lookup must not resurrect a dismissed prompt.
      const state = await response.json();
      if (state.dismissed) {
        try { localStorage.setItem(key, 'saved'); } catch { /* Optional local cache. */ }
        return;
      }
      if (state.renewalOffer) {
        if (!controller.signal.aborted) {
          setIsRenewal(true);
          setOffer(state.renewalOffer);
        }
        return;
      }
      if (state.activePlus) return;
      const pricing = await fetch('/api/stripe/offer', { cache: 'no-store', signal: controller.signal });
      if (!pricing.ok) return;
      const next: PlusOffer = await pricing.json();
      if (!controller.signal.aborted && next.canSubscribe && next.amount === 9 && next.label === 'Limited-time offer') {
        setOffer(next);
      }
    };
    void load().catch(() => { /* Never interrupt the dashboard for a promotion. */ });
    return () => controller.abort();
  }, [eligible, key]);

  const visible = eligible && !blocked && !dismissed && !!offer;
  useEffect(() => {
    const modal = dialog.current;
    if (visible && modal && !modal.open) {
      modal.showModal();
      modal.querySelector<HTMLButtonElement>('button[aria-label="Close"]')?.focus();
    }
    else if (modal?.open) modal.close();
  }, [visible]);

  const choose = (upgrade: boolean) => {
    if (clicked.current) return;
    clicked.current = true;
    setDismissed(true);
    dialog.current?.close();
    try { localStorage.setItem(key, 'pending'); } catch { /* Save to account below. */ }
    // Keep the choice even if checkout is abandoned; never charge from this action.
    void fetch('/api/user/plus-promotion', { method: 'POST', keepalive: true })
      .then(response => {
        if (response.ok) {
          try { localStorage.setItem(key, 'saved'); } catch { /* Account save succeeded. */ }
        }
      }).catch(() => { /* Pending local dismissal is retried on the next visit. */ });
    if (upgrade) {
      void fetch(isRenewal ? '/api/stripe/portal' : '/api/stripe/checkout', { method: 'POST' })
        .then(async response => {
          const data = await response.json();
          if (!response.ok || !data.url) throw new Error('Unable to open billing');
          window.location.assign(data.url);
        }).catch(() => onUpgrade()); // Existing settings provides billing retry/error UI.
    }
  };

  return (
    <dialog
      ref={dialog}
      aria-label="Limited-time Plus offer"
      className="m-0 max-h-none max-w-none border-0 bg-transparent p-0 backdrop:bg-transparent"
      onCancel={event => { event.preventDefault(); choose(false); }}
    >
      {visible && offer && (
        <OutOfCreditsModal
          isOpen
          variant="promotion"
          promotionOffer={offer}
          isRenewal={isRenewal}
          onClose={() => choose(false)}
          onPromotionUpgrade={() => choose(true)}
        />
      )}
    </dialog>
  );
}
