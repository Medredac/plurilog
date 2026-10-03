import crypto from 'node:crypto';
import type { EmbeddedDocxImage } from '@/utils/docxParser';

const STORAGE_BUCKET = 'message-images';
const MODEL_TRANSPORT_URL_EXPIRY_SECONDS = 259200;

export interface PersistedDocxEmbeddedImage {
  index: number;
  filename: string;
  storagePath: string;
  signedUrl: string;
  contentType: string;
  byteSize: number;
}

export interface PersistDocxEmbeddedImagesOptions {
  supabase: any;
  parentFilename: string;
  parentFileBytes: Buffer;
  images: EmbeddedDocxImage[];
}

const SUPPORTED_IMAGE_TYPES = new Set([
  'image/png',
  'image/jpeg',
  'image/jpg',
  'image/webp',
  'image/gif',
]);

function safeBaseFilename(filename: string): string {
  const raw = (filename || 'document.docx').split(/[\\/]/).pop() || 'document.docx';
  return raw
    .replace(/\.docx$/i, '')
    .replace(/[\u0000-\u001f\u007f]/g, '')
    .replace(/[<>:"/\\|?*]/g, '-')
    .replace(/\s+/g, ' ')
    .trim()
    .slice(0, 100) || 'document';
}

function normalizeExtension(image: EmbeddedDocxImage): string {
  if (image.contentType === 'image/jpeg' || image.contentType === 'image/jpg') return 'jpg';
  if (image.contentType === 'image/png') return 'png';
  if (image.contentType === 'image/webp') return 'webp';
  if (image.contentType === 'image/gif') return 'gif';
  return image.extension || 'bin';
}

function safeImageLabel(value?: string): string {
  return (value || '')
    .replace(/[\u0000-\u001f\u007f]/g, '')
    .replace(/[<>:"/\\|?*]/g, '-')
    .replace(/\s+/g, ' ')
    .trim()
    .slice(0, 90);
}

const DOCX_EMBEDDED_IMAGE_LIMIT = 32;
const DOCX_FRAGMENTED_IMAGE_THRESHOLD = 80;
const DOCX_FRAGMENTED_IMAGE_LIMIT = 24;

export interface DocxEmbeddedImageSelection {
  images: EmbeddedDocxImage[];
  originalCount: number;
  eligibleCount: number;
  selectedCount: number;
  mode: 'all' | 'bounded' | 'fragmented';
}

/**
 * Keeps DOCX visual processing bounded before the first model seat starts.
 *
 * Normal documents with a modest number of embedded raster images keep the
 * existing behavior. Large image-heavy DOCX files (often scan/conversion
 * bundles containing hundreds of tiny fragments) retain only the largest
 * candidates so text extraction can proceed immediately without spending the
 * entire request lifetime uploading and registering derived artifacts.
 */
export function selectDocxEmbeddedImagesForPersistence(
  images: EmbeddedDocxImage[]
): DocxEmbeddedImageSelection {
  const originalCount = Array.isArray(images) ? images.length : 0;
  const eligible = (Array.isArray(images) ? images : []).filter(
    (image) =>
      image &&
      Buffer.isBuffer(image.data) &&
      image.data.length > 0 &&
      SUPPORTED_IMAGE_TYPES.has((image.contentType || '').toLowerCase())
  );

  if (eligible.length <= DOCX_EMBEDDED_IMAGE_LIMIT) {
    return {
      images: eligible,
      originalCount,
      eligibleCount: eligible.length,
      selectedCount: eligible.length,
      mode: 'all',
    };
  }

  const fragmented = eligible.length > DOCX_FRAGMENTED_IMAGE_THRESHOLD;
  const limit = fragmented
    ? DOCX_FRAGMENTED_IMAGE_LIMIT
    : DOCX_EMBEDDED_IMAGE_LIMIT;

  const selected = [...eligible]
    .sort((a, b) => {
      const sizeDiff = b.data.length - a.data.length;
      return sizeDiff !== 0 ? sizeDiff : a.index - b.index;
    })
    .slice(0, limit)
    .sort((a, b) => a.index - b.index);

  return {
    images: selected,
    originalCount,
    eligibleCount: eligible.length,
    selectedCount: selected.length,
    mode: fragmented ? 'fragmented' : 'bounded',
  };
}

export async function persistDocxEmbeddedImages(
  options: PersistDocxEmbeddedImagesOptions
): Promise<PersistedDocxEmbeddedImage[]> {
  const { supabase, parentFilename, parentFileBytes, images } = options;
  if (!supabase || !Buffer.isBuffer(parentFileBytes) || parentFileBytes.length === 0) {
    return [];
  }
  if (!Array.isArray(images) || images.length === 0) return [];

  const {
    data: { user },
    error: authError,
  } = await supabase.auth.getUser();

  if (authError || !user) {
    throw new Error('Authenticated user session required for DOCX embedded-image persistence');
  }

  const parentHash = crypto
    .createHash('sha256')
    .update(parentFileBytes)
    .digest('hex');
  const parentBase = safeBaseFilename(parentFilename);
  const persisted: PersistedDocxEmbeddedImage[] = [];

  for (const image of images) {
    if (
      !image ||
      !Buffer.isBuffer(image.data) ||
      image.data.length === 0 ||
      !SUPPORTED_IMAGE_TYPES.has((image.contentType || '').toLowerCase())
    ) {
      continue;
    }

    const extension = normalizeExtension(image);
    const imageHash = crypto
      .createHash('sha256')
      .update(image.data)
      .digest('hex');
    const storagePath =
      `${user.id}/docx-assets/${parentHash}/${String(image.index).padStart(3, '0')}-${imageHash.slice(0, 16)}.${extension}`;

    const { error: uploadError } = await supabase.storage
      .from(STORAGE_BUCKET)
      .upload(storagePath, image.data, {
        contentType: image.contentType,
        upsert: false,
      });

    const createdNewObject = !uploadError;

    if (
      uploadError &&
      !/already exists|duplicate/i.test(uploadError.message || '')
    ) {
      console.warn('[DOCX Visual] Embedded image upload failed:', {
        parentFilename,
        imageIndex: image.index,
        error: uploadError.message,
      });
      continue;
    }

    const { data: signedData, error: signError } = await supabase.storage
      .from(STORAGE_BUCKET)
      .createSignedUrl(storagePath, MODEL_TRANSPORT_URL_EXPIRY_SECONDS);

    if (signError || !signedData?.signedUrl) {
      console.warn('[DOCX Visual] Embedded image signing failed:', {
        parentFilename,
        imageIndex: image.index,
        error: signError?.message || 'Unknown signing error',
      });
      if (createdNewObject) {
        const { error: cleanupError } = await supabase.storage
          .from(STORAGE_BUCKET)
          .remove([storagePath]);
        if (cleanupError) {
          console.warn('[DOCX Visual] Failed to clean unsigned embedded image:', {
            storagePath,
            error: cleanupError.message,
          });
        }
      }
      continue;
    }

    const altLabel = safeImageLabel(image.altText);
    const filename = altLabel
      ? `${parentBase} — embedded image ${image.index + 1} — ${altLabel}.${extension}`
      : `${parentBase} — embedded image ${image.index + 1}.${extension}`;
    persisted.push({
      index: image.index,
      filename,
      storagePath,
      signedUrl: `${signedData.signedUrl}#filename=${encodeURIComponent(filename)}`,
      contentType: image.contentType,
      byteSize: image.data.length,
    });
  }

  return persisted;
}
