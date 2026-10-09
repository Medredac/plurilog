import { NextResponse } from 'next/server';
import { createClient } from '@/utils/supabase/server';
import { stripe } from '@/lib/stripe';
import { INTRO_TERMS, type PlusOffer } from '@/lib/plusPricing';
import { ExistingSubscriptionError, qualifiesForIntro } from '@/lib/stripeIntroOffer';

export async function GET() {
  const reply = (body: PlusOffer | { error: string }, status = 200) =>
    NextResponse.json(body, { status, headers: { 'Cache-Control': 'private, no-store' } });
  const supabase = await createClient();
  const { data: { user } } = await supabase.auth.getUser();
  if (!user) return reply({ error: 'Not authenticated' }, 401);
  const { data: profile, error } = await supabase.from('profiles')
    .select('plan, plan_status, stripe_customer_id, stripe_subscription_id').eq('id', user.id).single();
  if (error || !profile) return reply({ error: 'Unable to load billing details.' }, 500);
  try {
    if (profile.plan === 'paid') {
      if (profile.plan_status === 'canceling') {
        return reply({ amount: null, label: 'Cancellation scheduled', terms: 'Your plan will not renew.', canSubscribe: false });
      }
      if (!profile.stripe_customer_id || !profile.stripe_subscription_id) throw new Error('Missing billing account');
      // A preview never creates an invoice or charges a customer. It reflects
      // discounts, tax and credit balances instead of advertising a guessed price.
      const invoice = await stripe.invoices.createPreview({
        customer: profile.stripe_customer_id, subscription: profile.stripe_subscription_id,
      });
      if (invoice.currency !== 'usd') throw new Error('Unexpected billing currency');
      return reply({ amount: invoice.amount_due / 100, label: 'Next payment', terms: 'USD. Manage your subscription for billing details.', canSubscribe: false });
    }
    const eligible = await qualifiesForIntro(stripe, profile);
    return reply({
      amount: eligible ? 9 : 19,
      label: eligible ? 'Introductory offer' : 'Plus',
      terms: eligible ? INTRO_TERMS : 'USD. Billed monthly. Cancel anytime.',
      canSubscribe: true,
    });
  } catch (error) {
    if (error instanceof ExistingSubscriptionError) {
      return reply({ amount: null, label: 'Subscription exists', terms: error.message, canSubscribe: false });
    }
    console.error('[Stripe Offer] Unable to load pricing:', error);
    return reply({ error: 'Unable to load pricing. Please close and reopen this window to retry.' }, 503);
  }
}
