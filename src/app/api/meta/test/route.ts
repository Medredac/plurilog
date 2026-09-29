import { NextResponse } from 'next/server';
import { sendMetaConversionEvent } from '@/lib/metaConversions';

const PREVIEW_TEST_KEY = 'plurilog-meta-test-0929-a7f4e2';

export async function GET(request: Request) {
  if (process.env.VERCEL_ENV !== 'preview') {
    return NextResponse.json({ error: 'Not found' }, { status: 404 });
  }

  const url = new URL(request.url);
  if (url.searchParams.get('key') !== PREVIEW_TEST_KEY) {
    return NextResponse.json({ error: 'Not found' }, { status: 404 });
  }

  const eventId = `plurilog:preview-capi-test:${Date.now()}`;
  const result = await sendMetaConversionEvent({
    eventName: 'Activated',
    eventId,
    externalId: 'preview-meta-capi-test',
    eventSourceUrl: url.origin,
    customData: {
      test: true,
    },
  });

  return NextResponse.json({ eventId, ...result });
}
