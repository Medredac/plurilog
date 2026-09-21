import { NextResponse } from 'next/server';

export const runtime = 'nodejs';

export async function GET() {
  if (process.env.VERCEL_ENV !== 'preview') {
    return NextResponse.json({ error: 'not found' }, { status: 404 });
  }
  const apiKey = process.env.OPENROUTER_API_KEY;
  if (!apiKey) {
    return NextResponse.json({ error: 'missing OPENROUTER_API_KEY' }, { status: 500 });
  }

  const response = await fetch('https://openrouter.ai/api/v1/responses', {
    method: 'POST',
    headers: {
      Authorization: `Bearer ${apiKey}`,
      'Content-Type': 'application/json',
    },
    body: JSON.stringify({
      model: 'google/gemini-3.7-flash',
      input:
        'Use the shell tool once. Run exactly: command -v libreoffice || true; command -v soffice || true; command -v pandoc || true; command -v python3 || true. Then report the raw command output only.',
      tools: [
        {
          type: 'openrouter:shell',
          parameters: {
            engine: 'openrouter',
            environment: { type: 'container_auto' },
          },
        },
      ],
    }),
  });

  const body = await response.text();
  return new NextResponse(body, {
    status: response.status,
    headers: { 'Content-Type': response.headers.get('content-type') || 'application/json' },
  });
}
