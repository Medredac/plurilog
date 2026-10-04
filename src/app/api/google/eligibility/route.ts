import { NextResponse } from 'next/server';
import { cookies } from 'next/headers';
import {
  MARKETING_CONSENT_COOKIE,
  isGoogleAdsTrackingAllowedForRequest,
  normalizeMarketingConsent,
  requiresMarketingConsent,
} from '@/lib/googleAds';

export const dynamic = 'force-dynamic';

export async function GET(request: Request) {
  const countryCode = request.headers.get('x-vercel-ip-country');
  const regionCode = request.headers.get('x-vercel-ip-country-region');
  const cookieStore = await cookies();
  const consentStatus = normalizeMarketingConsent(
    cookieStore.get(MARKETING_CONSENT_COOKIE)?.value
  );
  const consentRequired = requiresMarketingConsent(countryCode, regionCode);
  const isProduction = process.env.VERCEL_ENV === 'production';

  return NextResponse.json(
    {
      eligible:
        isProduction &&
        isGoogleAdsTrackingAllowedForRequest(
          countryCode,
          regionCode,
          consentStatus
        ),
      consentRequired,
      consentStatus,
      environment: process.env.VERCEL_ENV || process.env.NODE_ENV || 'unknown',
    },
    {
      headers: {
        'Cache-Control': 'private, no-store, max-age=0',
        Vary: 'X-Vercel-IP-Country, X-Vercel-IP-Country-Region, Cookie',
      },
    }
  );
}
