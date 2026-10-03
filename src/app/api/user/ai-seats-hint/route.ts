import { NextResponse } from 'next/server';
import { createClient } from '@/utils/supabase/server';
import { createServiceClient } from '@/utils/supabase/service';

export async function GET() {
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
    const { data: profile, error: profileError } = await service
      .from('profiles')
      .select('ai_seats_hint_seen_at')
      .eq('id', user.id)
      .maybeSingle();

    if (profileError) {
      console.error('[AI Seats Hint] Failed to load profile:', profileError);
      return NextResponse.json(
        { error: 'database_error', message: 'Failed to load hint state' },
        { status: 500 }
      );
    }

    return NextResponse.json({
      seen: Boolean(profile?.ai_seats_hint_seen_at),
    });
  } catch (error) {
    console.error('[AI Seats Hint] Unexpected GET error:', error);
    return NextResponse.json(
      { error: 'server_error', message: 'An unexpected error occurred' },
      { status: 500 }
    );
  }
}

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
    const seenAt = new Date().toISOString();
    const { error: updateError } = await service
      .from('profiles')
      .update({ ai_seats_hint_seen_at: seenAt })
      .eq('id', user.id)
      .is('ai_seats_hint_seen_at', null);

    if (updateError) {
      console.error('[AI Seats Hint] Failed to persist dismissal:', updateError);
      return NextResponse.json(
        { error: 'database_error', message: 'Failed to save hint state' },
        { status: 500 }
      );
    }

    return NextResponse.json({ seen: true });
  } catch (error) {
    console.error('[AI Seats Hint] Unexpected POST error:', error);
    return NextResponse.json(
      { error: 'server_error', message: 'An unexpected error occurred' },
      { status: 500 }
    );
  }
}
