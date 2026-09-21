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
      continue;
    }

    const filename = `${parentBase} — embedded image ${image.index + 1}.${extension}`;
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
