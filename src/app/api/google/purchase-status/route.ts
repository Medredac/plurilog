import { NextResponse } from 'next/server';
import { createClient } from '@/utils/supabase/server';
import { stripe } from '@/lib/stripe';

export const dynamic = 'force-dynamic';

export async function GET(request: Request) {
  const supabase = await createClient();
  const {
    data: { user },
  } = await supabase.auth.getUser();

  if (!user) {
    return NextResponse.json({ error: 'Not authenticated' }, { status: 401 });
  }

  const { searchParams } = new URL(request.url);
  const sessionId = searchParams.get('session_id')?.trim();

  if (!sessionId) {
    return NextResponse.json({ error: 'Missing session_id' }, { status: 400 });
  }

  try {
    const session = await stripe.checkout.sessions.retrieve(sessionId);

    if (
      session.client_reference_id !== user.id ||
      session.mode !== 'subscription' ||
      session.payment_status !== 'paid' ||
      typeof session.amount_total !== 'number' ||
      session.amount_total <= 0 ||
      !session.currency
    ) {
      return NextResponse.json(
        { verified: false },
        {
          status: 409,
          headers: { 'Cache-Control': 'private, no-store, max-age=0' },
        }
      );
    }

    return NextResponse.json(
      {
        verified: true,
        value: session.amount_total / 100,
        currency: session.currency.toUpperCase(),
        transactionId: session.id,
        email: user.email || null,
      },
      {
        headers: { 'Cache-Control': 'private, no-store, max-age=0' },
      }
    );
  } catch (error) {
    console.warn('[Google Ads] Failed to verify Checkout Session:', error);
    return NextResponse.json(
      { error: 'Unable to verify purchase' },
      { status: 404 }
    );
  }
}
