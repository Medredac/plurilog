import { NextResponse } from 'next/server';
import { createClient } from '@/utils/supabase/server';
import { stripe } from '@/lib/stripe';
import { hasUsedIntro, introCheckoutDiscount } from '@/lib/stripeIntroOffer';

const KEY = 'plus_promotion_9_3_v1_dismissed';
const reply = (body: object, status = 200) => NextResponse.json(body, {
  status, headers: { 'Cache-Control': 'private, no-store' },
});

export async function GET() {
  const supabase = await createClient();
  const { data: { user }, error } = await supabase.auth.getUser();
  if (error || !user) return reply({ error: 'Not authenticated' }, 401);
  if (user.user_metadata?.[KEY] === true) return reply({ dismissed: true });
  const { data: profile, error: profileError } = await supabase.from('profiles')
    .select('plan, plan_status, stripe_customer_id, stripe_subscription_id').eq('id', user.id).single();
  if (profileError || !profile) return reply({ error: 'Unable to load profile' }, 503);
  if (profile.plan !== 'paid') return reply({ dismissed: false });
  if (profile.plan_status !== 'canceling') return reply({ dismissed: false, activePlus: true });
  try {
    if (!profile.stripe_customer_id || !profile.stripe_subscription_id) throw new Error('Missing billing account');
    const subscription = await stripe.subscriptions.retrieve(profile.stripe_subscription_id);
    const item = subscription.items.data[0];
    const customer = typeof subscription.customer === 'string' ? subscription.customer : subscription.customer.id;
    const priceId = process.env.STRIPE_PRICE_ID_PLUS;
    // Match the existing signed-webhook resumption rules; opening this popup
    // does not change cancellation, discounts, billing dates or subscriptions.
    if (!priceId || customer !== profile.stripe_customer_id || subscription.status !== 'active' ||
        !(subscription.cancel_at_period_end || subscription.cancel_at) ||
        subscription.items.data.length !== 1 || item?.price.id !== priceId || item.quantity !== 1 ||
        subscription.discounts.length || item.discounts.length || await hasUsedIntro(stripe, customer)) {
      return reply({ dismissed: false, activePlus: true });
    }
    await introCheckoutDiscount(stripe, priceId, true);
    return reply({ dismissed: false, renewalOffer: {
      amount: 9, label: 'Limited-time offer', canSubscribe: true,
      terms: 'For your next 3 monthly payments after renewal, then $19/month.',
    } });
  } catch {
    return reply({ error: 'Unable to verify renewal offer' }, 503);
  }
}

export async function POST() {
  const supabase = await createClient();
  const { data: { user }, error } = await supabase.auth.getUser();
  if (error || !user) return reply({ error: 'Not authenticated' }, 401);
  // This user-editable preference only controls a popup, never billing or access.
  // Supabase merges this field with existing metadata; no profile migration needed.
  if (user.user_metadata?.[KEY] !== true) {
    const { error: saveError } = await supabase.auth.updateUser({ data: { [KEY]: true } });
    if (saveError) return reply({ error: 'Unable to save preference' }, 503);
  }
  return reply({ dismissed: true });
}
