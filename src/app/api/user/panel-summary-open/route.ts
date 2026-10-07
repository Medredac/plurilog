import { NextResponse } from 'next/server';
import { createClient } from '@/utils/supabase/server';
import { createServiceClient } from '@/utils/supabase/service';

export async function POST() {
  try {
    const supabase = await createClient();
    const {
      data: { user },
      error: authError,
    } = await supabase.auth.getUser();

    if (authError || !user) {
      return NextResponse.json(
        { error: 'unauthorized', message: 'Not authenticated' },
        { status: 401 }
      );
    }

    const service = createServiceClient();
    const { data, error: incrementError } = await service.rpc(
      'increment_panel_summary_open_count',
      { target_user_id: user.id }
    );

    if (incrementError) {
      console.error('[Panel Summary Open] Failed to increment counter:', incrementError);
      return NextResponse.json(
        { error: 'database_error', message: 'Failed to record summary open' },
        { status: 500 }
      );
    }

    return NextResponse.json({
      recorded: true,
      count: typeof data === 'number' ? data : Number(data ?? 0),
    });
  } catch (error) {
    console.error('[Panel Summary Open] Unexpected POST error:', error);
    return NextResponse.json(
      { error: 'server_error', message: 'An unexpected error occurred' },
      { status: 500 }
    );
  }
}
