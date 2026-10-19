"use client";
import { useState } from 'react';
import Link from 'next/link';
import { ChoosePlanModal } from '@/components/ChoosePlanModal';
import { PlusPlanCards } from '@/components/PlusPlanCards';
import { INTRO_TERMS } from '@/lib/plusPricing';
const offer = { amount: 9, label: 'Limited-time offer', terms: INTRO_TERMS, canSubscribe: true };
export function PlanPreview({ checkout, manage }: { checkout: string | null; manage: boolean }) {
  const [open, setOpen] = useState(!checkout && !manage);
  const [selected, setSelected] = useState<string | null>(null);
  return <main className="min-h-screen bg-[#F7F6F3] text-[#1C1B1A]">
    <div className="bg-amber-50 px-5 py-3 text-center text-sm text-amber-900">Preview only — no payment is collected, no subscription or account is changed.</div>
    <header className="flex items-center justify-between border-b border-[#E2E0DB] bg-white p-5"><Link href="/" className="flex items-center gap-2 font-semibold"><img src="/logo.svg" alt="" className="h-7 w-7"/>Plurilog</Link><Link href="/preview/plans" className="text-sm underline">New-user preview</Link></header>
    {checkout ? <section className="mx-auto mt-16 max-w-lg rounded-2xl border border-[#E2E0DB] bg-white p-8">
      <p className="text-xs font-semibold uppercase text-[#8A3D22]">Checkout preview</p><h1 className="mt-3 text-2xl font-semibold">Plurilog Plus {checkout === 'week' ? 'Weekly' : 'Monthly'}</h1>
      <p className="mt-6 text-4xl font-semibold">{checkout === 'week' ? '$4.99' : '$9'}<span className="text-base font-normal"> / {checkout === 'week' ? 'week' : 'month'}</span></p>
      <p className="mt-3 text-sm">{checkout === 'week' ? 'Billed $4.99 USD every week. Renews automatically until cancelled.' : '$9 USD/month for the first 3 months, then $19 USD/month. Renews automatically until cancelled.'}</p>
      <p className="mt-6 text-sm text-[#6A675F]">This shows the selected plan and billing terms. Stripe payment entry is not connected in this preview.</p>
      <Link href="/preview/plans" className="mt-6 block rounded-xl bg-[#1C1B1A] p-3 text-center text-white">Back to plans</Link>
    </section> : manage ? <section className="mx-auto max-w-3xl p-6"><h1 className="my-6 text-2xl font-semibold">Manage Plus — preview</h1><p className="mb-6 text-sm">Plan switching needs Stripe configuration before launch. This demonstration does not change billing.</p><PlusPlanCards offer={{ ...offer, amount: 19, label: 'Plus', terms: 'USD. Billed monthly. Cancel anytime.' }} onSelect={setSelected}/>{selected && <p role="status" className="mt-4">Selected {selected === 'week' ? 'weekly' : 'monthly'} for review. No change made.</p>}</section> : <section className="mx-auto flex min-h-[65vh] max-w-3xl flex-col items-center justify-center px-6 text-center"><h1 className="text-3xl font-semibold">What are you working on?</h1><p className="my-4 text-[#6A675F]">Bring ChatGPT, Claude and Gemini into one discussion.</p><button onClick={() => setOpen(true)} className="rounded-xl bg-[#1C1B1A] px-6 py-3 text-white">Choose your plan</button><Link href="/preview/plans?manage=true" className="mt-6 text-sm underline">Preview subscription management</Link></section>}
    <ChoosePlanModal isOpen={open} onClose={() => setOpen(false)} demoOffer={offer}/>
  </main>;
}
