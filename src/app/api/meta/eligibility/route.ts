import { NextResponse } from 'next/server';
import { isMetaTrackingAllowedForRequest } from '@/lib/metaConversions';

export const dynamic = 'force-dynamic';

export async function GET(request: Request) {
  const countryCode = request.headers.get('x-vercel-ip-country');

  return NextResponse.json(
    { eligible: isMetaTrackingAllowedForRequest(countryCode) },
    {
      headers: {
        'Cache-Control': 'private, no-store, max-age=0',
        Vary: 'X-Vercel-IP-Country',
      },
    }
  );
}
