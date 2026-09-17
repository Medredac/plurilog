'use client';

import React, { useEffect } from 'react';
import { Loader2 } from 'lucide-react';
import { REGISTRATION_BRIDGE_EVENT } from '@/components/MetaPixelProvider';

export default function RegistrationCompletePage() {
  useEffect(() => {
    let isMounted = true;
    let hasRedirected = false;

    const performRedirect = () => {
      if (!isMounted || hasRedirected) return;
      hasRedirected = true;
      if (typeof window !== 'undefined') {
        window.location.replace('/dashboard');
      }
    };

    if (typeof window !== 'undefined') {
      window.addEventListener(REGISTRATION_BRIDGE_EVENT, performRedirect, { once: true });
    }

    // Safety fallback timeout in case Meta is blocked or event is missed
    const safetyTimer = setTimeout(() => {
      performRedirect();
    }, 2200);

    return () => {
      isMounted = false;
      if (typeof window !== 'undefined') {
        window.removeEventListener(REGISTRATION_BRIDGE_EVENT, performRedirect);
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
