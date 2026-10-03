import { NextResponse } from 'next/server';
import { submitFeedbackEntry } from '@/lib/feedback';

export const runtime = 'nodejs';
export const dynamic = 'force-dynamic';

export async function POST(
  request: Request,
  context: { params: Promise<{ token: string }> }
) {
  try {
    const { token } = await context.params;

    let payload: unknown;
    try {
      payload = await request.json();
    } catch {
      return NextResponse.json(
        { error: 'invalid_request', message: 'Invalid request body.' },
        { status: 400 }
      );
    }

    const body =
      payload && typeof payload === 'object' && 'body' in payload
        ? (payload as { body?: unknown }).body
        : undefined;

    const result = await submitFeedbackEntry(token, body);

    if (!result.ok) {
      if (result.reason === 'invalid_body') {
        return NextResponse.json(
          {
            error: 'invalid_feedback',
            message: 'Please enter between 1 and 10,000 characters.',
          },
          { status: 400 }
        );
      }

      return NextResponse.json(
        {
          error: 'feedback_link_unavailable',
          message: 'This feedback link is no longer available.',
        },
        { status: 410 }
      );
    }

    return NextResponse.json(
      { success: true, entryId: result.entryId },
      {
        status: 201,
        headers: {
          'Cache-Control': 'private, no-store, max-age=0',
        },
      }
    );
  } catch (error) {
    console.error('[Feedback API] Unexpected error:', error);
    return NextResponse.json(
      {
        error: 'server_error',
        message: 'We could not save your feedback. Please try again.',
      },
      { status: 500 }
    );
  }
}
