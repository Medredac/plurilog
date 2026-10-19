import { isBillingPreview, paidEntryCutoff } from './paidEntry';
import { createServiceClient } from '@/utils/supabase/service';

export async function initializePreviewCredits(user: { id: string; created_at: string }) {
  if (!isBillingPreview()) return;
  const cutoff = paidEntryCutoff();
  if (!cutoff || Date.parse(user.created_at) < Date.parse(cutoff)) return;
  // The database's one-time marker and conditional UPDATE preserve later manual
  // balance edits and concurrent payment grants. Never change signup defaults.
  const { error } = await createServiceClient().rpc('initialize_preview_credits', {
    p_user_id: user.id, p_cutoff: cutoff,
  });
  if (error) throw new Error('Unable to initialize preview allowance.');
}
