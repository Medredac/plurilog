import React from 'react';
import { ModelId } from '../types/chat';

const PROVIDER_ICON_SRC: Record<ModelId, string> = {
  chatgpt: '/provider-chatgpt.svg',
  claude: '/provider-claude.svg',
  gemini: '/provider-gemini.svg',
};

interface ProviderIconProps {
  provider: ModelId;
  className?: string;
}

export const ProviderIcon: React.FC<ProviderIconProps> = ({
  provider,
  className = 'w-3.5 h-3.5',
}) => (
  <img
    src={PROVIDER_ICON_SRC[provider]}
    alt=""
    aria-hidden="true"
    draggable={false}
    className={`${className} object-contain select-none pointer-events-none`}
  />
);
