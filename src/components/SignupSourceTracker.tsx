'use client';

import { useEffect } from 'react';

const STORAGE_KEY = 'plurilog_signup_source';

export function normalizeReferrer(referrer: string, currentOrigin: string): string {
  if (!referrer || typeof referrer !== 'string') return 'direct';

  try {
    const refUrl = new URL(referrer);
    // If referrer origin matches current origin, it's internal navigation -> direct
    if (refUrl.origin === currentOrigin) {
      return 'direct';
    }

    const host = refUrl.hostname.toLowerCase();

    // gemini.google.com -> gemini (must check before generic google.*)
    if (host === 'gemini.google.com' || host.endsWith('.gemini.google.com')) {
      return 'gemini';
    }

    // facebook.com / m.facebook.com / l.facebook.com
    if (host === 'facebook.com' || host.endsWith('.facebook.com')) {
      return 'fb';
    }

    // instagram.com / l.instagram.com
    if (host === 'instagram.com' || host.endsWith('.instagram.com')) {
      return 'ig';
    }

    // reddit.com / www.reddit.com
    if (host === 'reddit.com' || host.endsWith('.reddit.com')) {
      return 'reddit';
    }

    // google.* (google.com, www.google.com, google.co.uk, google.ca, etc.)
    if (
      host === 'google.com' ||
      host.endsWith('.google.com') ||
      host.startsWith('google.') ||
      host.includes('.google.')
    ) {
      return 'google';
    }

    // chatgpt.com / chat.openai.com
    if (
      host === 'chatgpt.com' ||
      host.endsWith('.chatgpt.com') ||
      host === 'chat.openai.com' ||
      host.endsWith('.openai.com')
    ) {
      return 'chatgpt';
    }

    // linkedin.com
    if (host === 'linkedin.com' || host.endsWith('.linkedin.com')) {
      return 'linkedin';
    }

    // x.com / twitter.com / t.co
    if (
      host === 'x.com' ||
      host.endsWith('.x.com') ||
      host === 'twitter.com' ||
      host.endsWith('.twitter.com') ||
      host === 't.co' ||
      host.endsWith('.t.co')
    ) {
      return 'twitter';
    }

    // bing.com
    if (host === 'bing.com' || host.endsWith('.bing.com')) {
      return 'bing';
    }

    // claude.ai
    if (host === 'claude.ai' || host.endsWith('.claude.ai')) {
      return 'claude';
    }

    // unknown external domain
    return 'referral';
  } catch {
    return 'direct';
  }
}

export function hasGoogleAdsClickId(): boolean {
  if (typeof window === 'undefined') return false;

  try {
    const searchParams = new URLSearchParams(window.location.search);
    return ['gclid', 'gbraid', 'wbraid'].some((key) => {
      const value = searchParams.get(key);
      return Boolean(value && value.trim());
    });
  } catch {
    return false;
  }
}

export function determineSignupSource(): string {
  if (typeof window === 'undefined') return 'direct';

  // 1. A Google Ads click identifier is the strongest paid-search signal.
  if (hasGoogleAdsClickId()) {
    return 'google_ads';
  }

  // 2. `utm_source` query parameter if present
  try {
    const searchParams = new URLSearchParams(window.location.search);
    const utmSource = searchParams.get('utm_source');
    if (utmSource && utmSource.trim()) {
      return utmSource.trim().toLowerCase().slice(0, 50);
    }
  } catch {
    // Ignore search params parsing errors
  }

  // 3. otherwise `document.referrer`
  if (typeof document !== 'undefined' && document.referrer) {
    const norm = normalizeReferrer(document.referrer, window.location.origin);
    if (norm !== 'direct') {
      return norm;
    }
  }

  // 3. otherwise `direct`
  return 'direct';
}

export function SignupSourceTracker() {
  useEffect(() => {
    try {
      if (typeof window === 'undefined' || !window.localStorage) return;

      // A fresh Google Ads click must override stale first-touch values such as
      // "direct", otherwise paid users can be misclassified in Supabase.
      if (hasGoogleAdsClickId()) {
        localStorage.setItem(STORAGE_KEY, 'google_ads');
        return;
      }

      const existingSource = localStorage.getItem(STORAGE_KEY);
      if (existingSource) {
        return;
      }

      const source = determineSignupSource();
      localStorage.setItem(STORAGE_KEY, source);
    } catch {
      // Ignore localStorage access failures (e.g. storage disabled / sandbox)
    }
  }, []);

  return null;
}
