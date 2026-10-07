'use client';

import React, { useEffect, useRef, useState, Suspense } from 'react';
import { usePathname } from 'next/navigation';

export const META_PIXEL_ID = '1395458409440724';
const META_CONSENT_COOKIE = 'plurilog_meta_consent';

type MetaEligibility = {
  eligible: boolean;
  consentRequired: boolean;
  showConsent: boolean;
  consentStatus: 'accepted' | 'rejected' | 'unknown';
};

declare global {
  interface Window {
    fbq?: ((...args: any[]) => void) & {
      callMethod?: (...args: any[]) => void;
      queue?: any[];
      loaded?: boolean;
      version?: string;
      push?: (...args: any[]) => void;
    };
    _fbq?: any;
  }
}

export function isPublicMetaRoute(pathname: string | null): boolean {
  if (!pathname) return false;
  if (
    pathname === '/' ||
    pathname === '/blog' ||
    pathname === '/privacy' ||
    pathname === '/terms' ||
    pathname === '/auth/registration-complete'
  ) {
    return true;
  }
  if (pathname.startsWith('/blog/')) {
    return true;
  }
  return false;
}

export const REGISTRATION_BRIDGE_EVENT = 'plurilog:registration_bridge_complete';
export const MARKETING_CONSENT_CHANGED_EVENT = 'plurilog:marketing-consent-changed';

let isScriptReady = false;
const readyCallbacks: Array<() => void> = [];
const failCallbacks: Array<() => void> = [];

function notifyReady() {
  isScriptReady = true;
  while (readyCallbacks.length > 0) {
    const cb = readyCallbacks.shift();
    try {
      cb?.();
    } catch (e) {
      console.error(e);
    }
  }
}

function notifyFailed() {
  while (failCallbacks.length > 0) {
    const cb = failCallbacks.shift();
    try {
      cb?.();
    } catch (e) {
      console.error(e);
    }
  }
}

function initMetaPixel(pixelId: string) {
  if (typeof window === 'undefined') return;
  if (window.fbq) return;

  const n: any = function (...args: any[]) {
    if (n.callMethod) {
      n.callMethod.apply(n, args);
    } else {
      n.queue.push(args);
    }
  };

  if (!window._fbq) window._fbq = n;
  n.push = n;
  n.loaded = true;
  n.version = '2.0';
  n.queue = [];

  const script = document.createElement('script');
  script.async = true;
  script.src = 'https://' + 'connect.facebook.net/en_US/fbevents.js';

  script.addEventListener('load', () => {
    notifyReady();
  });

  script.addEventListener('error', () => {
    notifyFailed();
  });

  const firstScript = document.getElementsByTagName('script')[0];
  if (firstScript && firstScript.parentNode) {
    firstScript.parentNode.insertBefore(script, firstScript);
  } else {
    document.head.appendChild(script);
  }

  window.fbq = n;
  n('init', pixelId);
}

function waitForMetaPixelReady(
  onReady: () => void,
  onFailed: () => void,
  timeoutMs = 1500
) {
  if (typeof window === 'undefined') {
    onFailed();
    return;
  }

  if (isScriptReady) {
    onReady();
    return;
  }

  let settled = false;
  const timer = setTimeout(() => {
    if (!settled) {
      settled = true;
      onFailed();
    }
  }, timeoutMs);

  readyCallbacks.push(() => {
    if (!settled) {
      settled = true;
      clearTimeout(timer);
      onReady();
    }
  });

  failCallbacks.push(() => {
    if (!settled) {
      settled = true;
      clearTimeout(timer);
      onFailed();
    }
  });
}

function MetaPixelTracker() {
  const pathname = usePathname();
  const lastTrackedPathRef = useRef<string | null>(null);
  const isInitializedRef = useRef(false);
  const hasHandledRegisteredRef = useRef(false);
  const [eligibility, setEligibility] = useState<MetaEligibility | null>(null);
  const [consentRevision, setConsentRevision] = useState(0);

  useEffect(() => {
    if (typeof window === 'undefined') return;

    const isPublic = isPublicMetaRoute(pathname);

    if (!isPublic) {
      lastTrackedPathRef.current = null;
      setEligibility(null);
      return;
    }

    let cancelled = false;
    let postFireTimer: NodeJS.Timeout | null = null;

    const finishRegistrationBridge = () => {
      // Do not remove the registration marker here. Google Ads and Meta both
      // consume the same bridge marker, so cleaning it in one provider can
      // race the other provider and prevent its conversion from firing.
      // The registration-complete page redirects away once both providers
      // finish (or its safety timeout expires), which naturally clears it.
      window.dispatchEvent(new CustomEvent(REGISTRATION_BRIDGE_EVENT));
    };

    const hasRegistrationBridge = () => {
      try {
        return new URLSearchParams(window.location.search).get('registered') === 'true';
      } catch {
        return false;
      }
    };

    const releaseBridgeWithoutTracking = () => {
      if (!hasHandledRegisteredRef.current && hasRegistrationBridge()) {
        hasHandledRegisteredRef.current = true;
        finishRegistrationBridge();
      }
    };

    const run = async () => {
      let currentEligibility: MetaEligibility;

      try {
        const response = await fetch('/api/meta/eligibility', {
          method: 'GET',
          cache: 'no-store',
          credentials: 'same-origin',
        });
        currentEligibility = response.ok
          ? (await response.json())
          : {
              eligible: false,
              consentRequired: false,
              showConsent: false,
              consentStatus: 'unknown',
            };
      } catch {
        currentEligibility = {
          eligible: false,
          consentRequired: false,
          showConsent: false,
          consentStatus: 'unknown',
        };
      }

      if (cancelled) return;
      setEligibility(currentEligibility);

      if (!currentEligibility.eligible) {
        releaseBridgeWithoutTracking();
        return;
      }

      if (!isInitializedRef.current) {
        initMetaPixel(META_PIXEL_ID);
        isInitializedRef.current = true;
      }

      if (
        pathname &&
        lastTrackedPathRef.current !== pathname &&
        typeof window.fbq === 'function'
      ) {
        lastTrackedPathRef.current = pathname;
        window.fbq('track', 'PageView');
      }

      if (!hasHandledRegisteredRef.current && hasRegistrationBridge()) {
        hasHandledRegisteredRef.current = true;

        waitForMetaPixelReady(
          () => {
            if (typeof window.fbq === 'function') {
              window.fbq('track', 'CompleteRegistration');
            }
            postFireTimer = setTimeout(() => {
              finishRegistrationBridge();
            }, 250);
          },
          () => {
            finishRegistrationBridge();
          },
          1500
        );
      }
    };

    void run();

    return () => {
      cancelled = true;
      if (postFireTimer) {
        clearTimeout(postFireTimer);
      }
    };
  }, [pathname, consentRevision]);

  const chooseConsent = (choice: 'accepted' | 'rejected') => {
    if (typeof document === 'undefined') return;

    document.cookie =
      `${META_CONSENT_COOKIE}=${choice}; Max-Age=31536000; Path=/; SameSite=Lax; Secure`;

    setEligibility((current) =>
      current
        ? {
            ...current,
            eligible: choice === 'accepted',
            showConsent: false,
            consentStatus: choice,
          }
        : current
    );
    setConsentRevision((revision) => revision + 1);
    window.dispatchEvent(
      new CustomEvent(MARKETING_CONSENT_CHANGED_EVENT, { detail: { choice } })
    );
  };

  const shouldShowBanner =
    pathname === '/' &&
    eligibility?.consentRequired === true &&
    eligibility.showConsent === true;

  return shouldShowBanner ? (
    <div className="fixed inset-x-0 bottom-0 z-[100] px-3 pb-3 sm:px-5 sm:pb-5 pointer-events-none">
      <div className="pointer-events-auto mx-auto max-w-4xl rounded-2xl border border-zinc-200 bg-white/95 px-4 py-3 shadow-lg backdrop-blur sm:flex sm:items-center sm:gap-4 sm:px-5">
        <p className="flex-1 text-xs leading-relaxed text-zinc-600 sm:text-sm">
          We use cookies to enhance your experience, analyze site usage, and measure performance.
        </p>
        <div className="mt-3 flex shrink-0 items-center gap-2 sm:mt-0">
          <button
            type="button"
            onClick={() => chooseConsent('accepted')}
            className="rounded-lg bg-zinc-900 px-4 py-2 text-xs font-medium text-white transition-colors hover:bg-zinc-800 cursor-pointer"
          >
            Accept
          </button>
          <button
            type="button"
            onClick={() => chooseConsent('rejected')}
            className="rounded-lg border border-zinc-300 bg-white px-4 py-2 text-xs font-medium text-zinc-700 transition-colors hover:bg-zinc-50 cursor-pointer"
          >
            Reject
          </button>
          <a
            href="/privacy"
            className="px-1 text-xs font-medium text-zinc-500 underline underline-offset-2 hover:text-zinc-800"
          >
            Privacy Policy
          </a>
        </div>
      </div>
    </div>
  ) : null;
}

export function MetaPixelProvider({ children }: { children?: React.ReactNode }) {
  return (
    <>
      <Suspense fallback={null}>
        <MetaPixelTracker />
      </Suspense>
      {children}
    </>
  );
}
