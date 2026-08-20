/**
 * OpenRouter Dynamic Model Fallback Router
 * 
 * Fetches the live OpenRouter model catalog, caches it in-memory for 12 hours,
 * and dynamically builds a 3-model fallback array (primary, backup, emergency)
 * for each provider seat.
 */

export type ProviderPrefix = 'google/' | 'anthropic/' | 'openai/';

// Hardcoded emergency fallback stack used when live fetch fails or is empty
export const HARDCODED_FALLBACKS: Record<ProviderPrefix, string[]> = {
  'google/': ['google/gemini-3.7-flash'],
  'anthropic/': ['anthropic/claude-sonnet-4.5'],
  'openai/': ['openai/gpt-5'],
};

interface ModelCache {
  models: any[];
  timestamp: number;
}

let memoryCache: ModelCache | null = null;
const CACHE_TTL_MS = 12 * 60 * 60 * 1000; // 12 hours

/**
 * Fetch and cache OpenRouter models sorted by price ascending.
 */
export async function fetchOpenRouterModels(): Promise<any[]> {
  const now = Date.now();
  if (memoryCache && now - memoryCache.timestamp < CACHE_TTL_MS) {
    return memoryCache.models;
  }

  try {
    const res = await fetch(
      'https://openrouter.ai/api/v1/models?output_modalities=text&sort=pricing-low-to-high',
      {
        headers: {
          'User-Agent': 'Plurilog/1.0',
        },
        signal: AbortSignal.timeout(8000),
        cache: 'no-store',
      }
    );

    if (!res.ok) {
      console.warn(`[OpenRouter] Models endpoint returned status ${res.status}. Using emergency fallback.`);
      return [];
    }

    const data = await res.json();
    const modelsList: any[] = data?.data || [];

    if (Array.isArray(modelsList) && modelsList.length > 0) {
      memoryCache = {
        models: modelsList,
        timestamp: now,
      };
      return modelsList;
    }

    return [];
  } catch (err) {
    console.error('[OpenRouter] Failed to fetch models catalog:', err);
    return [];
  }
}

/**
 * Filter active models for a specific provider prefix, excluding deprecated,
 * disabled, or restricted-access entries.
 */
export function filterActiveModelsForProvider(models: any[], prefix: ProviderPrefix): string[] {
  return models
    .filter((m) => {
      const id: string = m?.id || '';
      if (!id.startsWith(prefix)) return false;

      // Exclude explicitly deprecated, hidden, or disabled models
      if (m?.deprecated === true) return false;
      if (m?.hidden === true) return false;
      if (m?.enabled === false) return false;

      const status: string = (m?.status || '').toLowerCase();
      if (['deprecated', 'disabled', 'unavailable', 'restricted'].includes(status)) {
        return false;
      }

      // Ensure text modality support
      const arch = m?.architecture || {};
      if (arch?.modality && !String(arch.modality).includes('text')) {
        return false;
      }

      return true;
    })
    .map((m) => m.id as string);
}

/**
 * Construct 3-model fallback array:
 * - Primary: first active model (cheapest)
 * - Backup: median active model
 * - Emergency: most capable flagship active model (last in sorted list)
 */
export function buildDynamicFallbackArray(candidates: string[], prefix: ProviderPrefix): string[] {
  if (!candidates || candidates.length === 0) {
    return HARDCODED_FALLBACKS[prefix] || [];
  }

  const primary = candidates[0];
  const emergency = candidates[candidates.length - 1];
  const medianIdx = Math.floor((candidates.length - 1) / 2);
  const backup = candidates[medianIdx];

  const list = [primary, backup, emergency];
  return Array.from(new Set(list));
}

/**
 * Get the fallback array for a specific provider.
 */
export async function getProviderModelFallbacks(prefix: ProviderPrefix): Promise<string[]> {
  try {
    const catalog = await fetchOpenRouterModels();
    const activeCandidates = filterActiveModelsForProvider(catalog, prefix);

    if (activeCandidates.length > 0) {
      return buildDynamicFallbackArray(activeCandidates, prefix);
    }
  } catch (err) {
    console.error(`[OpenRouter] Error resolving fallback for ${prefix}:`, err);
  }

  return HARDCODED_FALLBACKS[prefix] || [];
}

/**
 * Resolve fallback arrays for all 3 council seats in parallel.
 */
export async function getCouncilSeatFallbacks(): Promise<{
  gemini: string[];
  claude: string[];
  chatgpt: string[];
}> {
  try {
    const [gemini, claude, chatgpt] = await Promise.all([
      getProviderModelFallbacks('google/'),
      getProviderModelFallbacks('anthropic/'),
      getProviderModelFallbacks('openai/'),
    ]);

    return {
      gemini: gemini.length > 0 ? gemini : HARDCODED_FALLBACKS['google/'],
      claude: claude.length > 0 ? claude : HARDCODED_FALLBACKS['anthropic/'],
      chatgpt: chatgpt.length > 0 ? chatgpt : HARDCODED_FALLBACKS['openai/'],
    };
  } catch (err) {
    console.error('[OpenRouter] getCouncilSeatFallbacks error, using hardcoded stack:', err);
    return {
      gemini: HARDCODED_FALLBACKS['google/'],
      claude: HARDCODED_FALLBACKS['anthropic/'],
      chatgpt: HARDCODED_FALLBACKS['openai/'],
    };
  }
}
