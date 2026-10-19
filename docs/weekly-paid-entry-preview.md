# Weekly paid-entry preview

Based on origin/main 044affea6f154548668c1d1cb89d48ddb96e2872. Branch preview/weekly-paid-entry.

## Current setup

- Weekly $4.99 with the same card branding, robot artwork, benefits and button styling as monthly.
- Monthly keeps $9 for three months, then $19, and Popular / Limited-time offer labels.
- Checkout and account management use the existing live Stripe integration. Dummy checkout and management screens have been removed.
- Weekly live price: price_1USKuzK3pyxY4OhePX7HXc6O, product prod_VTHT9NE6jeSHZV. Identical customer-facing product name to monthly. Separate product prevents monthly coupons from carrying onto weekly if switching is introduced later.
- STRIPE_PRICE_ID_PLUS_WEEKLY is scoped only to the preview/weekly-paid-entry branch in Vercel. Monthly price and existing subscriptions are unchanged.
- The existing Stripe account branding applies to both hosted Checkouts.
- Existing accounts keep their access; paid-entry enforcement in production stays off unless PAID_ENTRY_STARTS_AT is explicitly set.
- No Supabase mutation, production deployment or payment performed by the agent.
- A completed live payment is real and will trigger the existing production billing webhook. Preview deployment does not isolate live Stripe events. Do not treat this as a test-card environment.
- The old /preview/plans URL redirects to the actual dashboard chooser. Sign in normally to use checkout.

## Before production launch

- Validate weekly renewal fulfillment: production currently recognizes only the monthly price for invoice renewals. Merge the prepared weekly allowlist and configure the production weekly price before accepting ongoing weekly subscriptions publicly.
- Review database billing-period fallback for weekly compatibility; no SQL changes are included.
- Weekly/monthly switching remains disabled in the existing Stripe portal. Do not change its configuration as part of this preview.
- Choose the actual launch cutoff so all earlier users remain grandfathered.

Savings use 52 weekly payments vs 12 monthly payments: 58% during the introductory offer, 12% afterward (rounded down).
