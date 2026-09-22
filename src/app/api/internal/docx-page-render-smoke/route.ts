import { NextResponse } from 'next/server';
import { renderDocx } from '@/utils/docxWriter';
import {
  createDocxRendererSnapshot,
  renderDocxPages,
} from '@/utils/docxPageRenderer';

export const runtime = 'nodejs';
export const maxDuration = 300;

export async function GET(request: Request) {
  if (process.env.VERCEL_ENV !== 'preview') {
    return NextResponse.json({ error: 'not found' }, { status: 404 });
  }

  const url = new URL(request.url);
  const includeImage = url.searchParams.get('image') === '1';
  const fixture = renderDocx({
    filename: 'docx-page-render-smoke.docx',
    title: 'DOCX Visual Rendering Smoke Test',
    blocks: [
      {
        type: 'paragraph',
        text: 'This is page one. The visual renderer should produce a PNG page image.',
      },
      ...(includeImage
        ? [
            {
              type: 'image' as const,
              mode: 'existing' as const,
              imageData: Buffer.from(
                'iVBORw0KGgoAAAANSUhEUgAAAAEAAAABCAQAAAC1HAwCAAAAC0lEQVR42mP8/x8AAusB9Y9ZJ6sAAAAASUVORK5CYII=',
                'base64'
              ),
              imageContentType: 'image/png',
              imageAltText: 'Embedded image smoke test',
              caption: 'Embedded image relationship smoke test',
              size: 'medium' as const,
              alignment: 'center' as const,
            },
          ]
        : []),
      {
        type: 'paragraph',
        text: Array.from(
          { length: 70 },
          (_, i) => `Line ${i + 1}: rendered layout verification.`
        ).join('\n'),
      },
    ],
  });

  const shouldBuildSnapshot = url.searchParams.get('snapshot') === '1';

  let snapshotId: string | null = null;
  let snapshotBuildElapsedMs: number | null = null;
  let libreOfficeVersion: string | null = null;

  if (shouldBuildSnapshot) {
    const snapshot = await createDocxRendererSnapshot();
    snapshotId = snapshot.snapshotId;
    snapshotBuildElapsedMs = snapshot.elapsedMs;
    libreOfficeVersion = snapshot.libreOfficeVersion;
  }

  const rendered = await renderDocxPages(
    fixture.buffer,
    snapshotId ? { snapshotId } : undefined
  );

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
    snapshotId,
    snapshotBuildElapsedMs,
    signatures,
    includeImage,
    fixtureByteSize: fixture.buffer.length,
  });

  return NextResponse.json({
    ok: true,
    pageCount: rendered.pages.length,
    totalPageCount: rendered.totalPageCount,
    truncated: rendered.truncated,
    usedSnapshot: rendered.usedSnapshot,
    elapsedMs: rendered.elapsedMs,
    snapshotId,
    snapshotBuildElapsedMs,
    libreOfficeVersion,
    signatures,
    includeImage,
    fixtureByteSize: fixture.buffer.length,
  });
}
