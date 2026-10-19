import { NextResponse } from 'next/server';
import { createClient } from '@/utils/supabase/server';
import { requiresPaidEntry } from '@/lib/paidEntry';
export async function GET() {
  const supabase = await createClient();
  const { data: { user } } = await supabase.auth.getUser();
  if (!user) return NextResponse.json({ error: 'Not authenticated' }, { status: 401 });
  const { data: rows, error } = await supabase.rpc('get_my_balance');
  const balance = rows?.[0];
  if (error || !balance) return NextResponse.json({ error: 'Unable to check access' }, { status: 503 });
  const requiresPlan = requiresPaidEntry(user.created_at, balance.plan);
  // Preview shares its database with production. Return the allowance usable in
  // this environment without changing production's signup grant or stored balance.
  return NextResponse.json({
    requiresPlan,
    balance: requiresPlan ? { ...balance, credits_cents: 0, remaining_cents: 0 } : balance,
  }, { headers: { 'Cache-Control': 'private, no-store' } });
}
