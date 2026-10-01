'use client';

import React from 'react';
import { ModelId } from '../types/chat';
import { ProviderIcon } from './ProviderIcon';

const TINT: Record<ModelId, string> = {
  claude: '#F6D3C9',
  gemini: '#D3E0F8',
  chatgpt: '#E6E5E2',
};

const SIZE = {
  sm: { wrap: 'w-6 h-6', icon: 'w-[13px] h-[13px]' },
  md: { wrap: 'w-8 h-8', icon: 'w-4 h-4' },
  lg: { wrap: 'w-11 h-11', icon: 'w-5 h-5' },
};

export function ProviderBadge({
  provider,
  size = 'sm',
  className = '',
  showBorder = true,
}: {
  provider: ModelId;
  size?: keyof typeof SIZE;
  className?: string;
  showBorder?: boolean;
}) {
  const s = SIZE[size];
  return (
    <span
      className={`inline-flex ${s.wrap} shrink-0 items-center justify-center rounded-full ${showBorder ? 'border-[1.5px] border-white' : ''} ${className}`}
      style={{ backgroundColor: TINT[provider] }}
      aria-hidden="true"
    >
      <ProviderIcon provider={provider} className={s.icon} />
    </span>
  );
}
