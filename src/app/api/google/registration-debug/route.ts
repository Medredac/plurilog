import { NextResponse } from 'next/server';

export const dynamic = 'force-dynamic';

export async function POST(request: Request) {
  try {
    const body = await request.json();
    const stage = typeof body?.stage === 'string' ? body.stage : 'unknown';
    const details =
      body && typeof body === 'object' && body.details && typeof body.details === 'object'
        ? body.details
        : {};

    console.info('[Google Registration Debug]', { stage, ...details });
    return NextResponse.json({ ok: true });
  } catch {
    return NextResponse.json({ ok: false }, { status: 400 });
  }
}
