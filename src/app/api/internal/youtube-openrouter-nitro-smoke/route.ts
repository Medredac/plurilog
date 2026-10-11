import { NextResponse } from 'next/server';

export const runtime = 'nodejs';
export const maxDuration = 120;

export async function GET() {
  if (process.env.VERCEL_ENV === 'production') return new Response('Not found', { status: 404 });
  const key = process.env.OPENROUTER_API_KEY;
  if (!key) return NextResponse.json({ ok:false, error:'missing_openrouter_key' }, { status:500 });

  const youtubeUrl = 'https://www.youtube.com/watch?v=jNQXAC9IVRw';
  const models = [
    'google/gemini-3.8-flash:nitro',
    'google/gemini-3.6-flash:nitro',
    'google/gemini-3-flash-preview:nitro',
  ];

  const results: any[] = [];
  for (const model of models) {
    const response = await fetch('https://openrouter.ai/api/v1/chat/completions', {
      method:'POST',
      headers:{ Authorization:`Bearer ${key}`, 'Content-Type':'application/json' },
      body: JSON.stringify({
        model,
        messages:[{
          role:'user',
          content:[
            { type:'text', text:'Describe this YouTube video in one short sentence.' },
            { type:'video_url', video_url:{ url: youtubeUrl } },
          ],
        }],
        max_tokens: 120,
      }),
    });
    const raw = await response.text();
    let payload:any=null;
    try { payload=JSON.parse(raw); } catch {}
    results.push({
      model,
      ok:response.ok,
      status:response.status,
      respondingModel:payload?.model||null,
      provider:payload?.provider||null,
      content:payload?.choices?.[0]?.message?.content||null,
      error:payload?.error||(!response.ok?raw.slice(0,700):null),
    });
    if (response.ok) break;
  }

  return NextResponse.json({ results }, { status: results.some(r=>r.ok)?200:502 });
}
