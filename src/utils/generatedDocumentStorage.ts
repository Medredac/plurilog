import crypto from 'node:crypto';
import { Buffer } from 'node:buffer';
import { ModelId } from '@/types/chat';
import { buildDurableAttachmentUrl } from './durableAttachments';

const STORAGE_BUCKET = 'message-images';
const MODEL_TRANSPORT_URL_EXPIRY_SECONDS = 259200;
const DOCX_MIME =
  'application/vnd.openxmlformats-officedocument.wordprocessingml.document';
const PDF_MIME = 'application/pdf';

export type GeneratedDocumentFormat = 'docx' | 'pdf';

export interface PersistGeneratedDocumentOptions {
  supabase: any;
  discussionId: string;
  messageId: string;
  seatId: ModelId;
  fileBuffer: Buffer;
  filename: string;
  format: GeneratedDocumentFormat;
}

export interface PersistGeneratedDocumentResult {
  storagePath: string;
  signedUrl: string;
  durableUrl: string;
  mediaType: string;
  byteSize: number;
  filename: string;
}

function sanitizeGeneratedFilename(
  value: string,
  format: GeneratedDocumentFormat
): string {
  const extension = format === 'pdf' ? '.pdf' : '.docx';
  const fallback = `document${extension}`;
  let base = (value || fallback)
    .split(/[\\/]/)
    .pop()!
    .replace(/[\u0000-\u001f\u007f]/g, '')
    .replace(/[<>:"/\\|?*]/g, '-')
    .replace(/\s+/g, ' ')
    .trim()
    .replace(/^\.+/, '') || 'document';

  base = base.replace(/\.(docx|pdf)$/i, '').trim() || 'document';
  base = base.slice(0, Math.max(1, 140 - extension.length));
  return `${base}${extension}`;
}

export async function persistGeneratedDocument(
  options: PersistGeneratedDocumentOptions
): Promise<PersistGeneratedDocumentResult> {
  const {
    supabase,
    discussionId,
    messageId,
    seatId,
    fileBuffer,
    format,
  } = options;
  const filename = sanitizeGeneratedFilename(options.filename, format);
  const mediaType = format === 'pdf' ? PDF_MIME : DOCX_MIME;

  if (!supabase) throw new Error('Authenticated Supabase client is required');
  if (!discussionId?.trim()) throw new Error('Valid discussionId is required');
  if (!messageId?.trim()) throw new Error('Valid messageId is required');
  if (!Buffer.isBuffer(fileBuffer) || fileBuffer.length === 0) {
    throw new Error('Generated document buffer is empty.');
  }

  const {
    data: { user },
    error: authError,
  } = await supabase.auth.getUser();

  if (authError || !user) {
    throw new Error('Authenticated user session required for document persistence');
  }

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
      `Message ${messageId} (sender: ${seatId}) not found in discussion ${discussionId}`
    );
  }

  const timestamp = Date.now();
  const randomSuffix = crypto.randomBytes(4).toString('hex');
  const filePath = `${user.id}/${timestamp}-doc-${seatId}-${randomSuffix}.${format}`;

  const { error: uploadError } = await supabase.storage
    .from(STORAGE_BUCKET)
    .upload(filePath, fileBuffer, {
      contentType: mediaType,
      upsert: false,
    });

  if (uploadError) {
    throw new Error(`Storage upload failed for generated document: ${uploadError.message}`);
  }

  const { data: signedData, error: signError } = await supabase.storage
    .from(STORAGE_BUCKET)
    .createSignedUrl(filePath, MODEL_TRANSPORT_URL_EXPIRY_SECONDS);

  if (signError || !signedData?.signedUrl) {
    try {
      await supabase.storage.from(STORAGE_BUCKET).remove([filePath]);
    } catch (cleanupErr) {
      console.warn(
        '[Generated Document Storage] Failed to remove orphan after sign error:',
        cleanupErr
      );
    }
    throw new Error(
      `Failed to create transport URL for generated document: ${
        signError?.message || 'Unknown signing error'
      }`
    );
  }

  const signedUrl = `${signedData.signedUrl}#filename=${encodeURIComponent(filename)}`;
  const durableUrl = buildDurableAttachmentUrl(filePath, filename);
  const currentAttachments: string[] = Array.isArray(existingMsg.attachment_urls)
    ? existingMsg.attachment_urls
    : [];

  const { error: updateError } = await supabase
    .from('messages')
    .update({ attachment_urls: [...currentAttachments, durableUrl] })
    .eq('id', messageId)
    .eq('discussion_id', discussionId)
    .eq('sender', seatId);

  if (updateError) {
    try {
      await supabase.storage.from(STORAGE_BUCKET).remove([filePath]);
    } catch (cleanupErr) {
      console.warn(
        '[Generated Document Storage] Failed to remove orphan after message update error:',
        cleanupErr
      );
    }
    throw new Error(
      `Failed to attach generated document to message: ${updateError.message}`
    );
  }

  return {
    storagePath: filePath,
    signedUrl,
    durableUrl,
    mediaType,
    byteSize: fileBuffer.length,
    filename,
  };
}
