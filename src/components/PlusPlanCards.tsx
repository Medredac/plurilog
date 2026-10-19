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
      return <div key={interval} className={`relative flex flex-col rounded-2xl border bg-white p-5 sm:p-6 ${monthly ? 'border-[#8A867D]' : 'border-[#E2E0DB]'}`}>
        {monthly && <div className="pointer-events-none absolute -top-[23px] right-5 flex items-end -space-x-2.5" aria-hidden="true">{['claude', 'chatgpt', 'gemini'].map(name => <img key={name} src={`/robot-head-${name}@3x.png`} alt="" className="h-[35px] w-[33px] object-contain" />)}</div>}
        <div className="mb-4 flex flex-wrap items-center gap-2">
          <h3 className="text-base font-semibold">Plus {monthly ? 'Monthly' : 'Weekly'}</h3>
          {monthly && <span className="rounded-full bg-[#F6D3C9] px-2 py-1 text-[11px] font-medium">Popular</span>}
        </div>
        <div className="flex items-baseline gap-1"><span className="text-4xl font-semibold tracking-tight">{amount != null ? `$${amount}` : '…'}</span><span className="text-sm text-[#6A675F]">/ {interval}</span></div>
        <div className="mt-3 min-h-20 text-xs leading-5 text-[#6A675F]">
          {monthly && offer?.label === 'Limited-time offer' && <span className="mb-1 inline-block rounded-full bg-[#FFF1E8] px-2 py-0.5 font-medium text-[#8A3D22]">Limited-time offer</span>}
          <p>{monthly ? offer?.terms || 'Loading your price…' : 'USD. Billed weekly. Cancel anytime.'}</p>
          {monthly && amount != null && <p className="mt-1 font-semibold text-[#8A3D22]">{monthlySavingsText(amount)}</p>}
        </div>
        <ul className="my-5 flex-1 space-y-2.5 text-xs leading-5">
          {PLUS_FEATURES.map(feature => <li className="flex items-start gap-2" key={feature}><Check className="mt-0.5 h-4 w-4 shrink-0"/><span>{feature}</span></li>)}
        </ul>
        <button type="button" disabled={disabled || !!busy || !offer?.canSubscribe} onClick={() => onSelect(interval)} className={`flex min-h-11 w-full cursor-pointer items-center justify-center rounded-[10px] px-4 text-sm font-medium disabled:cursor-not-allowed disabled:opacity-50 ${monthly ? 'bg-[#1C1B1A] text-white hover:bg-[#2A2927]' : 'border border-[#E2E0DB] hover:bg-[#F7F6F3]'}`}>{busy === interval ? 'Opening…' : `Choose ${monthly ? 'monthly' : 'weekly'}`}</button>
      </div>;
    })}
    <p className="text-center text-[11px] leading-4 text-[#6A675F] sm:col-span-2">Same Plus benefits on both plans. Subscriptions renew automatically until cancelled.<br/>Savings compare 12 monthly payments with 52 weekly payments.{offer?.amount === 9 ? ' After the offer, $19/month saves 12% vs weekly.' : ''}</p>
  </div>;
}
