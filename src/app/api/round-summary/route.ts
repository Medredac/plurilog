import { NextRequest } from 'next/server';
import { cookies } from 'next/headers';
import { createServerClient } from '@supabase/ssr';
import OpenAI from 'openai';
import { verifyDiscussionOwnership } from '@/utils/supabase/server';

export const runtime = 'nodejs';
export const maxDuration = 30;

type RoundMessageInput = {
  id?: string;
  modelId?: string;
  authorName?: string;
  content?: string;
};

const SUMMARY_MODEL = 'google/gemini-3.1-flash-lite';
const MAX_ROUND_MESSAGES = 6;
const MAX_MESSAGE_CHARS = 6000;
const MAX_TOTAL_CHARS = 18000;

function normalizeSummary(raw: string): string {
  const cleaned = (raw || '')
    .trim()
    .replace(/^\x60{3}(?:markdown|md|text)?\s*/i, '')
    .replace(/\s*\x60{3}$/i, '')
    .trim();

  if (!cleaned) return '';

  const lines = cleaned
    .split(/\r?\n/)
    .map((line) => line.trim())
    .filter(Boolean)
    .filter((line) => !/^#{1,6}\s+/u.test(line))
    .filter((line) => !/^round\s+(?:\d+\s+)?summary:?$/iu.test(line));

  const bulletLines = lines
    .map((line) => line.replace(/^[-*•]\s*/u, '').trim())
    .filter(Boolean)
    .slice(0, 3)
    .map((line) => `• ${line}`);

  if (bulletLines.length > 0) {
    return bulletLines.join('\n').slice(0, 900);
  }

  return `• ${cleaned.replace(/\s+/g, ' ')}`.slice(0, 900);
}

export async function POST(req: NextRequest) {
  try {
    const body = await req.json();
    const discussionId =
      typeof body?.discussionId === 'string' ? body.discussionId.trim() : '';
    const contextPrompt =
      typeof body?.contextPrompt === 'string'
        ? body.contextPrompt.trim().slice(0, 2400)
        : '';
    const rawMessages = Array.isArray(body?.messages)
      ? (body.messages as RoundMessageInput[])
      : [];

    if (rawMessages.length === 0) {
      return Response.json(
        { error: 'At least one round response is required.' },
        { status: 400 }
      );
    }

    const apiKey = process.env.OPENROUTER_API_KEY?.trim();
    if (!apiKey) {
      return Response.json(
        { error: 'Summary model is not configured.' },
        { status: 500 }
      );
    }

    const cookieStore = await cookies();
    const supabase = createServerClient(
      process.env.NEXT_PUBLIC_SUPABASE_URL || '',
      process.env.NEXT_PUBLIC_SUPABASE_ANON_KEY || '',
      {
        cookies: {
          getAll() {
            return cookieStore.getAll();
          },
          setAll(cookiesToSet) {
            try {
              cookiesToSet.forEach(({ name, value, options }) =>
                cookieStore.set(name, value, options)
              );
            } catch {
              // Route handlers may not always be able to write refreshed cookies.
            }
          },
        },
      }
    );

    const {
      data: { user },
      error: userError,
    } = await supabase.auth.getUser();

    if (userError || !user) {
      return Response.json({ error: 'Unauthorized.' }, { status: 401 });
    }

    if (discussionId) {
      const ownsDiscussion = await verifyDiscussionOwnership(
        supabase,
        discussionId
      );
      if (!ownsDiscussion) {
        return Response.json(
          { error: 'Discussion not found.' },
          { status: 404 }
        );
      }
    }

    let remainingChars = MAX_TOTAL_CHARS;
    const roundMessages = rawMessages
      .slice(0, MAX_ROUND_MESSAGES)
      .map((message) => {
        if (remainingChars <= 0) return null;

        const content = String(message?.content || '').trim();
        if (!content) return null;

        const clipped = content.slice(
          0,
          Math.min(MAX_MESSAGE_CHARS, remainingChars)
        );
        remainingChars -= clipped.length;

        const rawName = String(
          message?.authorName || message?.modelId || 'AI'
        ).trim();
        const name = rawName.slice(0, 40) || 'AI';

        return { name, content: clipped };
      })
      .filter(
        (message): message is { name: string; content: string } =>
          Boolean(message)
      );

    if (roundMessages.length === 0) {
      return Response.json(
        { error: 'No completed AI responses were supplied.' },
        { status: 400 }
      );
    }

    const transcript = roundMessages
      .map((message) => `${message.name}:\n${message.content}`)
      .join('\n\n');

    const openai = new OpenAI({
      apiKey,
      baseURL: 'https://openrouter.ai/api/v1',
      defaultHeaders: {
        'HTTP-Referer': 'https://plurilogai.com',
        'X-Title': 'Plurilog',
      },
    });

    const response = await openai.chat.completions.create({
      model: SUMMARY_MODEL,
      temperature: 0.1,
      max_tokens: 140,
      messages: [
        {
          role: 'system',
          content: `You create ultra-concise round summaries for a multi-AI discussion.

Return only 1 to 3 bullet lines, with each line starting with "• ".
Use the fewest bullets needed. Prefer one bullet.
Summarize what the AI responses collectively said in this round: agreement, meaningful disagreement, conclusion, or distinct takeaways.
Be literal when the round is trivial. Example: if all responses are greetings, write exactly "• Everyone says hello."
Do not add analysis, recommendations, caveats, headings, labels, or facts that were not present.
Do not repeat model-by-model details unless a disagreement actually matters.
Keep the entire answer under 55 words.`,
        },
        {
          role: 'user',
          content: `${contextPrompt ? `Conversation topic for context only:\n${contextPrompt}\n\n` : ''}AI responses in this round:\n\n${transcript}`,
        },
      ],
    });

    const summary = normalizeSummary(
      response.choices?.[0]?.message?.content || ''
    );

    if (!summary) {
      return Response.json(
        { error: 'Could not summarize this round.' },
        { status: 502 }
      );
    }

    console.log('[Round Summary]', {
      model: response.model || SUMMARY_MODEL,
      messageCount: roundMessages.length,
      inputTokens: response.usage?.prompt_tokens ?? null,
      outputTokens: response.usage?.completion_tokens ?? null,
    });

    return Response.json({ summary });
  } catch (error: any) {
    console.error('[Round Summary] Failed', {
      message: error?.message || String(error),
    });
    return Response.json(
      { error: 'Could not summarize this round.' },
      { status: 500 }
    );
  }
}
