import { createServiceClient } from './supabase/service';
import { extractAttachmentStoragePath } from './durableAttachments';
import { VIDEO_MAX_BYTES, VIDEO_INLINE_MAX_BYTES, VIDEO_BUDGET_MESSAGE, videoMime, type VideoRange } from './videoInputs';
import { readVideoResponse, validateVideoBytes, type VideoSource } from './videoInspection';
import { inspectPreparedVideo } from './videoPreparation';

export function ownedVideoPath(path: string | null, userId: string): string {
  if (!path || path.split('/')[0] !== userId || path.split('/').some(part => !part || part === '.' || part === '..' || /[\\%]/.test(part))) throw new Error('Video not available to this account.');
  return path;
}

export async function storedVideoSize(path: string): Promise<number> {
  const { data, error } = await createServiceClient().storage.from('message-images').info(path);
  if (error || !data || !Number.isSafeInteger(data.size) || (data.size ?? 0) <= 0) throw new Error('The stored video is unavailable or empty. Please upload it again.');
  return data.size!;
}

/** Trust Storage's byte counts, not attachment metadata supplied by the browser. */
export async function validateStoredVideoBudget(attachments: Array<{ url: string }>, userId: string) {
  if (attachments.length > 5) throw new Error('You can attach up to five files per message.');
  let total = 0;
  for (const attachment of attachments) {
    const path = ownedVideoPath(extractAttachmentStoragePath(attachment.url), userId);
    total += await storedVideoSize(path);
    if (total > VIDEO_MAX_BYTES) throw new Error(VIDEO_BUDGET_MESSAGE);
  }
}

export async function inspectStoredVideo(options: {
  path: string; userId: string; filename: string; question: string; range: VideoRange; signal: AbortSignal;
  analyze: (source: VideoSource, signal: AbortSignal) => Promise<{ findings: string; model: string }>;
}) {
  ownedVideoPath(options.path, options.userId);
  const size = await storedVideoSize(options.path);
  if (size > VIDEO_MAX_BYTES) throw new Error(VIDEO_BUDGET_MESSAGE);
  const { data, error } = await createServiceClient().storage.from('message-images').createSignedUrl(options.path, 600);
  if (error || !data?.signedUrl) throw new Error('The stored video is unavailable. Please upload it again.');
  if (size <= VIDEO_INLINE_MAX_BYTES) {
    const response = await fetch(data.signedUrl, { signal: AbortSignal.any([options.signal, AbortSignal.timeout(60_000)]), redirect: 'error' });
    const bytes = await readVideoResponse(response);
    validateVideoBytes(bytes, options.filename);
    return options.analyze({ url: `data:${videoMime(options.filename)};base64,${bytes.toString('base64')}`, label: options.filename, question: options.question, youtube: false }, options.signal);
  }
  return inspectPreparedVideo({ ...options, signedUrl: data.signedUrl });
}
