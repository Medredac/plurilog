const STORAGE_BUCKET = 'message-images';

function encodeStoragePath(storagePath: string): string {
  return storagePath
    .split('/')
    .map((segment) => encodeURIComponent(segment))
    .join('/');
}

/**
 * Stable, same-origin attachment URL for user-facing display/download.
 *
 * The underlying private Storage object remains the durable source of truth.
 * This URL never embeds a Supabase signed token; the API route authenticates
 * the current user and serves the object on demand.
 */
export function buildDurableAttachmentUrl(
  storagePath: string,
  filename?: string | null
): string {
  const cleanPath = (storagePath || '').trim().replace(/^\/+/, '');
  if (!cleanPath) return '';

  const encodedPath = encodeStoragePath(cleanPath);
  const cleanFilename = (filename || '').trim();

  if (!cleanFilename) {
    return `/api/attachments/${STORAGE_BUCKET}/${encodedPath}`;
  }

  const encodedFilename = encodeURIComponent(cleanFilename);
  return `/api/attachments/${STORAGE_BUCKET}/${encodedPath}?filename=${encodedFilename}#filename=${encodedFilename}`;
}

/**
 * Extract the permanent bucket-relative object path from either:
 * - a legacy Supabase signed URL, or
 * - a stable Plurilog /api/attachments/message-images/... URL.
 */
export function extractAttachmentStoragePath(url?: string | null): string | null {
  if (!url || typeof url !== 'string') return null;

  const marker = `${STORAGE_BUCKET}/`;
  const bucketIndex = url.indexOf(marker);
  if (bucketIndex === -1) return null;

  const rawPath = url
    .slice(bucketIndex + marker.length)
    .split('?')[0]
    .split('#')[0];

  if (!rawPath) return null;

  try {
    const decoded = decodeURIComponent(rawPath);
    return decoded || null;
  } catch {
    return rawPath || null;
  }
}

/**
 * Convert a persisted attachment reference into the stable user-facing URL.
 * Blob URLs and non-storage URLs are left untouched.
 */
export function normalizeAttachmentUrlForUi(url?: string | null): string | null {
  if (!url || typeof url !== 'string') return null;
  if (url.startsWith('blob:')) return url;
  if (url.startsWith('/api/attachments/')) return url;

  const storagePath = extractAttachmentStoragePath(url);
  if (!storagePath) return url;

  let filename: string | null = null;
  const hashIndex = url.indexOf('#');
  if (hashIndex !== -1) {
    const hashPart = url.slice(hashIndex + 1);
    const value = hashPart.startsWith('filename=')
      ? hashPart.slice('filename='.length)
      : hashPart.startsWith('name=')
        ? hashPart.slice('name='.length)
        : null;

    if (value) {
      try {
        filename = decodeURIComponent(value);
      } catch {
        filename = value;
      }
    }
  }

  return buildDurableAttachmentUrl(storagePath, filename);
}

export const ATTACHMENT_STORAGE_BUCKET = STORAGE_BUCKET;
