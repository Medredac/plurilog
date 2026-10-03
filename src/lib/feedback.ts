import { createHash, randomBytes } from 'crypto';
import { createServiceClient } from '@/utils/supabase/service';

export type FeedbackType = 'cancellation' | 'product' | 'support' | 'other';

const FEEDBACK_TOKEN_PATTERN = /^[A-Za-z0-9_-]{32,128}$/;
const DEFAULT_FEEDBACK_TTL_DAYS = 30;
const MAX_FEEDBACK_LENGTH = 10_000;

type FeedbackRequestRow = {
  id: string;
  user_id: string;
  feedback_type: FeedbackType;
  status: 'open' | 'closed' | 'revoked';
  expires_at: string;
  first_opened_at: string | null;
};

export type ResolvedFeedbackRequest = {
  requestId: string;
  feedbackType: FeedbackType;
  firstName: string;
};

export function feedbackFirstName(displayName: unknown): string {
  if (typeof displayName !== 'string') return 'there';
  const first = displayName.trim().split(/\s+/)[0];
  return first || 'there';
}

export function isValidFeedbackToken(token: string): boolean {
  return FEEDBACK_TOKEN_PATTERN.test(token);
}

export function hashFeedbackToken(token: string): string {
  return createHash('sha256').update(token, 'utf8').digest('hex');
}

async function findOpenFeedbackRequest(
  token: string
): Promise<FeedbackRequestRow | null> {
  if (!isValidFeedbackToken(token)) return null;

  const serviceClient = createServiceClient();
  const tokenHash = hashFeedbackToken(token);

  const { data, error } = await serviceClient
    .from('feedback_requests')
    .select('id, user_id, feedback_type, status, expires_at, first_opened_at')
    .eq('token_hash', tokenHash)
    .maybeSingle();

  if (error) {
    console.error('[Feedback] Failed to resolve request:', {
      code: error.code || null,
      message: error.message || null,
    });
    throw error;
  }

  if (!data) return null;

  const request = data as FeedbackRequestRow;
  if (
    request.status !== 'open' ||
    !request.expires_at ||
    new Date(request.expires_at).getTime() <= Date.now()
  ) {
    return null;
  }

  return request;
}

export async function resolveFeedbackRequest(
  token: string,
  options: { markOpened?: boolean } = {}
): Promise<ResolvedFeedbackRequest | null> {
  const request = await findOpenFeedbackRequest(token);
  if (!request) return null;

  const serviceClient = createServiceClient();
  const nowIso = new Date().toISOString();

  const [{ data: profile, error: profileError }] = await Promise.all([
    serviceClient
      .from('profiles')
      .select('display_name')
      .eq('id', request.user_id)
      .maybeSingle(),
    options.markOpened === false
      ? Promise.resolve({ data: null, error: null })
      : serviceClient
          .from('feedback_requests')
          .update({
            first_opened_at: request.first_opened_at || nowIso,
            last_opened_at: nowIso,
            updated_at: nowIso,
          })
          .eq('id', request.id)
          .eq('status', 'open'),
  ]);

  if (profileError) {
    console.warn('[Feedback] Could not load display name:', {
      code: profileError.code || null,
      message: profileError.message || null,
    });
  }

  return {
    requestId: request.id,
    feedbackType: request.feedback_type,
    firstName: feedbackFirstName(profile?.display_name),
  };
}

export async function submitFeedbackEntry(
  token: string,
  rawBody: unknown
): Promise<
  | { ok: true; entryId: string }
  | { ok: false; reason: 'invalid_body' | 'unavailable' }
> {
  if (typeof rawBody !== 'string') {
    return { ok: false, reason: 'invalid_body' };
  }

  const body = rawBody.trim();
  if (body.length < 1 || body.length > MAX_FEEDBACK_LENGTH) {
    return { ok: false, reason: 'invalid_body' };
  }

  const request = await findOpenFeedbackRequest(token);
  if (!request) {
    return { ok: false, reason: 'unavailable' };
  }

  const serviceClient = createServiceClient();
  const { data, error } = await serviceClient
    .from('feedback_entries')
    .insert({
      request_id: request.id,
      body,
    })
    .select('id')
    .single();

  if (error || !data?.id) {
    console.error('[Feedback] Failed to save entry:', {
      code: error?.code || null,
      message: error?.message || null,
      requestId: request.id,
    });
    throw error || new Error('Feedback insert returned no id');
  }

  return { ok: true, entryId: data.id };
}

export async function createFeedbackRequest({
  userId,
  feedbackType = 'product',
  expiresAt,
}: {
  userId: string;
  feedbackType?: FeedbackType;
  expiresAt?: Date;
}): Promise<{ requestId: string; token: string; expiresAt: string }> {
  const token = randomBytes(32).toString('base64url');
  const tokenHash = hashFeedbackToken(token);
  const expiry =
    expiresAt ||
    new Date(Date.now() + DEFAULT_FEEDBACK_TTL_DAYS * 24 * 60 * 60 * 1000);

  const serviceClient = createServiceClient();
  const { data, error } = await serviceClient
    .from('feedback_requests')
    .insert({
      user_id: userId,
      feedback_type: feedbackType,
      token_hash: tokenHash,
      status: 'open',
      expires_at: expiry.toISOString(),
    })
    .select('id, expires_at')
    .single();

  if (error || !data?.id) {
    console.error('[Feedback] Failed to create request:', {
      code: error?.code || null,
      message: error?.message || null,
      userId,
      feedbackType,
    });
    throw error || new Error('Feedback request insert returned no id');
  }

  return {
    requestId: data.id,
    token,
    expiresAt: data.expires_at,
  };
}
