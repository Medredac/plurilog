import { createHash } from 'crypto';
import { NextResponse } from 'next/server';
import { createClient } from '@/utils/supabase/server';
import { stripe } from '@/lib/stripe';
import { cookies } from 'next/headers';
import {
  META_CONSENT_COOKIE,
  isMetaSignupSource,
  isMetaTrackingAllowedForRequest,
  normalizeMetaConsentStatus,
} from '@/lib/metaConversions';
import {
  GOOGLE_ADS_COOKIE_NAMES,
  isGoogleAdsTrackingAllowedForRequest,
} from '@/lib/googleAds';

export async function POST(request: Request) {
  const supabase = await createClient();
  const { data: { user } } = await supabase.auth.getUser();

  if (!user) {
    return NextResponse.json({ error: 'Not authenticated' }, { status: 401 });
  }

  const { data: profile, error: profileError } = await supabase
    .from('profiles')
    .select('plan, plan_status, stripe_customer_id, stripe_subscription_id, signup_source')
    .eq('id', user.id)
    .single();

  if (profileError || !profile) {
    console.error('[Stripe Checkout] Profile fetch error or missing profile:', profileError);
    return NextResponse.json(
      { error: 'Unable to verify account status. Please try again later.' },
      { status: 500 }
    );
  }

  // Backend duplicate-subscription guard: block non-terminal paid subscriptions
  const nonTerminalStatuses = ['active', 'canceling', 'past_due', 'unpaid', 'trialing'];
  if (profile?.plan === 'paid' && profile.plan_status && nonTerminalStatuses.includes(profile.plan_status)) {
    return NextResponse.json(
      { error: 'An active or pending subscription already exists. Please manage your subscription in Account Settings.' },
      { status: 400 }
    );
  }

  const origin = new URL(request.url).origin;

  const sessionParams: any = {
    mode: 'subscription',
    client_reference_id: user.id,
    line_items: [{ price: process.env.STRIPE_PRICE_ID_PLUS!, quantity: 1 }],
    success_url: `${origin}/dashboard?upgraded=true&checkout_session_id={CHECKOUT_SESSION_ID}`,
    cancel_url: `${origin}/dashboard`,
  };

  // Preserve Meta attribution through Stripe so the verified purchase webhook
  // can report a paid conversion without relying on a browser success page.
  const metaCountryCode = request.headers.get('x-vercel-ip-country');
  const metaRegionCode = request.headers.get('x-vercel-ip-country-region');
  const cookieStore = await cookies();
  const metaConsentStatus = normalizeMetaConsentStatus(
    cookieStore.get(META_CONSENT_COOKIE)?.value
  );

  if (
    isMetaSignupSource(profile.signup_source) &&
    isMetaTrackingAllowedForRequest(
      metaCountryCode,
      metaRegionCode,
      metaConsentStatus
    )
  ) {
    const fbp = cookieStore.get('_fbp')?.value;
    const fbc = cookieStore.get('_fbc')?.value;
    const attributionMetadata: Record<string, string> = {
      plurilog_signup_source: profile.signup_source,
      plurilog_meta_consent: metaConsentStatus,
      ...(metaCountryCode ? { plurilog_meta_country: metaCountryCode.trim().toUpperCase() } : {}),
      ...(metaRegionCode ? { plurilog_meta_region: metaRegionCode.trim().toUpperCase() } : {}),
      ...(fbp ? { plurilog_fbp: fbp } : {}),
      ...(fbc ? { plurilog_fbc: fbc } : {}),
    };

    sessionParams.metadata = attributionMetadata;
    sessionParams.subscription_data = {
      metadata: attributionMetadata,
    };
  }

  // Preserve Google Ads click and UTM attribution through Stripe as well.
  // The browser Google tag handles the live conversion today; keeping these
  // values on the Checkout Session makes the verified purchase auditable and
  // leaves a clean path to server-side/offline conversion uploads later.
  if (
    isGoogleAdsTrackingAllowedForRequest(
      metaCountryCode,
      metaRegionCode,
      metaConsentStatus
    )
  ) {
    const readGoogleCookie = (name: string): string | undefined => {
      const rawValue = cookieStore.get(name)?.value;
      if (!rawValue) return undefined;
      try {
        return decodeURIComponent(rawValue);
      } catch {
        return rawValue;
      }
    };

    const gclid = readGoogleCookie(GOOGLE_ADS_COOKIE_NAMES.gclid);
    const gbraid = readGoogleCookie(GOOGLE_ADS_COOKIE_NAMES.gbraid);
    const wbraid = readGoogleCookie(GOOGLE_ADS_COOKIE_NAMES.wbraid);
    const utmSource = readGoogleCookie(GOOGLE_ADS_COOKIE_NAMES.utmSource);
    const utmCampaign = readGoogleCookie(GOOGLE_ADS_COOKIE_NAMES.utmCampaign);
    const utmTerm = readGoogleCookie(GOOGLE_ADS_COOKIE_NAMES.utmTerm);
    const utmContent = readGoogleCookie(GOOGLE_ADS_COOKIE_NAMES.utmContent);

    if (
      gclid ||
      gbraid ||
      wbraid ||
      utmSource?.toLowerCase() === 'google_ads'
    ) {
      const googleMetadata: Record<string, string> = {
        ...(profile.signup_source
          ? { plurilog_google_signup_source: profile.signup_source }
          : {}),
        plurilog_google_consent: metaConsentStatus,
        ...(metaCountryCode
          ? { plurilog_google_country: metaCountryCode.trim().toUpperCase() }
          : {}),
        ...(metaRegionCode
          ? { plurilog_google_region: metaRegionCode.trim().toUpperCase() }
          : {}),
        ...(gclid ? { plurilog_gclid: gclid } : {}),
        ...(gbraid ? { plurilog_gbraid: gbraid } : {}),
        ...(wbraid ? { plurilog_wbraid: wbraid } : {}),
        ...(utmSource ? { plurilog_google_utm_source: utmSource } : {}),
        ...(utmCampaign ? { plurilog_google_utm_campaign: utmCampaign } : {}),
        ...(utmTerm ? { plurilog_google_utm_term: utmTerm } : {}),
        ...(utmContent ? { plurilog_google_utm_content: utmContent } : {}),
      };

      const mergedMetadata = {
        ...(sessionParams.metadata || {}),
        ...googleMetadata,
      };

      sessionParams.metadata = mergedMetadata;
      sessionParams.subscription_data = {
        ...(sessionParams.subscription_data || {}),
        metadata: mergedMetadata,
      };
    }
  }

  // Reuse existing Stripe Customer if present; otherwise pass customer_email
  if (profile?.stripe_customer_id) {
    sessionParams.customer = profile.stripe_customer_id;
  } else {
    sessionParams.customer_email = user.email;
  }

  const sessionFingerprint = createHash('sha256')
    .update(JSON.stringify(sessionParams))
    .digest('hex')
    .slice(0, 24);
  const idempotencyKey = `checkout:${user.id}:${sessionFingerprint}`;

  const session = await stripe.checkout.sessions.create(sessionParams, {
    idempotencyKey,
  });

  return NextResponse.json({ url: session.url });
}
