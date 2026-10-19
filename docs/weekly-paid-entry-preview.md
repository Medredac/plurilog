# Weekly paid-entry preview

Base: current origin/main 044affea6f154548668c1d1cb89d48ddb96e2872.
Branch: preview/weekly-paid-entry. No production deployment or Supabase changes.

## Review

- `/`: weekly $4.99 and unchanged monthly $9 for 3 months then $19.
- `/preview/plans`: same new-user chooser without creating an account.
- `/preview/plans?checkout=week` or `month`: clearly marked checkout demonstration.
- `/preview/plans?manage=true`: clearly marked switching demonstration, no billing action.
- Actual preview dashboard: accounts created before the preview cutoff retain access; newer unpaid accounts get the chooser. API checks enforce access independently of the modal.
- Billing, portal and webhook preview guards are tied to Vercel's preview environment AND this branch. No URL parameter enables demo mode.
- Preview pages are noindex. Existing blog content is not rewritten.

## Before any production activation (not done)

1. Connect a separate Stripe sandbox and test actual checkout, signed fulfillment, renewal, cancellation and switching against an isolated database. Current connector exposes only live Plurilog; current preview intentionally never creates a live Checkout or Portal session and refuses billing webhooks.
2. Create a USD 499 recurring weekly price and set STRIPE_PRICE_ID_PLUS_WEEKLY. No live price was created. Monthly stays price_1UG24BK3pyxY4Ohen0WYN1VE.
3. Plan switching is currently disabled in the existing Stripe portal. Create an isolated portal configuration, then set STRIPE_PLUS_PORTAL_CONFIGURATION_ID only once validated. Do not edit the existing live default configuration during preview.
4. Coupon caveat: the monthly intro is $10 off for 3 months, restricted to the monthly product. If weekly is added to the SAME product, carrying this coupon through a monthly-to-weekly switch could discount weekly to zero. Prefer a separate weekly product with identical Plus entitlements, or explicitly remove incompatible discounts on switching. Test discounted monthly -> weekly, weekly -> monthly, legacy price subscriptions, and cancellation. Show the payable amount and renewal date before confirmation; avoid double subscriptions and extra usage charges.
5. Choose PAID_ENTRY_STARTS_AT at the actual launch time. Without that server variable, production paid-entry enforcement stays off. Do not copy the preview cutoff into production: all users created before the eventual launch must be grandfathered. No existing credits are removed.
6. Review database billing-period/credit replenishment routines for weekly compatibility before authorizing release. No SQL migrations or database updates have been applied. Existing Plus unlimited replenishment remains unchanged.
7. Update backend product-description prompts and any remaining historical/free-plan claims before release, then reconcile public metadata. This preview retains legacy credit prompts only for grandfathered users.

Savings: floor(100 * (1 - monthly_price * 12 / (4.99 * 52))) => 58% intro, 12% regular. Copy explicitly describes the comparison and promotional duration.

Validation: TypeScript and focused 27 billing/access tests passed without external API usage. Existing monthly offer regression tests retained.
