import { NextResponse } from 'next/server';
import { createClient } from '@/utils/supabase/server';

export const COUNTRY_CODE_ROLLOUT_AT = new Date('2026-09-19T04:00:00.000Z').getTime();

export async function POST(request: Request) {
  try {
    const supabase = await createClient();
    const {
      data: { user },
      error: authError,
    } = await supabase.auth.getUser();

    if (authError || !user) {
      return NextResponse.json({ error: 'unauthorized', message: 'Not authenticated' }, { status: 401 });
    }

    // Only accounts created on or after the country-capture rollout cutoff are eligible
    const userCreatedAtMs = user.created_at ? new Date(user.created_at).getTime() : 0;
    if (userCreatedAtMs < COUNTRY_CODE_ROLLOUT_AT) {
      return NextResponse.json({ recorded: false, reason: 'account_predates_rollout' });
    }

    const rawCountry = request.headers.get('x-vercel-ip-country');
    if (!rawCountry) {
      return NextResponse.json({ recorded: false, reason: 'no_country_header' });
    }

    const normalized = rawCountry.trim().toUpperCase();
    if (!/^[A-Z]{2}$/.test(normalized)) {
      return NextResponse.json({ recorded: false, reason: 'invalid_country_format' });
    }

    const { error: rpcErr } = await supabase.rpc('set_my_country_code', {
      p_country: normalized,
    });

    if (rpcErr) {
      console.warn('[Record Country] Error executing set_my_country_code RPC:', rpcErr);
      return NextResponse.json({ error: 'database_error', message: 'Failed to record country' }, { status: 500 });
    }

    return NextResponse.json({ recorded: true });
  } catch (err: any) {
    console.error('[Record Country] Unexpected error:', err);
    return NextResponse.json({ error: 'server_error', message: 'An unexpected error occurred' }, { status: 500 });
  }
}
