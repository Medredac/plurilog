import { NextResponse } from 'next/server';
import { stripe } from '@/lib/stripe';
import { createServiceClient } from '@/utils/supabase/service';
import Stripe from 'stripe';

const PLUS_MONTHLY_ALLOWANCE_CENTS = 900;

export async function POST(request: Request) {
  const body = await request.text(); // MUST be raw text, not .json() — signature verification requires the exact original bytes
  const signature = request.headers.get('stripe-signature');

  if (!signature) {
    return NextResponse.json({ error: 'Missing signature' }, { status: 400 });
  }

  let event: Stripe.Event;
  try {
    event = stripe.webhooks.constructEvent(body, signature, process.env.STRIPE_WEBHOOK_SECRET!);
  } catch (err: any) {
    console.error('[Stripe Webhook] Signature verification failed:', err.message);
    return NextResponse.json({ error: 'Invalid signature' }, { status: 400 });
  }

  const supabase = createServiceClient();

  try {
    switch (event.type) {
      case 'checkout.session.completed': {
        const session = event.data.object as Stripe.Checkout.Session;
        const userId = session.client_reference_id;
        if (!userId || !session.subscription) break;

        const subscriptionId = session.subscription as string;

        // Fetch profile BEFORE provisioning to check replay
        const { data: profile, error: profileFetchError } = await supabase
          .from('profiles')
          .select('id, plan, plan_status, stripe_subscription_id, current_period_end, period_reset_at')
          .eq('id', userId)
          .single();

        if (profileFetchError || !profile) {
          console.error(`[Stripe Webhook] Profile fetch failed for checkout.session.completed:`, profileFetchError);
          return NextResponse.json({ error: 'Failed to load profile for checkout provisioning' }, { status: 500 });
        }

        // Replay guard: same subscription ID must NEVER initialize credits twice, regardless of current plan.
        if (profile.stripe_subscription_id === subscriptionId) {
          console.log(`[Stripe Webhook] Duplicate checkout.session.completed for already-initialized subscription ${subscriptionId}, skipping credit grant.`);
          // If the profile is in terminal state (free/canceled), do NOT resurrect to paid.
          if (profile.plan === 'paid') {
            await supabase.from('profiles').update({
              stripe_customer_id: session.customer as string,
              updated_at: new Date().toISOString(),
            }).eq('id', userId);
          }
          break;
        }

        // Genuinely new subscription: retrieve periodEnd from Stripe
        const subscription = await stripe.subscriptions.retrieve(subscriptionId);
        const periodEndTimestamp = (subscription as any).current_period_end ?? ((subscription as any).items?.data?.[0])?.current_period_end;
        if (typeof periodEndTimestamp !== 'number' || periodEndTimestamp <= 0) {
          console.error(`[Stripe Webhook] Subscription ${subscriptionId} missing valid current_period_end timestamp.`);
          return NextResponse.json({ error: 'Subscription missing valid period end timestamp' }, { status: 500 });
        }
        const periodEnd = new Date(periodEndTimestamp * 1000).toISOString();

        const { error, count } = await supabase.from('profiles').update({
          plan: 'paid',
          plan_status: 'active',
          credits_cents: PLUS_MONTHLY_ALLOWANCE_CENTS,
          remaining_cents: PLUS_MONTHLY_ALLOWANCE_CENTS,
          total_spent_cents: 0,
          period_reset_at: periodEnd,
          current_period_end: periodEnd,
          stripe_customer_id: session.customer as string,
          stripe_subscription_id: subscriptionId,
          updated_at: new Date().toISOString(),
        }, { count: 'exact' }).eq('id', userId);

        if (error || count === 0) {
          console.error(`[Stripe Webhook] Supabase update failed for checkout.session.completed:`, error || 'matched 0 rows');
          return NextResponse.json({ error: 'Database update failed' }, { status: 500 });
        }

        console.log(`[Stripe Webhook] Upgraded user ${userId} to paid.`);
        break;
      }

      case 'invoice.paid': {
        const invoice = event.data.object as Stripe.Invoice;
        const subscriptionId = (
          (invoice as any).subscription ??
          (invoice as any).parent?.subscription_details?.subscription ??
          null
        ) as string | null;
        if (!subscriptionId) break;

        const customerId = typeof invoice.customer === 'string' ? invoice.customer : (invoice.customer as any)?.id;

        // Fetch matching profile by subscriptionId, falling back to customerId
        let { data: profile, error: profileError } = await supabase
          .from('profiles')
          .select('id, plan, plan_status, stripe_subscription_id, stripe_customer_id, current_period_end, period_reset_at')
          .eq('stripe_subscription_id', subscriptionId)
          .maybeSingle();

        if (!profile && customerId) {
          const fallback = await supabase
            .from('profiles')
            .select('id, plan, plan_status, stripe_subscription_id, stripe_customer_id, current_period_end, period_reset_at')
            .eq('stripe_customer_id', customerId)
            .maybeSingle();
          profile = fallback.data;
          profileError = fallback.error;
        }

        if (profileError) {
          console.error(`[Stripe Webhook] Error finding profile for invoice.paid:`, profileError);
          return NextResponse.json({ error: 'Database error fetching profile' }, { status: 500 });
        }

        if (!profile) {
          console.error(`[Stripe Webhook] No matching profile found for invoice.paid, subscriptionId: ${subscriptionId}`);
          return NextResponse.json({ error: 'Profile not found, retry later' }, { status: 500 });
        }

        // Subscription identity check
        if (profile.stripe_subscription_id && profile.stripe_subscription_id !== subscriptionId) {
          console.log(`[Stripe Webhook] invoice.paid for stale subscription ${subscriptionId} (current profile has ${profile.stripe_subscription_id}), ignoring.`);
          break;
        }

        // Stale invoice must NOT grant credits or resurrect paid access if user is free/canceled
        if (profile.plan !== 'paid') {
          console.log(`[Stripe Webhook] invoice.paid received for non-paid user (${profile.plan}), ignoring credit reset.`);
          break;
        }

        // Strictly identify the Plus recurring subscription line item from the immutable invoice lines
        const plusPriceId = process.env.STRIPE_PRICE_ID_PLUS;
        if (!plusPriceId) {
          console.error('[Stripe Webhook] Missing STRIPE_PRICE_ID_PLUS environment variable.');
          return NextResponse.json({ error: 'Server configuration error' }, { status: 500 });
        }

        const qualifyingLines = (invoice.lines?.data || []).filter((line) => {
          // Check subscription identity if exposed on line
          const lineSubId = typeof line.subscription === 'string'
            ? line.subscription
            : (line.subscription as any)?.id ?? line.parent?.subscription_item_details?.subscription;
          if (lineSubId && lineSubId !== subscriptionId) {
            return false;
          }

          // Exact Plus price ID match is REQUIRED
          const linePriceId = typeof line.pricing?.price_details?.price === 'string'
            ? line.pricing.price_details.price
            : (line.pricing?.price_details?.price as any)?.id ?? (line as any).price?.id;
          if (linePriceId !== plusPriceId) {
            return false;
          }

          // Must have a valid positive period.end timestamp
          return typeof line.period?.end === 'number' && line.period.end > 0;
        });

        if (qualifyingLines.length === 0) {
          console.error(`[Stripe Webhook] No matching Plurilog Plus subscription line found on invoice ${invoice.id} for subscription ${subscriptionId}`);
          return NextResponse.json({ error: 'No matching Plus subscription line on invoice' }, { status: 400 });
        }

        // Pick qualifying line with the greatest period.end (in case of proration + recurring line)
        const plusLine = qualifyingLines.reduce((latest, curr) => (curr.period.end > latest.period.end ? curr : latest), qualifyingLines[0]);
        const allowancePeriodEnd = new Date(plusLine.period.end * 1000).toISOString();

        // Calculate if this is a genuine new allowance period using actual timestamps
        const isNewAllowancePeriod =
          !profile.period_reset_at ||
          new Date(allowancePeriodEnd).getTime() > new Date(profile.period_reset_at).getTime();

        if (isNewAllowancePeriod) {
          // Grant allowance exactly once for this period
          const updatePayload = {
            plan_status: 'active',
            credits_cents: PLUS_MONTHLY_ALLOWANCE_CENTS,
            remaining_cents: PLUS_MONTHLY_ALLOWANCE_CENTS,
            total_spent_cents: 0,
            period_reset_at: allowancePeriodEnd,
            current_period_end: allowancePeriodEnd,
            stripe_subscription_id: subscriptionId,
            updated_at: new Date().toISOString(),
          };

          const { error, count } = await supabase
            .from('profiles')
            .update(updatePayload, { count: 'exact' })
            .eq('id', profile.id);

          if (error || count === 0) {
            console.error(`[Stripe Webhook] Supabase update failed for invoice.paid (new period):`, error || 'matched 0 rows');
            return NextResponse.json({ error: 'Database update failed' }, { status: 500 });
          }

          console.log(`[Stripe Webhook] Renewed subscription ${subscriptionId} and granted 900 cents allowance for period ending ${allowancePeriodEnd}.`);
        } else {
          // Same or older billing period: do NOT touch credits or spend
          const shouldUpdatePeriodEnd =
            !profile.current_period_end ||
            new Date(allowancePeriodEnd).getTime() >= new Date(profile.current_period_end).getTime();

          const reconcilePayload: Record<string, any> = {
            plan_status: 'active',
            stripe_subscription_id: subscriptionId,
            updated_at: new Date().toISOString(),
            ...(shouldUpdatePeriodEnd ? { current_period_end: allowancePeriodEnd } : {}),
          };

          const { error } = await supabase
            .from('profiles')
            .update(reconcilePayload, { count: 'exact' })
            .eq('id', profile.id);

          if (error) {
            console.error(`[Stripe Webhook] Supabase reconciliation failed for invoice.paid (same period):`, error);
            return NextResponse.json({ error: 'Database reconciliation failed' }, { status: 500 });
          }

          console.log(`[Stripe Webhook] invoice.paid replayed or unadvanced period for ${subscriptionId}; reconciled status without touching credits.`);
        }
        break;
      }

      case 'invoice.payment_failed': {
        const invoice = event.data.object as Stripe.Invoice;
        const subscriptionId = (
          (invoice as any).subscription ??
          (invoice as any).parent?.subscription_details?.subscription ??
          null
        ) as string | null;
        if (!subscriptionId) break;

        const { error, count } = await supabase.from('profiles').update({
          plan_status: 'past_due',
          updated_at: new Date().toISOString(),
        }, { count: 'exact' })
          .eq('stripe_subscription_id', subscriptionId)
          .neq('plan_status', 'canceled');

        if (error) {
          console.error(`[Stripe Webhook] Supabase update failed for invoice.payment_failed:`, error);
        } else if (count === 0) {
          console.error(`[Stripe Webhook] Supabase update matched 0 rows for invoice.payment_failed, subscriptionId: ${subscriptionId}`);
        }

        console.log(`[Stripe Webhook] Payment failed for subscription ${subscriptionId}, marked past_due.`);
        break;
      }

      case 'customer.subscription.updated': {
        const subscription = event.data.object as Stripe.Subscription;
        const subscriptionId = subscription.id;
        const periodEndTimestamp = (subscription as any).current_period_end ?? ((subscription as any).items?.data?.[0])?.current_period_end;
        const periodEnd = periodEndTimestamp ? new Date(periodEndTimestamp * 1000).toISOString() : null;

        const { error, count } = await supabase.from('profiles').update({
          plan_status: (subscription.status === 'past_due' || subscription.status === 'unpaid')
            ? 'past_due'
            : (subscription.cancel_at_period_end || subscription.cancel_at !== null)
              ? 'canceling'
              : 'active',
          ...(periodEnd ? { current_period_end: periodEnd } : {}),
          updated_at: new Date().toISOString(),
        }, { count: 'exact' }).eq('stripe_subscription_id', subscriptionId);

        if (error) {
          console.error(`[Stripe Webhook] Supabase update failed for customer.subscription.updated:`, error);
        } else if (count === 0) {
          console.error(`[Stripe Webhook] Supabase update matched 0 rows for customer.subscription.updated, subscriptionId: ${subscriptionId}`);
        }

        console.log(`[Stripe Webhook] Subscription ${subscription.id} updated — cancel_at: ${subscription.cancel_at}, cancel_at_period_end: ${subscription.cancel_at_period_end}`);
        break;
      }

      case 'customer.subscription.deleted': {
        const subscription = event.data.object as Stripe.Subscription;
        const subscriptionId = subscription.id;

        const { error, count } = await supabase.from('profiles').update({
          plan: 'free',
          plan_status: 'canceled',
          credits_cents: 50,
          remaining_cents: 0,
          updated_at: new Date().toISOString(),
        }, { count: 'exact' }).eq('stripe_subscription_id', subscriptionId);

        if (error) {
          console.error(`[Stripe Webhook] Supabase update failed for customer.subscription.deleted:`, error);
        } else if (count === 0) {
          console.error(`[Stripe Webhook] Supabase update matched 0 rows for customer.subscription.deleted, subscriptionId: ${subscriptionId}`);
        }

        console.log(`[Stripe Webhook] Subscription ${subscription.id} ended, reverted to free.`);
        break;
      }

      default:
        break;
    }
  } catch (err: any) {
    console.error('[Stripe Webhook] Error processing event:', err);
    return NextResponse.json({ error: 'Webhook processing failed' }, { status: 500 });
  }

  return NextResponse.json({ received: true });
}
