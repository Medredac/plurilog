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
    pathname === '/terms'
  ) {
    return true;
  }
  if (pathname.startsWith('/blog/')) {
    return true;
  }
  return false;
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
  const firstScript = document.getElementsByTagName('script')[0];
  if (firstScript && firstScript.parentNode) {
    firstScript.parentNode.insertBefore(script, firstScript);
  } else {
    document.head.appendChild(script);
  }

  window.fbq = n;
  n('init', pixelId);
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

    // Process one-time Google OAuth registration bridge
    if (!hasHandledRegisteredRef.current && typeof window.fbq === 'function') {
      try {
        const searchParams = new URLSearchParams(window.location.search);
        if (searchParams.get('registered') === 'true') {
          hasHandledRegisteredRef.current = true;
          window.fbq('track', 'CompleteRegistration');

          searchParams.delete('registered');
          const remainingQuery = searchParams.toString();
          const cleanUrl = remainingQuery
            ? `${window.location.pathname}?${remainingQuery}${window.location.hash}`
            : `${window.location.pathname}${window.location.hash}`;
          window.history.replaceState(window.history.state, '', cleanUrl);
        }
      } catch (err) {
        console.error('[MetaPixel] Error handling registered parameter:', err);
      }
    }
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
