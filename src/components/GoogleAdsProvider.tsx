'use client';

import React, { Suspense, useEffect, useRef, useState } from 'react';
import { usePathname, useSearchParams } from 'next/navigation';
import {
  GOOGLE_ADS_COOKIE_NAMES,
  GOOGLE_ADS_PURCHASE_SEND_TO,
  GOOGLE_ADS_TAG_ID,
} from '@/lib/googleAds';

const CONSENT_CHANGED_EVENT = 'plurilog:marketing-consent-changed';
const CLICK_COOKIE_MAX_AGE_SECONDS = 60 * 60 * 24 * 90;

type GoogleEligibility = {
  eligible: boolean;
  consentRequired: boolean;
  consentStatus: 'accepted' | 'rejected' | 'unknown';
};

type PurchaseStatus = {
  verified: boolean;
  value?: number;
  currency?: string;
  transactionId?: string;
  email?: string | null;
};

declare global {
  interface Window {
    dataLayer?: unknown[];
    gtag?: (...args: any[]) => void;
  }
}

let googleTagPromise: Promise<void> | null = null;

function setFirstPartyCookie(name: string, value: string) {
  if (typeof document === 'undefined' || !value) return;

  document.cookie =
    `${name}=${encodeURIComponent(value)}; Max-Age=${CLICK_COOKIE_MAX_AGE_SECONDS}; Path=/; SameSite=Lax; Secure`;
}

function captureGoogleAttributionFromUrl() {
  if (typeof window === 'undefined') return;

  const params = new URLSearchParams(window.location.search);
  const values: Array<[string, string | null]> = [
    [GOOGLE_ADS_COOKIE_NAMES.gclid, params.get('gclid')],
    [GOOGLE_ADS_COOKIE_NAMES.gbraid, params.get('gbraid')],
    [GOOGLE_ADS_COOKIE_NAMES.wbraid, params.get('wbraid')],
    [GOOGLE_ADS_COOKIE_NAMES.utmSource, params.get('utm_source')],
    [GOOGLE_ADS_COOKIE_NAMES.utmCampaign, params.get('utm_campaign')],
    [GOOGLE_ADS_COOKIE_NAMES.utmTerm, params.get('utm_term')],
    [GOOGLE_ADS_COOKIE_NAMES.utmContent, params.get('utm_content')],
  ];

  for (const [cookieName, rawValue] of values) {
    const value = rawValue?.trim();
    if (value) setFirstPartyCookie(cookieName, value);
  }
}

function loadGoogleTag(): Promise<void> {
  if (typeof window === 'undefined') return Promise.resolve();

  if (googleTagPromise) return googleTagPromise;

  googleTagPromise = new Promise<void>((resolve, reject) => {
    window.dataLayer = window.dataLayer || [];
    window.gtag =
      window.gtag ||
      function gtag(...args: any[]) {
        window.dataLayer?.push(args);
      };

    window.gtag('js', new Date());
    window.gtag('config', GOOGLE_ADS_TAG_ID);

    const existingScript = document.querySelector<HTMLScriptElement>(
      `script[src*="googletagmanager.com/gtag/js?id=${GOOGLE_ADS_TAG_ID}"]`
    );

    if (existingScript) {
      resolve();
      return;
    }

    const script = document.createElement('script');
    script.async = true;
    script.src =
      'https://www.googletagmanager.com/gtag/js?id=' +
      encodeURIComponent(GOOGLE_ADS_TAG_ID);
    script.addEventListener('load', () => resolve(), { once: true });
    script.addEventListener(
      'error',
      () => reject(new Error('Failed to load Google tag')),
      { once: true }
    );
    document.head.appendChild(script);
  });

  return googleTagPromise;
}

function cleanPurchaseParams() {
  if (typeof window === 'undefined') return;

  const url = new URL(window.location.href);
  url.searchParams.delete('upgraded');
  url.searchParams.delete('checkout_session_id');
  window.history.replaceState(window.history.state, '', url.toString());
}

function GoogleAdsTracker() {
  const pathname = usePathname();
  const searchParams = useSearchParams();
  const [eligibility, setEligibility] = useState<GoogleEligibility | null>(null);
  const [tagReady, setTagReady] = useState(false);
  const [consentRevision, setConsentRevision] = useState(0);
  const handledSessionRef = useRef<string | null>(null);

  useEffect(() => {
    const handleConsentChanged = () => {
      setConsentRevision((revision) => revision + 1);
    };

    window.addEventListener(CONSENT_CHANGED_EVENT, handleConsentChanged);
    return () => {
      window.removeEventListener(CONSENT_CHANGED_EVENT, handleConsentChanged);
    };
  }, []);

  useEffect(() => {
    let cancelled = false;

    const run = async () => {
      try {
        const response = await fetch('/api/google/eligibility', {
          method: 'GET',
          cache: 'no-store',
          credentials: 'same-origin',
        });

        const currentEligibility: GoogleEligibility = response.ok
          ? await response.json()
          : {
              eligible: false,
              consentRequired: false,
              consentStatus: 'unknown',
            };

        if (cancelled) return;
        setEligibility(currentEligibility);

        if (!currentEligibility.eligible) {
          setTagReady(false);
          return;
        }

        captureGoogleAttributionFromUrl();

        try {
          await loadGoogleTag();
          if (!cancelled) setTagReady(true);
        } catch (error) {
          console.warn('[Google Ads] Google tag failed to load:', error);
          if (!cancelled) setTagReady(false);
        }
      } catch (error) {
        console.warn('[Google Ads] Eligibility check failed:', error);
        if (!cancelled) {
          setEligibility(null);
          setTagReady(false);
        }
      }
    };

    void run();

    return () => {
      cancelled = true;
    };
  }, [pathname, consentRevision]);

  useEffect(() => {
    if (
      !eligibility?.eligible ||
      !tagReady ||
      typeof window === 'undefined' ||
      typeof window.gtag !== 'function'
    ) {
      return;
    }

    if (!pathname?.startsWith('/dashboard')) return;
    if (searchParams.get('upgraded') !== 'true') return;

    const sessionId = searchParams.get('checkout_session_id')?.trim();
    if (!sessionId || handledSessionRef.current === sessionId) return;

    handledSessionRef.current = sessionId;
    let cancelled = false;

    const reportPurchase = async () => {
      try {
        const response = await fetch(
          `/api/google/purchase-status?session_id=${encodeURIComponent(sessionId)}`,
          {
            method: 'GET',
            cache: 'no-store',
            credentials: 'same-origin',
          }
        );

        if (!response.ok) {
          handledSessionRef.current = null;
          return;
        }

        const purchase = (await response.json()) as PurchaseStatus;
        if (
          cancelled ||
          !purchase.verified ||
          typeof purchase.value !== 'number' ||
          !purchase.currency ||
          !purchase.transactionId
        ) {
          handledSessionRef.current = null;
          return;
        }

        const dedupeKey =
          'plurilog:google-purchase:' + purchase.transactionId;

        try {
          if (localStorage.getItem(dedupeKey) === 'sent') {
            cleanPurchaseParams();
            return;
          }
        } catch {
          // Continue without local dedupe; Google also deduplicates by transaction_id.
        }

        if (purchase.email) {
          window.gtag?.('set', 'user_data', {
            email: purchase.email.trim().toLowerCase(),
          });
        }

        window.gtag?.('event', 'conversion', {
          send_to: GOOGLE_ADS_PURCHASE_SEND_TO,
          value: purchase.value,
          currency: purchase.currency,
          transaction_id: purchase.transactionId,
        });

        try {
          localStorage.setItem(dedupeKey, 'sent');
        } catch {
          // Non-critical: transaction_id is still present for Google-side dedupe.
        }

        cleanPurchaseParams();
      } catch (error) {
        console.warn('[Google Ads] Purchase reporting failed:', error);
        handledSessionRef.current = null;
      }
    };

    void reportPurchase();

    return () => {
      cancelled = true;
    };
  }, [eligibility, pathname, searchParams, tagReady]);

  return null;
}

export function GoogleAdsProvider() {
  return (
    <Suspense fallback={null}>
      <GoogleAdsTracker />
    </Suspense>
  );
}
