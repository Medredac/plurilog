export const VIDEO_LIMIT_BYTES = 500 * 1024 * 1024;
export const VIDEO_LIMIT_SECONDS = 90 * 60;

const VIDEO_MIME: Record<string, string> = {
  mp4: 'video/mp4',
  mov: 'video/mov',
  webm: 'video/webm',
};

export function videoMime(filename: string): string | null {
  const ext = filename.toLowerCase().split('.').pop() || '';
  return VIDEO_MIME[ext] || null;
}

export function isVideoAttachment(attachment: { filename?: string; url?: string }): boolean {
  if (attachment.filename && videoMime(attachment.filename)) return true;
  const pathname = (attachment.url || '').split('?')[0].split('#')[0];
  return Boolean(videoMime(pathname));
}
