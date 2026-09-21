import { NextRequest } from 'next/server';
import { createClient } from '@/utils/supabase/server';
import { createServiceClient } from '@/utils/supabase/service';
import { ATTACHMENT_STORAGE_BUCKET } from '@/utils/durableAttachments';

const MIME_BY_EXTENSION: Record<string, string> = {
  png: 'image/png',
  jpg: 'image/jpeg',
  jpeg: 'image/jpeg',
  webp: 'image/webp',
  gif: 'image/gif',
  pdf: 'application/pdf',
  docx: 'application/vnd.openxmlformats-officedocument.wordprocessingml.document',
  xlsx: 'application/vnd.openxmlformats-officedocument.spreadsheetml.sheet',
  pptx: 'application/vnd.openxmlformats-officedocument.presentationml.presentation',
  txt: 'text/plain; charset=utf-8',
  md: 'text/markdown; charset=utf-8',
  markdown: 'text/markdown; charset=utf-8',
  csv: 'text/csv; charset=utf-8',
  tsv: 'text/tab-separated-values; charset=utf-8',
  json: 'application/json; charset=utf-8',
  html: 'text/html; charset=utf-8',
  htm: 'text/html; charset=utf-8',
  xml: 'application/xml; charset=utf-8',
  yaml: 'application/yaml; charset=utf-8',
  yml: 'application/yaml; charset=utf-8',
};

function inferContentType(storagePath: string, blobType?: string | null): string {
  if (blobType && blobType !== 'application/octet-stream') return blobType;
  const filename = storagePath.split('/').pop() || '';
  const extension = filename.includes('.') ? filename.split('.').pop()!.toLowerCase() : '';
  return MIME_BY_EXTENSION[extension] || 'application/octet-stream';
}

function safeDisplayFilename(value: string | null, storagePath: string): string {
  const fallback = storagePath.split('/').pop() || 'attachment';
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

  // All Plurilog message attachments are stored below the authenticated user's
  // top-level folder. Never use the service client before this ownership check.
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
  const contentType = inferContentType(storagePath, fileBlob.type);
  const bytes = await fileBlob.arrayBuffer();

  return new Response(bytes, {
    status: 200,
    headers: {
      'Content-Type': contentType,
      'Content-Length': String(fileBlob.size),
      'Content-Disposition': `inline; filename*=UTF-8''${encodeURIComponent(filename)}`,
      'Cache-Control': 'private, no-store, max-age=0',
      'X-Content-Type-Options': 'nosniff',
    },
  });
}
