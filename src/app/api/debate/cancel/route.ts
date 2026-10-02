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

    if (!discussionId || !runId) {
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
    const nowIso = new Date().toISOString();
    const { data: cancelledRun, error: cancelError } = await serviceClient
      .from('discussion_run_state')
      .update({
        status: 'cancelled',
        cancelled_at: nowIso,
        updated_at: nowIso,
      })
      .eq('discussion_id', discussionId)
      .eq('user_id', user.id)
      .eq('active_run_id', runId)
      .eq('status', 'active')
      .select('active_run_id')
      .maybeSingle();

    if (cancelError) {
      console.error('[Durable Stop] Failed to cancel run:', cancelError);
      return NextResponse.json(
        { error: 'Could not cancel this panel run.' },
        { status: 500 }
      );
    }

    return NextResponse.json({
      ok: true,
      cancelled: Boolean(cancelledRun?.active_run_id),
    });
  } catch (error) {
    console.error('[Durable Stop] Cancel route failed:', error);
    return NextResponse.json(
      { error: 'Could not cancel this panel run.' },
      { status: 500 }
    );
  }
}
