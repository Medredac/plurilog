import { NextResponse } from 'next/server';
import { stripe } from '@/lib/stripe';
import { createServiceClient } from '@/utils/supabase/service';
import Stripe from 'stripe';

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

        const subscription = await stripe.subscriptions.retrieve(session.subscription as string);
        const periodEndTimestamp = (subscription as any).current_period_end ?? ((subscription as any).items?.data?.[0])?.current_period_end ?? (Date.now() / 1000 + 30 * 24 * 3600);
        const periodEnd = new Date(periodEndTimestamp * 1000).toISOString();

        await supabase.from('profiles').update({
          plan: 'paid',
          plan_status: 'active',
          credits_cents: 600,
          remaining_cents: 600,
          total_spent_cents: 0,
          period_reset_at: periodEnd,
          current_period_end: periodEnd,
          stripe_customer_id: session.customer as string,
          stripe_subscription_id: session.subscription as string,
          updated_at: new Date().toISOString(),
        }).eq('id', userId);

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

        const subscription = await stripe.subscriptions.retrieve(subscriptionId);
        const periodEndTimestamp = (subscription as any).current_period_end ?? ((subscription as any).items?.data?.[0])?.current_period_end ?? (Date.now() / 1000 + 30 * 24 * 3600);
        const periodEnd = new Date(periodEndTimestamp * 1000).toISOString();

        await supabase.from('profiles').update({
          plan_status: 'active',
          remaining_cents: 600,
          total_spent_cents: 0,
          period_reset_at: periodEnd,
          current_period_end: periodEnd,
          updated_at: new Date().toISOString(),
        }).eq('stripe_subscription_id', subscriptionId);

        console.log(`[Stripe Webhook] Renewed subscription ${subscriptionId}.`);
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

        await supabase.from('profiles').update({
          plan_status: 'past_due',
          updated_at: new Date().toISOString(),
        }).eq('stripe_subscription_id', subscriptionId);

        console.log(`[Stripe Webhook] Payment failed for subscription ${subscriptionId}, marked past_due.`);
        break;
      }

      case 'customer.subscription.updated': {
        const subscription = event.data.object as Stripe.Subscription;
        const periodEndTimestamp = (subscription as any).current_period_end ?? ((subscription as any).items?.data?.[0])?.current_period_end;
        const periodEnd = periodEndTimestamp ? new Date(periodEndTimestamp * 1000).toISOString() : null;

        await supabase.from('profiles').update({
          plan_status: (subscription.cancel_at_period_end || subscription.cancel_at !== null) ? 'canceling' : 'active',
          ...(periodEnd ? { current_period_end: periodEnd, period_reset_at: periodEnd } : {}),
          updated_at: new Date().toISOString(),
        }).eq('stripe_subscription_id', subscription.id);

        console.log(`[Stripe Webhook] Subscription ${subscription.id} updated — cancel_at: ${subscription.cancel_at}, cancel_at_period_end: ${subscription.cancel_at_period_end}`);
        break;
      }

      case 'customer.subscription.deleted': {
        const subscription = event.data.object as Stripe.Subscription;

        await supabase.from('profiles').update({
          plan: 'free',
          plan_status: 'canceled',
          credits_cents: 50,
          remaining_cents: 0,
          period_reset_at: null,
          updated_at: new Date().toISOString(),
        }).eq('stripe_subscription_id', subscription.id);

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
