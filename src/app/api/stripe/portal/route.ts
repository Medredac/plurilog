import { initializePreviewCredits } from '@/lib/previewCredits';
import { billingProfileTable } from '@/lib/billingEnvironment';
import { NextResponse } from 'next/server';
import { createClient } from '@/utils/supabase/server';
import { stripe } from '@/lib/stripe';

export async function POST(request: Request) {
  const supabase = await createClient();
  const { data: { user } } = await supabase.auth.getUser();

  if (!user) {
    return NextResponse.json({ error: 'Not authenticated' }, { status: 401 });
  }

  await initializePreviewCredits(user);
  const { data: profile, error } = await supabase
    .from(billingProfileTable())
    .select('stripe_customer_id')
    .eq('id', user.id)
    .single();

  if (error || !profile?.stripe_customer_id) {
    return NextResponse.json({ error: 'No Stripe customer found for this account' }, { status: 400 });
  }

  const origin = new URL(request.url).origin;

  const session = await stripe.billingPortal.sessions.create({
    customer: profile.stripe_customer_id,
    ...(process.env.STRIPE_PLUS_PORTAL_CONFIGURATION_ID ? { configuration: process.env.STRIPE_PLUS_PORTAL_CONFIGURATION_ID } : {}),
    return_url: `${origin}/dashboard`,
  });

  return NextResponse.json({ url: session.url });
}
