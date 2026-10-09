import type Stripe from 'stripe';
import { INTRO_COUPON_ID } from './plusPricing';

interface BillingProfile {
  stripe_customer_id?: string | null;
  stripe_subscription_id?: string | null;
}

export class ExistingSubscriptionError extends Error {}

// Prior full-price subscriptions do not consume the promotion. Only a paid
// invoice on which this specific coupon actually reduced the amount does.
export async function hasUsedIntro(stripe: Stripe, customer: string) {
  for await (const invoice of stripe.invoices.list({
    customer, status: 'paid', limit: 100,
    expand: ['data.total_discount_amounts.discount'],
  })) {
    for (const amount of invoice.total_discount_amounts || []) {
      if (amount.amount <= 0) continue;
      if (typeof amount.discount === 'string') throw new Error('Unable to verify previous discount usage.');
      const coupon = amount.discount.source.coupon;
      if ((typeof coupon === 'string' ? coupon : coupon?.id) === INTRO_COUPON_ID) return true;
    }
  }
  return false;
}

export async function qualifiesForIntro(stripe: Stripe, profile: BillingProfile) {
  if (profile.stripe_subscription_id && !profile.stripe_customer_id) {
    throw new Error('Unable to verify the existing billing account.');
  }
  if (profile.stripe_customer_id) {
    for await (const subscription of stripe.subscriptions.list({
      customer: profile.stripe_customer_id, status: 'all', limit: 100,
    })) {
      if (!['canceled', 'incomplete_expired'].includes(subscription.status)) {
        throw new ExistingSubscriptionError('Please manage your existing subscription in Account Settings.');
      }
    }
    return !(await hasUsedIntro(stripe, profile.stripe_customer_id));
  }
  return true;
}

// Called only after a signed Stripe event says the customer undid cancellation.
// Merely scheduling cancellation, opening settings or a portal never applies it.
export async function applyIntroOnResumption(
  stripe: Stripe,
  subscription: Stripe.Subscription,
  previous: { cancel_at?: number | null; cancel_at_period_end?: boolean } | undefined,
  priceId: string,
) {
  const wasCanceling = previous?.cancel_at_period_end === true ||
    (typeof previous?.cancel_at === 'number' && previous.cancel_at > 0);
  if (!wasCanceling || subscription.status !== 'active' || subscription.cancel_at || subscription.cancel_at_period_end) return;
  // Re-read for delayed/replayed events and a cancellation made in the meantime.
  const current = await stripe.subscriptions.retrieve(subscription.id);
  if (current.status !== 'active' || current.cancel_at || current.cancel_at_period_end) return;
  const item = current.items.data[0];
  if (current.items.data.length !== 1 || item?.price.id !== priceId || item.quantity !== 1) return;
  // Preserve existing discounts; never restart a running promotion or stack it.
  if (current.discounts.length || item.discounts.length) return;
  const customer = typeof current.customer === 'string' ? current.customer : current.customer.id;
  if (await hasUsedIntro(stripe, customer)) return;
  await introCheckoutDiscount(stripe, priceId, true);
  await stripe.subscriptions.update(current.id, {
    discounts: [{ coupon: INTRO_COUPON_ID }],
    proration_behavior: 'none',
  }, { idempotencyKey: `resume-intro:${current.id}:v1` });
}

export async function introCheckoutDiscount(stripe: Stripe, priceId: string, eligible: boolean) {
  if (!eligible) return {};
  const [price, coupon] = await Promise.all([
    stripe.prices.retrieve(priceId),
    stripe.coupons.retrieve(INTRO_COUPON_ID, { expand: ['applies_to'] }),
  ]);
  const productId = typeof price.product === 'string' ? price.product : price.product.id;
  if (!price.active || price.currency !== 'usd' || price.unit_amount !== 1900 ||
      price.recurring?.interval !== 'month' || price.recurring.interval_count !== 1 ||
      !coupon.valid || coupon.amount_off !== 1000 || coupon.currency !== 'usd' ||
      coupon.duration !== 'repeating' || coupon.duration_in_months !== 3 ||
      !coupon.applies_to?.products.includes(productId)) {
    throw new Error('Introductory offer configuration does not match the advertised price.');
  }
  return {
    discounts: [{ coupon: INTRO_COUPON_ID }],
    custom_text: { submit: { message: '$9 USD/month for your first 3 months, then $19 USD/month. Cancel anytime.' } },
  };
}
