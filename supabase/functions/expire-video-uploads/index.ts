import { createClient } from 'npm:@supabase/supabase-js@2.112.3';

// Custom authentication: the service-only RPC checks the supplied secret against
// Vault before returning any candidates. No caller can supply deletion paths.
Deno.serve(async (request: Request) => {
  if (request.method !== 'POST') return new Response(null, { status: 405 });
  const token = request.headers.get('x-video-cleanup-token');
  if (!token || token.length > 256) return new Response(null, { status: 401 });
  const client = createClient(Deno.env.get('SUPABASE_URL')!, Deno.env.get('SUPABASE_SERVICE_ROLE_KEY')!, {
    auth: { persistSession: false, autoRefreshToken: false },
  });
  const { data, error } = await client.rpc('expired_video_upload_paths', { p_token: token });
  if (error) return new Response(null, { status: error.code === '42501' ? 401 : 503 });
  const paths = data as string[];
  if (!Array.isArray(paths) || paths.some(path => !/^[0-9a-f-]{36}\/video-ephemeral-v1\/[^/]+\.(mp4|mov|webm)$/i.test(path))) {
    return new Response(null, { status: 500 });
  }
  if (!paths.length) return Response.json({ removed: 0 });
  // Storage API deletes actual bytes too. Never DELETE storage.objects via SQL.
  const removed = await client.storage.from('message-images').remove(paths);
  if (removed.error) return new Response(null, { status: 503 });
  return Response.json({ removed: removed.data?.length ?? 0 });
});
