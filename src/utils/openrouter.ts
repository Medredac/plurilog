/**
 * OpenRouter Model Routing Dictionary
 *
 * Hardcoded model fallback configuration for council seats.
 */

export type ProviderPrefix = 'google/' | 'anthropic/' | 'openai/';

export const PROVIDER_MODELS: Record<ProviderPrefix, string[]> = {
  'google/': [
    'google/gemini-3.1-flash-lite',
    'google/gemini-3.7-flash',
    'google/gemini-3.1-pro-preview',
  ],
  'anthropic/': [
    '~anthropic/claude-haiku-latest',
    '~anthropic/claude-sonnet-latest',
    '~anthropic/claude-opus-latest',
  ],
  'openai/': [
    'openai/gpt-5.6-luna',
    'openai/gpt-5.6-terra',
    'openai/gpt-5.6-sol',
  ],
};

export function getProviderModels(prefix: ProviderPrefix): string[] {
  return PROVIDER_MODELS[prefix] || [];
}

export function getCouncilSeatFallbacks(): {
  gemini: string[];
  claude: string[];
  chatgpt: string[];
} {
  return {
    gemini: PROVIDER_MODELS['google/'],
    claude: PROVIDER_MODELS['anthropic/'],
    chatgpt: PROVIDER_MODELS['openai/'],
  };
}
