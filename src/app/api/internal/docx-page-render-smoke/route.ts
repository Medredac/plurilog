import { NextResponse } from 'next/server';
import { renderDocx } from '@/utils/docxWriter';
import { extractPdfEmbeddedImages } from '@/utils/pdfEmbeddedImages';
import {
  createDocxRendererSnapshot,
  renderDocxPages,
  convertDocxToPdf,
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
    title: '履歴書レンダリングテスト',
    design: {
      fontFamily: 'jp-sans',
      headingFontFamily: 'jp-sans',
      locale: 'ja-JP',
      marginMm: 16,
    },
    blocks: [
      {
        type: 'table',
        headers: ['項目', '内容'],
        rows: [
          ['氏名', 'メリエム・ベリ（Meryem Behri）'],
          ['ふりがな', 'めりえむ'],
          ['現住所', '東京都町田市'],
          ['メールアドレス', 'test@example.com'],
        ],
        tableWidthPct: 66,
        columnWidthsPct: [26, 74],
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
              imageAltText: '証明写真テスト',
              size: 'small' as const,
              alignment: 'right' as const,
              placement: 'top-right' as const,
              widthMm: 30,
              heightMm: 40,
            },
          ]
        : []),
      {
        type: 'heading',
        level: 2,
        text: '学歴・職歴',
      },
      {
        type: 'table',
        headers: ['年', '月', '学歴・職歴'],
        rows: [
          ['2019', '3', '筑波大学 卒業'],
          ['2021', '9', '筑波大学大学院 修了'],
          ['2025', '2', '株式会社アクト 入社'],
        ],
        columnWidthsPct: [10, 8, 82],
      },
      {
        type: 'paragraph',
        text: '日本語の文字と表の右側の内容が、実際のLibreOfficeレンダリングでも正しく表示されることを確認します。',
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

  const shouldTestConversion = url.searchParams.get('convert') === '1';
  let convertedPdfByteSize: number | null = null;
  let convertedPdfPageCount: number | null = null;
  let convertedPdfEmbeddedImageCount: number | null = null;

  if (shouldTestConversion) {
    const converted = await convertDocxToPdf(
      fixture.buffer,
      snapshotId ? { snapshotId } : undefined
    );
    convertedPdfByteSize = converted.buffer.length;
    convertedPdfPageCount = converted.totalPageCount;
    const extractedImages = await extractPdfEmbeddedImages(converted.buffer, {
      timeoutMs: 30_000,
      minDimension: 1,
      minArea: 1,
    });
    convertedPdfEmbeddedImageCount = extractedImages.length;
  }

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
    renderedTextIncludesJapanese:
      rendered.renderedText.includes('履歴書レンダリングテスト') &&
      rendered.renderedText.includes('メリエム') &&
      rendered.renderedText.includes('東京都町田市'),
    renderedTextIncludesRightColumns:
      rendered.renderedText.includes('test@example.com') &&
      rendered.renderedText.includes('筑波大学大学院') &&
      rendered.renderedText.includes('株式会社アクト'),
    renderedTextSample: rendered.renderedText.slice(0, 1200),
    shouldTestConversion,
    convertedPdfByteSize,
    convertedPdfPageCount,
    convertedPdfEmbeddedImageCount,
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
    renderedTextIncludesJapanese:
      rendered.renderedText.includes('履歴書レンダリングテスト') &&
      rendered.renderedText.includes('メリエム') &&
      rendered.renderedText.includes('東京都町田市'),
    renderedTextIncludesRightColumns:
      rendered.renderedText.includes('test@example.com') &&
      rendered.renderedText.includes('筑波大学大学院') &&
      rendered.renderedText.includes('株式会社アクト'),
    shouldTestConversion,
    convertedPdfByteSize,
    convertedPdfPageCount,
    convertedPdfEmbeddedImageCount,
    fixtureByteSize: fixture.buffer.length,
  });
}
