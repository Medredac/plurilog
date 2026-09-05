import sharp from 'sharp';

export interface AttachmentItem {
  url: string;
  filename?: string;
}

/**
 * Checks whether an attachment is a JPEG/JPG candidate based on filename or URL pathname.
 * Case-insensitive.
 */
function isJpegAttachment(att: AttachmentItem): boolean {
  if (!att?.url) return false;
  const nameToCheck = (att.filename || att.url.split('?')[0] || '').toLowerCase();
  return nameToCheck.endsWith('.jpg') || nameToCheck.endsWith('.jpeg');
}

/**
 * Prepares vision attachments specifically for the Gemini model seat.
 * 
 * Invariants:
 * 1. Strictly JPEG/JPG-only: non-JPEGs (.png, .webp, .gif, .pdf, etc.) are returned unchanged without fetching.
 * 2. EXIF Orientation 1 or absent: returned unchanged (no re-encoding, zero latency/payload overhead).
 * 3. EXIF Orientation 2-8: auto-oriented via Sharp into a high-quality upright JPEG data URI (data:image/jpeg;base64,...).
 * 4. Independent fail-safe: any failure (fetch, decode, rotate, encode) logs a warning and falls back to original attachment.
 * 5. Strictly preserves exact input order and array length.
 * 6. Completely ephemeral: normalized data URIs are never persisted to database or storage.
 */
export async function prepareGeminiVisionAttachments(
  attachments?: AttachmentItem[] | null
): Promise<AttachmentItem[] | null> {
  if (!attachments || !Array.isArray(attachments) || attachments.length === 0) {
    return attachments || null;
  }

  const result: AttachmentItem[] = [];

  for (let i = 0; i < attachments.length; i++) {
    const att = attachments[i];

    if (!att || !att.url) {
      result.push(att);
      continue;
    }

    // 1. Strictly JPEG/JPG-only scope
    if (!isJpegAttachment(att)) {
      result.push(att);
      continue;
    }

    // 2. Process JPEG attachment with isolated failure handling
    try {
      const response = await fetch(att.url);
      if (!response.ok) {
        console.warn(
          `[Gemini Vision Normalization] HTTP fetch failed for attachment index ${i} (${response.status} ${response.statusText}), falling back to original URL`
        );
        result.push(att);
        continue;
      }

      const arrayBuf = await response.arrayBuffer();
      const inputBuffer = Buffer.from(arrayBuf);

      const metadata = await sharp(inputBuffer).metadata();

      // If orientation is undefined or 1, there is no EXIF-directed orientation transform to apply
      if (!metadata.orientation || metadata.orientation === 1) {
        result.push(att);
        continue;
      }

      // Orientation 2-8: Apply physical orientation transpose and encode to high-quality JPEG
      const normalizedBuffer = await sharp(inputBuffer)
        .rotate()
        .jpeg({
          quality: 92,
          mozjpeg: false,
        })
        .toBuffer();

      const dataUri = `data:image/jpeg;base64,${normalizedBuffer.toString('base64')}`;

      result.push({
        ...att,
        url: dataUri,
      });
    } catch (err: any) {
      console.warn(
        `[Gemini Vision Normalization] Failed to normalize JPEG attachment index ${i} (${att.filename || 'attachment'}), falling back to original URL:`,
        err?.message || err
      );
      result.push(att);
    }
  }

  return result;
}
