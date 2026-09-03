import { cookies } from 'next/headers';
import { createServerClient } from '@supabase/ssr';
import type { SupabaseClient } from '@supabase/supabase-js';

export async function createClient() {
  const cookieStore = await cookies();
  return createServerClient(
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
            // Ignore in contexts where cookies can't be set
          }
        },
      },
    }
  );
}

/**
 * Verifies that the currently authenticated user owns the specified discussion.
 * Uses the user-scoped authenticated Supabase client (subject to discussions RLS: user_id = auth.uid()).
 * Never uses the service-role client to establish ownership.
 */
export async function verifyDiscussionOwnership(
  userSupabase: SupabaseClient,
  discussionId: string
): Promise<boolean> {
  if (!discussionId || !userSupabase) return false;

  try {
    const { data, error } = await userSupabase
      .from('discussions')
      .select('id')
      .eq('id', discussionId)
      .maybeSingle();

    if (error || !data?.id) {
      return false;
    }
    return true;
  } catch {
    return false;
  }
}
