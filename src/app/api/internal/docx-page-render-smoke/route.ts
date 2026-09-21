import { NextResponse } from 'next/server';
import { renderDocx } from '@/utils/docxWriter';
import { renderDocxPages } from '@/utils/docxPageRenderer';

export const runtime = 'nodejs';
export const maxDuration = 300;

export async function GET() {
  if (process.env.VERCEL_ENV !== 'preview') {
    return NextResponse.json({ error: 'not found' }, { status: 404 });
  }

  const fixture = renderDocx({
    filename: 'docx-page-render-smoke.docx',
    title: 'DOCX Visual Rendering Smoke Test',
    blocks: [
      {
        type: 'paragraph',
        text: 'This is page one. The visual renderer should produce a PNG page image.',
      },
      {
        type: 'paragraph',
        text: Array.from({ length: 70 }, (_, i) => `Line ${i + 1}: rendered layout verification.`).join('\n'),
      },
    ],
  });

  const rendered = await renderDocxPages(fixture.buffer);
  const signatures = rendered.pages.map((page) => ({
    pageNumber: page.pageNumber,
    byteSize: page.data.length,
    pngMagic: page.data.subarray(1, 4).toString('ascii'),
  }));

  console.log('[DOCX Page Render Smoke]', {
    pageCount: rendered.pages.length,
    totalPageCount: rendered.totalPageCount,
    truncated: rendered.truncated,
    usedSnapshot: rendered.usedSnapshot,
    elapsedMs: rendered.elapsedMs,
    signatures,
  });

  return NextResponse.json({
    ok: true,
    pageCount: rendered.pages.length,
    totalPageCount: rendered.totalPageCount,
    truncated: rendered.truncated,
    usedSnapshot: rendered.usedSnapshot,
    elapsedMs: rendered.elapsedMs,
    signatures,
  });
}
