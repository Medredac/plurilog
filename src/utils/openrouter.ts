/**
 * OpenRouter Model Routing Dictionary
 *
 * Hardcoded model fallback configuration for council seats.
 */

export type ProviderPrefix = 'google/' | 'anthropic/' | 'openai/';

export const PROVIDER_MODELS: Record<ProviderPrefix, string[]> = {
  'google/': [
    'google/gemini-3.8-flash',
    'google/gemini-3.7-flash',
    'google/gemini-3.5-flash-lite',
  ],
  'anthropic/': [
    '~anthropic/claude-sonnet-latest',
    '~anthropic/claude-haiku-latest',
    '~anthropic/claude-opus-latest',
  ],
  'openai/': [
    'openai/gpt-5.6-luna',
    'openai/gpt-6-luna',
    'openai/gpt-5.6-sol',
  ],
};

export function getProviderModels(prefix: ProviderPrefix): string[] {
  return PROVIDER_MODELS[prefix] || [];
}

// Repeat 50 cents of 5.6-first, then 50 cents of 6-first routing.
// Use the same overall per-user spend counter as Claude, not GPT-only spend.
export function getChatgptFallbacksForUsage(overallUsageCents: number): string[] {
  const models = [...PROVIDER_MODELS['openai/']];
  const usage = Number.isFinite(overallUsageCents)
    ? Math.max(0, overallUsageCents)
    : 0;
  if (usage % 100 >= 50) {
    [models[0], models[1]] = [models[1], models[0]];
  }
  return models;
}

// Repeat 50 cents of Flash-first, then 50 cents of Flash-Lite-first routing.
// Read the same overall per-user spend counter as the other seats.
export function getGeminiFallbacksForUsage(overallUsageCents: number): string[] {
  const models = [...PROVIDER_MODELS['google/']];
  const usage = Number.isFinite(overallUsageCents)
    ? Math.max(0, overallUsageCents)
    : 0;
  if (usage % 100 >= 50) {
    return [models[2], models[0], models[1]];
  }
  return models;
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
