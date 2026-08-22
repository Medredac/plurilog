import { NextRequest, NextResponse } from 'next/server';
import OpenAI from 'openai';

export async function POST(req: NextRequest) {
  try {
    const { prompt } = await req.json();
    if (!prompt || typeof prompt !== 'string' || !prompt.trim()) {
      return NextResponse.json({ title: 'New Discussion' });
    }

    const apiKey = process.env.OPENROUTER_API_KEY;
    if (!apiKey) {
      return NextResponse.json({ title: prompt.slice(0, 40).trim() || 'New Discussion' });
    }

    const openai = new OpenAI({
      baseURL: 'https://openrouter.ai/api/v1',
      apiKey: apiKey,
      defaultHeaders: {
        'HTTP-Referer': process.env.NEXT_PUBLIC_APP_URL || 'http://localhost:3000',
        'X-Title': 'Plurilog',
      },
    });

    const completion = await openai.chat.completions.create({
      model: 'google/gemini-3.1-flash-lite',
      messages: [
        {
          role: 'system',
          content:
            'You are an assistant that summarizes user prompts into short, natural discussion titles of 3 to 6 words capturing the topic or intent. Output only the title text — do not wrap in quotation marks, do not include a trailing period, and do not add prefixes like "Title:".',
        },
        {
          role: 'user',
          content: `Summarize the following message into a short, natural title of 3-6 words, capturing the topic or intent — do not use quotation marks or a trailing period.\n\nMessage: ${prompt.trim()}`,
        },
      ],
      max_tokens: 30,
      temperature: 0.3,
    });

    let title = completion.choices[0]?.message?.content?.trim() || '';
    // Clean up any extraneous quotes or trailing periods
    title = title.replace(/^["'`\s]+|["'`\s.]+$/g, '').trim();

    if (!title) {
      title = prompt.slice(0, 40).trim() || 'New Discussion';
    }

    return NextResponse.json({ title });
  } catch (err) {
    console.error('[Generate Title Error]', err);
    return NextResponse.json({ title: 'New Discussion' });
  }
}
