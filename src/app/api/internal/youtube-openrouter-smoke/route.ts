import { NextResponse } from 'next/server';

export const runtime = 'nodejs';
export const maxDuration = 120;

export async function GET() {
  if (process.env.VERCEL_ENV === 'production') {
    return new Response('Not found', { status: 404 });
  }

  const key = process.env.OPENROUTER_API_KEY;
  if (!key) {
    return NextResponse.json({ ok: false, error: 'missing_openrouter_key' }, { status: 500 });
  }

  const youtubeUrl = 'https://www.youtube.com/watch?v=jNQXAC9IVRw';
  const response = await fetch('https://openrouter.ai/api/v1/chat/completions', {
    method: 'POST',
    headers: {
      Authorization: `Bearer ${key}`,
      'Content-Type': 'application/json',
    },
    body: JSON.stringify({
      model: 'google/gemini-3.8-flash',
      provider: {
        only: ['google-ai-studio'],
        allow_fallbacks: false,
      },
      messages: [{
        role: 'user',
        content: [
          { type: 'text', text: 'Describe what happens in this YouTube video in one sentence.' },
          { type: 'video_url', video_url: { url: youtubeUrl } },
        ],
      }],
    }),
  });

  const raw = await response.text();
  let payload: any = null;
  try { payload = JSON.parse(raw); } catch {}

  return NextResponse.json({
    ok: response.ok,
    status: response.status,
    model: payload?.model || null,
    provider: payload?.provider || null,
    content: payload?.choices?.[0]?.message?.content || null,
    error: payload?.error || (!response.ok ? raw.slice(0, 1000) : null),
  }, { status: response.ok ? 200 : 502 });
}
