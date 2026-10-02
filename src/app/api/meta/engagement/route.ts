import { NextResponse } from 'next/server';
import { cookies } from 'next/headers';
import { createClient } from '@/utils/supabase/server';
import { createServiceClient } from '@/utils/supabase/service';
import {
  META_CONSENT_COOKIE,
  isMetaSignupSource,
  isMetaTrackingAllowedForRequest,
  normalizeMetaConsentStatus,
  sendMetaConversionEvent,
} from '@/lib/metaConversions';

const ACTIVATED_THRESHOLD = 5;
const DEEP_ENGAGEMENT_THRESHOLD = 10;

export async function POST(request: Request) {
  const countryCode = request.headers.get('x-vercel-ip-country');
  const regionCode = request.headers.get('x-vercel-ip-country-region');
  const eventSourceUrl = `${new URL(request.url).origin}/dashboard`;
  const cookieStore = await cookies();
  const consentStatus = normalizeMetaConsentStatus(
    cookieStore.get(META_CONSENT_COOKIE)?.value
  );

  if (
    !isMetaTrackingAllowedForRequest(
      countryCode,
      regionCode,
      consentStatus
    )
  ) {
    return NextResponse.json({
      eligible: false,
      completedLevel: 2,
      reason: 'geo_not_eligible',
    });
  }

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
    .select('signup_source, email, meta_activated_at, meta_deep_engagement_at')
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

  let activatedAt = profile?.meta_activated_at || null;
  let deepEngagementAt = profile?.meta_deep_engagement_at || null;
  let completedLevel: 0 | 1 | 2 = deepEngagementAt ? 2 : activatedAt ? 1 : 0;
  if (completedLevel >= 2) {
    return NextResponse.json({
      eligible: true,
      completedLevel,
      alreadyCompleted: true,
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
      completedLevel,
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
  const fbp = cookieStore.get('_fbp')?.value || null;
  const fbc = cookieStore.get('_fbc')?.value || null;
  const email = profile?.email || user.email || null;

  if (userMessageCount >= ACTIVATED_THRESHOLD && !activatedAt) {
    const result = await sendMetaConversionEvent({
      eventName: 'Activated',
      countryCode,
      regionCode,
      consentStatus,
      eventId: `plurilog:${user.id}:activated:v1`,
      email,
      externalId: user.id,
      fbp,
      fbc,
      eventSourceUrl,
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

    const activatedAtValue = new Date().toISOString();
    const { error: stampError } = await service
      .from('profiles')
      .update({ meta_activated_at: activatedAtValue })
      .eq('id', user.id)
      .is('meta_activated_at', null);

    if (stampError) {
      console.error('[Meta Engagement] Failed to persist Activated milestone:', stampError);
      return NextResponse.json({
        eligible: true,
        userMessageCount,
        completedLevel,
        pending: 'ActivatedPersistence',
      });
    }

    activatedAt = activatedAtValue;
    completedLevel = 1;
  }

  if (
    userMessageCount >= DEEP_ENGAGEMENT_THRESHOLD &&
    !deepEngagementAt
  ) {
    const result = await sendMetaConversionEvent({
      eventName: 'DeepEngagement',
      countryCode,
      regionCode,
      consentStatus,
      eventId: `plurilog:${user.id}:deep-engagement:v1`,
      email,
      externalId: user.id,
      fbp,
      fbc,
      eventSourceUrl,
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

    const deepEngagementAtValue = new Date().toISOString();
    const { error: stampError } = await service
      .from('profiles')
      .update({ meta_deep_engagement_at: deepEngagementAtValue })
      .eq('id', user.id)
      .is('meta_deep_engagement_at', null);

    if (stampError) {
      console.error('[Meta Engagement] Failed to persist DeepEngagement milestone:', stampError);
      return NextResponse.json({
        eligible: true,
        userMessageCount,
        completedLevel,
        pending: 'DeepEngagementPersistence',
      });
    }

    deepEngagementAt = deepEngagementAtValue;
    completedLevel = 2;
  }

  return NextResponse.json({
    eligible: true,
    userMessageCount,
    completedLevel,
  });
}
