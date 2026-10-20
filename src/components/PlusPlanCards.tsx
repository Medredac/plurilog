"use client";

import { Check } from 'lucide-react';
import { PLUS_FEATURES } from '@/lib/plusFeatures';
import { WEEKLY_PRICE, monthlySavingsText, type BillingInterval, type PlusOffer } from '@/lib/plusPricing';

export function PlusPlanCards({ offer, onSelect, busy, disabled = false }: {
  offer: PlusOffer | null;
  onSelect: (interval: BillingInterval) => void;
  busy?: BillingInterval | null;
  disabled?: boolean;
}) {
  return <div className="grid grid-cols-1 gap-8 sm:grid-cols-2 text-[#1C1B1A]">
    {(['week', 'month'] as const).map(interval => {
      const monthly = interval === 'month';
      const amount = monthly ? offer?.amount : WEEKLY_PRICE;
      return <div key={interval} className={`relative flex flex-col rounded-2xl border bg-white p-5 sm:p-6 shadow-2xs ${monthly ? 'border-[#E6AA97]' : 'border-[#8A867D]'}`}>
        {monthly && <div className="pointer-events-none absolute -top-[23px] right-5 flex items-end -space-x-2.5" aria-hidden="true">{['claude', 'chatgpt', 'gemini'].map(name => <img key={name} src={`/robot-head-${name}@3x.png`} alt="" className="h-[35px] w-[33px] object-contain" />)}</div>}
        <div className="mb-4 flex flex-wrap items-center gap-2">
          <h3 className="text-base font-semibold">1 {monthly ? 'month' : 'week'}</h3>
          {monthly && <span className="rounded-full bg-[#F6D3C9] px-2 py-1 text-[11px] font-medium text-[#582B1D]">Popular · {monthlySavingsText()} monthly</span>}
        </div>
        <div className="flex items-baseline gap-1"><span className="text-4xl font-semibold tracking-tight">{amount != null ? `$${amount}` : '…'}</span><span className="text-sm text-[#6A675F]">/ {interval}</span></div>
        <div className="mt-2 text-xs leading-5 text-[#6A675F]">
          <p>Billed {monthly ? 'monthly' : 'weekly'}. Cancel anytime.</p>
          {monthly && offer?.label === 'Limited-time offer' && <span className="mb-1 inline-block rounded-full bg-[#FFF1E8] px-2 py-0.5 font-medium text-[#8A3D22]">Limited-time offer</span>}
          {monthly && <p>{!offer ? 'Loading your price…' : offer.label === 'Limited-time offer' ? offer.terms : ''}</p>}
        </div>
        <ul className="my-5 flex-1 space-y-2.5 text-xs leading-5">
          {PLUS_FEATURES.map(feature => <li className="flex items-start gap-2" key={feature}><span className="mt-[2px] inline-flex h-4 w-4 shrink-0 items-center justify-center rounded-full bg-[#1C1B1A] text-white"><Check className="h-2.5 w-2.5 stroke-[2.5]"/></span><span>{feature === 'Cancel anytime' ? `Renews ${monthly ? 'monthly' : 'weekly'}. Cancel anytime.` : feature}</span></li>)}
        </ul>
        <button type="button" disabled={disabled || !!busy || !offer?.canSubscribe} onClick={() => onSelect(interval)} className={`flex min-h-11 w-full cursor-pointer items-center justify-center rounded-[10px] px-4 text-sm font-medium disabled:cursor-not-allowed disabled:opacity-50 transition-colors ${monthly ? 'bg-[#F6D3C9] text-[#582B1D] hover:bg-[#EDC0B1]' : 'bg-[#1C1B1A] text-white hover:bg-[#2A2927]'}`}>{busy === interval ? 'Opening…' : amount != null ? `Enjoy 1 ${monthly ? 'month' : 'week'} for $${amount}` : 'Loading…'}</button>
      </div>;
    })}
  </div>;
}
