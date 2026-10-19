import type Stripe from 'stripe';
import type { BillingInterval } from './plusPricing';
import { hasUsedIntro, introCheckoutDiscount } from './stripeIntroOffer';

const OWNER = 'plurilog_period_end_switch_v1';
const idOf = (value: string | { id: string }) => typeof value === 'string' ? value : value.id;
export class PlanSwitchError extends Error {}

export interface PlanSwitchDetails {
  available: boolean;
  interval?: BillingInterval;
  amount?: number;
  introductory?: boolean;
  effectiveAt?: string;
  pending?: boolean;
  reason?: string;
}

export async function loadSwitchSubscription(stripe: Stripe, subscriptionId: string, customerId: string) {
  const subscription = await stripe.subscriptions.retrieve(subscriptionId);
  if (idOf(subscription.customer) !== customerId) throw new PlanSwitchError('Billing account does not match.');
  const item = subscription.items.data[0];
  if (subscription.items.data.length !== 1 || item.quantity !== 1 ||
      ![process.env.STRIPE_PRICE_ID_PLUS, process.env.STRIPE_PRICE_ID_PLUS_WEEKLY].filter(Boolean).includes(item.price.id)) {
    throw new PlanSwitchError('Please contact hello@plurilogai.com to change this plan.');
  }
  const schedule = subscription.schedule
    ? await stripe.subscriptionSchedules.retrieve(idOf(subscription.schedule)) : null;
  return { subscription, item, schedule };
}

export async function switchDetails(stripe: Stripe, subscription: Stripe.Subscription, schedule: Stripe.SubscriptionSchedule | null): Promise<PlanSwitchDetails> {
  const item = subscription.items.data[0];
  const end = item.current_period_end;
  if (subscription.status !== 'active' || subscription.cancel_at_period_end || subscription.cancel_at) {
    return { available: false, reason: 'Your subscription must be active and renewing to change plans.' };
  }
  if (!end || end <= Date.now() / 1000) return { available: false, reason: 'Your renewal is processing. Please try again shortly.' };
  if (schedule && schedule.metadata?.plurilog_switch !== OWNER) {
    return { available: false, reason: 'An existing billing change must finish before you can switch plans.' };
  }
  const pending = schedule?.phases.find(phase => phase.start_date >= end);
  if (pending) {
    const interval = idOf(pending.items[0].price) === process.env.STRIPE_PRICE_ID_PLUS_WEEKLY ? 'week' : 'month';
    return { available: true, pending: true, interval, amount: Number(schedule?.metadata?.target_amount),
      introductory: schedule?.metadata?.introductory === 'true', effectiveAt: new Date(pending.start_date * 1000).toISOString() };
  }
  const interval = item.price.id === process.env.STRIPE_PRICE_ID_PLUS_WEEKLY ? 'month' : 'week';
  const introductory = interval === 'month' && !await hasUsedIntro(stripe, idOf(subscription.customer));
  return { available: true, pending: false, interval, amount: interval === 'week' ? 4.99 : introductory ? 9 : 19,
    introductory, effectiveAt: new Date(end * 1000).toISOString() };
}

// Preserve the adopted current phase. Do not replay one-time invoice items or
// silently discard unusual billing arrangements that this UI doesn't support.
function preservePhase(phase: Stripe.SubscriptionSchedule.Phase): Stripe.SubscriptionScheduleUpdateParams.Phase {
  if (phase.add_invoice_items?.length || phase.billing_thresholds || phase.transfer_data || phase.on_behalf_of ||
      phase.application_fee_percent || phase.trial || phase.trial_end || phase.invoice_settings ||
      phase.items.some(item => item.billing_thresholds)) {
    throw new PlanSwitchError('Please contact hello@plurilogai.com to change this billing arrangement.');
  }
  return {
    start_date: phase.start_date,
    end_date: phase.end_date,
    items: phase.items.map(item => ({ price: idOf(item.price), quantity: item.quantity,
      discounts: item.discounts?.length ? item.discounts.map(discount => {
        if (discount.discount) return { discount: idOf(discount.discount) };
        if (discount.coupon) return { coupon: idOf(discount.coupon) };
        if (discount.promotion_code) return { promotion_code: idOf(discount.promotion_code) };
        throw new PlanSwitchError('Unable to preserve the current item discount.');
      }) : '',
      ...(item.tax_rates?.length ? { tax_rates: item.tax_rates.map(idOf) } : {}),
      ...(item.metadata ? { metadata: item.metadata } : {}),
    })),
    discounts: phase.discounts?.length ? phase.discounts.map(discount => {
      if (discount.discount) return { discount: idOf(discount.discount) };
      if (discount.coupon) return { coupon: idOf(discount.coupon) };
      if (discount.promotion_code) return { promotion_code: idOf(discount.promotion_code) };
      throw new PlanSwitchError('Unable to preserve the current discount.');
    }) : '',
    ...(phase.automatic_tax ? { automatic_tax: { enabled: phase.automatic_tax.enabled } } : {}),
    ...(phase.default_payment_method ? { default_payment_method: idOf(phase.default_payment_method) } : {}),
    ...(phase.default_tax_rates?.length ? { default_tax_rates: phase.default_tax_rates.map(idOf) } : {}),
    ...(phase.collection_method ? { collection_method: phase.collection_method } : {}),
    ...(phase.billing_cycle_anchor ? { billing_cycle_anchor: phase.billing_cycle_anchor } : {}),
    ...(phase.metadata ? { metadata: phase.metadata } : {}),
    ...(phase.description ? { description: phase.description } : {}),
    proration_behavior: 'none',
  };
}

export async function schedulePlanSwitch(stripe: Stripe, subscription: Stripe.Subscription, existing: Stripe.SubscriptionSchedule | null, interval: BillingInterval, requestId: string) {
  const details = await switchDetails(stripe, subscription, existing);
  if (!details.available) throw new PlanSwitchError(details.reason);
  if (details.interval !== interval) throw new PlanSwitchError('Please reload your plan details before confirming.');
  if (details.pending) return details; // Retrying the same confirmation is harmless.
  const targetPriceId = interval === 'week' ? process.env.STRIPE_PRICE_ID_PLUS_WEEKLY : process.env.STRIPE_PRICE_ID_PLUS;
  if (!targetPriceId) throw new Error('Missing target price');
  const price = await stripe.prices.retrieve(targetPriceId);
  if (!price.active || price.currency !== 'usd' || price.unit_amount !== (interval === 'week' ? 499 : 1900) ||
      price.recurring?.interval !== interval || price.recurring.interval_count !== 1) throw new Error('Unexpected target price');
  const discount = interval === 'month' ? await introCheckoutDiscount(stripe, targetPriceId, !!details.introductory) : {};
  let schedule = existing;
  try {
    if (!schedule) schedule = await stripe.subscriptionSchedules.create({ from_subscription: subscription.id }, {
      idempotencyKey: `switch-create:${subscription.id}:${requestId}`,
    });
    if (schedule.status !== 'active' || !schedule.current_phase) throw new PlanSwitchError('Your billing cycle changed. Please reload and try again.');
    const phase = schedule.phases.find(p => p.start_date === schedule!.current_phase!.start_date);
    if (!phase || idOf(phase.items[0].price) !== subscription.items.data[0].price.id) throw new PlanSwitchError('Your billing plan changed. Please reload and try again.');
    const latest = await stripe.subscriptions.retrieve(subscription.id);
    if (latest.status !== 'active' || latest.cancel_at || latest.cancel_at_period_end ||
        latest.items.data[0]?.current_period_end !== subscription.items.data[0].current_period_end ||
        latest.items.data[0]?.price.id !== subscription.items.data[0].price.id) {
      throw new PlanSwitchError('Your subscription changed. Please reload before switching.');
    }
    const current = preservePhase(phase);
    const end = subscription.items.data[0].current_period_end;
    if (end <= Date.now() / 1000) throw new PlanSwitchError('Your renewal is processing. Please try again shortly.');
    await stripe.subscriptionSchedules.update(schedule.id, {
      end_behavior: 'release', proration_behavior: 'none',
      metadata: { plurilog_switch: OWNER, target_amount: String(details.amount), introductory: String(!!details.introductory) },
      phases: [
        { ...current, end_date: end },
        { ...current, start_date: end, end_date: undefined, duration: { interval, interval_count: 1 },
          items: [{ price: targetPriceId, quantity: 1 }], discounts: discount.discounts ?? '',
          billing_cycle_anchor: 'phase_start', proration_behavior: 'none' },
      ],
    }, { idempotencyKey: `switch-update:${subscription.id}:${requestId}` });
    return { ...details, pending: true };
  } catch (error) {
    // A failed configuration must not leave a new, empty schedule blocking Manage.
    if (!existing && schedule?.status === 'active') await stripe.subscriptionSchedules.release(schedule.id);
    throw error;
  }
}

export async function undoPlanSwitch(stripe: Stripe, schedule: Stripe.SubscriptionSchedule | null) {
  if (!schedule) return;
  if (schedule.metadata?.plurilog_switch !== OWNER) throw new PlanSwitchError('This billing change cannot be removed here.');
  // Releasing keeps the current subscription and its paid period intact.
  await stripe.subscriptionSchedules.release(schedule.id);
}
