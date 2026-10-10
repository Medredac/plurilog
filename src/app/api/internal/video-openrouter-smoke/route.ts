import { NextRequest, NextResponse } from 'next/server';
import { createServiceClient } from '@/utils/supabase/service';

export const runtime = 'nodejs';
export const maxDuration = 300;

export async function GET(request: NextRequest) {
  if (process.env.VERCEL_ENV === 'production') {
    return new Response('Not found', { status: 404 });
  }
  const apiKey = process.env.OPENROUTER_API_KEY;
  if (!apiKey) return NextResponse.json({ ok: false, error: 'missing_openrouter_key' }, { status: 500 });

  const sourceUrl = 'https://storage.googleapis.com/cloud-samples-data/video/JaneGoodall.mp4';
  const path = `video-smoke/${Date.now()}-openrouter.mp4`;
  const storage = createServiceClient().storage.from('message-images');

  try {
    const source = await fetch(sourceUrl);
    if (!source.ok) throw new Error(`sample_download_${source.status}`);
    const bytes = await source.arrayBuffer();

    const { error: uploadError } = await storage.upload(path, bytes, {
      contentType: 'video/mp4',
      upsert: false,
    });
    if (uploadError) throw new Error(`supabase_upload: ${uploadError.message}`);

    const { data: signed, error: signedError } = await storage.createSignedUrl(path, 600);
    if (signedError || !signed?.signedUrl) {
      throw new Error(`signed_url: ${signedError?.message || 'missing'}`);
    }

    const response = await fetch('https://openrouter.ai/api/v1/chat/completions', {
      method: 'POST',
      headers: {
        Authorization: `Bearer ${apiKey}`,
        'Content-Type': 'application/json',
      },
      body: JSON.stringify({
        model: 'google/gemini-3.8-flash',
        provider: {
          only: ['google-vertex'],
          allow_fallbacks: false,
        },
        messages: [{
          role: 'user',
          content: [
            { type: 'text', text: 'Describe this video in one short sentence.' },
            { type: 'video_url', video_url: { url: signed.signedUrl } },
          ],
        }],
      }),
    });
    const text = await response.text();
    let payload: any = null;
    try { payload = JSON.parse(text); } catch {}

    return NextResponse.json({
      ok: response.ok,
      status: response.status,
      model: payload?.model || null,
      provider: payload?.provider || null,
      content: payload?.choices?.[0]?.message?.content?.slice?.(0, 300) || null,
      error: payload?.error?.message || (!response.ok ? text.slice(0, 300) : null),
      sampleBytes: bytes.byteLength,
      usedSignedSupabaseUrl: true,
    }, { status: response.ok ? 200 : 502 });
  } catch (error) {
    return NextResponse.json({
      ok: false,
      error: error instanceof Error ? error.message : String(error),
    }, { status: 500 });
  } finally {
    await storage.remove([path]);
  }
}
