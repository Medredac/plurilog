import type Stripe from 'stripe';
import { INTRO_COUPON_ID } from './plusPricing';

interface BillingProfile {
  stripe_customer_id?: string | null;
  stripe_subscription_id?: string | null;
}

export class ExistingSubscriptionError extends Error {}

// Stripe history prevents a cancellation/rejoin from restarting the offer.
// A retained subscription ID also protects accounts whose customer is missing.
export async function qualifiesForIntro(stripe: Stripe, profile: BillingProfile) {
  let hasHistory = Boolean(profile.stripe_subscription_id);
  if (profile.stripe_customer_id) {
    for await (const subscription of stripe.subscriptions.list({
      customer: profile.stripe_customer_id, status: 'all', limit: 100,
    })) {
      hasHistory = true;
      if (!['canceled', 'incomplete_expired'].includes(subscription.status)) {
        throw new ExistingSubscriptionError('Please manage your existing subscription in Account Settings.');
      }
    }
  }
  return !hasHistory;
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
