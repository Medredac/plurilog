import { createClient } from '@/utils/supabase/server';
import { CONNECTED_APPS } from '@/lib/integrations/catalog';

export async function GET() {
  const supabase = await createClient();
  const { data: { user }, error } = await supabase.auth.getUser();
  if (error || !user) return Response.json({ error: 'Sign in to manage your apps.' }, { status: 401 });
  // Fail closed until OAuth and its account/token store are implemented.
  // Never derive a connection from Google sign-in or client-side state.
  return Response.json({
    apps: CONNECTED_APPS.map(app => ({ id: app.id, status: 'setup_required', connected: false })),
  }, { headers: { 'Cache-Control': 'private, no-store' } });
}
