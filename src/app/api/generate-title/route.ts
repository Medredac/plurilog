import { NextRequest, NextResponse } from 'next/server';
import OpenAI from 'openai';

export async function POST(req: NextRequest) {
  try {
    const body = await req.json();
    const userPrompt =
      typeof body?.userPrompt === 'string'
        ? body.userPrompt
        : typeof body?.prompt === 'string'
          ? body.prompt
          : '';
    const firstAiResponse =
      typeof body?.firstAiResponse === 'string' ? body.firstAiResponse : '';
    const rawAttachments = Array.isArray(body?.attachmentNames)
      ? body.attachmentNames
      : [];

    // Defensive server-side caps
    const cleanUserPrompt = userPrompt.trim().slice(0, 300);
    const cleanAiResponse = firstAiResponse.trim().slice(0, 300);
    const cleanAttachmentNames = rawAttachments
      .slice(0, 5)
      .map((name: unknown) => String(name || '').trim().slice(0, 100))
      .filter(Boolean);

    // If ALL context is empty, return default title
    if (!cleanUserPrompt && !cleanAiResponse && cleanAttachmentNames.length === 0) {
      return NextResponse.json({ title: 'New discussion' });
    }

    const apiKey = process.env.OPENROUTER_API_KEY;
    if (!apiKey) {
      const fallback =
        cleanUserPrompt.slice(0, 40).trim() ||
        cleanAttachmentNames[0] ||
        'New discussion';
      return NextResponse.json({ title: fallback });
    }

    const openai = new OpenAI({
      baseURL: 'https://openrouter.ai/api/v1',
      apiKey: apiKey,
      defaultHeaders: {
        'HTTP-Referer': process.env.NEXT_PUBLIC_APP_URL || 'http://localhost:3000',
        'X-Title': 'Plurilog',
      },
    });

    const contextParts: string[] = [];
    if (cleanUserPrompt) {
      contextParts.push(`User request:\n${cleanUserPrompt}`);
    }
    if (cleanAttachmentNames.length > 0) {
      contextParts.push(`Attached files:\n${cleanAttachmentNames.join(', ')}`);
    }
    if (cleanAiResponse) {
      contextParts.push(`First AI response summary:\n${cleanAiResponse}`);
    }
    const combinedContext = contextParts.join('\n\n');

    const completion = await openai.chat.completions.create({
      model: 'google/gemini-3.1-flash-lite',
      messages: [
        {
          role: 'system',
          content:
            'You are an assistant that summarizes conversations into short, natural discussion titles of 3 to 6 words capturing the topic or intent. Output only the title text — do not wrap in quotation marks, do not include a trailing period, and do not add prefixes like "Title:".',
        },
        {
          role: 'user',
          content: `Summarize the following discussion into a short, natural title of 3-6 words capturing the topic or intent — do not use quotation marks, do not include a trailing period, and do not add prefixes.\n\n${combinedContext}`,
        },
      ],
      max_tokens: 30,
      temperature: 0.3,
    });

    let title = completion.choices[0]?.message?.content?.trim() || '';
    // Clean up any extraneous quotes, backticks, or trailing periods
    title = title.replace(/^["'`\s]+|["'`\s.]+$/g, '').trim();
    // Remove leading prefixes like "Title:", "Topic:", "Subject:"
    title = title.replace(/^(Title|Topic|Subject):\s*/i, '').trim();
    // Normalize multiple spaces
    title = title.replace(/\s+/g, ' ').trim();
    // Cap at 60 characters
    title = title.slice(0, 60).trim();

    if (
      !title ||
      title.toLowerCase() === 'untitled discussion' ||
      title.toLowerCase() === 'new discussion'
    ) {
      title = 'New discussion';
    }

    return NextResponse.json({ title });
  } catch (err) {
    console.error('[Generate Title Error]', err);
    return NextResponse.json({ title: 'New discussion' });
  }
}

