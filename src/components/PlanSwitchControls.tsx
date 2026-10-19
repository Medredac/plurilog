'use client';
import { useEffect, useRef, useState } from 'react';
import type { PlanSwitchDetails } from '@/lib/stripePlanSwitch';

export function PlanSwitchControls() {
  const [details, setDetails] = useState<PlanSwitchDetails | null>(null);
  const [confirming, setConfirming] = useState(false);
  const [busy, setBusy] = useState(false);
  const [error, setError] = useState('');
  const requestId = useRef('');
  useEffect(() => {
    const controller = new AbortController();
    fetch('/api/stripe/switch', { cache: 'no-store', signal: controller.signal })
      .then(async response => {
        if (response.status === 404) return; // Preview-only control.
        const data = await response.json();
        if (!response.ok) throw new Error(data.error);
        setDetails(data);
      }).catch(error => { if (!controller.signal.aborted) setError(error.message || 'Unable to load plan changes.'); });
    return () => controller.abort();
  }, []);
  async function change(method: 'POST' | 'DELETE') {
    setBusy(true); setError('');
    try {
      const response = await fetch('/api/stripe/switch', { method, headers: { 'Content-Type': 'application/json' },
        ...(method === 'POST' ? { body: JSON.stringify({ interval: details?.interval, requestId: requestId.current,
          amount: details?.amount, effectiveAt: details?.effectiveAt }) } : {}) });
      const data = await response.json();
      if (!response.ok) throw new Error(data.error);
      setDetails(data); setConfirming(false); requestId.current = '';
    } catch (error) { setError(error instanceof Error ? error.message : 'Unable to change your plan.'); }
    finally { setBusy(false); }
  }
  const date = details?.effectiveAt ? new Date(details.effectiveAt).toLocaleDateString('en-US', { month: 'long', day: 'numeric', year: 'numeric' }) : '';
  const price = `$${details?.amount}/${details?.interval}`;
  const label = details?.interval === 'week' ? 'weekly' : 'monthly';
  const buttonClass = 'cursor-pointer rounded-lg border border-[#E2E0DB] px-3 py-2 text-[11px] font-medium hover:bg-[#F7F6F3] disabled:opacity-50';
  if (!details?.available && !error) return null;
  return <div className="border-t border-[#E7E5E0] px-4 py-3 text-[11px] text-[#6A675F]">
    {error && <p role="alert" className="mb-2 text-red-700">{error}</p>}
    {details?.available && (details.pending ? <>
      <p className="mb-2">Switching to {label} on {date}: {price}{details.introductory ? ' for 3 months, then $19/month' : ''}.</p>
      <button className={buttonClass} disabled={busy} onClick={() => change('DELETE')}>{busy ? 'Updating…' : 'Undo plan change'}</button>
      <p className="mt-2">To cancel your subscription, undo this change first, then select Manage.</p>
    </> : confirming ? <>
      <p className="mb-2">Your current plan stays active until {date}. Then {price}{details.introductory ? ' for 3 months, then $19/month' : ''}. Nothing charged today.</p>
      <div className="flex gap-2">
        <button className={buttonClass} disabled={busy} onClick={() => change('POST')}>{busy ? 'Scheduling…' : 'Confirm switch'}</button>
        <button className={buttonClass} disabled={busy} onClick={() => setConfirming(false)}>Cancel</button>
      </div>
    </> : <button className={buttonClass} onClick={() => { requestId.current = crypto.randomUUID(); setConfirming(true); }}>Switch to {label} · {price}</button>)}
  </div>;
}
