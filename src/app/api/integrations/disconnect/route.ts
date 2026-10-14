import { isConnectedAppId } from '@/lib/integrations/catalog';
import { disconnectGoogle } from '@/lib/integrations/googleConnection';
import { integrationUser, sameOrigin, PRIVATE_HEADERS } from '@/lib/integrations/http';
export async function POST(request: Request) {
  const user = await integrationUser();
  if (!user) return Response.json({ error: 'Sign in to manage your apps.' }, { status: 401, headers: PRIVATE_HEADERS });
  if (!sameOrigin(request)) return Response.json({ error: 'Open the stable preview to disconnect.' }, { status: 403, headers: PRIVATE_HEADERS });
  try {
    const body = await request.json();
    if (!isConnectedAppId(body.app)) return Response.json({ error: 'Invalid app.' }, { status: 400 });
    await disconnectGoogle(user.id, body.app);
    return Response.json({ disconnected: true }, { headers: PRIVATE_HEADERS });
  } catch { return Response.json({ error: 'Could not disconnect. Please try again.' }, { status: 503, headers: PRIVATE_HEADERS }); }
}
