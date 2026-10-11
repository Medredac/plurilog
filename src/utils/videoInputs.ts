/** Shared, browser-safe video input rules. This is an app limit, not a model limit. */
export const VIDEO_MAX_BYTES = 25 * 1024 * 1024;
export const VIDEO_ACCEPT = '.mp4,.mov,.webm,video/mp4,video/quicktime,video/webm';

export function videoMime(filename: string): string | null {
  const extension = filename.split(/[?#]/)[0].split('.').pop()?.toLowerCase();
  return ({ mp4: 'video/mp4', mov: 'video/quicktime', webm: 'video/webm' } as Record<string, string>)[extension || ''] || null;
}

export function isVideoAttachment(attachment: { filename?: string; url?: string }): boolean {
  return Boolean(videoMime(attachment.filename || '') || videoMime(attachment.url || ''));
}

export function normalizeYouTubeUrl(raw: string): string | null {
  try {
    const url = new URL(raw.replace(/[.,!?;:]+$/, ''));
    if (!['http:', 'https:'].includes(url.protocol) || url.username || url.password || url.port) return null;
    const host = url.hostname.toLowerCase();
    let id: string | null = null;
    if (host === 'youtu.be' || host === 'www.youtu.be') id = url.pathname.slice(1).split('/')[0];
    else if (['youtube.com', 'www.youtube.com', 'm.youtube.com', 'music.youtube.com', 'youtube-nocookie.com', 'www.youtube-nocookie.com'].includes(host)) {
      if (url.pathname === '/watch') id = url.searchParams.get('v');
      else id = url.pathname.match(/^\/(?:shorts|live|embed)\/([^/]+)\/?$/)?.[1] || null;
    }
    return id && /^[a-zA-Z0-9_-]{11}$/.test(id) ? `https://www.youtube.com/watch?v=${id}` : null;
  } catch { return null; }
}

export function extractYouTubeUrls(text: string): string[] {
  return [...new Set((text.match(/https?:\/\/[^\s<>\[\]{}"'()]+/gi) || [])
    .map(normalizeYouTubeUrl).filter((url): url is string => Boolean(url)))];
}

export const VIDEO_INSPECTION_TOOL = {
  type: 'function' as const,
  function: {
    name: 'inspect_video',
    description: 'Open a public YouTube video or an uploaded video from THIS discussion for your direct audio/visual inspection. Use before answering questions that require video details not already established by saved findings, including timestamps and transcripts. For an earlier video, use conversation-memory tools to identify the correct message and source first; do not guess the most recent video. Supply either youtube_url or the exact uploaded filename. If filenames are ambiguous, also supply source_user_message_id from memory. The video is attached to your next call; inspect it and answer the original request. You can retrieve more history or inspect another video afterward. Private/unavailable YouTube videos and missing uploads may fail; never invent an inspection.',
    parameters: {
      type: 'object',
      properties: {
        youtube_url: { type: 'string', description: 'A YouTube link supplied in the current message or recovered from this conversation.' },
        filename: { type: 'string', description: 'Exact uploaded video filename.' },
        source_user_message_id: { type: 'string', description: 'Message identity returned by memory retrieval, to distinguish duplicate filenames.' },
        question: { type: 'string', description: 'What you need to inspect; include any requested timestamps and transcription language.' },
      },
      required: ['question'],
      additionalProperties: false,
    },
  },
};
