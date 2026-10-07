import { NextRequest, NextResponse } from 'next/server';
import { cookies } from 'next/headers';
import { createServerClient } from '@supabase/ssr';
import { verifyDiscussionOwnership } from '@/utils/supabase/server';
import { createServiceClient } from '@/utils/supabase/service';

export const runtime = 'nodejs';

export async function POST(req: NextRequest) {
  try {
    const body = await req.json();
    const discussionId =
      typeof body?.discussionId === 'string' ? body.discussionId.trim() : '';
    const runId =
      typeof body?.runId === 'string' ? body.runId.trim() : '';
    const parsedRunStartedAt = Number(body?.runStartedAt);
    const runStartedAt =
      Number.isFinite(parsedRunStartedAt) && parsedRunStartedAt > 0
        ? Math.floor(parsedRunStartedAt)
        : 0;

    if (!discussionId || !runId || !runStartedAt) {
      return NextResponse.json(
        { error: 'discussionId and runId are required.' },
        { status: 400 }
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
              // Route handlers may not always allow response cookie mutation.
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
      return NextResponse.json({ error: 'Unauthorized.' }, { status: 401 });
    }

    const isOwner = await verifyDiscussionOwnership(supabase, discussionId);
    if (!isOwner) {
      return NextResponse.json({ error: 'Discussion not found.' }, { status: 404 });
    }

    const serviceClient = createServiceClient();
    const { data: cancelledRun, error: cancelError } =
      await serviceClient.rpc('cancel_debate_run', {
        p_discussion_id: discussionId,
        p_user_id: user.id,
        p_run_id: runId,
        p_started_at: runStartedAt,
      });

    if (cancelError) {
      console.error('[Durable Stop] Failed to cancel run:', cancelError);
      return NextResponse.json(
        { error: 'Could not cancel this panel run.' },
        { status: 500 }
      );
    }

    console.log('[Durable Stop] Cancel request processed', {
      discussionId,
      runId,
      runStartedAt,
      cancelled: cancelledRun === true,
    });

    return NextResponse.json({
      ok: true,
      cancelled: cancelledRun === true,
    });
  } catch (error) {
    console.error('[Durable Stop] Cancel route failed:', error);
    return NextResponse.json(
      { error: 'Could not cancel this panel run.' },
      { status: 500 }
    );
  }
}
