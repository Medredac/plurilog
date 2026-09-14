'use client';

import React, { useEffect, useRef, Suspense } from 'react';
import { usePathname } from 'next/navigation';
import posthog from 'posthog-js';

const ALLOWED_ATTRIBUTION_PARAMS = [
  'utm_source',
  'utm_medium',
  'utm_campaign',
  'utm_term',
  'utm_content',
] as const;

export function isPublicPostHogRoute(pathname: string | null): boolean {
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

export function getSanitizedPageUrl(origin: string, pathname: string, search: string): string {
  try {
    const searchParams = new URLSearchParams(search);
    const sanitizedParams = new URLSearchParams();

    for (const param of ALLOWED_ATTRIBUTION_PARAMS) {
      const val = searchParams.get(param);
      if (val !== null && val.trim() !== '') {
        sanitizedParams.set(param, val.trim());
      }
    }

    const queryString = sanitizedParams.toString();
    return queryString ? `${origin}${pathname}?${queryString}` : `${origin}${pathname}`;
  } catch {
    return `${origin}${pathname}`;
  }
}

function PostHogTracker() {
  const pathname = usePathname();
  const lastTrackedPathRef = useRef<string | null>(null);
  const isInitializedRef = useRef(false);

  useEffect(() => {
    if (typeof window === 'undefined') return;

    const token = process.env.NEXT_PUBLIC_POSTHOG_PROJECT_TOKEN;
    if (!token) return;

    if (!isInitializedRef.current) {
      posthog.init(token, {
        api_host: process.env.NEXT_PUBLIC_POSTHOG_HOST || 'https://us.i.posthog.com',
        persistence: 'memory',
        person_profiles: 'never',
        disable_session_recording: true,
        autocapture: false,
        capture_pageview: false,
        capture_pageleave: false,
        disable_surveys: true,
        disable_surveys_automatic_display: true,
        enable_recording_console_log: false,
        session_recording: {
          maskAllInputs: true,
          maskTextSelector: 'input, textarea, select',
          blockClass: 'ph-no-capture',
          blockSelector: '.ph-no-capture',
        },
      });
      isInitializedRef.current = true;
    }
  }, []);

  useEffect(() => {
    if (typeof window === 'undefined') return;
    const token = process.env.NEXT_PUBLIC_POSTHOG_PROJECT_TOKEN;
    if (!token) return;

    const isPublic = isPublicPostHogRoute(pathname);

    if (isPublic) {
      // 1. Start or resume session recording on whitelisted public routes
      posthog.startSessionRecording();

      // 2. Track public pageview once per unique public path transition with sanitized URL
      if (pathname && lastTrackedPathRef.current !== pathname) {
        lastTrackedPathRef.current = pathname;
        const sanitizedUrl = getSanitizedPageUrl(
          window.location.origin,
          pathname,
          window.location.search
        );
        posthog.capture('$pageview', {
          $current_url: sanitizedUrl,
        });
      }
    } else {
      // Stop session recording immediately on any non-whitelisted route
      posthog.stopSessionRecording();
      // Reset last tracked path so subsequent navigation to a public page triggers a fresh pageview
      lastTrackedPathRef.current = null;
    }
  }, [pathname]);

  return null;
}

export function PostHogProvider({ children }: { children?: React.ReactNode }) {
  return (
    <>
      <Suspense fallback={null}>
        <PostHogTracker />
      </Suspense>
      {children}
    </>
  );
}
