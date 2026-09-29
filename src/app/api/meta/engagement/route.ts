import { NextResponse } from 'next/server';
import { cookies } from 'next/headers';
import { createClient } from '@/utils/supabase/server';
import { createServiceClient } from '@/utils/supabase/service';
import {
  isMetaSignupSource,
  sendMetaConversionEvent,
} from '@/lib/metaConversions';

const ACTIVATED_THRESHOLD = 5;
const DEEP_ENGAGEMENT_THRESHOLD = 10;

function normalizeKnownLevel(value: unknown): 0 | 1 | 2 {
  const n = Number(value);
  if (n >= 2) return 2;
  if (n >= 1) return 1;
  return 0;
}

export async function POST(request: Request) {
  const userSupabase = await createClient();
  const {
    data: { user },
  } = await userSupabase.auth.getUser();

  if (!user) {
    return NextResponse.json({ error: 'Not authenticated' }, { status: 401 });
  }

  let knownLevel: 0 | 1 | 2 = 0;
  try {
    const body = await request.json();
    knownLevel = normalizeKnownLevel(body?.knownLevel);
  } catch {
    knownLevel = 0;
  }

  const service = createServiceClient();

  const { data: profile, error: profileError } = await service
    .from('profiles')
    .select('signup_source, email')
    .eq('id', user.id)
    .maybeSingle();

  if (profileError) {
    console.error('[Meta Engagement] Failed to load profile:', profileError);
    return NextResponse.json({ error: 'Profile lookup failed' }, { status: 500 });
  }

  if (!isMetaSignupSource(profile?.signup_source)) {
    return NextResponse.json({
      eligible: false,
      completedLevel: 2,
    });
  }

  const { data: discussions, error: discussionsError } = await service
    .from('discussions')
    .select('id')
    .eq('user_id', user.id);

  if (discussionsError) {
    console.error('[Meta Engagement] Failed to load discussions:', discussionsError);
    return NextResponse.json({ error: 'Discussion lookup failed' }, { status: 500 });
  }

  const discussionIds = (discussions || []).map((discussion) => discussion.id);
  if (discussionIds.length === 0) {
    return NextResponse.json({
      eligible: true,
      userMessageCount: 0,
      completedLevel: knownLevel,
    });
  }

  const { count, error: countError } = await service
    .from('messages')
    .select('id', { count: 'exact', head: true })
    .in('discussion_id', discussionIds)
    .eq('sender', 'user')
    .neq('content', 'Continue');

  if (countError) {
    console.error('[Meta Engagement] Failed to count user messages:', countError);
    return NextResponse.json({ error: 'Message count failed' }, { status: 500 });
  }

  const userMessageCount = count || 0;
  const cookieStore = await cookies();
  const fbp = cookieStore.get('_fbp')?.value || null;
  const fbc = cookieStore.get('_fbc')?.value || null;
  const email = profile?.email || user.email || null;
  let completedLevel: 0 | 1 | 2 = knownLevel;

  if (userMessageCount >= ACTIVATED_THRESHOLD && completedLevel < 1) {
    const result = await sendMetaConversionEvent({
      eventName: 'Activated',
      eventId: `plurilog:${user.id}:activated:v1`,
      email,
      externalId: user.id,
      fbp,
      fbc,
    });

    if (!result.sent) {
      return NextResponse.json({
        eligible: true,
        userMessageCount,
        completedLevel,
        pending: 'Activated',
        reason: result.reason,
      });
    }

    completedLevel = 1;
  }

  if (userMessageCount >= DEEP_ENGAGEMENT_THRESHOLD && completedLevel < 2) {
    const result = await sendMetaConversionEvent({
      eventName: 'DeepEngagement',
      eventId: `plurilog:${user.id}:deep-engagement:v1`,
      email,
      externalId: user.id,
      fbp,
      fbc,
    });

    if (!result.sent) {
      return NextResponse.json({
        eligible: true,
        userMessageCount,
        completedLevel,
        pending: 'DeepEngagement',
        reason: result.reason,
      });
    }

    completedLevel = 2;
  }

  return NextResponse.json({
    eligible: true,
    userMessageCount,
    completedLevel,
  });
}
