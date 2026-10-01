import { createHash } from 'crypto';

const DEFAULT_META_DATASET_ID = '1395458409440724';
const DEFAULT_GRAPH_API_VERSION = 'v24.0';

export type MetaEventName = 'Activated' | 'DeepEngagement' | 'Purchase';

export interface MetaConversionInput {
  eventName: MetaEventName;
  countryCode?: string | null;
  eventId: string;
  email?: string | null;
  externalId: string;
  fbp?: string | null;
  fbc?: string | null;
  eventTime?: number;
  eventSourceUrl?: string;
  customData?: Record<string, unknown>;
}

export interface MetaConversionResult {
  sent: boolean;
  reason?: string;
  eventsReceived?: number;
}

function sha256(value: string): string {
  return createHash('sha256').update(value).digest('hex');
}

function normalizedHash(value?: string | null): string | null {
  const normalized = value?.trim().toLowerCase();
  return normalized ? sha256(normalized) : null;
}

export function isMetaSignupSource(source?: string | null): boolean {
  if (!source) return false;
  const normalized = source.trim().toLowerCase();
  return (
    normalized === 'fb' ||
    normalized === 'ig' ||
    normalized === 'facebook' ||
    normalized === 'instagram' ||
    normalized === 'meta'
  );
}

const META_TRACKING_COUNTRIES = new Set(['US', 'AU', 'NZ']);

export function isMetaTrackingCountry(countryCode?: string | null): boolean {
  const normalized = countryCode?.trim().toUpperCase();
  return normalized ? META_TRACKING_COUNTRIES.has(normalized) : false;
}

export function isMetaTrackingAllowedForRequest(countryCode?: string | null): boolean {
  if (isMetaTrackingCountry(countryCode)) return true;

  // Preview is a controlled test environment. Allow the existing Meta Test Events
  // setup to exercise the funnel from any developer location without weakening the
  // production geo gate.
  return (
    process.env.VERCEL_ENV === 'preview' &&
    Boolean(process.env.META_TEST_EVENT_CODE?.trim())
  );
}

export async function sendMetaConversionEvent(
  input: MetaConversionInput
): Promise<MetaConversionResult> {
  if (!isMetaTrackingAllowedForRequest(input.countryCode)) {
    return { sent: false, reason: 'geo_not_eligible' };
  }

  const token = process.env.META_CONVERSIONS_API_TOKEN?.trim();
  if (!token) {
    console.warn('[Meta CAPI] META_CONVERSIONS_API_TOKEN is not configured.');
    return { sent: false, reason: 'missing_token' };
  }

  const testEventCode = process.env.META_TEST_EVENT_CODE?.trim();
  if (process.env.VERCEL_ENV === 'preview' && !testEventCode) {
    console.info('[Meta CAPI] Preview send skipped until META_TEST_EVENT_CODE is configured.');
    return { sent: false, reason: 'preview_test_code_missing' };
  }

  const datasetId = process.env.META_DATASET_ID?.trim() || DEFAULT_META_DATASET_ID;
  const graphVersion =
    process.env.META_GRAPH_API_VERSION?.trim() || DEFAULT_GRAPH_API_VERSION;

  const emailHash = normalizedHash(input.email);
  const externalIdHash = normalizedHash(input.externalId);

  const userData: Record<string, unknown> = {};
  if (emailHash) userData.em = [emailHash];
  if (externalIdHash) userData.external_id = [externalIdHash];
  if (input.fbp?.trim()) userData.fbp = input.fbp.trim();
  if (input.fbc?.trim()) userData.fbc = input.fbc.trim();

  const payload: Record<string, unknown> = {
    data: [
      {
        event_name: input.eventName,
        event_time: input.eventTime ?? Math.floor(Date.now() / 1000),
        event_id: input.eventId,
        action_source: 'website',
        event_source_url: input.eventSourceUrl || 'https://plurilogai.com/dashboard',
        user_data: userData,
        ...(input.customData ? { custom_data: input.customData } : {}),
      },
    ],
    ...(testEventCode ? { test_event_code: testEventCode } : {}),
  };

  const endpoint =
    `https://graph.facebook.com/${graphVersion}/${encodeURIComponent(datasetId)}/events` +
    `?access_token=${encodeURIComponent(token)}`;

  try {
    const response = await fetch(endpoint, {
      method: 'POST',
      headers: { 'Content-Type': 'application/json' },
      body: JSON.stringify(payload),
      cache: 'no-store',
      signal: AbortSignal.timeout(3500),
    });

    const responseBody = await response.text().catch(() => '');

    if (!response.ok) {
      console.error(
        `[Meta CAPI] ${input.eventName} failed with status ${response.status}:`,
        responseBody.slice(0, 1000)
      );
      return { sent: false, reason: `http_${response.status}` };
    }

    let eventsReceived: number | undefined;
    try {
      const parsed = responseBody ? JSON.parse(responseBody) : null;
      if (typeof parsed?.events_received === 'number') {
        eventsReceived = parsed.events_received;
      }
    } catch {
      // A successful HTTP response with a non-JSON body is still unexpected.
    }

    if (eventsReceived !== undefined && eventsReceived < 1) {
      console.warn(
        `[Meta CAPI] ${input.eventName} returned 200 but accepted 0 events:`,
        responseBody.slice(0, 1000)
      );
      return { sent: false, reason: 'zero_events_received', eventsReceived };
    }

    console.log(
      `[Meta CAPI] Sent ${input.eventName} (${input.eventId})` +
      (eventsReceived !== undefined ? ` — events_received=${eventsReceived}` : '') +
      '.'
    );
    return { sent: true, eventsReceived };
  } catch (error) {
    console.error(`[Meta CAPI] ${input.eventName} request failed:`, error);
    return { sent: false, reason: 'request_failed' };
  }
}
