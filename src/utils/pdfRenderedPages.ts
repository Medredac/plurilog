import crypto from 'node:crypto';
import type { RenderedPdfReviewPage } from '@/utils/richPdfRenderer';

const STORAGE_BUCKET = 'message-images';
const MODEL_TRANSPORT_URL_EXPIRY_SECONDS = 259200;

export interface PersistedPdfRenderedPage {
  pageNumber: number;
  filename: string;
  storagePath: string;
  signedUrl: string;
  contentType: 'image/png';
  byteSize: number;
}

export interface PersistPdfRenderedPagesOptions {
  supabase: any;
  parentFilename: string;
  parentFileBytes: Buffer;
  pages: RenderedPdfReviewPage[];
}

function safeBaseFilename(filename: string): string {
  const raw = (filename || 'document.pdf').split(/[\\/]/).pop() || 'document.pdf';
  return (
    raw
      .replace(/\.pdf$/i, '')
      .replace(/[\u0000-\u001f\u007f]/g, '')
      .replace(/[<>:"/\\|?*]/g, '-')
      .replace(/\s+/g, ' ')
      .trim()
      .slice(0, 100) || 'document'
  );
}

export async function persistPdfRenderedPages(
  options: PersistPdfRenderedPagesOptions
): Promise<PersistedPdfRenderedPage[]> {
  const { supabase, parentFilename, parentFileBytes, pages } = options;
  if (!supabase || !Buffer.isBuffer(parentFileBytes) || parentFileBytes.length === 0) {
    return [];
  }
  if (!Array.isArray(pages) || pages.length === 0) return [];

  const {
    data: { user },
    error: authError,
  } = await supabase.auth.getUser();

  if (authError || !user) {
    throw new Error('Authenticated user session required for PDF rendered-page persistence');
  }

  const parentHash = crypto.createHash('sha256').update(parentFileBytes).digest('hex');
  const parentBase = safeBaseFilename(parentFilename);
  const persisted: PersistedPdfRenderedPage[] = [];

  for (const page of pages) {
    if (
      !page ||
      !Number.isInteger(page.pageNumber) ||
      page.pageNumber < 1 ||
      !Buffer.isBuffer(page.data) ||
      page.data.length === 0
    ) {
      continue;
    }

    const pageHash = crypto.createHash('sha256').update(page.data).digest('hex');
    const pageNumber = String(page.pageNumber).padStart(3, '0');
    const storagePath =
      `${user.id}/pdf-pages/${parentHash}/page-${pageNumber}-${pageHash.slice(0, 16)}.png`;

    const { error: uploadError } = await supabase.storage
      .from(STORAGE_BUCKET)
      .upload(storagePath, page.data, {
        contentType: 'image/png',
        upsert: false,
      });

    const createdNewObject = !uploadError;

    if (uploadError && !/already exists|duplicate/i.test(uploadError.message || '')) {
      console.warn('[PDF Visual] Rendered page upload failed:', {
        parentFilename,
        pageNumber: page.pageNumber,
        error: uploadError.message,
      });
      continue;
    }

    const { data: signedData, error: signError } = await supabase.storage
      .from(STORAGE_BUCKET)
      .createSignedUrl(storagePath, MODEL_TRANSPORT_URL_EXPIRY_SECONDS);

    if (signError || !signedData?.signedUrl) {
      console.warn('[PDF Visual] Rendered page signing failed:', {
        parentFilename,
        pageNumber: page.pageNumber,
        error: signError?.message || 'Unknown signing error',
      });
      if (createdNewObject) {
        const { error: cleanupError } = await supabase.storage
          .from(STORAGE_BUCKET)
          .remove([storagePath]);
        if (cleanupError) {
          console.warn('[PDF Visual] Failed to clean unsigned rendered page:', {
            storagePath,
            error: cleanupError.message,
          });
        }
      }
      continue;
    }

    const filename = `${parentBase} — rendered page ${page.pageNumber}.png`;
    persisted.push({
      pageNumber: page.pageNumber,
      filename,
      storagePath,
      signedUrl: `${signedData.signedUrl}#filename=${encodeURIComponent(filename)}`,
      contentType: 'image/png',
      byteSize: page.data.length,
    });
  }

  return persisted;
}
