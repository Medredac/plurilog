import { NextRequest, NextResponse } from 'next/server';
import { renderRichPdf } from '@/utils/richPdfRenderer';

export const runtime = 'nodejs';
export const maxDuration = 120;

export async function GET(req: NextRequest) {
  if (process.env.VERCEL_ENV !== 'preview') {
    return NextResponse.json({ error: 'preview only' }, { status: 404 });
  }

  if (req.nextUrl.searchParams.get('token') !== 'p7rK3wN9mQ2xV6cL8sT4yH1jF5bD0zAa') {
    return NextResponse.json({ error: 'not found' }, { status: 404 });
  }

  try {
    const result = await renderRichPdf(
      {
        filename: 'snapshot-smoke.pdf',
        title: 'Snapshot Smoke Test',
        design: {
          accentColor: '#1f5f74',
          accentColor2: '#3459a6',
          backgroundColor: '#ffffff',
        },
        blocks: [
          {
            type: 'banner',
            eyebrow: 'PLURILOG',
            title: 'Rich PDF renderer',
            subtitle: 'Prebuilt Chrome snapshot restore test',
          },
          {
            type: 'cards',
            cardColumns: 2,
            cards: [
              { title: 'Modern layout', text: 'HTML/CSS rendering is active.' },
              { title: 'Visual review', text: 'Rendered pages are available.' },
            ],
          },
        ],
      },
      { timeoutMs: 60_000 }
    );

    return NextResponse.json({
      ok: true,
      usedSnapshot: result.usedSnapshot,
      pageCount: result.totalPageCount,
      byteSize: result.buffer.length,
      reviewPageCount: result.reviewPages.length,
    });
  } catch (error: any) {
    return NextResponse.json(
      { error: error?.message || String(error) },
      { status: 500 }
    );
  }
}
