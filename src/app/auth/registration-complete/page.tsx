'use client';

import React, { useEffect } from 'react';
import { Loader2 } from 'lucide-react';
import { REGISTRATION_BRIDGE_EVENT } from '@/components/MetaPixelProvider';
import { GOOGLE_REGISTRATION_BRIDGE_EVENT } from '@/components/GoogleAdsProvider';

export default function RegistrationCompletePage() {
  useEffect(() => {
    let isMounted = true;
    let hasRedirected = false;
    let metaComplete = false;
    let googleComplete = false;

    const getSafeNext = () => {
      if (typeof window === 'undefined') return '/dashboard';
      const requestedNext = new URLSearchParams(window.location.search).get('next') || '/dashboard';
      return requestedNext.startsWith('/') && !requestedNext.startsWith('//')
        ? requestedNext
        : '/dashboard';
    };

    const performRedirect = () => {
      if (!isMounted || hasRedirected) return;
      hasRedirected = true;
      if (typeof window !== 'undefined') {
        window.location.replace(getSafeNext());
      }
    };

    const maybeRedirect = () => {
      if (metaComplete && googleComplete) {
        performRedirect();
      }
    };

    const handleMetaComplete = () => {
      metaComplete = true;
      maybeRedirect();
    };

    const handleGoogleComplete = () => {
      googleComplete = true;
      maybeRedirect();
    };

    if (typeof window !== 'undefined') {
      window.addEventListener(REGISTRATION_BRIDGE_EVENT, handleMetaComplete, { once: true });
      window.addEventListener(
        GOOGLE_REGISTRATION_BRIDGE_EVENT,
        handleGoogleComplete,
        { once: true }
      );
    }

    // Safety fallback keeps registration from hanging if either ad script is blocked.
    const safetyTimer = setTimeout(() => {
      performRedirect();
    }, 2600);

    return () => {
      isMounted = false;
      if (typeof window !== 'undefined') {
        window.removeEventListener(REGISTRATION_BRIDGE_EVENT, handleMetaComplete);
        window.removeEventListener(
          GOOGLE_REGISTRATION_BRIDGE_EVENT,
          handleGoogleComplete
        );
      }
      clearTimeout(safetyTimer);
    };
  }, []);

  return (
    <div className="flex h-screen w-screen items-center justify-center bg-white text-zinc-900 font-sans">
      <div className="flex flex-col items-center gap-3">
        <img
          src="/logo.svg"
          alt="Plurilog"
          className="w-8 h-8 rounded-lg object-contain"
        />
        <div className="flex items-center gap-2 text-xs text-zinc-500 font-medium">
          <Loader2 className="w-3.5 h-3.5 animate-spin text-zinc-600" />
          <span>Verifying session...</span>
        </div>
      </div>
    </div>
  );
}
