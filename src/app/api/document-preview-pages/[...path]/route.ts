import crypto from 'node:crypto';
import { NextRequest } from 'next/server';
import { Sandbox } from '@vercel/sandbox';
import { createClient } from '@/utils/supabase/server';
import { createServiceClient } from '@/utils/supabase/service';
import { ATTACHMENT_STORAGE_BUCKET } from '@/utils/durableAttachments';
import { convertDocxToPdf } from '@/utils/docxPageRenderer';

const DEFAULT_RENDERER_SNAPSHOT_ID =
  'snap_vwQhLmdtlIxq4OliWzLOjVlHEzuD';
const MAX_PREVIEW_BYTES = 25 * 1024 * 1024;
const MAX_PREVIEW_PAGES = 40;
const PREVIEW_DPI = 160;

function getExtension(filename: string): string {
  const clean = filename.trim().toLowerCase();
  const index = clean.lastIndexOf('.');
  return index === -1 ? '' : clean.slice(index + 1);
}

function safeDisplayFilename(value: string | null, storagePath: string): string {
  const fallback = storagePath.split('/').pop() || 'document';
  const candidate = (value || fallback).trim() || fallback;
  return candidate.replace(/[\r\n]/g, ' ').slice(0, 240);
}

function parsePageCount(raw: string): number | null {
  const match = raw.match(/^Pages:\s+(\d+)$/im);
  if (!match) return null;
  const value = Number(match[1]);
  return Number.isFinite(value) && value > 0 ? value : null;
}

async function assertCommand(
  result: Awaited<ReturnType<InstanceType<typeof Sandbox>['runCommand']>>,
  label: string
) {
  if (result.exitCode === 0) return;
  const stderr = (await result.stderr()).trim();
  const stdout = (await result.stdout()).trim();
  throw new Error(
    `${label} failed (exit ${result.exitCode}): ${(
      stderr ||
      stdout ||
      'unknown error'
    ).slice(-3000)}`
  );
}

function attachmentUrl(storagePath: string, filename: string): string {
  const encodedPath = storagePath
    .split('/')
    .map((segment) => encodeURIComponent(segment))
    .join('/');

  return `/api/attachments/${ATTACHMENT_STORAGE_BUCKET}/${encodedPath}?filename=${encodeURIComponent(
    filename
  )}`;
}

interface CachedPreviewMeta {
  totalPageCount: number | null;
  renderedPageCount: number;
  truncated: boolean;
}

async function loadCachedPreview(
  serviceSupabase: ReturnType<typeof createServiceClient>,
  prefix: string
): Promise<{ meta: CachedPreviewMeta; pagePaths: string[] } | null> {
  const metaPath = `${prefix}/meta.json`;
  const { data: metaBlob } = await serviceSupabase.storage
    .from(ATTACHMENT_STORAGE_BUCKET)
    .download(metaPath);

  if (!metaBlob) return null;

  try {
    const meta = JSON.parse(await metaBlob.text()) as CachedPreviewMeta;
    if (
      !meta ||
      !Number.isInteger(meta.renderedPageCount) ||
      meta.renderedPageCount < 1
    ) {
      return null;
    }

    const pagePaths = Array.from(
      { length: meta.renderedPageCount },
      (_, index) =>
        `${prefix}/page-${String(index + 1).padStart(3, '0')}.png`
    );

    return { meta, pagePaths };
  } catch {
    return null;
  }
}

async function renderPdfPages(
  pdfBytes: Buffer,
  signal: AbortSignal
): Promise<{
  pages: Buffer[];
  totalPageCount: number | null;
  truncated: boolean;
}> {
  const snapshotId =
    process.env.DOCX_RENDERER_SNAPSHOT_ID?.trim() ||
    DEFAULT_RENDERER_SNAPSHOT_ID;

  const sandbox = await Sandbox.create({
    source: { type: 'snapshot', snapshotId },
    persistent: false,
    timeout: 60_000,
    networkPolicy: 'allow-all',
  });

  const abortHandler = () => {
    void sandbox.stop().catch(() => undefined);
  };
  signal.addEventListener('abort', abortHandler, { once: true });

  try {
    await sandbox.writeFiles([
      {
        path: '/vercel/sandbox/input.pdf',
        content: pdfBytes,
      },
    ]);

    const info = await sandbox.runCommand({
      cmd: 'pdfinfo',
      args: ['/vercel/sandbox/input.pdf'],
    });
    await assertCommand(info, 'PDF preview inspection');
    const totalPageCount = parsePageCount(await info.stdout());
    const renderPageCount = Math.min(
      totalPageCount || MAX_PREVIEW_PAGES,
      MAX_PREVIEW_PAGES
    );

    const render = await sandbox.runCommand({
      cmd: 'pdftoppm',
      args: [
        '-png',
        '-r',
        String(PREVIEW_DPI),
        '-f',
        '1',
        '-l',
        String(renderPageCount),
        '/vercel/sandbox/input.pdf',
        '/vercel/sandbox/page',
      ],
    });
    await assertCommand(render, 'PDF preview rendering');

    const list = await sandbox.runCommand({
      cmd: 'sh',
      args: [
        '-lc',
        "find /vercel/sandbox -maxdepth 1 -type f -name 'page-*.png' -printf '%f\\n' | sort -V",
      ],
    });
    await assertCommand(list, 'PDF preview page enumeration');

    const filenames = (await list.stdout())
      .split(/\r?\n/)
      .map((name) => name.trim())
      .filter(Boolean)
      .slice(0, MAX_PREVIEW_PAGES);

    if (filenames.length === 0) {
      throw new Error('PDF preview renderer produced no pages.');
    }

    const pages: Buffer[] = [];
    for (const filename of filenames) {
      const page = await sandbox.readFileToBuffer({
        path: `/vercel/sandbox/${filename}`,
      });
      if (!page?.length) {
        throw new Error(`Rendered preview page could not be read: ${filename}`);
      }
      pages.push(page);
    }

    return {
      pages,
      totalPageCount,
      truncated:
        typeof totalPageCount === 'number'
          ? totalPageCount > pages.length
          : pages.length >= MAX_PREVIEW_PAGES,
    };
  } finally {
    signal.removeEventListener('abort', abortHandler);
    await sandbox.stop().catch(() => undefined);
  }
}

export async function GET(
  request: NextRequest,
  context: { params: Promise<{ path: string[] }> }
) {
  const { path } = await context.params;

  if (
    !Array.isArray(path) ||
    path.length < 3 ||
    path[0] !== ATTACHMENT_STORAGE_BUCKET
  ) {
    return new Response('Not found', { status: 404 });
  }

  const storageSegments = path.slice(1);
  if (
    storageSegments.some(
      (segment) =>
        !segment ||
        segment === '.' ||
        segment === '..' ||
        segment.includes('\\')
    )
  ) {
    return new Response('Not found', { status: 404 });
  }

  const storagePath = storageSegments.join('/');

  const userSupabase = await createClient();
  const {
    data: { user },
    error: authError,
  } = await userSupabase.auth.getUser();

  if (authError || !user) {
    return new Response('Unauthorized', { status: 401 });
  }

  if (storageSegments[0] !== user.id) {
    return new Response('Not found', { status: 404 });
  }

  const serviceSupabase = createServiceClient();
  const { data: fileBlob, error: downloadError } =
    await serviceSupabase.storage
      .from(ATTACHMENT_STORAGE_BUCKET)
      .download(storagePath);

  if (downloadError || !fileBlob) {
    return new Response('Not found', { status: 404 });
  }

  if (fileBlob.size > MAX_PREVIEW_BYTES) {
    return new Response('Document is too large to preview.', { status: 413 });
  }

  const filename = safeDisplayFilename(
    request.nextUrl.searchParams.get('filename'),
    storagePath
  );
  const extension = getExtension(filename) || getExtension(storagePath);

  if (extension !== 'pdf' && extension !== 'docx') {
    return new Response('Preview pages unavailable for this file type.', {
      status: 415,
    });
  }

  const sourceBytes = Buffer.from(await fileBlob.arrayBuffer());
  const sourceHash = crypto
    .createHash('sha256')
    .update(sourceBytes)
    .digest('hex');
  const cachePrefix =
    `${user.id}/document-preview-pages/${sourceHash}`;

  const cached = await loadCachedPreview(serviceSupabase, cachePrefix);
  if (cached) {
    return Response.json(
      {
        filename,
        totalPageCount: cached.meta.totalPageCount,
        renderedPageCount: cached.meta.renderedPageCount,
        truncated: cached.meta.truncated,
        pages: cached.pagePaths.map((pagePath, index) => ({
          pageNumber: index + 1,
          url: attachmentUrl(
            pagePath,
            `${filename} — page ${index + 1}.png`
          ),
        })),
      },
      {
        headers: {
          'Cache-Control': 'private, no-store, max-age=0',
        },
      }
    );
  }

  try {
    const pdfBytes =
      extension === 'docx'
        ? (
            await convertDocxToPdf(sourceBytes, {
              timeoutMs: 45_000,
              signal: request.signal,
            })
          ).buffer
        : sourceBytes;

    const rendered = await renderPdfPages(pdfBytes, request.signal);

    const pagePaths: string[] = [];
    for (let index = 0; index < rendered.pages.length; index += 1) {
      const storagePagePath =
        `${cachePrefix}/page-${String(index + 1).padStart(3, '0')}.png`;

      const { error: uploadError } = await serviceSupabase.storage
        .from(ATTACHMENT_STORAGE_BUCKET)
        .upload(storagePagePath, rendered.pages[index], {
          contentType: 'image/png',
          cacheControl: '31536000',
          upsert: true,
        });

      if (uploadError) {
        throw new Error(
          `Preview page upload failed: ${uploadError.message}`
        );
      }

      pagePaths.push(storagePagePath);
    }

    const meta: CachedPreviewMeta = {
      totalPageCount: rendered.totalPageCount,
      renderedPageCount: pagePaths.length,
      truncated: rendered.truncated,
    };

    await serviceSupabase.storage
      .from(ATTACHMENT_STORAGE_BUCKET)
      .upload(
        `${cachePrefix}/meta.json`,
        Buffer.from(JSON.stringify(meta), 'utf8'),
        {
          contentType: 'application/json',
          cacheControl: '31536000',
          upsert: true,
        }
      );

    return Response.json(
      {
        filename,
        totalPageCount: rendered.totalPageCount,
        renderedPageCount: pagePaths.length,
        truncated: rendered.truncated,
        pages: pagePaths.map((pagePath, index) => ({
          pageNumber: index + 1,
          url: attachmentUrl(
            pagePath,
            `${filename} — page ${index + 1}.png`
          ),
        })),
      },
      {
        headers: {
          'Cache-Control': 'private, no-store, max-age=0',
        },
      }
    );
  } catch (error) {
    if (request.signal.aborted) {
      return new Response('Request cancelled', { status: 499 });
    }

    console.error('[Document Preview Pages] Rendering failed', {
      filename,
      storagePath,
      error,
    });

    return new Response('Document preview rendering failed.', {
      status: 500,
    });
  }
}
