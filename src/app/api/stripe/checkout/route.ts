import { NextResponse } from 'next/server';
import { createClient } from '@/utils/supabase/server';
import { stripe } from '@/lib/stripe';

export async function POST(request: Request) {
  const supabase = await createClient();
  const { data: { user } } = await supabase.auth.getUser();

  if (!user) {
    return NextResponse.json({ error: 'Not authenticated' }, { status: 401 });
  }

  const { data: profile, error: profileError } = await supabase
    .from('profiles')
    .select('plan, plan_status, stripe_customer_id, stripe_subscription_id')
    .eq('id', user.id)
    .single();

  if (profileError || !profile) {
    console.error('[Stripe Checkout] Profile fetch error or missing profile:', profileError);
    return NextResponse.json(
      { error: 'Unable to verify account status. Please try again later.' },
      { status: 500 }
    );
  }

  // Backend duplicate-subscription guard: block non-terminal paid subscriptions
  const nonTerminalStatuses = ['active', 'canceling', 'past_due', 'unpaid', 'trialing'];
  if (profile?.plan === 'paid' && profile.plan_status && nonTerminalStatuses.includes(profile.plan_status)) {
    return NextResponse.json(
      { error: 'An active or pending subscription already exists. Please manage your subscription in Account Settings.' },
      { status: 400 }
    );
  }

  const origin = new URL(request.url).origin;

  const sessionParams: any = {
    mode: 'subscription',
    client_reference_id: user.id,
    line_items: [{ price: process.env.STRIPE_PRICE_ID_PLUS!, quantity: 1 }],
    success_url: `${origin}/dashboard?upgraded=true`,
    cancel_url: `${origin}/dashboard`,
  };

  // Reuse existing Stripe Customer if present; otherwise pass customer_email
  if (profile?.stripe_customer_id) {
    sessionParams.customer = profile.stripe_customer_id;
  } else {
    sessionParams.customer_email = user.email;
  }

  const idempotencyKey = `checkout:${user.id}:${profile?.stripe_subscription_id ?? 'none'}`;

  const session = await stripe.checkout.sessions.create(sessionParams, {
    idempotencyKey,
  });

  return NextResponse.json({ url: session.url });
}
