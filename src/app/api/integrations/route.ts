import { CONNECTED_APPS } from '@/lib/integrations/catalog';
import { connectionStatus } from '@/lib/integrations/googleConnection';
import { integrationUser, PRIVATE_HEADERS } from '@/lib/integrations/http';
export async function GET() {
  const user = await integrationUser();
  if (!user) return Response.json({ error: 'Sign in to manage your apps.' }, { status: 401, headers: PRIVATE_HEADERS });
  return Response.json({ apps: await Promise.all(CONNECTED_APPS.map(app => connectionStatus(user.id, app.id))) }, { headers: PRIVATE_HEADERS });
}
