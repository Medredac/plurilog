import { NextRequest } from 'next/server';
import { createClient } from '@/utils/supabase/server';
import { readFile } from 'node:fs/promises';

export const maxDuration = 120;
export async function POST(req: NextRequest) {
  if (process.env.VERCEL_ENV !== 'preview') return new Response('Not found', { status: 404 });
  const supabase = await createClient();
  const { data: { user } } = await supabase.auth.getUser();
  if (!user) return new Response('Unauthorized', { status: 401 });
  const { data: discussion } = await supabase.from('discussions').select('id').eq('id', '7a2e75db-0ab3-41c3-af74-c476b69c7f44').eq('user_id', user.id).maybeSingle();
  if (!discussion) return new Response('Not found', { status: 404 });
  const { test } = await req.json();
  const cases: Record<string, { model: string; processing?: string; upload?: boolean; provider?: string }> = {
    stream: { model: 'google/gemini-3.8-flash', provider: 'google-ai-studio' },
    tools: { model: 'google/gemini-3.8-flash', provider: 'google-ai-studio' },
    models: { model: 'google/gemini-3.8-flash', provider: 'google-ai-studio' },
    automatic: { model: 'google/gemini-3.8-flash' },
    documented: { model: 'google/gemini-2.5-flash' },
    youtube: { model: 'google/gemini-3.8-flash', provider: 'google-ai-studio' },
    agentic: { model: 'google/gemini-3.8-flash', provider: 'google-ai-studio', processing: 'agentic' },
    fallback: { model: 'google/gemini-3.7-flash', provider: 'google-ai-studio' },
    lite: { model: 'google/gemini-3.5-flash-lite', provider: 'google-ai-studio' },
    upload: { model: 'google/gemini-3.8-flash', upload: true },
    text: { model: 'google/gemini-3.8-flash', provider: 'google-ai-studio' },
  };
  const config = cases[test];
  if (!config) return new Response('Invalid test', { status: 400 });
  const url = config.upload
    ? `data:video/mp4;base64,${(await readFile(process.cwd() + '/src/app/api/video-verification/fixture.mp4')).toString('base64')}`
    : 'https://www.youtube.com/watch?v=jNQXAC9IVRw';
  const start = Date.now();
  const response = await fetch('https://openrouter.ai/api/v1/chat/completions', {
    method: 'POST', signal: AbortSignal.timeout(90_000),
    headers: { Authorization: `Bearer ${process.env.OPENROUTER_API_KEY?.trim()}`, 'Content-Type': 'application/json', 'X-Title': 'Plurilog preview verification' },
    body: JSON.stringify({
      model: config.model, max_tokens: 2000,
      ...(test === 'stream' ? { stream: true } : {}),
      ...(test === 'tools' ? { tools: [{ type: 'openrouter:web_search', parameters: { max_results: 3, max_total_results: 6 } }] } : {}),
      ...(test === 'models' ? { models: ['google/gemini-3.8-flash', 'google/gemini-3.7-flash', 'google/gemini-3.5-flash-lite'] } : {}),
      ...(config.provider ? { provider: { only: [config.provider] } } : {}),
      messages: [{ role: 'user', content: test === 'text' ? 'Reply with OK.' : [
        { type: 'text', text: config.upload ? 'Describe the background and shape at 0:01 and at 0:04, in one sentence each.' : 'Describe what is visible at 0:07 of this video in one sentence. Inspect the video, not web metadata.' },
        { type: 'video_url', video_url: { url }, ...(config.processing ? { processing: config.processing } : {}) },
      ] }],
    }),
  });
  let result: any;
  if (response.headers.get('content-type')?.includes('text/event-stream')) {
    const events = (await response.text()).split('\n').filter(line => line.startsWith('data: ') && !line.includes('[DONE]')).map(line => JSON.parse(line.slice(6)));
    const failure = events.find(event => event.error);
    result = failure || { model: events.find(event => event.model)?.model, choices: [{ message: { content: events.map(event => event.choices?.[0]?.delta?.content || '').join('') } }], usage: events.findLast(event => event.usage)?.usage };
  } else result = await response.json();
  return Response.json({ test, status: response.status, elapsedMs: Date.now() - start, model: result.model, text: result.choices?.[0]?.message?.content, usage: result.usage, error: result.error ? { message: result.error.message, metadata: result.error.metadata } : null });
}
