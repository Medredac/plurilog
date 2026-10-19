import { NextResponse } from 'next/server';
import { createClient } from '@/utils/supabase/server';
import { initializePreviewCredits } from '@/lib/previewCredits';
import { requiresPaidEntry } from '@/lib/paidEntry';
export async function GET() {
  const supabase = await createClient();
  const { data: { user } } = await supabase.auth.getUser();
  if (!user) return NextResponse.json({ error: 'Not authenticated' }, { status: 401 });
  try { await initializePreviewCredits(user); }
  catch { return NextResponse.json({ error: 'Unable to initialize account balance' }, { status: 503 }); }
  const { data: rows, error } = await supabase.rpc('get_my_balance');
  const balance = rows?.[0];
  if (error || !balance) return NextResponse.json({ error: 'Unable to check access' }, { status: 503 });
  const requiresPlan = requiresPaidEntry(user.created_at, balance.plan);
  return NextResponse.json({
    requiresPlan,
    balance,
    blocked: requiresPlan || Number(balance.remaining_cents) <= 0,
  }, { headers: { 'Cache-Control': 'private, no-store' } });
}
