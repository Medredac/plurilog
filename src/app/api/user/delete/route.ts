import { NextResponse } from 'next/server';
import { createClient } from '@/utils/supabase/server';
import { createServiceClient } from '@/utils/supabase/service';

export async function POST(request: Request) {
  try {
    // 1. Authenticate current user using server Supabase client
    const supabase = await createClient();
    const {
      data: { user },
      error: authError,
    } = await supabase.auth.getUser();

    if (authError || !user) {
      return NextResponse.json({ error: 'unauthorized', message: 'Not authenticated' }, { status: 401 });
    }

    // Parse optional confirmation flag
    let confirmCanceling = false;
    try {
      const body = await request.json();
      confirmCanceling = Boolean(body?.confirmCanceling);
    } catch {
      // Body is optional on initial request
    }

    // 2. Read the current profile using service client
    const serviceClient = createServiceClient();
    const { data: profile, error: profileErr } = await serviceClient
      .from('profiles')
      .select('id, plan, plan_status, current_period_end')
      .eq('id', user.id)
      .maybeSingle();

    if (profileErr) {
      console.error('[Account Deletion] Failed to fetch profile:', profileErr);
      return NextResponse.json({ error: 'database_error', message: 'Failed to verify account status.' }, { status: 500 });
    }

    // 3. Evaluate subscription safety
    if (profile?.plan === 'paid') {
      if (profile.plan_status === 'canceling') {
        if (!confirmCanceling) {
          return NextResponse.json({
            code: 'canceling_subscription_confirmation_required',
            currentPeriodEnd: profile.current_period_end || null,
          });
        }
        // If confirmCanceling is true, deletion proceeds below
      } else if (profile.plan_status === 'canceled') {
        // Former paid user with ended subscription: deletion proceeds
      } else {
        // active, past_due, or any other paid status -> block deletion
        return NextResponse.json({
          code: 'active_subscription_must_be_canceled',
        });
      }
    }

    // 4. Clean up ALL storage files under bucket `message-images` prefix `${user.id}/`
    // Repeatedly list the first batch under the user prefix and remove it until no files remain.
    let hasMore = true;
    while (hasMore) {
      const { data: files, error: listErr } = await serviceClient.storage
        .from('message-images')
        .list(user.id, { limit: 1000 });

      if (listErr) {
        console.error('[Account Deletion] Storage list failed:', listErr);
        return NextResponse.json(
          { error: 'storage_cleanup_failed', message: 'Failed to clean up uploaded files. Account deletion halted.' },
          { status: 500 }
        );
      }

      if (!files || files.length === 0) {
        hasMore = false;
        break;
      }

      const pathsToDelete = files
        .filter((f) => f.name && f.name !== '.emptyFolderPlaceholder')
        .map((f) => `${user.id}/${f.name}`);

      if (pathsToDelete.length > 0) {
        const { error: removeErr } = await serviceClient.storage
          .from('message-images')
          .remove(pathsToDelete);

        if (removeErr) {
          console.error('[Account Deletion] Storage remove failed:', removeErr);
          return NextResponse.json(
            { error: 'storage_cleanup_failed', message: 'Failed to remove uploaded files. Account deletion halted.' },
            { status: 500 }
          );
        }
      } else {
        hasMore = false;
      }
    }

    // 5. Delete the Auth user — Postgres ON DELETE CASCADE takes care of user-linked tables
    const { error: deleteUserErr } = await serviceClient.auth.admin.deleteUser(user.id);
    if (deleteUserErr) {
      console.error('[Account Deletion] Auth admin deleteUser failed:', deleteUserErr);
      return NextResponse.json(
        { error: 'auth_deletion_failed', message: 'Failed to delete account credentials.' },
        { status: 500 }
      );
    }

    return NextResponse.json({ success: true });
  } catch (err: any) {
    console.error('[Account Deletion] Unexpected error:', err);
    return NextResponse.json(
      { error: 'server_error', message: 'An unexpected error occurred during account deletion.' },
      { status: 500 }
    );
  }
}
