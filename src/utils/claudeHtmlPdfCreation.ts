import { Buffer } from 'node:buffer';
import {
  createHtmlPdfRenderSession,
  extractPdfAssetIds,
  injectPdfAssets,
  sanitizePdfCss,
  sanitizePdfHtml,
  type RenderedHtmlPdfPage,
} from '@/utils/htmlPdfRenderer';
import {
  generateGeminiImage,
  generateChatGPTImage,
  editGeminiImage,
  editChatGPTImage,
} from '@/utils/openrouterImages';
import {
  resolveRequestedEvidence,
  type ResourceBrokerContext,
} from '@/utils/resourceBroker';

export interface PdfHtmlImageRequest {
  id: string;
  mode: 'existing' | 'generate' | 'edit';
  prompt?: string;
  need?: string;
  filename?: string;
}

export interface ClaudeHtmlPdfArgs {
  filename: string;
  html: string;
  css: string;
  locale?: string;
  target_page_count?: number;
  images?: PdfHtmlImageRequest[];
}

export interface HtmlPdfImageSource {
  filename: string;
  storagePath?: string | null;
  url?: string | null;
}

export interface HtmlPdfImageCostEvent {
  costUsd: number;
  model: string;
  operation: 'generate' | 'edit';
}

export interface CreateClaudeHtmlPdfOptions {
  openai: any;
  serviceClient: any;
  args: ClaudeHtmlPdfArgs;
  signal?: AbortSignal;
  availableImages?: HtmlPdfImageSource[];
  resourceContext?: ResourceBrokerContext;
  reviewModel?: string;
  reviewModels?: string[];
  originalUserPrompt?: string;
  reviewSessionId?: string | null;
  onImageCost?: (event: HtmlPdfImageCostEvent) => void;
}

export interface CreateClaudeHtmlPdfResult {
  buffer: Buffer;
  filename: string;
  fullText: string;
  pageCount: number | null;
  initialPageCount: number | null;
  imageAssetCount: number;
  imageCostUsd: number;
  imageModels: string[];
  visualReviewCostUsd: number;
  visualReviewApplied: boolean;
  reviewRationale: string;
}

const MAX_IMAGE_ASSETS = 12;
const MAX_IMAGE_BYTES = 15 * 1024 * 1024;

function clean(value: unknown, max = 10000): string {
  if (typeof value !== 'string') return '';
  return value.replace(/\u0000/g, '').trim().slice(0, max);
}

function mediaTypeFromFilename(filename?: string | null): string {
  const lower = (filename || '').toLowerCase();
  if (lower.endsWith('.jpg') || lower.endsWith('.jpeg')) return 'image/jpeg';
  if (lower.endsWith('.webp')) return 'image/webp';
  if (lower.endsWith('.gif')) return 'image/gif';
  if (lower.endsWith('.bmp')) return 'image/bmp';
  return 'image/png';
}

function cleanMediaType(value?: string | null, filename?: string | null): string {
  const normalized = (value || '').split(';')[0].trim().toLowerCase();
  return normalized.startsWith('image/')
    ? normalized
    : mediaTypeFromFilename(filename);
}

function isImageFilename(value?: string | null): boolean {
  if (!value) return false;
  const path = value.split('?')[0].split('#')[0].toLowerCase();
  return /\.(png|jpe?g|webp|gif|bmp)$/.test(path);
}

function scoreImageSource(
  source: HtmlPdfImageSource,
  need: string,
  filename?: string
): number {
  const sourceName = (source.filename || '').toLowerCase();
  const wanted = (filename || '').trim().toLowerCase();
  if (wanted && sourceName === wanted) return 1000;
  if (wanted && sourceName.includes(wanted)) return 800;
  const tokens = `${need} ${filename || ''}`
    .toLowerCase()
    .match(/[a-z0-9]{3,}/g) || [];
  let score = 0;
  for (const token of tokens) if (sourceName.includes(token)) score += 20;
  return score;
}

function fallbackResolveImageSource(
  availableImages: HtmlPdfImageSource[],
  need: string,
  filename?: string
): HtmlPdfImageSource | null {
  const candidates = availableImages.filter((source) =>
    isImageFilename(source.filename || source.url || source.storagePath)
  );
  if (candidates.length === 0) return null;
  const ranked = candidates
    .map((source) => ({
      source,
      score: scoreImageSource(source, need, filename),
    }))
    .sort((a, b) => b.score - a.score);

  if (
    ranked[0]?.score > 0 &&
    (!ranked[1] || ranked[0].score > ranked[1].score)
  ) {
    return ranked[0].source;
  }
  return candidates.length === 1 ? candidates[0] : null;
}

async function downloadImageBytes(
  serviceClient: any,
  source: HtmlPdfImageSource,
  signal?: AbortSignal
): Promise<{ data: Buffer; contentType: string }> {
  let data: Buffer;
  let contentType = mediaTypeFromFilename(source.filename);

  if (source.storagePath) {
    const { data: blob, error } = await serviceClient.storage
      .from('message-images')
      .download(source.storagePath);
    if (error || !blob) {
      throw new Error(
        `Failed to load PDF image asset: ${error?.message || 'Not found'}`
      );
    }
    data = Buffer.from(await blob.arrayBuffer());
    contentType = cleanMediaType(blob.type, source.filename);
  } else if (source.url) {
    const response = await fetch(source.url, { signal });
    if (!response.ok) {
      throw new Error(
        `Failed to fetch PDF image asset (HTTP ${response.status}).`
      );
    }
    data = Buffer.from(await response.arrayBuffer());
    contentType = cleanMediaType(
      response.headers.get('content-type'),
      source.filename
    );
  } else {
    throw new Error('Resolved PDF image asset has no retrievable source.');
  }

  if (!data.length) throw new Error('Resolved PDF image asset is empty.');
  if (data.length > MAX_IMAGE_BYTES) {
    throw new Error('PDF image asset exceeds the 15 MB image limit.');
  }

  return { data, contentType };
}

async function signImageSource(
  serviceClient: any,
  source: HtmlPdfImageSource
): Promise<string> {
  if (source.url) return source.url;
  if (!source.storagePath) {
    throw new Error('PDF image source cannot be signed.');
  }
  const { data, error } = await serviceClient.storage
    .from('message-images')
    .createSignedUrl(source.storagePath, 900);
  if (error || !data?.signedUrl) {
    throw new Error(
      `Failed to sign PDF image source: ${error?.message || 'Unknown error'}`
    );
  }
  return data.signedUrl;
}

async function generatePdfImage(
  prompt: string,
  signal: AbortSignal | undefined,
  onImageCost?: (event: HtmlPdfImageCostEvent) => void
): Promise<{ data: Buffer; contentType: string; model: string }> {
  const instruction = clean(prompt, 8000);
  if (!instruction) {
    throw new Error('Generated PDF image assets require a prompt.');
  }

  let result;
  try {
    result = await generateGeminiImage({ prompt: instruction, signal });
  } catch (geminiErr) {
    console.warn(
      '[HTML PDF] Gemini image generation failed; falling back to GPT Image:',
      geminiErr
    );
    result = await generateChatGPTImage({ prompt: instruction, signal });
  }

  if (typeof result.costUsd === 'number' && result.costUsd > 0) {
    onImageCost?.({
      costUsd: result.costUsd,
      model: result.model,
      operation: 'generate',
    });
  }

  const cleanB64 = result.b64Json
    .replace(/^data:image\/[a-z0-9.+-]+;base64,/i, '')
    .trim();
  const data = Buffer.from(cleanB64, 'base64');
  if (!data.length) throw new Error('Generated PDF image returned empty bytes.');

  return {
    data,
    contentType: cleanMediaType(result.mediaType),
    model: result.model,
  };
}

async function editPdfImage(
  prompt: string,
  referenceImageUrl: string,
  signal: AbortSignal | undefined,
  onImageCost?: (event: HtmlPdfImageCostEvent) => void
): Promise<{ data: Buffer; contentType: string; model: string }> {
  const instruction = clean(prompt, 8000);
  if (!instruction) {
    throw new Error('Edited PDF image assets require an instruction.');
  }

  let result;
  try {
    result = await editGeminiImage({
      prompt: instruction,
      referenceImageUrl,
      signal,
    });
  } catch (geminiErr) {
    console.warn(
      '[HTML PDF] Gemini image editing failed; falling back to GPT Image:',
      geminiErr
    );
    result = await editChatGPTImage({
      prompt: instruction,
      referenceImageUrl,
      signal,
    });
  }

  if (typeof result.costUsd === 'number' && result.costUsd > 0) {
    onImageCost?.({
      costUsd: result.costUsd,
      model: result.model,
      operation: 'edit',
    });
  }

  const cleanB64 = result.b64Json
    .replace(/^data:image\/[a-z0-9.+-]+;base64,/i, '')
    .trim();
  const data = Buffer.from(cleanB64, 'base64');
  if (!data.length) throw new Error('Edited PDF image returned empty bytes.');

  return {
    data,
    contentType: cleanMediaType(result.mediaType),
    model: result.model,
  };
}

async function resolvePdfAssets(options: {
  html: string;
  css: string;
  requests: PdfHtmlImageRequest[];
  serviceClient: any;
  availableImages: HtmlPdfImageSource[];
  resourceContext?: ResourceBrokerContext;
  signal?: AbortSignal;
  onImageCost?: (event: HtmlPdfImageCostEvent) => void;
}): Promise<{
  assets: Map<string, { data: Buffer; contentType: string }>;
  imageAssetCount: number;
  imageModels: string[];
}> {
  const {
    html,
    css,
    requests,
    serviceClient,
    availableImages,
    resourceContext,
    signal,
    onImageCost,
  } = options;

  const referencedIds = extractPdfAssetIds(html, css);
  if (referencedIds.length > MAX_IMAGE_ASSETS) {
    throw new Error(
      `PDF references too many image assets (${referencedIds.length}; max ${MAX_IMAGE_ASSETS}).`
    );
  }

  const requestMap = new Map<string, PdfHtmlImageRequest>();
  for (const request of requests || []) {
    const id = clean(request?.id, 80);
    if (!id || !/^[a-zA-Z0-9_-]+$/.test(id)) {
      throw new Error('Every PDF image asset requires a simple alphanumeric id.');
    }
    if (requestMap.has(id)) {
      throw new Error(`Duplicate PDF image asset id "${id}".`);
    }
    requestMap.set(id, request);
  }

  for (const id of referencedIds) {
    if (!requestMap.has(id)) {
      throw new Error(
        `PDF HTML references image asset "${id}" but no matching image request was supplied.`
      );
    }
  }

  const assets = new Map<string, { data: Buffer; contentType: string }>();
  const imageModels = new Set<string>();

  for (const id of referencedIds) {
    const request = requestMap.get(id)!;
    const mode =
      request.mode === 'existing' || request.mode === 'edit'
        ? request.mode
        : 'generate';
    const need = clean(
      request.need || request.prompt || request.filename || id,
      4000
    );

    if (mode === 'generate') {
      const generated = await generatePdfImage(
        request.prompt || need,
        signal,
        onImageCost
      );
      imageModels.add(generated.model);
      assets.set(id, {
        data: generated.data,
        contentType: generated.contentType,
      });
      continue;
    }

    let source: HtmlPdfImageSource | null = null;
    if (resourceContext) {
      const broker = resolveRequestedEvidence(
        {
          modality: 'visual',
          resource_type: 'image',
          need,
          filename: request.filename,
        },
        resourceContext
      );
      if (broker.status === 'resolved' && broker.evidence?.storagePath) {
        source =
          availableImages.find(
            (candidate) =>
              candidate.storagePath === broker.evidence?.storagePath
          ) || {
            filename: broker.evidence.filename || request.filename || 'image.png',
            storagePath: broker.evidence.storagePath,
          };
      }
    }

    source =
      source ||
      fallbackResolveImageSource(
        availableImages,
        need,
        request.filename
      );

    if (!source) {
      throw new Error(
        `Could not uniquely resolve the image requested for PDF asset "${id}": ${need}`
      );
    }

    if (mode === 'existing') {
      const downloaded = await downloadImageBytes(
        serviceClient,
        source,
        signal
      );
      assets.set(id, downloaded);
    } else {
      const signedUrl = await signImageSource(serviceClient, source);
      const edited = await editPdfImage(
        request.prompt || need,
        signedUrl,
        signal,
        onImageCost
      );
      imageModels.add(edited.model);
      assets.set(id, {
        data: edited.data,
        contentType: edited.contentType,
      });
    }
  }

  return {
    assets,
    imageAssetCount: assets.size,
    imageModels: Array.from(imageModels),
  };
}

function sameAssetSet(beforeHtml: string, beforeCss: string, afterHtml: string, afterCss: string): boolean {
  const before = extractPdfAssetIds(beforeHtml, beforeCss).sort();
  const after = extractPdfAssetIds(afterHtml, afterCss).sort();
  return JSON.stringify(before) === JSON.stringify(after);
}

async function reviewHtmlPdfWithClaude(options: {
  openai: any;
  model: string;
  models: string[];
  html: string;
  css: string;
  locale?: string;
  targetPageCount?: number;
  pages: RenderedHtmlPdfPage[];
  originalUserPrompt?: string;
  signal?: AbortSignal;
  sessionId?: string | null;
}): Promise<{
  html: string;
  css: string;
  costUsd: number;
  respondingModel: string;
  applied: boolean;
  rationale: string;
}> {
  const {
    openai,
    model,
    models,
    html,
    css,
    locale,
    targetPageCount,
    pages,
    originalUserPrompt = '',
    signal,
    sessionId,
  } = options;

  const content: any[] = [
    {
      type: 'text',
      text: [
        'This is the one and only visual quality-control pass for a PDF you just designed.',
        'Inspect the ACTUAL rendered pages below, then return the complete corrected HTML body and CSS.',
        'The goal is a polished human-designed document, not a generic AI dashboard. Use restraint where the document calls for restraint: hierarchy, typography, whitespace, proportion, alignment and visual rhythm should do more work than decorative boxes.',
        'Do not impose a specific aesthetic when the user asked for another one. Preserve the intended cultural/document convention.',
        'Correct crowding, accidental empty space, weak hierarchy, poor page balance, awkward page breaks, tiny text, overuse of colour, gratuitous cards, table readability, and inconsistent spacing.',
        'Do not add or remove image assets. Keep every asset:<id> reference exactly represented in the revised HTML/CSS, though you may resize or reposition it.',
        'Do not add JavaScript, external URLs, web fonts, @import, forms, iframes, or remote resources.',
        targetPageCount
          ? `The user requested exactly ${targetPageCount} page${targetPageCount === 1 ? '' : 's'}. Treat that as a hard layout constraint.`
          : '',
        originalUserPrompt
          ? `Original user request:\n${originalUserPrompt}`
          : '',
        `Locale: ${locale || 'en'}`,
        `Current HTML body:\n${html}`,
        `Current CSS:\n${css}`,
      ].filter(Boolean).join('\n\n'),
    },
  ];

  for (const page of pages.slice(0, 6)) {
    content.push({
      type: 'text',
      text: `Rendered PDF page ${page.pageNumber}`,
    });
    content.push({
      type: 'image_url',
      image_url: {
        url: `data:${page.contentType};base64,${page.data.toString('base64')}`,
      },
    });
  }

  const tool = {
    type: 'function',
    function: {
      name: 'revise_pdf_html',
      description:
        'Return the complete final HTML body and CSS after inspecting the rendered PDF pages.',
      parameters: {
        type: 'object',
        properties: {
          html: {
            type: 'string',
            description:
              'Complete revised HTML body fragment. No html/head/body wrapper, no script, no external resources.',
          },
          css: {
            type: 'string',
            description:
              'Complete revised print CSS including @page rules and all document styling.',
          },
          rationale: {
            type: 'string',
            description: 'Brief internal summary of the visual corrections made.',
          },
        },
        required: ['html', 'css'],
        additionalProperties: false,
      },
    },
  };

  const response = await (openai.chat.completions.create as any)({
    model,
    models,
    messages: [
      {
        role: 'system',
        content:
          'You are Claude acting as a meticulous editorial designer and print art director. Revise the actual rendered document once, with strong aesthetic judgment and restraint.',
      },
      { role: 'user', content },
    ],
    tools: [tool],
    tool_choice: {
      type: 'function',
      function: { name: 'revise_pdf_html' },
    },
    parallel_tool_calls: false,
    temperature: 0.2,
    max_tokens: 20000,
    signal,
    ...(sessionId ? { session_id: sessionId } : {}),
  });

  const respondingModel =
    typeof response?.model === 'string' ? response.model : model;
  const costUsd =
    typeof response?.usage?.cost === 'number' ? response.usage.cost : 0;
  const call = response?.choices?.[0]?.message?.tool_calls?.find(
    (entry: any) => entry?.function?.name === 'revise_pdf_html'
  );
  const raw = call?.function?.arguments;
  if (!raw || typeof raw !== 'string') {
    return {
      html,
      css,
      costUsd,
      respondingModel,
      applied: false,
      rationale: 'Claude returned no usable HTML/CSS revision.',
    };
  }

  let parsed: any;
  try {
    parsed = JSON.parse(raw);
  } catch {
    return {
      html,
      css,
      costUsd,
      respondingModel,
      applied: false,
      rationale: 'Claude returned invalid JSON for the HTML/CSS revision.',
    };
  }

  const revisedHtml = sanitizePdfHtml(parsed?.html || '');
  const revisedCss = sanitizePdfCss(parsed?.css || '');

  if (!revisedHtml || !revisedCss) {
    return {
      html,
      css,
      costUsd,
      respondingModel,
      applied: false,
      rationale: 'Claude returned an empty HTML/CSS revision.',
    };
  }

  if (!sameAssetSet(html, css, revisedHtml, revisedCss)) {
    return {
      html,
      css,
      costUsd,
      respondingModel,
      applied: false,
      rationale:
        'Claude changed the PDF image-asset set during visual review, so the first layout was retained.',
    };
  }

  return {
    html: revisedHtml,
    css: revisedCss,
    costUsd,
    respondingModel,
    applied: revisedHtml !== html || revisedCss !== css,
    rationale: clean(parsed?.rationale, 1200) || 'Claude completed the visual layout review.',
  };
}

export async function createClaudeHtmlPdf(
  options: CreateClaudeHtmlPdfOptions
): Promise<CreateClaudeHtmlPdfResult> {
  const {
    openai,
    serviceClient,
    args,
    signal,
    availableImages = [],
    resourceContext,
    reviewModel,
    reviewModels = reviewModel ? [reviewModel] : [],
    originalUserPrompt = '',
    reviewSessionId,
    onImageCost,
  } = options;

  const rawHtml = sanitizePdfHtml(args.html);
  const rawCss = sanitizePdfCss(args.css);
  if (!rawHtml || !rawCss) {
    throw new Error(
      'PDF creation requires a complete HTML body and CSS stylesheet.'
    );
  }

  const targetPageCount =
    typeof args.target_page_count === 'number' &&
    Number.isFinite(args.target_page_count)
      ? Math.max(1, Math.min(30, Math.floor(args.target_page_count)))
      : undefined;

  let imageCostUsd = 0;
  const costAwareCallback = (event: HtmlPdfImageCostEvent) => {
    imageCostUsd += event.costUsd;
    onImageCost?.(event);
  };

  const resolvedAssets = await resolvePdfAssets({
    html: rawHtml,
    css: rawCss,
    requests: Array.isArray(args.images) ? args.images : [],
    serviceClient,
    availableImages,
    resourceContext,
    signal,
    onImageCost: costAwareCallback,
  });

  const session = await createHtmlPdfRenderSession({
    signal,
    timeoutMs: 100_000,
  });

  let visualReviewCostUsd = 0;
  let visualReviewApplied = false;
  let reviewRationale = '';

  try {
    const initialInjected = injectPdfAssets(
      rawHtml,
      rawCss,
      resolvedAssets.assets
    );
    const initial = await session.render({
      filename: args.filename,
      html: initialInjected.html,
      css: initialInjected.css,
      locale: args.locale,
      targetPageCount,
    });

    let selected = initial;

    if (reviewModel && initial.reviewPages.length > 0) {
      try {
        const reviewed = await reviewHtmlPdfWithClaude({
          openai,
          model: reviewModel,
          models:
            reviewModels.length > 0 ? reviewModels : [reviewModel],
          html: rawHtml,
          css: rawCss,
          locale: args.locale,
          targetPageCount,
          pages: initial.reviewPages,
          originalUserPrompt,
          signal,
          sessionId: reviewSessionId,
        });
        visualReviewCostUsd += reviewed.costUsd;
        reviewRationale = reviewed.rationale;

        if (reviewed.applied) {
          const reviewedInjected = injectPdfAssets(
            reviewed.html,
            reviewed.css,
            resolvedAssets.assets
          );
          const revised = await session.render({
            filename: args.filename,
            html: reviewedInjected.html,
            css: reviewedInjected.css,
            locale: args.locale,
            targetPageCount,
          });

          const target = targetPageCount || 0;
          const initialDistance =
            target && initial.totalPageCount
              ? Math.abs(initial.totalPageCount - target)
              : 0;
          const revisedDistance =
            target && revised.totalPageCount
              ? Math.abs(revised.totalPageCount - target)
              : 0;

          if (!target || revisedDistance <= initialDistance) {
            selected = revised;
            visualReviewApplied = true;
          } else {
            reviewRationale =
              `${reviewRationale} Revision was rejected because it moved farther from the requested page count.`.trim();
          }

          console.log('[HTML PDF Visual Review]', {
            applied: visualReviewApplied,
            initialPageCount: initial.totalPageCount,
            revisedPageCount: revised.totalPageCount,
            targetPageCount: target || null,
            rationale: reviewRationale,
          });
        } else {
          console.log('[HTML PDF Visual Review]', {
            applied: false,
            initialPageCount: initial.totalPageCount,
            targetPageCount: targetPageCount || null,
            rationale: reviewRationale,
          });
        }
      } catch (reviewErr) {
        console.warn(
          '[HTML PDF Visual Review] Non-critical review failure; using first render:',
          reviewErr
        );
      }
    }

    return {
      buffer: selected.buffer,
      filename: selected.filename,
      fullText: selected.fullText,
      pageCount: selected.totalPageCount,
      initialPageCount: initial.totalPageCount,
      imageAssetCount: resolvedAssets.imageAssetCount,
      imageCostUsd,
      imageModels: resolvedAssets.imageModels,
      visualReviewCostUsd,
      visualReviewApplied,
      reviewRationale,
    };
  } finally {
    await session.close();
  }
}
