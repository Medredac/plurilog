import { NextResponse } from 'next/server';
import { createClient } from '@/utils/supabase/server';
import { stripe } from '@/lib/stripe';
import { isBillingPreview } from '@/lib/paidEntry';
import { isPlusPlan } from '@/lib/plans';
import { loadSwitchSubscription, switchDetails, schedulePlanSwitch, undoPlanSwitch, PlanSwitchError } from '@/lib/stripePlanSwitch';

async function handle(request: Request) {
  const reply = (body: unknown, status = 200) => NextResponse.json(body, { status, headers: { 'Cache-Control': 'private, no-store' } });
  if (!isBillingPreview() && request.method === 'POST') return reply({ error: 'Not found' }, 404);
  const db = await createClient();
  const { data: { user } } = await db.auth.getUser();
  if (!user) return reply({ error: 'Not authenticated' }, 401);
  const { data: profile, error } = await db.from('profiles').select('plan, stripe_subscription_id, stripe_customer_id').eq('id', user.id).single();
  if (error) return reply({ error: 'Unable to load billing details.' }, 503);
  if (!isPlusPlan(profile?.plan) || !profile.stripe_subscription_id || !profile.stripe_customer_id) {
    return reply({ available: false, reason: 'No active Stripe subscription to change.' }, request.method === 'GET' ? 200 : 409);
  }
  try {
    const { subscription, schedule } = await loadSwitchSubscription(stripe, profile.stripe_subscription_id, profile.stripe_customer_id);
    if (request.method === 'GET') {
      const details = await switchDetails(stripe, subscription, schedule);
      return reply(!isBillingPreview() && !details.pending ? { available: false } : details);
    }
    if (request.method === 'DELETE') {
      await undoPlanSwitch(stripe, schedule);
      return reply(isBillingPreview() ? await switchDetails(stripe, subscription, null) : { available: false });
    }
    const body = await request.json();
    if (!['week', 'month'].includes(body.interval) || typeof body.requestId !== 'string' || !/^[a-zA-Z0-9-]{16,64}$/.test(body.requestId)) {
      return reply({ error: 'Invalid plan change.' }, 400);
    }
    const quote = await switchDetails(stripe, subscription, schedule);
    if (quote.amount !== body.amount || quote.effectiveAt !== body.effectiveAt) return reply({ error: 'Your billing details changed. Please reopen Account settings before confirming.' }, 409);
    return reply(await schedulePlanSwitch(stripe, subscription, schedule, body.interval, body.requestId));
  } catch (error) {
    if (error instanceof PlanSwitchError) return request.method === 'GET'
      ? reply({ available: false, reason: error.message }) : reply({ error: error.message }, 409);
    console.error('[Stripe switch]', error);
    return reply({ error: 'Unable to change your plan. Please try again.' }, 503);
  }
}
export const GET = handle;
export const POST = handle;
export const DELETE = handle;
