import { isConnectedAppId } from '@/lib/integrations/catalog';
import { AppAccessError, beginGoogleConnection, googleAppsAvailable, integrationOrigin } from '@/lib/integrations/googleConnection';
import { integrationUser, sameOrigin, PRIVATE_HEADERS } from '@/lib/integrations/http';
export async function POST(request: Request) {
  const user = await integrationUser();
  if (!user) return Response.json({ error: 'Sign in to connect an app.' }, { status: 401, headers: PRIVATE_HEADERS });
  try {
    const body = await request.json();
    if (!isConnectedAppId(body.app)) return Response.json({ error: 'Choose Gmail or Google Drive.' }, { status: 400 });
    if (!sameOrigin(request)) {
      // Deployment-specific URLs are normal Vercel entrypoints. Move the user
      // to the configured callback origin before starting any authorization.
      if (!googleAppsAvailable() || request.headers.get('origin') !== new URL(request.url).origin) {
        return Response.json({ error: 'Open Plurilog to connect this app.' }, { status: 403, headers: PRIVATE_HEADERS });
      }
      return Response.json({ url: `${integrationOrigin()}/dashboard?connectApp=${body.app}` }, { headers: PRIVATE_HEADERS });
    }
    return Response.json({ url: await beginGoogleConnection(user.id, body.app) }, { headers: PRIVATE_HEADERS });
  } catch (error) {
    return Response.json({ error: error instanceof AppAccessError && error.status === 'setup_required' ? 'Google connections still need administrator setup.' : 'Could not start Google authorization. Please try again.' }, { status: 503, headers: PRIVATE_HEADERS });
  }
}
