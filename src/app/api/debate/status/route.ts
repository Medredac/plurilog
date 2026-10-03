import { NextRequest, NextResponse } from 'next/server';
import { cookies } from 'next/headers';
import { createServerClient } from '@supabase/ssr';
import { verifyDiscussionOwnership } from '@/utils/supabase/server';
import { createServiceClient } from '@/utils/supabase/service';
import { DEBATE_STALE_ACTIVE_RUN_AFTER_MS } from '@/utils/debateRuntimeBudget';

export const runtime = 'nodejs';
export const dynamic = 'force-dynamic';

export async function GET(req: NextRequest) {
  try {
    const discussionId =
      req.nextUrl.searchParams.get('discussionId')?.trim() || '';

    if (!discussionId) {
      return NextResponse.json(
        { error: 'discussionId is required.' },
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
    const { data: runState, error: runStateError } = await serviceClient
      .from('discussion_run_state')
      .select(
        'active_run_id, active_started_at, status, updated_at, cancelled_at, completed_at'
      )
      .eq('discussion_id', discussionId)
      .eq('user_id', user.id)
      .maybeSingle();

    if (runStateError) {
      console.error('[Durable Run] Status lookup failed:', runStateError);
      return NextResponse.json(
        { error: 'Could not read panel run status.' },
        { status: 500 }
      );
    }

    if (!runState) {
      return NextResponse.json(
        {
          active: false,
          status: null,
          runId: null,
          runStartedAt: null,
        },
        {
          headers: {
            'Cache-Control': 'no-store, max-age=0',
          },
        }
      );
    }

    const runStartedAt = Number(runState.active_started_at);

    if (
      runState.status === 'active' &&
      Number.isFinite(runStartedAt) &&
      runStartedAt > 0 &&
      Date.now() - runStartedAt > DEBATE_STALE_ACTIVE_RUN_AFTER_MS
    ) {
      const staleAt = new Date().toISOString();
      const { error: staleCleanupError } = await serviceClient
        .from('discussion_run_state')
        .update({
          status: 'cancelled',
          cancelled_at: staleAt,
          updated_at: staleAt,
        })
        .eq('discussion_id', discussionId)
        .eq('user_id', user.id)
        .eq('active_run_id', runState.active_run_id)
        .eq('status', 'active');

      if (staleCleanupError) {
        console.warn(
          '[Durable Run] Stale active-run cleanup failed:',
          staleCleanupError
        );
      } else {
        runState.status = 'cancelled';
        runState.cancelled_at = staleAt;
        runState.updated_at = staleAt;
        console.warn('[Durable Run] Cleared stale active run:', {
          discussionId,
          runId: runState.active_run_id,
          runStartedAt,
        });
      }
    }

    return NextResponse.json(
      {
        active: runState.status === 'active',
        status: runState.status,
        runId: runState.active_run_id,
        runStartedAt:
          Number.isFinite(runStartedAt) && runStartedAt > 0
            ? Math.floor(runStartedAt)
            : null,
        updatedAt: runState.updated_at || null,
        cancelledAt: runState.cancelled_at || null,
        completedAt: runState.completed_at || null,
      },
      {
        headers: {
          'Cache-Control': 'no-store, max-age=0',
        },
      }
    );
  } catch (error) {
    console.error('[Durable Run] Status route failed:', error);
    return NextResponse.json(
      { error: 'Could not read panel run status.' },
      { status: 500 }
    );
  }
}
