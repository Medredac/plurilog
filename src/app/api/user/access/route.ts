import { NextResponse } from 'next/server';
import { createClient } from '@/utils/supabase/server';
import { requiresPaidEntry } from '@/lib/paidEntry';
export async function GET() {
  const supabase = await createClient();
  const { data: { user } } = await supabase.auth.getUser();
  if (!user) return NextResponse.json({ error: 'Not authenticated' }, { status: 401 });
  const { data: profile, error } = await supabase.from('profiles').select('plan').eq('id', user.id).single();
  if (error || !profile) return NextResponse.json({ error: 'Unable to check access' }, { status: 503 });
  return NextResponse.json({ requiresPlan: requiresPaidEntry(user.created_at, profile.plan) }, { headers: { 'Cache-Control': 'private, no-store' } });
}
