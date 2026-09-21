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
        'Use the shell tool once. Run exactly: id; command -v apt-get || true; command -v apk || true; command -v chromium || true; command -v google-chrome || true; command -v wkhtmltopdf || true. Then report the raw command output only.',
      tools: [
        {
          type: 'openrouter:shell',
          parameters: {
            engine: 'openrouter',
            environment: {
              type: 'container_auto',
              network_policy: { type: 'allowlist', allowed_domains: ['*'] },
            },
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
