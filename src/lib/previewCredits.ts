import { isSandboxBilling } from './billingEnvironment';
import { isBillingPreview, paidEntryCutoff } from './paidEntry';
import { createServiceClient } from '@/utils/supabase/service';

export async function initializePreviewCredits(user: { id: string; created_at: string }) {
  if (!isBillingPreview()) return;
  const cutoff = paidEntryCutoff();
  const existingAccount = Number.isFinite(Date.parse(user.created_at)) && Date.parse(user.created_at) < Date.parse(cutoff);
  const service = createServiceClient();
  // Zero only new accounts visiting this preview, once. Preserve existing users
  // and any manual edits after initialization; production signup is unchanged.
  if (cutoff && !existingAccount) {
    const { error } = await service.rpc('initialize_preview_credits', {
      p_user_id: user.id, p_cutoff: cutoff,
    });
    if (error) throw new Error('Unable to initialize preview allowance.');
  }
  if (isSandboxBilling()) {
    let seed = { id: user.id, credits_cents: 0, remaining_cents: 0 };
    if (existingAccount) {
      const { data, error } = await service.from('profiles')
        .select('credits_cents, remaining_cents').eq('id', user.id).single();
      if (error || !data) throw new Error('Unable to preserve existing allowance.');
      seed = { id: user.id, credits_cents: Number(data.credits_cents), remaining_cents: Number(data.remaining_cents) };
    }
    // Do not copy live Stripe identifiers or overwrite a sandbox balance.
    const { error } = await service.from('stripe_sandbox_profiles')
      .upsert(seed, { onConflict: 'id', ignoreDuplicates: true });
    if (error) throw new Error('Unable to initialize sandbox billing.');
  }
}
