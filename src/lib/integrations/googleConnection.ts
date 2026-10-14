import 'server-only';
import { getToken, startAuthorization, revokeToken, NoValidTokenError, UserAuthorizationRequiredError } from '@vercel/connect';
import { ConnectedAppId } from './catalog';

export const GOOGLE_SCOPES: Record<ConnectedAppId, string[]> = {
  gmail: ['https://www.googleapis.com/auth/gmail.modify'],
  'google-drive': ['https://www.googleapis.com/auth/drive.file'],
};
export class AppAccessError extends Error {
  constructor(public readonly status: 'setup_required' | 'connection_required' | 'unavailable') { super(status); }
}
export function connectorFor(app: ConnectedAppId): string {
  // This release is deliberately confined to preview. A production rollout requires a separate review.
  if (process.env.VERCEL_ENV !== 'preview' || process.env.VERCEL_GIT_COMMIT_REF !== 'feat/google-apps-preview' || process.env.GOOGLE_APPS_ENABLED !== 'true') throw new AppAccessError('setup_required');
  const connector = process.env[app === 'gmail' ? 'GOOGLE_GMAIL_CONNECTOR' : 'GOOGLE_DRIVE_CONNECTOR'];
  if (!connector) throw new AppAccessError('setup_required');
  return connector;
}
export function googleAppsAvailable(): boolean {
  try { connectorFor('gmail'); connectorFor('google-drive'); return true; }
  catch { return false; }
}
export function googleSubject(userId: string, app: ConnectedAppId) {
  if (!userId) throw new AppAccessError('connection_required');
  return { type: 'user' as const, id: `plurilog-preview:${app}:${userId}` };
}
export function integrationOrigin(): string {
  const value = process.env.GOOGLE_APPS_ORIGIN;
  if (!value) throw new AppAccessError('setup_required');
  const url = new URL(value);
  if (url.protocol !== 'https:' || url.origin !== value) throw new AppAccessError('setup_required');
  return url.origin;
}
export async function googleToken(userId: string, app: ConnectedAppId): Promise<string> {
  const connector = connectorFor(app);
  try {
    // Revalidate grants on every operation so disconnects affect other instances immediately.
    return await getToken(connector, { subject: googleSubject(userId, app), scopes: GOOGLE_SCOPES[app] }, { forceRefresh: true });
  } catch (error) {
    if (error instanceof NoValidTokenError || error instanceof UserAuthorizationRequiredError) throw new AppAccessError('connection_required');
    throw new AppAccessError('unavailable');
  }
}
export async function connectionStatus(userId: string, app: ConnectedAppId) {
  try {
    await googleToken(userId, app);
    return { id: app, status: 'connected', connected: true };
  } catch (error) {
    return { id: app, status: error instanceof AppAccessError ? error.status : 'unavailable', connected: false };
  }
}
export async function beginGoogleConnection(userId: string, app: ConnectedAppId) {
  const response = await startAuthorization(connectorFor(app), {
    subject: googleSubject(userId, app), scopes: GOOGLE_SCOPES[app],
  }, { callbackUrl: `${integrationOrigin()}/dashboard?connectApp=${app}`, expiresInMs: 600_000 });
  // Return only the navigation URL. Never expose the verifier, tokens, or metadata to models.
  const url = new URL(response.url);
  if (url.protocol !== 'https:') throw new AppAccessError('unavailable');
  return url.href;
}
export async function disconnectGoogle(userId: string, app: ConnectedAppId) {
  await revokeToken(connectorFor(app), { subject: googleSubject(userId, app) });
}
