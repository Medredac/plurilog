import { createClient } from '@/utils/supabase/server';
import { integrationOrigin } from './googleConnection';
export const PRIVATE_HEADERS = { 'Cache-Control': 'private, no-store' };
export async function integrationUser() {
  const supabase = await createClient();
  const { data: { user }, error } = await supabase.auth.getUser();
  return !error ? user : null;
}
export function sameOrigin(request: Request): boolean {
  try { return request.headers.get('origin') === integrationOrigin() && new URL(request.url).origin === integrationOrigin(); }
  catch { return false; }
}
