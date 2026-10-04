import { NextResponse } from 'next/server';
import { cookies } from 'next/headers';
import { createClient } from '@/utils/supabase/server';
import { createServiceClient } from '@/utils/supabase/service';
import {
  GOOGLE_ADS_COOKIE_NAMES,
  isGoogleSignupSource,
  type GoogleEngagementMilestone,
} from '@/lib/googleAds';

const ACTIVATED_THRESHOLD = 5;
const DEEP_ENGAGEMENT_THRESHOLD = 10;

export async function POST() {
  const userSupabase = await createClient();
  const {
    data: { user },
  } = await userSupabase.auth.getUser();

  if (!user) {
    return NextResponse.json({ error: 'Not authenticated' }, { status: 401 });
  }

  const service = createServiceClient();
  const { data: profile, error: profileError } = await service
    .from('profiles')
    .select('signup_source')
    .eq('id', user.id)
    .maybeSingle();

  if (profileError) {
    console.error('[Google Engagement] Failed to load profile:', profileError);
    return NextResponse.json({ error: 'Profile lookup failed' }, { status: 500 });
  }

  const cookieStore = await cookies();
  const hasGoogleClickAttribution = [
    GOOGLE_ADS_COOKIE_NAMES.gclid,
    GOOGLE_ADS_COOKIE_NAMES.gbraid,
    GOOGLE_ADS_COOKIE_NAMES.wbraid,
  ].some((name) => Boolean(cookieStore.get(name)?.value));

  if (!isGoogleSignupSource(profile?.signup_source) && !hasGoogleClickAttribution) {
    return NextResponse.json({
      eligible: false,
      userMessageCount: 0,
      milestones: [] as GoogleEngagementMilestone[],
    });
  }

  const { data: discussions, error: discussionsError } = await service
    .from('discussions')
    .select('id')
    .eq('user_id', user.id);

  if (discussionsError) {
    console.error('[Google Engagement] Failed to load discussions:', discussionsError);
    return NextResponse.json({ error: 'Discussion lookup failed' }, { status: 500 });
  }

  const discussionIds = (discussions || []).map((discussion) => discussion.id);
  if (discussionIds.length === 0) {
    return NextResponse.json({
      eligible: true,
      userMessageCount: 0,
      milestones: [] as GoogleEngagementMilestone[],
    });
  }

  const { count, error: countError } = await service
    .from('messages')
    .select('id', { count: 'exact', head: true })
    .in('discussion_id', discussionIds)
    .eq('sender', 'user')
    .neq('content', 'Continue');

  if (countError) {
    console.error('[Google Engagement] Failed to count user messages:', countError);
    return NextResponse.json({ error: 'Message count failed' }, { status: 500 });
  }

  const userMessageCount = count || 0;
  const milestones: GoogleEngagementMilestone[] = [];

  if (userMessageCount >= ACTIVATED_THRESHOLD) {
    milestones.push('Activated');
  }
  if (userMessageCount >= DEEP_ENGAGEMENT_THRESHOLD) {
    milestones.push('DeepEngagement');
  }

  return NextResponse.json({
    eligible: true,
    userMessageCount,
    milestones,
  });
}
