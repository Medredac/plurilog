/**
 * Preview-only ephemeral Gemini video transport.
 * Private Supabase videos cannot be sent as MP4 URLs through OpenRouter:
 * Google's OpenRouter endpoints require inline base64 for private video.
 * For files up to 500 MiB this helper streams the original signed Supabase
 * object to Google's resumable Files API, analyzes it with Gemini 3.8 Flash,
 * and deletes the Google Files copy in finally.
 */
import { VIDEO_LIMIT_BYTES, videoMime } from './videoUpload';

function jsonError(status: number, detail: unknown): Error {
  const safe = typeof detail === 'string' ? detail.slice(0, 400) : JSON.stringify(detail).slice(0, 400);
  return new Error(`Gemini video API error (${status}): ${safe}`);
}

async function parseJson(response: Response): Promise<any> {
  const body = await response.text();
  let parsed: any;
  try {
    parsed = JSON.parse(body);
  } catch {
    throw jsonError(response.status, body);
  }
  if (!response.ok) throw jsonError(response.status, parsed?.error?.message || parsed);
  return parsed;
}

function delay(ms: number, signal: AbortSignal) {
  return new Promise<void>((resolve, reject) => {
    if (signal.aborted) { reject(signal.reason || new Error('Video analysis aborted')); return; }
    const timeout = setTimeout(() => { signal.removeEventListener('abort', onAbort); resolve(); }, ms);
    const onAbort = () => { clearTimeout(timeout); reject(signal.reason || new Error('Video analysis aborted')); };
    signal.addEventListener('abort', onAbort, { once: true });
  });
}

export interface GeminiVideoResult {
  content: string;
  usage: {
    prompt_tokens: number;
    completion_tokens: number;
    total_tokens: number;
    cost: number;
  };
}

export async function analyzeGeminiVideo({
  signedUrl,
  filename,
  prompt,
  signal,
  userId,
}: {
  signedUrl: string;
  filename: string;
  prompt: string;
  signal: AbortSignal;
  userId: string;
}): Promise<GeminiVideoResult> {
  const key = process.env.GEMINI_API_KEY;
  if (!key) throw new Error('Gemini video analysis is not configured for this preview.');

  const mime = videoMime(filename);
  if (!mime) throw new Error('Unsupported video format.');

  // Never fetch arbitrary user-supplied URLs on the server.
  const source = new URL(signedUrl);
  const supabaseOrigin = new URL(process.env.NEXT_PUBLIC_SUPABASE_URL || '');
  const expectedPrefix = `/storage/v1/object/sign/message-images/${userId}/video-temp/`;
  if (source.origin !== supabaseOrigin.origin || !decodeURIComponent(source.pathname).startsWith(expectedPrefix)) {
    throw new Error('Untrusted video attachment URL.');
  }

  const downloaded = await fetch(signedUrl, { signal });
  if (!downloaded.ok || !downloaded.body) {
    throw new Error('Could not read the temporary video from private storage.');
  }
  const bytes = Number(downloaded.headers.get('content-length'));
  if (!Number.isInteger(bytes) || bytes < 1 || bytes > VIDEO_LIMIT_BYTES) {
    await downloaded.body.cancel();
    throw new Error('Video must be at most 500 MB.');
  }

  const googleBase = 'https://generativelanguage.googleapis.com';
  const start = await fetch(`${googleBase}/upload/v1beta/files`, {
    method: 'POST',
    headers: {
      'x-goog-api-key': key,
      'X-Goog-Upload-Protocol': 'resumable',
      'X-Goog-Upload-Command': 'start',
      'X-Goog-Upload-Header-Content-Length': String(bytes),
      'X-Goog-Upload-Header-Content-Type': mime,
      'Content-Type': 'application/json',
    },
    body: JSON.stringify({ file: { display_name: filename.slice(0, 120) } }),
    signal,
  });
  if (!start.ok) throw jsonError(start.status, await start.text());
  const uploadUrl = start.headers.get('x-goog-upload-url');
  if (!uploadUrl || new URL(uploadUrl).origin !== googleBase) {
    throw new Error('Gemini Files API did not return a trusted upload URL.');
  }

  let googleFileName: string | null = null;
  try {
    // Stream from Supabase to Google; do not hold a 500 MB file in Vercel memory.
    const uploaded = await fetch(uploadUrl, {
      method: 'POST',
      headers: {
        'X-Goog-Upload-Offset': '0',
        'X-Goog-Upload-Command': 'upload, finalize',
        'Content-Length': String(bytes),
        'Content-Type': mime,
      },
      body: downloaded.body,
      duplex: 'half',
      signal,
    } as RequestInit & { duplex: 'half' });
    const fileInfo = await parseJson(uploaded);
    googleFileName = fileInfo?.file?.name || null;
    let file = fileInfo?.file;
    if (!googleFileName || !file?.uri) throw new Error('Gemini Files API returned an invalid file record.');

    for (let attempt = 0; attempt < 180; attempt++) {
      const state = String(file.state || 'ACTIVE').toUpperCase();
      if (state === 'ACTIVE') break;
      if (state === 'FAILED') throw new Error('Google could not process the uploaded video.');
      if (attempt === 179) throw new Error('Timed out preparing the uploaded video.');
      await delay(4000, signal);
      file = await parseJson(await fetch(`${googleBase}/v1beta/${googleFileName}`, {
        headers: { 'x-goog-api-key': key },
        signal,
      }));
    }

    const response = await parseJson(await fetch(`${googleBase}/v1beta/interactions`, {
      method: 'POST',
      headers: { 'x-goog-api-key': key, 'Content-Type': 'application/json' },
      body: JSON.stringify({
        model: 'gemini-3.8-flash',
        input: [
          { type: 'video', uri: file.uri, mime_type: mime, processing: 'agentic' },
          { type: 'text', text: prompt.trim() || 'Analyze and summarize this video. Note important events with timestamps.' },
        ],
      }),
      signal,
    }));

    const content = (
      response?.output_text ||
      response?.outputText ||
      (Array.isArray(response?.outputs)
        ? response.outputs.filter((output: any) => output?.type === 'text').map((output: any) => output.text || '').join('\n')
        : '')
    ).trim();
    if (!content) throw new Error('Gemini returned no video analysis text.');

    const usage = response.usage || response.usage_metadata || response.usageMetadata || {};
    const input = Number(usage.input_tokens ?? usage.prompt_token_count ?? usage.promptTokenCount ?? usage.inputTokens ?? 0);
    const output = Number(usage.output_tokens ?? usage.candidates_token_count ?? usage.candidatesTokenCount ?? usage.outputTokens ?? 0);
    return {
      content,
      usage: {
        prompt_tokens: input,
        completion_tokens: output,
        total_tokens: input + output,
        // Standard Gemini 3.8 Flash rates (USD/M). Direct Google API pricing
        // must be verified before enabling this feature in production.
        cost: (input * 0.75 + output * 3.75) / 1_000_000,
      },
    };
  } finally {
    if (googleFileName) {
      try {
        await fetch(`${googleBase}/v1beta/${googleFileName}`, {
          method: 'DELETE',
          headers: { 'x-goog-api-key': key },
          signal: AbortSignal.timeout(15_000),
        });
      } catch (error) {
        console.warn('[Gemini Video] Failed to delete Google Files copy:', error);
      }
    }
  }
}
