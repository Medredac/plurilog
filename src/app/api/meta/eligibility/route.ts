import { NextResponse } from 'next/server';
import { cookies } from 'next/headers';
import {
  META_CONSENT_COOKIE,
  isMetaTrackingAllowedForRequest,
  normalizeMetaConsentStatus,
  requiresMetaConsent,
} from '@/lib/metaConversions';

export const dynamic = 'force-dynamic';

export async function GET(request: Request) {
  const countryCode = request.headers.get('x-vercel-ip-country');
  const regionCode = request.headers.get('x-vercel-ip-country-region');
  const cookieStore = await cookies();
  const consentStatus = normalizeMetaConsentStatus(
    cookieStore.get(META_CONSENT_COOKIE)?.value
  );
  const consentRequired = requiresMetaConsent(countryCode, regionCode);

  return NextResponse.json(
    {
      eligible: isMetaTrackingAllowedForRequest(
        countryCode,
        regionCode,
        consentStatus
      ),
      consentRequired,
      showConsent: consentRequired && consentStatus === 'unknown',
      consentStatus,
    },
    {
      headers: {
        'Cache-Control': 'private, no-store, max-age=0',
        Vary: 'X-Vercel-IP-Country, X-Vercel-IP-Country-Region, Cookie',
      },
    }
  );
}
