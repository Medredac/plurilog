# Weekly paid-entry preview

Based on main 044affea6f154548668c1d1cb89d48ddb96e2872. Branch preview/weekly-paid-entry. The billing-only support is separately based on that same main in fix/weekly-billing-backend.

## Pricing and scope

- Weekly $4.99 has the same Plus benefits and branding as monthly.
- Monthly retains $9 for three months, then $19; Popular / Limited-time offer / Save 12% remain. Savings compare 52 weekly charges with 12 regular monthly charges.
- Production landing-page pricing, the free plan, existing-user access and acquisition popups remain unchanged. New paid-entry enforcement is preview-only unless a production launch cutoff is explicitly configured.
- Checkout is live Stripe, not a test-card environment. No live payment or customer subscription was created or changed during implementation.
- Weekly price: price_1USKuzK3pyxY4OhePX7HXc6O; product prod_VTHT9NE6jeSHZV. Separate product prevents the monthly coupon applying to weekly.
- The weekly price is configured for the preview branch and production webhook. Existing monthly prices and portal configuration remain unchanged.

## Paid lifecycle

- Supabase plans remain distinct: paid (monthly), weekly_paid (weekly). Manually assigning weekly_paid displays weekly Plus in settings; it does not create a Stripe subscription.
- Initial paid checkout grants 900. Renewals use the exact recurring invoice period, weekly or monthly. Duplicate and concurrent delivery cannot grant the allowance twice. A failed database write asks Stripe to retry.
- Weekly refill uses the existing below-100 behavior: add increments of 100 until the balance is at least 100. Cancellation pending retains access until period end. Expired weekly access cannot refill; subscription deletion sets free/canceled and zero remaining.
- The additive migration 20261019183524_support_weekly_paid_plus.sql has been applied. The monthly fallback is preserved; weekly never advances by that fallback.
- Stripe sends live checkout events to the existing production webhook irrespective of which UI opened checkout. Backend support therefore ships separately from preview-only pricing/paywall changes.

## Switching

- Preview Account settings offers a confirmed switch at current paid period end, never an immediate charge or credit reset.
- The monthly introduction is offered only if unused; switching cannot restart it.
- Stripe subscription schedules preserve the current phase/discount, then activate the chosen interval at period end. A pending change can be undone.
- Stripe's portal cannot cancel a subscription with a pending schedule. The UI explains to undo the pending change then use Manage. Production can display/undo a pending change created in preview, but cannot initiate a new switch.
- After the switched period's paid invoice, our completed schedule is released so standard portal management is available again.

## Validation

- 43 focused billing/access/rendering tests, with mocked Stripe events and APIs; no model/API generation spend.
- TypeScript checks on preview and billing-only branches.
- Live Supabase checks used a synthetic fixture in one rolled-back transaction: refill, spend/refill, canceling, expiry, canceled access, monthly refill and monthly rollover. No test profile or spend persisted.
- Not tested by charging a real card or changing an existing user's real subscription.
