'use client';

import React, { useEffect, useRef, Suspense } from 'react';
import { usePathname } from 'next/navigation';

export const META_PIXEL_ID = '1395458409440724';

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

function waitForMetaPixelReady(onReady: () => void, onFailed: () => void, timeoutMs = 1500) {
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

  useEffect(() => {
    if (typeof window === 'undefined') return;

    const isPublic = isPublicMetaRoute(pathname);

    if (!isPublic) {
      // If user navigates away from public routes, reset last tracked path
      lastTrackedPathRef.current = null;
      return;
    }

    // Lazy initialize on first visit to an eligible public route
    if (!isInitializedRef.current) {
      initMetaPixel(META_PIXEL_ID);
      isInitializedRef.current = true;
    }

    // Track PageView once per unique public pathname
    if (pathname && lastTrackedPathRef.current !== pathname && typeof window.fbq === 'function') {
      lastTrackedPathRef.current = pathname;
      window.fbq('track', 'PageView');
    }

    // Process deterministic Google OAuth registration bridge
    let postFireTimer: NodeJS.Timeout | null = null;

    if (!hasHandledRegisteredRef.current) {
      try {
        const searchParams = new URLSearchParams(window.location.search);
        if (searchParams.get('registered') === 'true') {
          hasHandledRegisteredRef.current = true;

          const finishBridge = () => {
            try {
              const currentParams = new URLSearchParams(window.location.search);
              currentParams.delete('registered');
              const remainingQuery = currentParams.toString();
              const cleanUrl = remainingQuery
                ? `${window.location.pathname}?${remainingQuery}${window.location.hash}`
                : `${window.location.pathname}${window.location.hash}`;
              window.history.replaceState(window.history.state, '', cleanUrl);
            } catch (err) {
              console.error('[MetaPixel] Error cleaning registered parameter:', err);
            }

            // Signal landing page that registration bridge is complete
            window.dispatchEvent(new CustomEvent(REGISTRATION_BRIDGE_EVENT));
          };

          waitForMetaPixelReady(
            () => {
              // Real library is loaded; fire event on public landing page
              if (typeof window.fbq === 'function') {
                window.fbq('track', 'CompleteRegistration');
              }
              // Short post-fire grace period allowing loaded library to dispatch beacon over network before full document unload
              postFireTimer = setTimeout(() => {
                finishBridge();
              }, 250);
            },
            () => {
              // Failed or timed out (e.g. ad blocker); release bridge without fabricating events
              finishBridge();
            },
            1500
          );
        }
      } catch (err) {
        console.error('[MetaPixel] Error handling registered parameter:', err);
      }
    }

    return () => {
      if (postFireTimer) {
        clearTimeout(postFireTimer);
      }
    };
  }, [pathname]);

  return null;
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
