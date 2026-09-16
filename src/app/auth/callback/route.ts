import { NextResponse } from 'next/server';
import { createClient } from '@/utils/supabase/server';

export async function GET(request: Request) {
  const { searchParams, origin } = new URL(request.url);
  const code = searchParams.get('code');
  const next = searchParams.get('next') ?? '/dashboard';
  const safeNext = (next.startsWith('/') && !next.startsWith('//')) ? next : '/dashboard';

  if (code) {
    const supabase = await createClient();
    const { error } = await supabase.auth.exchangeCodeForSession(code);
    if (!error) {
      try {
        const { data: wasClaimed, error: claimError } = await supabase.rpc('claim_new_registration');
        if (!claimError && wasClaimed === true) {
          return NextResponse.redirect(`${origin}/?registered=true`);
        }
      } catch (claimErr) {
        console.error('[Auth Callback] Error claiming registration:', claimErr);
      }
      return NextResponse.redirect(`${origin}${safeNext}`);
    }
  }

  return NextResponse.redirect(`${origin}/?auth_error=true`);
}
