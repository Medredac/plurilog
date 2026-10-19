"use client";
import { useEffect, useRef, useState } from 'react';
import { useRouter } from 'next/navigation';
import { X } from 'lucide-react';
import { usePlusOffer } from '@/hooks/usePlusOffer';
import { PlusPlanCards } from './PlusPlanCards';
import type { BillingInterval, PlusOffer } from '@/lib/plusPricing';

export function ChoosePlanModal({ isOpen, onClose, demoOffer }: { isOpen: boolean; onClose: () => void; demoOffer?: PlusOffer }) {
  const router = useRouter();
  const dialog = useRef<HTMLDialogElement>(null);
  const loaded = usePlusOffer(isOpen && !demoOffer);
  const offer = demoOffer || loaded.offer;
  const [busy, setBusy] = useState<BillingInterval | null>(null);
  const [error, setError] = useState<string | null>(null);
  const [wasOpen, setWasOpen] = useState(isOpen);
  if (wasOpen !== isOpen) { setWasOpen(isOpen); setBusy(null); setError(null); }
  useEffect(() => {
    if (isOpen) { dialog.current?.showModal(); }
    else dialog.current?.close();
  }, [isOpen]);
  const choose = async (interval: BillingInterval) => {
    if (demoOffer) { router.push(`/preview/plans?checkout=${interval}`); return; }
    setBusy(interval); setError(null);
    try {
      const response = await fetch('/api/stripe/checkout', { method: 'POST', headers: { 'Content-Type': 'application/json' }, body: JSON.stringify({ interval }) });
      const data = await response.json();
      if (!response.ok || !data.url) throw new Error(data.error || 'Unable to open checkout.');
      window.location.assign(data.url);
    } catch (e) { setError(e instanceof Error ? e.message : 'Unable to open checkout.'); setBusy(null); }
  };
  return <dialog ref={dialog} aria-labelledby="choose-plan-title" onCancel={event => { event.preventDefault(); onClose(); }} className="m-auto max-h-[calc(100dvh-2rem)] w-[calc(100%-2rem)] max-w-3xl overflow-y-auto rounded-[18px] border border-[#E2E0DB] bg-white p-5 shadow-xl backdrop:bg-black/30 sm:p-7">
    <div className="mb-5 flex items-start justify-between gap-4"><div><div className="mb-3 flex items-center gap-2"><img src="/logo.svg" alt="" className="h-6 w-6"/><span className="text-sm font-medium">Plurilog Plus</span></div><h2 id="choose-plan-title" className="text-2xl font-semibold text-[#1C1B1A]">Choose your plan</h2><p className="mt-1 text-sm text-[#6A675F]">Your AI panel, ready when you are.</p></div><button autoFocus aria-label="Close plan selection" onClick={onClose} className="rounded-lg p-2 hover:bg-zinc-100"><X className="h-5 w-5"/></button></div>
    {(error || loaded.error) && <p role="alert" className="mb-4 text-sm text-red-700">{error || loaded.error}</p>}
    <PlusPlanCards offer={offer} onSelect={choose} busy={busy}/>
  </dialog>;
}
