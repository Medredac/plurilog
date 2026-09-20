/**
 * OpenRouter Native Gemini Image API Adapter
 *
 * Isolated server-side helper for Google's native Gemini image generation and editing
 * via OpenRouter's /api/v1/images endpoint.
 *
 * NOTE: Inert utility — not currently imported or consumed by runtime routes.
 */

export const GEMINI_IMAGE_MODEL = 'google/gemini-3.1-flash-image';
export const CHATGPT_IMAGE_MODEL = 'openai/gpt-image-2.5-flare';
const OPENROUTER_IMAGES_ENDPOINT = 'https://openrouter.ai/api/v1/images';

export interface GeneratedImageResult {
  b64Json: string;
  mediaType: string;
  costUsd: number | null;
  model: string;
}

export interface GenerateGeminiImageOptions {
  prompt: string;
  signal?: AbortSignal;
}

export interface GenerateChatGPTImageOptions {
  prompt: string;
  signal?: AbortSignal;
}

export interface EditGeminiImageOptions {
  prompt: string;
  referenceImageUrl: string;
  signal?: AbortSignal;
}

function getOpenRouterHeaders(apiKey: string): Record<string, string> {
  return {
    Authorization: `Bearer ${apiKey.trim()}`,
    'Content-Type': 'application/json',
    'HTTP-Referer': process.env.NEXT_PUBLIC_APP_URL || ('https:' + '//plurilogai.com'),
    'X-Title': 'Plurilog',
  };
}

function parseAndValidateImageResponse(rawJson: unknown, model: string): GeneratedImageResult {
  if (!rawJson || typeof rawJson !== 'object') {
    throw new Error('Malformed image API response: expected JSON object');
  }

  const responseObj = rawJson as Record<string, any>;
  const data = responseObj.data;

  if (!Array.isArray(data) || data.length === 0) {
    throw new Error('Image API returned empty or missing data array');
  }

  const primaryItem = data[0];
  if (!primaryItem || typeof primaryItem !== 'object') {
    throw new Error('Image API returned invalid item in data array');
  }

  const b64Json = primaryItem.b64_json;
  if (!b64Json || typeof b64Json !== 'string' || b64Json.trim() === '') {
    throw new Error('Image API returned missing or empty b64_json payload');
  }

  const mediaType =
    typeof primaryItem.media_type === 'string' && primaryItem.media_type.trim()
      ? primaryItem.media_type.trim()
      : 'image/png';

  const usageCost = responseObj.usage?.cost;
  const costUsd = typeof usageCost === 'number' && !Number.isNaN(usageCost) ? usageCost : null;

  return {
    b64Json,
    mediaType,
    costUsd,
    model,
  };
}

/**
 * Generate a standalone image from a text prompt using Google Gemini via OpenRouter.
 */
export async function generateGeminiImage(
  options: GenerateGeminiImageOptions
): Promise<GeneratedImageResult> {
  const apiKey = process.env.OPENROUTER_API_KEY;
  if (!apiKey || apiKey.trim() === '') {
    throw new Error('OPENROUTER_API_KEY is not configured in server environment');
  }

  const trimmedPrompt = options.prompt?.trim();
  if (!trimmedPrompt) {
    throw new Error('A non-empty prompt is required for image generation');
  }

  const requestBody = {
    model: GEMINI_IMAGE_MODEL,
    prompt: trimmedPrompt,
  };

  const response = await fetch(OPENROUTER_IMAGES_ENDPOINT, {
    method: 'POST',
    headers: getOpenRouterHeaders(apiKey),
    body: JSON.stringify(requestBody),
    signal: options.signal,
  });

  if (!response.ok) {
    let errorDetail = '';
    try {
      const errJson = await response.json();
      errorDetail = errJson?.error?.message || JSON.stringify(errJson);
    } catch {
      try {
        errorDetail = (await response.text()).slice(0, 300);
      } catch {
        errorDetail = `HTTP ${response.status}`;
      }
    }
    throw new Error(
      `OpenRouter image generation failed (HTTP ${response.status}): ${errorDetail}`
    );
  }

  const parsedJson = await response.json();
  return parseAndValidateImageResponse(parsedJson, GEMINI_IMAGE_MODEL);
}

/**
 * Generate a standalone image from a text prompt using OpenAI GPT Image via OpenRouter.
 */
export async function generateChatGPTImage(
  options: GenerateChatGPTImageOptions
): Promise<GeneratedImageResult> {
  const apiKey = process.env.OPENROUTER_API_KEY;
  if (!apiKey || apiKey.trim() === '') {
    throw new Error('OPENROUTER_API_KEY is not configured in server environment');
  }

  const trimmedPrompt = options.prompt?.trim();
  if (!trimmedPrompt) {
    throw new Error('A non-empty prompt is required for image generation');
  }

  const requestBody = {
    model: CHATGPT_IMAGE_MODEL,
    prompt: trimmedPrompt,
  };

  const response = await fetch(OPENROUTER_IMAGES_ENDPOINT, {
    method: 'POST',
    headers: getOpenRouterHeaders(apiKey),
    body: JSON.stringify(requestBody),
    signal: options.signal,
  });

  if (!response.ok) {
    let errorDetail = '';
    try {
      const errJson = await response.json();
      errorDetail = errJson?.error?.message || JSON.stringify(errJson);
    } catch {
      try {
        errorDetail = (await response.text()).slice(0, 300);
      } catch {
        errorDetail = `HTTP ${response.status}`;
      }
    }
    throw new Error(
      `OpenRouter ChatGPT image generation failed (HTTP ${response.status}): ${errorDetail}`
    );
  }

  const parsedJson = await response.json();
  return parseAndValidateImageResponse(parsedJson, CHATGPT_IMAGE_MODEL);
}

/**
 * Edit or transform an existing reference image with a prompt using Google Gemini via OpenRouter.
 */
export async function editGeminiImage(
  options: EditGeminiImageOptions
): Promise<GeneratedImageResult> {
  const apiKey = process.env.OPENROUTER_API_KEY;
  if (!apiKey || apiKey.trim() === '') {
    throw new Error('OPENROUTER_API_KEY is not configured in server environment');
  }

  const trimmedPrompt = options.prompt?.trim();
  if (!trimmedPrompt) {
    throw new Error('A non-empty prompt is required for image editing');
  }

  const referenceUrl = options.referenceImageUrl?.trim();
  if (!referenceUrl) {
    throw new Error('A valid reference image URL is required for image editing');
  }

  const requestBody = {
    model: GEMINI_IMAGE_MODEL,
    prompt: trimmedPrompt,
    input_references: [
      {
        type: 'image_url',
        image_url: {
          url: referenceUrl,
        },
      },
    ],
  };

  const response = await fetch(OPENROUTER_IMAGES_ENDPOINT, {
    method: 'POST',
    headers: getOpenRouterHeaders(apiKey),
    body: JSON.stringify(requestBody),
    signal: options.signal,
  });

  if (!response.ok) {
    let errorDetail = '';
    try {
      const errJson = await response.json();
      errorDetail = errJson?.error?.message || JSON.stringify(errJson);
    } catch {
      try {
        errorDetail = (await response.text()).slice(0, 300);
      } catch {
        errorDetail = `HTTP ${response.status}`;
      }
    }
    throw new Error(
      `OpenRouter image editing failed (HTTP ${response.status}): ${errorDetail}`
    );
  }

  const parsedJson = await response.json();
  return parseAndValidateImageResponse(parsedJson, GEMINI_IMAGE_MODEL);
}
