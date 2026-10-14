import { googleToken } from '@/lib/integrations/googleConnection';
import { integrationUser, sameOrigin, PRIVATE_HEADERS } from '@/lib/integrations/http';
export async function POST(request: Request) {
  const user = await integrationUser();
  if (!user) return Response.json({ error: 'Sign in first.' }, { status: 401, headers: PRIVATE_HEADERS });
  if (!sameOrigin(request)) return Response.json({ error: 'Open the stable preview.' }, { status: 403, headers: PRIVATE_HEADERS });
  try {
    const developerKey = process.env.GOOGLE_PICKER_API_KEY;
    const appId = process.env.GOOGLE_CLOUD_PROJECT_NUMBER;
    if (!developerKey || !appId) throw new Error('Picker unavailable');
    // Google Picker requires the user's short-lived drive.file token in the browser.
    // It never enters chat, logs, localStorage, or the model's context.
    return Response.json({ accessToken: await googleToken(user.id, 'google-drive'), developerKey, appId }, { headers: PRIVATE_HEADERS });
  } catch { return Response.json({ error: 'The file chooser is unavailable. Connect Drive or try again later.' }, { status: 503, headers: PRIVATE_HEADERS }); }
}
