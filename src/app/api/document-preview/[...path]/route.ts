import { NextRequest } from 'next/server';
import { createClient } from '@/utils/supabase/server';
import { createServiceClient } from '@/utils/supabase/service';
import { ATTACHMENT_STORAGE_BUCKET } from '@/utils/durableAttachments';
import { convertDocxToPdf } from '@/utils/docxPageRenderer';

const TEXT_EXTENSIONS = new Set([
  'txt',
  'md',
  'markdown',
  'csv',
  'tsv',
  'json',
  'html',
  'htm',
  'xml',
  'yaml',
  'yml',
]);

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
      (segment) => !segment || segment === '.' || segment === '..' || segment.includes('\\')
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
  const { data: fileBlob, error: downloadError } = await serviceSupabase.storage
    .from(ATTACHMENT_STORAGE_BUCKET)
    .download(storagePath);

  if (downloadError || !fileBlob) {
    return new Response('Not found', { status: 404 });
  }

  const filename = safeDisplayFilename(
    request.nextUrl.searchParams.get('filename'),
    storagePath
  );
  const extension = getExtension(filename) || getExtension(storagePath);
  const sourceBytes = Buffer.from(await fileBlob.arrayBuffer());

  if (extension === 'docx') {
    try {
      const converted = await convertDocxToPdf(sourceBytes, {
        timeoutMs: 45_000,
        signal: request.signal,
      });

      return new Response(new Uint8Array(converted.buffer), {
        status: 200,
        headers: {
          'Content-Type': 'application/pdf',
          'Content-Length': String(converted.buffer.length),
          'Content-Disposition': `inline; filename*=UTF-8''${encodeURIComponent(
            filename.replace(/\.docx$/i, '.pdf')
          )}`,
          'Cache-Control': 'private, no-store, max-age=0',
          'X-Content-Type-Options': 'nosniff',
        },
      });
    } catch (error) {
      if (request.signal.aborted) {
        return new Response('Request cancelled', { status: 499 });
      }
      console.error('[Document Preview] DOCX conversion failed', {
        filename,
        storagePath,
        error,
      });
      return new Response('Preview unavailable', { status: 500 });
    }
  }

  if (extension === 'pdf') {
    return new Response(new Uint8Array(sourceBytes), {
      status: 200,
      headers: {
        'Content-Type': 'application/pdf',
        'Content-Length': String(sourceBytes.length),
        'Content-Disposition': `inline; filename*=UTF-8''${encodeURIComponent(filename)}`,
        'Cache-Control': 'private, no-store, max-age=0',
        'X-Content-Type-Options': 'nosniff',
      },
    });
  }

  if (TEXT_EXTENSIONS.has(extension)) {
    return new Response(new Uint8Array(sourceBytes), {
      status: 200,
      headers: {
        // Force all uploaded text-like formats, including HTML/XML, to render as
        // inert text inside the preview drawer.
        'Content-Type': 'text/plain; charset=utf-8',
        'Content-Length': String(sourceBytes.length),
        'Content-Disposition': `inline; filename*=UTF-8''${encodeURIComponent(filename)}`,
        'Cache-Control': 'private, no-store, max-age=0',
        'X-Content-Type-Options': 'nosniff',
        'Content-Security-Policy': "default-src 'none'; frame-ancestors 'self'",
      },
    });
  }

  return new Response('Preview unavailable for this file type', { status: 415 });
}
