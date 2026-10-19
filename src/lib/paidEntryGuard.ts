import { createClient } from '@/utils/supabase/server';
import { paidEntryCutoff, requiresPaidEntry } from './paidEntry';
export async function paidEntryGuard(): Promise<Response | null> {
  if (!paidEntryCutoff()) return null;
  const supabase = await createClient();
  const { data: { user } } = await supabase.auth.getUser();
  if (!user) return Response.json({ error: 'Not authenticated' }, { status: 401 });
  if (!requiresPaidEntry(user.created_at, 'free')) return null;
  const { data: profile, error } = await supabase.from('profiles').select('plan').eq('id', user.id).single();
  if (error || !profile) return Response.json({ error: 'Unable to verify account access.' }, { status: 503 });
  return requiresPaidEntry(user.created_at, profile.plan)
    ? Response.json({ error: 'Choose a plan to continue.', code: 'PLAN_REQUIRED' }, { status: 402 })
    : null;
}
