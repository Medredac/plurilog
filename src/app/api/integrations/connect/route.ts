import { isConnectedAppId } from '@/lib/integrations/catalog';
import { AppAccessError, beginGoogleConnection } from '@/lib/integrations/googleConnection';
import { integrationUser, sameOrigin, PRIVATE_HEADERS } from '@/lib/integrations/http';
export async function POST(request: Request) {
  const user = await integrationUser();
  if (!user) return Response.json({ error: 'Sign in to connect an app.' }, { status: 401, headers: PRIVATE_HEADERS });
  if (!sameOrigin(request)) return Response.json({ error: 'Open the stable preview to connect.' }, { status: 403, headers: PRIVATE_HEADERS });
  try {
    const body = await request.json();
    if (!isConnectedAppId(body.app)) return Response.json({ error: 'Choose Gmail or Google Drive.' }, { status: 400 });
    return Response.json({ url: await beginGoogleConnection(user.id, body.app) }, { headers: PRIVATE_HEADERS });
  } catch (error) {
    return Response.json({ error: error instanceof AppAccessError && error.status === 'setup_required' ? 'Google connections still need administrator setup.' : 'Could not start Google authorization. Please try again.' }, { status: 503, headers: PRIVATE_HEADERS });
  }
}
