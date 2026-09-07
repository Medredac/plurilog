import { NextRequest, NextResponse } from 'next/server';
import { createClient } from '@/utils/supabase/server';

function getOpenRouterAudioFormat(baseType: string): string | null {
  switch (baseType) {
    case 'audio/webm':
      return 'webm';
    case 'audio/mp4':
      return 'mp4';
    case 'audio/ogg':
      return 'ogg';
    case 'audio/wav':
    case 'audio/x-wav':
      return 'wav';
    case 'audio/m4a':
    case 'audio/x-m4a':
      return 'm4a';
    case 'audio/mpeg':
    case 'audio/mp3':
      return 'mp3';
    default:
      return null;
  }
}

export async function POST(req: NextRequest) {
  try {
    const supabase = await createClient();
    const {
      data: { user },
      error: authError,
    } = await supabase.auth.getUser();

    if (authError || !user) {
      return NextResponse.json({ error: 'Unauthorized' }, { status: 401 });
    }

    const apiKey = process.env.OPENROUTER_API_KEY;
    if (!apiKey) {
      return NextResponse.json(
        { error: 'OPENROUTER_API_KEY is not configured on the server.' },
        { status: 500 }
      );
    }

    const formData = await req.formData();
    const audioFile = formData.get('audio') as File | null;

    if (!audioFile || !(audioFile instanceof Blob) || audioFile.size === 0) {
      return NextResponse.json(
        { error: 'No valid audio file provided.' },
        { status: 400 }
      );
    }

    // 10MB audio size limit guard
    if (audioFile.size > 10 * 1024 * 1024) {
      return NextResponse.json(
        { error: 'Audio file exceeds 10MB limit.' },
        { status: 413 }
      );
    }

    // Audio MIME type validation
    const declaredType = audioFile.type || '';
    const baseType = declaredType.toLowerCase().split(';')[0].trim();
    const ALLOWED_MIME_TYPES = new Set([
      'audio/webm',
      'audio/mp4',
      'audio/ogg',
      'audio/wav',
      'audio/x-wav',
      'audio/m4a',
      'audio/x-m4a',
      'audio/mpeg',
      'audio/mp3',
    ]);

    if (!baseType || !ALLOWED_MIME_TYPES.has(baseType)) {
      return NextResponse.json(
        { error: 'Unsupported audio format.' },
        { status: 400 }
      );
    }

    const format = getOpenRouterAudioFormat(baseType);
    if (!format) {
      return NextResponse.json(
        { error: 'Unsupported audio format.' },
        { status: 400 }
      );
    }

    // Convert audio to base64 for OpenRouter transcription API
    const arrayBuffer = await audioFile.arrayBuffer();
    const base64Audio = Buffer.from(arrayBuffer).toString('base64');

    const openRouterRes = await fetch('https://openrouter.ai/api/v1/audio/transcriptions', {
      method: 'POST',
      headers: {
        'Authorization': `Bearer ${apiKey.trim()}`,
        'Content-Type': 'application/json',
      },
      body: JSON.stringify({
        model: 'openai/whisper-large-v3-turbo',
        input_audio: {
          data: base64Audio,
          format: format,
        },
      }),
    });

    if (!openRouterRes.ok) {
      console.error(
        '[OpenRouter Transcribe Error] Status:',
        openRouterRes.status
      );
      return NextResponse.json(
        { error: 'Failed to transcribe audio.' },
        {
          status:
            openRouterRes.status >= 400 && openRouterRes.status < 500
              ? openRouterRes.status
              : 500,
        }
      );
    }

    const result = await openRouterRes.json();
    const text = typeof result?.text === 'string' ? result.text : '';
    return NextResponse.json({ text: text.trim() });
  } catch (err: any) {
    console.error('[Transcribe Error]', err?.message || err);
    return NextResponse.json(
      { error: 'Failed to transcribe audio. Please try again.' },
      { status: 500 }
    );
  }
}
