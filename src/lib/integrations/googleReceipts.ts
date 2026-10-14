import 'server-only';
import { createServiceClient } from '@/utils/supabase/service';
import { decryptGoogle, encryptGoogle } from './googleCrypto';
export async function reserveGoogleAction(userId: string, runId: string, fingerprint: string): Promise<{ reserved: true } | { reserved: false; result: Record<string, unknown> }> {
  const database = createServiceClient();
  const { error } = await database.from('preview_google_action_receipts').insert({ user_id: userId, run_id: runId, fingerprint });
  if (!error) return { reserved: true };
  if (error.code !== '23505') throw new Error('Action receipt unavailable');
  const { data, error: readError } = await database.from('preview_google_action_receipts').select('encrypted_result').eq('user_id', userId).eq('run_id', runId).eq('fingerprint', fingerprint).maybeSingle();
  if (readError || !data) throw new Error('Action receipt unavailable');
  return { reserved: false, result: data.encrypted_result ? decryptGoogle<Record<string, unknown>>(data.encrypted_result, `receipt:${userId}:${runId}:${fingerprint}`) : { status: 'error', code: 'pending_or_unknown_previous_action', message: 'This action was already started. Do not repeat it. Inspect Google before retrying.' } };
}
export async function finishGoogleAction(userId: string, runId: string, fingerprint: string, result: Record<string, unknown>) {
  const { error } = await createServiceClient().from('preview_google_action_receipts').update({ encrypted_result: encryptGoogle(result, `receipt:${userId}:${runId}:${fingerprint}`) }).eq('user_id', userId).eq('run_id', runId).eq('fingerprint', fingerprint);
  if (error) throw new Error('Action receipt unavailable');
}
