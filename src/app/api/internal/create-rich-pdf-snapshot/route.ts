import { NextRequest, NextResponse } from 'next/server';
import { createRichPdfRendererSnapshot } from '@/utils/richPdfRenderer';

export const runtime = 'nodejs';
export const maxDuration = 300;

export async function GET(req: NextRequest) {
  if (process.env.VERCEL_ENV !== 'preview') {
    return NextResponse.json({ error: 'preview only' }, { status: 404 });
  }

  if (req.nextUrl.searchParams.get('token') !== 'p7rK3wN9mQ2xV6cL8sT4yH1jF5bD0zAa') {
    return NextResponse.json({ error: 'not found' }, { status: 404 });
  }

  try {
    const result = await createRichPdfRendererSnapshot();
    return NextResponse.json(result);
  } catch (error: any) {
    return NextResponse.json(
      { error: error?.message || String(error) },
      { status: 500 }
    );
  }
}
