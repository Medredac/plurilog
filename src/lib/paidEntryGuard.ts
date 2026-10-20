import { balanceRpc } from '@/lib/billingEnvironment';
import { initializePreviewCredits } from './previewCredits';
import { createClient } from '@/utils/supabase/server';
import { hasUsableBalance } from './paidEntry';
export async function paidEntryGuard(): Promise<Response | null> {
  const supabase = await createClient();
  const { data: { user } } = await supabase.auth.getUser();
  if (!user) return Response.json({ error: 'Not authenticated' }, { status: 401 });
  try { await initializePreviewCredits(user); }
  catch { return Response.json({ error: 'Unable to initialize account balance.' }, { status: 503 }); }
  const { data: rows, error } = await supabase.rpc(balanceRpc());
  const profile = rows?.[0];
  if (error || !profile) return Response.json({ error: 'Unable to verify account access.' }, { status: 503 });
  return !hasUsableBalance(profile.remaining_cents)
    ? Response.json({ error: 'Choose a plan to continue.', code: 'PLAN_REQUIRED' }, { status: 402 })
    : null;
}
