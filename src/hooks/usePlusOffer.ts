'use client';

import { useEffect, useState } from 'react';
import type { PlusOffer } from '@/lib/plusPricing';

export function usePlusOffer(isOpen: boolean) {
  const [offer, setOffer] = useState<PlusOffer | null>(null);
  const [error, setError] = useState<string | null>(null);
  const [wasOpen, setWasOpen] = useState(isOpen);
  if (wasOpen !== isOpen) {
    setWasOpen(isOpen);
    setOffer(null);
    setError(null);
  }
  useEffect(() => {
    if (!isOpen) return;
    const controller = new AbortController();
    fetch('/api/stripe/offer', { signal: controller.signal, cache: 'no-store' })
      .then(async response => {
        const data = await response.json();
        if (!response.ok) throw new Error(data.error || 'Unable to load pricing.');
        if (!controller.signal.aborted) setOffer(data);
      })
      .catch(error => {
        if (!controller.signal.aborted) setError(error.message);
      });
    return () => controller.abort();
  }, [isOpen]);
  return { offer, error };
}
