import crypto from 'crypto';
import type { SupabaseClient } from '@supabase/supabase-js';
import { ModelId } from '../types/chat';
import { buildDurableAttachmentUrl } from './durableAttachments';

/**
 * Storage & message persistence helper for generated AI images.
 *
 * Persists model-generated images directly into the existing `message-images` bucket.
 * The database stores a stable authenticated Plurilog attachment URL; temporary signed
 * URLs are returned only for same-round model transport.
 *
 * NOTE: Inert utility — not currently imported or consumed by runtime routes.
 */

const STORAGE_BUCKET = 'message-images';
const MODEL_TRANSPORT_URL_EXPIRY_SECONDS = 259200; // 72h transport window; never used as durable attachment identity

const SUPPORTED_MIME_TO_EXT: Record<string, string> = {
  'image/png': 'png',
  'image/jpeg': 'jpg',
  'image/jpg': 'jpg',
  'image/webp': 'webp',
};

export interface PersistGeneratedImageOptions {
  supabase: SupabaseClient;
  discussionId: string;
  messageId: string;
  seatId: ModelId;
  b64Json: string;
  mediaType?: string;
}

export interface PersistGeneratedImageResult {
  storagePath: string;
  signedUrl: string;
  mediaType: string;
  byteSize: number;
  filename: string;
}

/**
 * Persists a generated image into Supabase Storage and updates the assistant message row.
 */
export async function persistGeneratedImage(
  options: PersistGeneratedImageOptions
): Promise<PersistGeneratedImageResult> {
  const {
    supabase,
    discussionId,
    messageId,
    seatId,
    b64Json,
    mediaType = 'image/png',
  } = options;

  // 1. Security & Parameter Validation
  if (!supabase) {
    throw new Error('Authenticated Supabase client is required');
  }
  if (!discussionId || typeof discussionId !== 'string' || discussionId.trim() === '') {
    throw new Error('Valid discussionId is required for generated image persistence');
  }
  if (!messageId || typeof messageId !== 'string' || messageId.trim() === '') {
    throw new Error('Valid messageId is required for generated image persistence');
  }
  if (!seatId || typeof seatId !== 'string') {
    throw new Error('Valid seatId is required for generated image persistence');
  }

  // 2. Derive Authenticated User ID from Supabase Session
  const {
    data: { user },
    error: authError,
  } = await supabase.auth.getUser();

  if (authError || !user) {
    throw new Error('Authenticated user session required for generated image persistence');
  }

  // 3. MIME Type Validation
  const normalizedMime = mediaType.trim().toLowerCase();
  const safeExt = SUPPORTED_MIME_TO_EXT[normalizedMime];
  if (!safeExt) {
    throw new Error(
      `Unsupported image mediaType "${mediaType}". Supported formats: image/png, image/jpeg, image/webp.`
    );
  }

  // 4. Base64 Decoding & Byte Validation
  if (!b64Json || typeof b64Json !== 'string' || b64Json.trim() === '') {
    throw new Error('Invalid or empty base64 image data');
  }

  const cleanB64 = b64Json.replace(/^data:image\/[a-z]+;base64,/, '').trim();
  let fileBuffer: Buffer;
  try {
    fileBuffer = Buffer.from(cleanB64, 'base64');
  } catch (err: any) {
    throw new Error(`Failed to decode base64 image data: ${err?.message || 'Invalid encoding'}`);
  }

  if (fileBuffer.length === 0) {
    throw new Error('Decoded image buffer is empty (0 bytes)');
  }

  // 5. Verify message existence, ownership, and expected model sender under active session
  const { data: existingMsg, error: fetchErr } = await supabase
    .from('messages')
    .select('id, discussion_id, sender, attachment_urls')
    .eq('id', messageId)
    .eq('discussion_id', discussionId)
    .eq('sender', seatId)
    .maybeSingle();

  if (fetchErr) {
    throw new Error(`Failed to verify message record: ${fetchErr.message}`);
  }
  if (!existingMsg) {
    throw new Error(
      `Message ${messageId} (sender: ${seatId}) not found in discussion ${discussionId} or not accessible under current session`
    );
  }

  // 6. Generate collision-resistant storage path and display filename
  const timestamp = Date.now();
  const randomSuffix = crypto.randomBytes(4).toString('hex');
  const filename = `${seatId}-generated-${timestamp}.${safeExt}`;
  const filePath = `${user.id}/${timestamp}-gen-${seatId}-${randomSuffix}.${safeExt}`;

  // 7. Upload bytes into Supabase Storage
  const { error: uploadError } = await supabase.storage
    .from(STORAGE_BUCKET)
    .upload(filePath, fileBuffer, {
      contentType: normalizedMime,
      upsert: false,
    });

  if (uploadError) {
    throw new Error(`Storage upload failed for generated image: ${uploadError.message}`);
  }

  // 8. Generate a short-lived signed URL for same-round model transport only
  const { data: signedData, error: signError } = await supabase.storage
    .from(STORAGE_BUCKET)
    .createSignedUrl(filePath, MODEL_TRANSPORT_URL_EXPIRY_SECONDS);

  if (signError || !signedData?.signedUrl) {
    // Attempt orphan cleanup on storage file
    try {
      await supabase.storage.from(STORAGE_BUCKET).remove([filePath]);
    } catch (cleanupErr) {
      console.warn('[Generated Image Storage] Failed to remove orphan after sign error:', cleanupErr);
    }
    throw new Error(
      `Failed to create signed URL for generated image: ${signError?.message || 'Unknown signing error'}`
    );
  }

  const signedUrlWithFilename = `${signedData.signedUrl}#filename=${encodeURIComponent(filename)}`;

  // 9. Persist the stable authenticated Plurilog attachment URL.
  // The signed URL above is transport-only for same-round model access.
  const currentAttachments: string[] = Array.isArray(existingMsg.attachment_urls)
    ? existingMsg.attachment_urls
    : [];

  const durableUrl = buildDurableAttachmentUrl(filePath, filename);
  const updatedAttachments = [...currentAttachments, durableUrl];

  // 10. Update assistant message row (strictly constrained to messageId, discussionId, and sender)
  const { error: updateError } = await supabase
    .from('messages')
    .update({ attachment_urls: updatedAttachments })
    .eq('id', messageId)
    .eq('discussion_id', discussionId)
    .eq('sender', seatId);

  if (updateError) {
    // Attempt orphan cleanup of the newly uploaded file to avoid leaving unlinked storage objects
    try {
      await supabase.storage.from(STORAGE_BUCKET).remove([filePath]);
    } catch (cleanupErr) {
      console.warn('[Generated Image Storage] Failed to remove orphan after update error:', cleanupErr);
    }
    throw new Error(
      `Failed to update message attachments with generated image: ${updateError.message}`
    );
  }

  return {
    storagePath: filePath,
    signedUrl: signedUrlWithFilename,
    mediaType: normalizedMime,
    byteSize: fileBuffer.length,
    filename,
  };
}
