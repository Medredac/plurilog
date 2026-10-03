import { NextResponse } from 'next/server';
import { POST as submitFeedbackPost } from '@/app/api/feedback/[token]/route';

export const runtime = 'nodejs';
export const dynamic = 'force-dynamic';

export async function GET(request: Request) {
  if (process.env.VERCEL_ENV !== 'preview') {
    return NextResponse.json({ error: 'not found' }, { status: 404 });
  }

  const url = new URL(request.url);
  const token = url.searchParams.get('token') || '';

  if (!token) {
    return NextResponse.json({ error: 'missing token' }, { status: 400 });
  }

  const syntheticRequest = new Request(
    new URL(`/api/feedback/${encodeURIComponent(token)}`, request.url),
    {
      method: 'POST',
      headers: {
        'Content-Type': 'application/json',
      },
      body: JSON.stringify({
        body: 'Automated feedback flow smoke test — safe to delete.',
      }),
    }
  );

  const response = await submitFeedbackPost(syntheticRequest, {
    params: Promise.resolve({ token }),
  });

  const responseBody = await response.text();

  return NextResponse.json({
    upstreamStatus: response.status,
    upstreamBody: responseBody,
  });
}
