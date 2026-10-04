export const GOOGLE_ADS_TAG_ID = 'AW-18492863415';
export const GOOGLE_ADS_PURCHASE_SEND_TO =
  'AW-18492863415/O2weCMDi_I8dELfnivJE';

export const MARKETING_CONSENT_COOKIE = 'plurilog_meta_consent';

export const GOOGLE_ADS_COOKIE_NAMES = {
  gclid: 'plurilog_google_gclid',
  gbraid: 'plurilog_google_gbraid',
  wbraid: 'plurilog_google_wbraid',
  utmSource: 'plurilog_google_utm_source',
  utmCampaign: 'plurilog_google_utm_campaign',
  utmTerm: 'plurilog_google_utm_term',
  utmContent: 'plurilog_google_utm_content',
} as const;

export type MarketingConsentStatus = 'accepted' | 'rejected' | 'unknown';

const GOOGLE_ADS_TRACKING_COUNTRIES = new Set(['US', 'CA', 'GB', 'AU']);

export function normalizeMarketingConsent(
  value?: string | null
): MarketingConsentStatus {
  if (value === 'accepted' || value === 'rejected') return value;
  return 'unknown';
}

export function requiresMarketingConsent(
  countryCode?: string | null,
  regionCode?: string | null
): boolean {
  const country = countryCode?.trim().toUpperCase();
  const region = regionCode?.trim().toUpperCase();

  return country === 'GB' || (country === 'CA' && region === 'QC');
}

export function isGoogleAdsTrackingCountry(
  countryCode?: string | null
): boolean {
  const normalized = countryCode?.trim().toUpperCase();
  return normalized ? GOOGLE_ADS_TRACKING_COUNTRIES.has(normalized) : false;
}

export function isGoogleAdsTrackingAllowedForRequest(
  countryCode?: string | null,
  regionCode?: string | null,
  consentStatus: MarketingConsentStatus = 'unknown'
): boolean {
  if (!isGoogleAdsTrackingCountry(countryCode)) return false;
  if (requiresMarketingConsent(countryCode, regionCode)) {
    return consentStatus === 'accepted';
  }
  return true;
}
