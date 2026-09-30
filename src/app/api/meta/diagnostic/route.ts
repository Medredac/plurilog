import { NextResponse } from 'next/server';
import { sendMetaConversionEvent } from '@/lib/metaConversions';

const PREVIEW_TEST_KEY = 'plurilog-meta-test-0930-capi';

export async function GET(request: Request) {
  if (process.env.VERCEL_ENV !== 'preview') {
    return NextResponse.json({ error: 'Not found' }, { status: 404 });
  }

  const url = new URL(request.url);
  if (url.searchParams.get('key') !== PREVIEW_TEST_KEY) {
    return NextResponse.json({ error: 'Not found' }, { status: 404 });
  }

  const eventId = `plurilog:preview-capi-diagnostic:${Date.now()}`;
  const result = await sendMetaConversionEvent({
    eventName: 'Activated',
    eventId,
    externalId: 'preview-meta-capi-diagnostic',
    eventSourceUrl: url.origin,
  });

  return NextResponse.json({ eventId, ...result });
}
