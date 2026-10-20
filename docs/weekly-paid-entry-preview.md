# Weekly and monthly paid-entry release

## Pricing and access

- Plus costs $4.99/week or $19/month, with identical benefits. Monthly saves 12% compared with 52 weekly charges over a year.
- New purchases receive no introductory coupon. Existing Stripe discounts remain in place until their original expiry.
- Production rollout changes only the profile defaults to zero. Existing free balances are preserved; positive usable balances still permit access regardless of plan label.
- The preview-only initializer remains limited to the billing preview. Production relies on database insert defaults, with no retrospective balance clearing.
- Existing free users nearing their limit retain the legacy monthly upgrade prompt. Zero-balance users see both plans.
- Yellow hero badge, coral monthly card, and “Open your panel” calls to action match the approved preview.

## Live Stripe connection

- Product: `prod_V9OgMuuBrHYUGY`
- Monthly price: `price_1UG24BK3pyxY4Ohen0WYN1VE`
- Weekly price: `price_1USUr5K3pyxY4OheKex7HPsg`
- Default portal configuration: `bpc_1ULEybK3pyxY4Ohe9DRrYIw1`
- Live events continue to reach the existing production webhook at `/api/stripe/webhook`.
- Manage opens Stripe’s portal. Monthly-to-weekly changes are scheduled at period end; weekly-to-monthly uses standard immediate proration.

## Paid lifecycle

- Supabase plans are `paid` (monthly) and `weekly_paid` (weekly), using regular `profiles` and `spend_events` tables.
- Initial checkout grants 900. Renewals follow the actual recurring invoice period. Duplicate delivery cannot grant the allowance twice.
- Existing automatic refill behavior is retained. Canceling keeps access until period end; deletion clears the remaining balance and restores the free label.
- Failed payment marks the account past due without granting a fresh cycle. Successful recovery resets the allowance once. Existing Stripe retry settings are unchanged.
- Migration `20261020061228_block_overdue_monthly_credit_resets.sql` is already applied.
- Apply `20261020073021_zero_new_account_starting_balance.sql` with the production launch. It changes insert defaults only.

## Verification

Billing/access unit tests and TypeScript checks cover the merged release without model-generation spend. Database verification checks new-account zero balances and preservation of existing balances. Live checkout configuration can be inspected without submitting a real payment.
