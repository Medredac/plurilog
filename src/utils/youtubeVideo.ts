import type OpenAI from 'openai';
import type { DiscussionMemoryResult } from '@/utils/discussionMemory';

const YOUTUBE_HOSTS = new Set([
  'youtube.com',
  'www.youtube.com',
  'm.youtube.com',
  'music.youtube.com',
  'youtu.be',
  'www.youtu.be',
  'youtube-nocookie.com',
  'www.youtube-nocookie.com',
]);

const URL_RE = /https?:\/\/[^\s<>()\[\]{}"'“”‘’]+/gi;

function trimUrlPunctuation(value: string): string {
  return value.replace(/[.,!?;:]+$/g, '');
}

export function normalizeYouTubeUrl(raw: string): string | null {
  try {
    const parsed = new URL(trimUrlPunctuation(raw));
    if (parsed.protocol !== 'https:' && parsed.protocol !== 'http:') return null;
    if (!YOUTUBE_HOSTS.has(parsed.hostname.toLowerCase())) return null;

    if (parsed.hostname.toLowerCase().endsWith('youtu.be')) {
      const id = parsed.pathname.split('/').filter(Boolean)[0];
      return id ? `https://youtu.be/${id}` : null;
    }

    const path = parsed.pathname;
    if (
      path === '/watch' ||
      path.startsWith('/shorts/') ||
      path.startsWith('/live/') ||
      path.startsWith('/embed/')
    ) {
      parsed.protocol = 'https:';
      parsed.hash = '';
      return parsed.toString();
    }
    return null;
  } catch {
    return null;
  }
}

export function extractYouTubeUrls(text?: string | null): string[] {
  if (!text) return [];
  const seen = new Set<string>();
  for (const match of text.match(URL_RE) || []) {
    const normalized = normalizeYouTubeUrl(match);
    if (normalized) seen.add(normalized);
  }
  return [...seen];
}

export function isYouTubeInspectionRequest(
  prompt: string,
  hasCurrentYouTubeUrl: boolean
): boolean {
  const text = prompt.toLowerCase();

  if (hasCurrentYouTubeUrl) {
    // A YouTube URL pasted in the current message is explicit media supplied
    // for this turn. Gemini should receive it even for natural prompts such as
    // "what do you think?" rather than requiring magic analysis keywords.
    return true;
  }

  // Historical reinspection should be explicit enough that we do not silently
  // re-process an old video just because a YouTube URL exists somewhere in history.
  return /\b(reinspect|re-watch|rewatch|watch again|look at .*again|check .*again|go back to .*video|go back to .*lecture|video|youtube|lecture|clip|timestamp|at \d{1,3}(?::\d{2})?|minute \d+|what (?:did|does) .* say|what happens?)\b/i.test(text) &&
    /\b(that|the|earlier|previous|last|same|again|video|youtube|lecture|clip)\b/i.test(text);
}

export function resolveYouTubeUrlForTurn(
  prompt: string,
  memory?: DiscussionMemoryResult
): { url: string; source: 'current' | 'history' } | null {
  const currentUrls = extractYouTubeUrls(prompt);
  if (currentUrls.length > 0 && isYouTubeInspectionRequest(prompt, true)) {
    return { url: currentUrls[currentUrls.length - 1], source: 'current' };
  }

  if (!isYouTubeInspectionRequest(prompt, false)) return null;

  const rounds = memory?.allRounds || memory?.recentRounds || [];
  for (let i = rounds.length - 1; i >= 0; i -= 1) {
    const urls = extractYouTubeUrls(rounds[i]?.userPrompt || '');
    if (urls.length > 0) {
      return { url: urls[urls.length - 1], source: 'history' };
    }
  }
  return null;
}

export function attachYouTubeVideo(
  messages: OpenAI.Chat.Completions.ChatCompletionMessageParam[],
  youtubeUrl: string
): OpenAI.Chat.Completions.ChatCompletionMessageParam[] {
  const cloned = [...messages];
  let target = -1;
  for (let i = cloned.length - 1; i >= 0; i -= 1) {
    if (cloned[i]?.role === 'user') {
      target = i;
      break;
    }
  }
  if (target < 0) return cloned;

  const original: any = cloned[target];
  const content = Array.isArray(original.content)
    ? [...original.content]
    : [{ type: 'text', text: String(original.content || '') }];

  const alreadyAttached = content.some(
    (part: any) =>
      part?.type === 'video_url' &&
      part?.video_url?.url === youtubeUrl
  );
  if (!alreadyAttached) {
    content.push({
      type: 'video_url',
      video_url: { url: youtubeUrl },
    });
  }

  cloned[target] = { ...original, content } as any;
  return cloned;
}
