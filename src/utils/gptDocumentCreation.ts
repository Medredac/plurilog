import { ModelId } from '@/types/chat';
import { createServiceClient } from '@/utils/supabase/service';
import {
  ingestParsedDocument,
  ingestDiscussionArtifacts,
} from '@/utils/discussionMemory';
import { parseDocx } from '@/utils/docxParser';
import { persistDocxEmbeddedImages } from '@/utils/docxVisualAssets';
import { persistGeneratedDocument } from '@/utils/generatedDocumentStorage';
import { renderDocx } from '@/utils/docxWriter';
import type { DocxBlock, StructuredDocxInput } from '@/utils/docxWriter';
import {
  renderDocxPages,
  convertDocxToPdf,
  type RenderedDocxPage,
} from '@/utils/docxPageRenderer';
import { persistDocxRenderedPages } from '@/utils/docxRenderedPages';
import {
  createRichPdfRenderSession,
  type PdfDesign,
  type RichDocumentBlock,
  type RenderedPdfReviewPage,
} from '@/utils/richPdfRenderer';
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

export interface GptCreateFileArgs extends Omit<StructuredDocxInput, 'blocks'> {
  format: 'docx' | 'pdf';
  design?: PdfDesign;
  design_reference_ids?: string[];
  blocks: RichDocumentBlock[];
}

export interface DocumentImageSource {
  filename: string;
  storagePath?: string | null;
  url?: string | null;
}

export interface DocumentImageCostEvent {
  costUsd: number;
  model: string;
  operation: 'generate' | 'edit';
}
export interface ExecuteGptDocumentCreationOptions {
  supabase: any;
  openai: any;
  discussionId: string;
  messageId: string;
  seatId: ModelId;
  args: GptCreateFileArgs;
  signal?: AbortSignal;
  durableSignal?: AbortSignal;
  sourceDocx?: {
    storagePath: string;
    filename: string;
  } | null;
  availableImages?: DocumentImageSource[];
  resourceContext?: ResourceBrokerContext;
  onImageCost?: (event: DocumentImageCostEvent) => void;
  reviewModel?: string;
  reviewModels?: string[];
  originalUserPrompt?: string;
  reviewSessionId?: string | null;
}

export interface ExecuteGptDocumentCreationResult {
  finalContent: string;
  format: 'docx' | 'pdf';
  messageId: string;
  createdAt: string;
  filename: string;
  storagePath: string;
  signedUrl: string;
  durableUrl: string;
  fullText: string;
  imageAssetCount: number;
  imageCostUsd: number;
  visualReviewCostUsd: number;
  visualReviewApplied: boolean;
  renderedPageAttachments: Array<{ url: string; filename: string }>;
}

const MAX_DOCUMENT_IMAGES = 12;
const MAX_DOCUMENT_IMAGE_BYTES = 15 * 1024 * 1024;

const PAGE_COUNT_WORDS: Record<string, number> = {
  one: 1,
  two: 2,
  three: 3,
  four: 4,
  five: 5,
  six: 6,
  seven: 7,
  eight: 8,
  nine: 9,
  ten: 10,
};

function requestedPageCount(args: GptCreateFileArgs, prompt?: string): number | null {
  if (
    typeof args.design?.targetPageCount === 'number' &&
    Number.isFinite(args.design.targetPageCount) &&
    args.design.targetPageCount > 0
  ) {
    return Math.max(1, Math.min(30, Math.floor(args.design.targetPageCount)));
  }

  const value = (prompt || '').toLowerCase();
  const numeric = value.match(/\b(\d{1,2})\s*[- ]?\s*pages?\b/i);
  if (numeric) {
    const parsed = Number(numeric[1]);
    if (Number.isFinite(parsed) && parsed >= 1 && parsed <= 30) return parsed;
  }

  const word = value.match(
    /\b(one|two|three|four|five|six|seven|eight|nine|ten)\s*[- ]?\s*pages?\b/i
  );
  return word ? PAGE_COUNT_WORDS[word[1].toLowerCase()] || null : null;
}

function normalizeRenderedComparisonText(value: string): string {
  return (value || '')
    .normalize('NFKC')
    .replace(/[\s\u00a0]+/g, '')
    .replace(/[‐‑‒–—―]/g, '-')
    .replace(/[〜～]/g, '~')
    .toLowerCase();
}

function missingRenderedTableValues(
  blocks: RichDocumentBlock[],
  renderedText: string
): string[] {
  const haystack = normalizeRenderedComparisonText(renderedText);
  if (!haystack) return ['[rendered document text was empty]'];

  const missing: string[] = [];
  for (const block of blocks || []) {
    if ((block as any)?.type !== 'table') continue;
    const headers = Array.isArray((block as any).headers) ? (block as any).headers : [];
    const rows = Array.isArray((block as any).rows) ? (block as any).rows : [];
    const values = [...headers, ...rows.flat()]
      .map((value) => String(value || '').trim())
      .filter((value) => value.length >= 2);

    for (const value of values) {
      const needle = normalizeRenderedComparisonText(value);
      if (needle.length < 2) continue;
      if (!haystack.includes(needle)) {
        missing.push(value.slice(0, 240));
        if (missing.length >= 20) return missing;
      }
    }
  }
  return missing;
}

function pageCountDistance(actual: number | null, target: number | null): number {
  if (!target || !actual) return Number.POSITIVE_INFINITY;
  return Math.abs(actual - target);
}

function compactDocxArgs(args: GptCreateFileArgs): GptCreateFileArgs {
  const design = args.design || {};
  const blocks = (args.blocks || [])
    .filter((block: any) => block?.type !== 'page_break')
    .map((block: any) => {
    if (block?.type !== 'image') return block;
    const size =
      block.size === 'full'
        ? 'large'
        : block.size === 'large'
          ? 'medium'
          : block.size || 'medium';
    return { ...block, size };
  });

  return {
    ...args,
    design: {
      ...design,
      marginMm: Math.max(9, (design.marginMm || 16) - 2),
      bodySizePt: Math.max(9, (design.bodySizePt || 10.5) - 0.5),
      lineHeight: Math.max(1.08, (design.lineHeight || 1.32) - 0.08),
    },
    blocks,
  };
}

function spreadDocxAcrossTargetPages(
  args: GptCreateFileArgs,
  target: number
): GptCreateFileArgs {
  if (target <= 1) {
    return {
      ...args,
      blocks: (args.blocks || []).filter((block: any) => block?.type !== 'page_break'),
    };
  }

  const blocks = (args.blocks || []).filter((block: any) => block?.type !== 'page_break');
  if (blocks.length < target) return args;

  const weight = (block: any): number => {
    if (!block) return 1;
    if (block.type === 'image') {
      if (block.size === 'full') return 5;
      if (block.size === 'large') return 4;
      if (block.size === 'medium') return 3;
      return 2;
    }
    if (block.type === 'table') {
      return Math.max(2, Math.min(8, (block.rows?.length || 0) * 0.7 + 1.5));
    }
    if (block.type === 'bullets' || block.type === 'numbered') {
      return Math.max(1.5, (block.items?.length || 0) * 0.7);
    }
    if (block.type === 'heading') return block.level === 1 ? 1.8 : 1.2;
    if (block.type === 'paragraph') {
      return Math.max(1, Math.min(5, String(block.text || '').length / 420));
    }
    return 1;
  };

  const weights = blocks.map(weight);
  const total = weights.reduce((sum, value) => sum + value, 0);
  if (total <= 0) return args;

  const output: RichDocumentBlock[] = [];
  let cumulative = 0;
  let nextBoundary = total / target;
  let breaksAdded = 0;

  for (let i = 0; i < blocks.length; i++) {
    const remainingBlocks = blocks.length - i;
    const remainingBreaks = target - 1 - breaksAdded;

    if (
      i > 0 &&
      breaksAdded < target - 1 &&
      cumulative >= nextBoundary &&
      remainingBlocks > remainingBreaks
    ) {
      output.push({ type: 'page_break' } as any);
      breaksAdded += 1;
      nextBoundary = (total * (breaksAdded + 1)) / target;
    }

    output.push(blocks[i]);
    cumulative += weights[i];
  }

  return breaksAdded > 0 ? { ...args, blocks: output } : args;
}

function coerceRichBlocksForDocx(blocks: RichDocumentBlock[]): RichDocumentBlock[] {
  const output: RichDocumentBlock[] = [];

  for (const block of blocks || []) {
    if (!block || typeof block !== 'object') continue;
    const b: any = block;

    if (
      ['heading', 'paragraph', 'bullets', 'numbered', 'table', 'image', 'page_break'].includes(
        b.type
      )
    ) {
      output.push(block);
      continue;
    }

    if (b.type === 'banner') {
      if (b.eyebrow) output.push({ type: 'paragraph', text: String(b.eyebrow) } as any);
      if (b.title) output.push({ type: 'heading', level: 1, text: String(b.title) } as any);
      if (b.subtitle) output.push({ type: 'paragraph', text: String(b.subtitle) } as any);
      continue;
    }

    if (b.type === 'callout') {
      if (b.title) output.push({ type: 'heading', level: 2, text: String(b.title) } as any);
      else if (b.eyebrow) output.push({ type: 'heading', level: 3, text: String(b.eyebrow) } as any);
      if (b.text) output.push({ type: 'paragraph', text: String(b.text) } as any);
      if (Array.isArray(b.items) && b.items.length > 0) {
        output.push({ type: 'bullets', items: b.items.map(String) } as any);
      }
      continue;
    }

    if (b.type === 'cards' && Array.isArray(b.cards)) {
      for (const card of b.cards) {
        if (card?.title) {
          output.push({ type: 'heading', level: 2, text: String(card.title) } as any);
        }
        if (card?.text) {
          output.push({ type: 'paragraph', text: String(card.text) } as any);
        }
      }
      continue;
    }

    if (b.type === 'columns' && Array.isArray(b.columns)) {
      for (const column of b.columns) {
        if (column?.title) {
          output.push({ type: 'heading', level: 2, text: String(column.title) } as any);
        }
        if (column?.text) {
          output.push({ type: 'paragraph', text: String(column.text) } as any);
        }
        if (Array.isArray(column?.items) && column.items.length > 0) {
          output.push({ type: 'bullets', items: column.items.map(String) } as any);
        }
      }
      continue;
    }

    if (b.type === 'flow' && Array.isArray(b.steps)) {
      const items = b.steps
        .map((step: any) => {
          const title = String(step?.title || step?.label || '').trim();
          const text = String(step?.text || '').trim();
          return [title, text].filter(Boolean).join(' — ');
        })
        .filter(Boolean);
      if (items.length > 0) output.push({ type: 'numbered', items } as any);
    }
  }

  return output;
}


function applyDocxDocumentConventions(
  blocks: RichDocumentBlock[],
  prompt: string
): RichDocumentBlock[] {
  const isRirekisho =
    /(?:履歴書|りれきしょ|rirekisho)/i.test(prompt || '') ||
    blocks.some((block: any) =>
      block?.type === 'heading' && /履\s*歴\s*書/.test(String(block.text || ''))
    );

  if (!isRirekisho) return blocks;

  const portraitRegex =
    /(?:証明写真|顔写真|写真|portrait|headshot|id\s*photo|profile\s*photo)/i;
  const hasPortrait = blocks.some((block: any) => {
    if (block?.type !== 'image') return false;
    const description = [
      block.need,
      block.prompt,
      block.caption,
      block.filename,
      block.imageAltText,
    ]
      .filter(Boolean)
      .join(' ');
    return portraitRegex.test(description);
  });

  return blocks.map((block: any) => {
    if (block?.type === 'image') {
      const description = [
        block.need,
        block.prompt,
        block.caption,
        block.filename,
        block.imageAltText,
      ]
        .filter(Boolean)
        .join(' ');

      if (portraitRegex.test(description)) {
        return {
          ...block,
          placement: 'top-right',
          alignment: 'right',
          size: 'small',
          widthMm: 30,
          heightMm: 40,
          caption: undefined,
        } as RichDocumentBlock;
      }
      return block;
    }

    if (block?.type === 'table') {
      const headers = Array.isArray(block.headers) ? block.headers : [];
      let rows = Array.isArray(block.rows) ? block.rows : [];
      const tableText = [...headers, ...rows.flat()].join(' ');

      const looksLikeProfileTable =
        rows.length > 0 &&
        rows.every((row: any) => Array.isArray(row) && row.length <= 2) &&
        /(?:氏名|ふりがな|現住所|電話|メール|生年月日|国籍)/.test(tableText);

      if (looksLikeProfileTable) {
        if (hasPortrait) {
          rows = rows.filter((row: any) => {
            const label = String(Array.isArray(row) ? row[0] || '' : '');
            return !/^\s*(?:写真|証明写真)\s*$/.test(label);
          });
        }
        return {
          ...block,
          rows,
          tableWidthPct: 66,
          columnWidthsPct: [26, 74],
        } as RichDocumentBlock;
      }

      const columnCount = Math.max(
        headers.length,
        ...rows.map((row: any) => (Array.isArray(row) ? row.length : 0)),
        0
      );
      if (
        columnCount === 3 &&
        /(?:年|月)/.test(String(headers[0] || '') + String(headers[1] || ''))
      ) {
        return {
          ...block,
          tableWidthPct: 100,
          columnWidthsPct: [10, 8, 82],
        } as RichDocumentBlock;
      }
    }

    return block;
  });
}

function isImageFilename(value?: string | null): boolean {
  if (!value) return false;
  const clean = value.split('?')[0].split('#')[0].toLowerCase();
  return /\.(png|jpe?g|webp|gif|bmp)$/.test(clean);
}

function mediaTypeFromFilename(filename?: string | null): string {
  const clean = (filename || '').toLowerCase();
  if (clean.endsWith('.jpg') || clean.endsWith('.jpeg')) return 'image/jpeg';
  if (clean.endsWith('.webp')) return 'image/webp';
  if (clean.endsWith('.gif')) return 'image/gif';
  if (clean.endsWith('.bmp')) return 'image/bmp';
  return 'image/png';
}

function cleanMediaType(value: string | null | undefined, filename?: string | null): string {
  const normalized = (value || '').split(';')[0].trim().toLowerCase();
  return normalized.startsWith('image/') ? normalized : mediaTypeFromFilename(filename);
}

function scoreImageSource(source: DocumentImageSource, need: string, filename?: string): number {
  const sourceName = (source.filename || '').toLowerCase();
  const wantedFilename = (filename || '').trim().toLowerCase();
  if (wantedFilename && sourceName === wantedFilename) return 1000;
  if (wantedFilename && sourceName.includes(wantedFilename)) return 800;

  const combinedNeed = `${need} ${filename || ''}`.toLowerCase();
  const tokens = combinedNeed.match(/[a-z0-9]{3,}/g) || [];
  let score = 0;
  for (const token of tokens) if (sourceName.includes(token)) score += 20;

  const wantsPortrait =
    /\b(photo|portrait|headshot|id\s*photo|profile\s*photo)\b/i.test(combinedNeed) ||
    /(?:証明写真|顔写真|写真|ポートレート)/.test(need || '');

  if (wantsPortrait && /portrait photo candidate/.test(sourceName)) {
    score += 300;
    if (/candidate 1\b/.test(sourceName)) score += 40;
  }

  return score;
}

function fallbackResolveImageSource(
  availableImages: DocumentImageSource[],
  need: string,
  filename?: string
): DocumentImageSource | null {
  const candidates = availableImages.filter((source) =>
    isImageFilename(source.filename || source.url || source.storagePath)
  );
  if (candidates.length === 0) return null;
  const ranked = candidates
    .map((source) => ({ source, score: scoreImageSource(source, need, filename) }))
    .sort((a, b) => b.score - a.score);
  if (ranked[0]?.score > 0 && (!ranked[1] || ranked[0].score > ranked[1].score)) {
    return ranked[0].source;
  }
  return candidates.length === 1 ? candidates[0] : null;
}

async function downloadImageBytes(
  serviceClient: any,
  source: DocumentImageSource,
  signal?: AbortSignal
): Promise<{ data: Buffer; contentType: string; filename: string }> {
  let data: Buffer;
  let contentType = mediaTypeFromFilename(source.filename);

  if (source.storagePath) {
    const { data: blob, error } = await serviceClient.storage
      .from('message-images')
      .download(source.storagePath);
    if (error || !blob) throw new Error(`Failed to load document image: ${error?.message || 'Not found'}`);
    data = Buffer.from(await blob.arrayBuffer());
    contentType = cleanMediaType(blob.type, source.filename);
  } else if (source.url) {
    const response = await fetch(source.url, { signal });
    if (!response.ok) throw new Error(`Failed to fetch document image (HTTP ${response.status}).`);
    data = Buffer.from(await response.arrayBuffer());
    contentType = cleanMediaType(response.headers.get('content-type'), source.filename);
  } else {
    throw new Error('Resolved document image has no retrievable source.');
  }

  if (data.length === 0) throw new Error('Resolved document image is empty.');
  if (data.length > MAX_DOCUMENT_IMAGE_BYTES) throw new Error('Document image exceeds the 15 MB image limit.');
  return { data, contentType, filename: source.filename || 'image.png' };
}

async function signImageSource(serviceClient: any, source: DocumentImageSource): Promise<string> {
  if (source.url) return source.url;
  if (!source.storagePath) throw new Error('Image source cannot be signed.');
  const { data, error } = await serviceClient.storage
    .from('message-images')
    .createSignedUrl(source.storagePath, 900);
  if (error || !data?.signedUrl) throw new Error(`Failed to sign image source: ${error?.message || 'Unknown error'}`);
  return data.signedUrl;
}

async function generateDocumentImage(
  prompt: string,
  signal: AbortSignal | undefined,
  onImageCost?: (event: DocumentImageCostEvent) => void
): Promise<{ data: Buffer; contentType: string; altText: string }> {
  const trimmed = (prompt || '').trim();
  if (!trimmed) throw new Error('Generated document images require a prompt.');
  let result;
  try {
    result = await generateGeminiImage({ prompt: trimmed, signal });
  } catch (geminiErr) {
    console.warn('[Generated Document] Gemini image generation failed; falling back to GPT Image:', geminiErr);
    result = await generateChatGPTImage({ prompt: trimmed, signal });
  }
  if (typeof result.costUsd === 'number' && result.costUsd > 0) {
    onImageCost?.({ costUsd: result.costUsd, model: result.model, operation: 'generate' });
  }
  const cleanB64 = result.b64Json.replace(/^data:image\/[a-z0-9.+-]+;base64,/i, '').trim();
  const data = Buffer.from(cleanB64, 'base64');
  if (!data.length) throw new Error('Generated document image returned empty bytes.');
  return { data, contentType: cleanMediaType(result.mediaType), altText: trimmed };
}

async function editDocumentImage(
  prompt: string,
  referenceImageUrl: string,
  signal: AbortSignal | undefined,
  onImageCost?: (event: DocumentImageCostEvent) => void
): Promise<{ data: Buffer; contentType: string; altText: string }> {
  const trimmed = (prompt || '').trim();
  if (!trimmed) throw new Error('Edited document images require an editing instruction.');
  let result;
  try {
    result = await editGeminiImage({ prompt: trimmed, referenceImageUrl, signal });
  } catch (geminiErr) {
    console.warn('[Generated Document] Gemini image editing failed; falling back to GPT Image:', geminiErr);
    result = await editChatGPTImage({ prompt: trimmed, referenceImageUrl, signal });
  }
  if (typeof result.costUsd === 'number' && result.costUsd > 0) {
    onImageCost?.({ costUsd: result.costUsd, model: result.model, operation: 'edit' });
  }
  const cleanB64 = result.b64Json.replace(/^data:image\/[a-z0-9.+-]+;base64,/i, '').trim();
  const data = Buffer.from(cleanB64, 'base64');
  if (!data.length) throw new Error('Edited document image returned empty bytes.');
  return { data, contentType: cleanMediaType(result.mediaType), altText: trimmed };
}

async function resolveDocumentBlocks(
  blocks: RichDocumentBlock[],
  serviceClient: any,
  availableImages: DocumentImageSource[],
  resourceContext: ResourceBrokerContext | undefined,
  signal: AbortSignal | undefined,
  onImageCost?: (event: DocumentImageCostEvent) => void
): Promise<{ blocks: RichDocumentBlock[]; imageAssetCount: number }> {
  const resolved: RichDocumentBlock[] = [];
  let imageAssetCount = 0;

  for (const block of blocks || []) {
    if (block?.type !== 'image') {
      resolved.push(block);
      continue;
    }
    if (imageAssetCount >= MAX_DOCUMENT_IMAGES) continue;

    if (
      Buffer.isBuffer(block.imageData) &&
      block.imageData.length > 0 &&
      typeof block.imageContentType === 'string'
    ) {
      resolved.push(block);
      imageAssetCount++;
      continue;
    }

    const mode = block.mode === 'existing' || block.mode === 'edit' ? block.mode : 'generate';
    const need = (block.need || block.prompt || block.caption || 'the requested image').trim();
    let payload: { data: Buffer; contentType: string; altText: string };

    if (mode === 'generate') {
      payload = await generateDocumentImage(block.prompt || need, signal, onImageCost);
    } else {
      let source: DocumentImageSource | null = null;
      if (resourceContext) {
        const broker = resolveRequestedEvidence(
          { modality: 'visual', resource_type: 'image', need, filename: block.filename },
          resourceContext
        );
        if (broker.status === 'resolved' && broker.evidence?.storagePath) {
          const matched = availableImages.find((candidate) =>
            candidate.storagePath === broker.evidence?.storagePath
          );
          source = matched || {
            filename: broker.evidence.filename || block.filename || 'image.png',
            storagePath: broker.evidence.storagePath,
          };
        }
      }
      source = source || fallbackResolveImageSource(availableImages, need, block.filename);
      if (!source) {
        throw new Error(`Could not uniquely resolve the image requested for the document: ${need}`);
      }

      if (mode === 'existing') {
        const downloaded = await downloadImageBytes(serviceClient, source, signal);
        payload = { data: downloaded.data, contentType: downloaded.contentType, altText: need };
      } else {
        const signedUrl = await signImageSource(serviceClient, source);
        payload = await editDocumentImage(block.prompt || need, signedUrl, signal, onImageCost);
      }
    }

    resolved.push({
      ...block,
      mode,
      imageData: payload.data,
      imageContentType: payload.contentType,
      imageAltText: payload.altText,
    });
    imageAssetCount++;
  }

  return { blocks: resolved, imageAssetCount };
}

interface PdfVisualReviewOutcome {
  args: GptCreateFileArgs;
  costUsd: number;
  applied: boolean;
  respondingModel: string | null;
  rationale: string;
}

function preserveImageSourceDirectives(
  originalBlocks: RichDocumentBlock[],
  revisedBlocks: RichDocumentBlock[]
): RichDocumentBlock[] | null {
  const originalImages = originalBlocks.filter((block) => block?.type === 'image') as any[];
  const revisedImages = revisedBlocks.filter((block) => block?.type === 'image') as any[];

  if (originalImages.length !== revisedImages.length) {
    return null;
  }

  let imageIndex = 0;
  return revisedBlocks.map((block) => {
    if (block?.type !== 'image') return block;
    const original = originalImages[imageIndex++];
    return {
      ...block,
      mode: original.mode,
      prompt: original.prompt,
      need: original.need,
      filename: original.filename,
    } as RichDocumentBlock;
  });
}

function reuseResolvedImagePayloads(
  revisedBlocks: RichDocumentBlock[],
  resolvedBlocks: RichDocumentBlock[]
): RichDocumentBlock[] {
  const resolvedImages = resolvedBlocks.filter(
    (block: any) =>
      block?.type === 'image' &&
      Buffer.isBuffer(block.imageData) &&
      block.imageData.length > 0
  ) as any[];

  let imageIndex = 0;
  return revisedBlocks.map((block: any) => {
    if (block?.type !== 'image') return block;
    const source = resolvedImages[imageIndex++];
    if (!source) return block;
    return {
      ...block,
      imageData: source.imageData,
      imageContentType: source.imageContentType,
      imageAltText: source.imageAltText,
    } as RichDocumentBlock;
  });
}

async function reviewRenderedPdfWithGpt(options: {
  openai: any;
  model: string;
  models: string[];
  args: GptCreateFileArgs;
  pages: RenderedPdfReviewPage[];
  originalUserPrompt?: string;
  signal?: AbortSignal;
  sessionId?: string | null;
}): Promise<PdfVisualReviewOutcome> {
  const {
    openai,
    model,
    models,
    args,
    pages,
    originalUserPrompt = '',
    signal,
    sessionId,
  } = options;

  if (!model || pages.length === 0) {
    return {
      args,
      costUsd: 0,
      applied: false,
      respondingModel: null,
      rationale: 'No visual review model or rendered pages were available.',
    };
  }

  const pageBlocks: any[] = [
    {
      type: 'text',
      text: [
        'You are performing the single final visual quality-control pass on a PDF you just designed.',
        'Inspect the ACTUAL rendered page images below, not merely the source specification.',
        'Return the complete revised PDF specification through the revise_pdf_layout tool.',
        'Improve only where the rendered result materially benefits: page balance, whitespace, hierarchy, density, grouping, alignment, table legibility, visual rhythm, overflow, awkward page breaks, and overall polish.',
        'Respect the user\'s requested aesthetic and document type. Do not force a colourful SaaS look unless the request calls for it.',
        'Preserve the factual substance. You may shorten or reflow wording modestly when necessary for layout, but do not introduce unsupported claims.',
        'Preserve the number and identity of image assets. You may change their display size, alignment, caption, or placement, but do not add, remove, regenerate, or replace images in this review pass.',
        'If an exact page count was requested, treat it as a hard constraint and balance the content across those pages rather than leaving one page crowded and another mostly empty.',
        originalUserPrompt
          ? `Original user request:\n${originalUserPrompt}`
          : '',
        args.design_reference_ids?.length
          ? `Selected design references: ${args.design_reference_ids.join(', ')}. Preserve their intended visual grammar unless the rendered result shows a clear reason to deviate.`
          : '',
        `Current PDF specification:\n${JSON.stringify({
          title: args.title,
          design: args.design,
          design_reference_ids: args.design_reference_ids,
          blocks: args.blocks,
        })}`,
      ].filter(Boolean).join('\n\n'),
    },
  ];

  for (const page of pages.slice(0, 6)) {
    pageBlocks.push({
      type: 'text',
      text: `Rendered PDF page ${page.pageNumber}`,
    });
    pageBlocks.push({
      type: 'image_url',
      image_url: {
        url: `data:${page.contentType};base64,${page.data.toString('base64')}`,
      },
    });
  }

  const reviewTool = {
    type: 'function',
    function: {
      name: 'revise_pdf_layout',
      description:
        'Return the complete final PDF layout specification after visually inspecting the rendered pages.',
      parameters: {
        type: 'object',
        properties: {
          title: {
            type: 'string',
            description:
              'Optional top-level title. Omit or leave empty when a banner already provides the title treatment.',
          },
          design: {
            type: 'object',
            description: 'Final PDF design controls.',
            additionalProperties: true,
          },
          blocks: {
            type: 'array',
            minItems: 1,
            maxItems: 200,
            items: {
              type: 'object',
              additionalProperties: true,
            },
          },
          rationale: {
            type: 'string',
            description:
              'One short internal note describing the main visual corrections made.',
          },
        },
        required: ['blocks'],
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
          'You are ChatGPT acting as a meticulous document art director. This is a bounded visual QA pass, not a new document-writing task. Inspect the rendered pages and make one final correction pass.',
      },
      {
        role: 'user',
        content: pageBlocks,
      },
    ],
    tools: [reviewTool],
    tool_choice: {
      type: 'function',
      function: { name: 'revise_pdf_layout' },
    },
    parallel_tool_calls: false,
    temperature: 0.2,
    max_tokens: 12000,
    signal,
    ...(sessionId ? { session_id: sessionId } : {}),
  });

  const respondingModel =
    typeof response?.model === 'string' ? response.model : model;
  const costUsd =
    typeof response?.usage?.cost === 'number' ? response.usage.cost : 0;
  const toolCall = response?.choices?.[0]?.message?.tool_calls?.find(
    (call: any) => call?.function?.name === 'revise_pdf_layout'
  );
  const rawArguments = toolCall?.function?.arguments;
  if (!rawArguments || typeof rawArguments !== 'string') {
    return {
      args,
      costUsd,
      applied: false,
      respondingModel,
      rationale: 'ChatGPT returned no usable visual-review layout revision.',
    };
  }

  let parsed: any;
  try {
    parsed = JSON.parse(rawArguments);
  } catch {
    return {
      args,
      costUsd,
      applied: false,
      respondingModel,
      rationale: 'ChatGPT returned invalid JSON for the visual-review revision.',
    };
  }

  if (!Array.isArray(parsed?.blocks) || parsed.blocks.length === 0) {
    return {
      args,
      costUsd,
      applied: false,
      respondingModel,
      rationale: 'ChatGPT returned an empty visual-review block list.',
    };
  }

  const imageSafeBlocks = preserveImageSourceDirectives(
    args.blocks || [],
    parsed.blocks as RichDocumentBlock[]
  );
  if (!imageSafeBlocks) {
    return {
      args,
      costUsd,
      applied: false,
      respondingModel,
      rationale:
        'Visual review attempted to change the number of image assets, so the original specification was retained.',
    };
  }

  const reviewedDesign: PdfDesign = {
    ...(args.design || {}),
    ...(parsed.design && typeof parsed.design === 'object' ? parsed.design : {}),
  };
  if (args.design?.targetPageCount) {
    reviewedDesign.targetPageCount = args.design.targetPageCount;
  }

  const reviewedArgs: GptCreateFileArgs = {
    ...args,
    format: 'pdf',
    filename: args.filename,
    title:
      typeof parsed.title === 'string'
        ? parsed.title
        : args.title,
    design: reviewedDesign,
    blocks: imageSafeBlocks,
  };

  const before = JSON.stringify({
    title: args.title || '',
    design: args.design || {},
    blocks: args.blocks || [],
  });
  const after = JSON.stringify({
    title: reviewedArgs.title || '',
    design: reviewedArgs.design || {},
    blocks: reviewedArgs.blocks || [],
  });

  return {
    args: reviewedArgs,
    costUsd,
    applied: before !== after,
    respondingModel,
    rationale:
      typeof parsed.rationale === 'string'
        ? parsed.rationale.slice(0, 1000)
        : 'The document model completed the visual PDF review.',
  };
}

async function reviewRenderedDocxWithGpt(options: {
  openai: any;
  model: string;
  models: string[];
  args: GptCreateFileArgs;
  pages: RenderedDocxPage[];
  totalPageCount: number | null;
  originalUserPrompt?: string;
  signal?: AbortSignal;
  sessionId?: string | null;
}): Promise<PdfVisualReviewOutcome> {
  const {
    openai,
    model,
    models,
    args,
    pages,
    totalPageCount,
    originalUserPrompt = '',
    signal,
    sessionId,
  } = options;

  if (!model || pages.length === 0) {
    return {
      args,
      costUsd: 0,
      applied: false,
      respondingModel: null,
      rationale: 'No visual review model or rendered Word pages were available.',
    };
  }

  const target = requestedPageCount(args, originalUserPrompt);
  const pageBlocks: any[] = [
    {
      type: 'text',
      text: [
        'You are performing the final visual quality-control pass on a Microsoft Word document you just designed.',
        'Inspect the ACTUAL LibreOffice-rendered page images below. Do not judge only from the source specification.',
        'Return the complete revised DOCX specification through the revise_docx_layout tool.',
        'Fix page balance, excessive whitespace, crowded areas, orphaned headings, split list items, awkward page breaks, image sizing, table legibility, hierarchy, spacing, and typography.',
        'Compare the rendered pages against the source specification. Every non-empty table cell, factual name/date/status, and requested image must remain visibly present. Never solve overflow by hiding or dropping a table column.',
        'If Japanese characters are visible in the page images, do not claim they are missing/tofu. Only diagnose glyph corruption when the actual rendered glyphs are visibly boxes or replacement characters.',
        'Use only Word-supported core blocks: heading, paragraph, bullets, numbered, table, image, and page_break. Do not introduce PDF-only banner/card/column/flow/divider/spacer blocks.',
        'Preserve factual table content exactly. You may shorten or reflow ordinary prose modestly when needed for layout, but do not change names, dates, institutions, degree/completion status, employment status, or other source-grounded facts, and do not add unsupported claims.',
        'Preserve the number and identity of image assets. You may resize, align, caption, or reposition them, but do not add, remove, regenerate, or replace images in this review pass.',
        target
          ? `HARD CONSTRAINT: the user requested exactly ${target} page${target === 1 ? '' : 's'}. The current Word render has ${totalPageCount || pages.length} page${(totalPageCount || pages.length) === 1 ? '' : 's'}. Revise the document so the finished Word render is exactly ${target} page${target === 1 ? '' : 's'} while keeping the pages visually balanced.`
          : `The current Word render has ${totalPageCount || pages.length} pages. Improve its visual balance without arbitrarily changing length.`,
        originalUserPrompt ? `Original user request:\n${originalUserPrompt}` : '',
        args.design_reference_ids?.length
          ? `Selected design references: ${args.design_reference_ids.join(', ')}. Preserve their intended visual grammar where Word supports it.`
          : '',
        `Current DOCX specification:\n${JSON.stringify({
          title: args.title,
          design: args.design,
          design_reference_ids: args.design_reference_ids,
          blocks: args.blocks,
        })}`,
      ]
        .filter(Boolean)
        .join('\n\n'),
    },
  ];

  for (const page of pages.slice(0, 8)) {
    pageBlocks.push({
      type: 'text',
      text: `Rendered Word page ${page.pageNumber}`,
    });
    pageBlocks.push({
      type: 'image_url',
      image_url: {
        url: `data:${page.contentType};base64,${page.data.toString('base64')}`,
      },
    });
  }

  const reviewTool = {
    type: 'function',
    function: {
      name: 'revise_docx_layout',
      description:
        'Return the complete final Word-document layout specification after inspecting the rendered pages.',
      parameters: {
        type: 'object',
        properties: {
          title: { type: 'string' },
          design: {
            type: 'object',
            description:
              'Final Word design controls. Adjust margins, body size, line height, colours, and font families when useful.',
            additionalProperties: true,
          },
          blocks: {
            type: 'array',
            minItems: 1,
            maxItems: 200,
            items: {
              type: 'object',
              additionalProperties: true,
            },
          },
          rationale: {
            type: 'string',
            description: 'One short internal note describing the corrections made.',
          },
        },
        required: ['blocks'],
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
          'You are ChatGPT acting as a meticulous Word-document art director. This is a bounded visual QA pass. Correct the real rendered pages and respect exact page-count requests.',
      },
      {
        role: 'user',
        content: pageBlocks,
      },
    ],
    tools: [reviewTool],
    tool_choice: {
      type: 'function',
      function: { name: 'revise_docx_layout' },
    },
    parallel_tool_calls: false,
    temperature: 0.2,
    max_tokens: 12000,
    signal,
    ...(sessionId ? { session_id: sessionId } : {}),
  });

  const respondingModel =
    typeof response?.model === 'string' ? response.model : model;
  const costUsd =
    typeof response?.usage?.cost === 'number' ? response.usage.cost : 0;
  const toolCall = response?.choices?.[0]?.message?.tool_calls?.find(
    (call: any) => call?.function?.name === 'revise_docx_layout'
  );
  const rawArguments = toolCall?.function?.arguments;
  if (!rawArguments || typeof rawArguments !== 'string') {
    return {
      args,
      costUsd,
      applied: false,
      respondingModel,
      rationale: 'ChatGPT returned no usable Word visual-review revision.',
    };
  }

  let parsed: any;
  try {
    parsed = JSON.parse(rawArguments);
  } catch {
    return {
      args,
      costUsd,
      applied: false,
      respondingModel,
      rationale: 'ChatGPT returned invalid JSON for the Word visual-review revision.',
    };
  }

  if (!Array.isArray(parsed?.blocks) || parsed.blocks.length === 0) {
    return {
      args,
      costUsd,
      applied: false,
      respondingModel,
      rationale: 'ChatGPT returned an empty Word visual-review block list.',
    };
  }

  const wordBlocks = (parsed.blocks as RichDocumentBlock[]).filter((block: any) =>
    ['heading', 'paragraph', 'bullets', 'numbered', 'table', 'image', 'page_break'].includes(
      block?.type
    )
  );
  const imageSafeBlocks = preserveImageSourceDirectives(
    args.blocks || [],
    wordBlocks
  );
  if (!imageSafeBlocks) {
    return {
      args,
      costUsd,
      applied: false,
      respondingModel,
      rationale:
        'Word visual review attempted to change the number of image assets, so the original specification was retained.',
    };
  }

  const reviewedDesign: PdfDesign = {
    ...(args.design || {}),
    ...(parsed.design && typeof parsed.design === 'object' ? parsed.design : {}),
  };
  if (target) reviewedDesign.targetPageCount = target;

  const reviewedArgs: GptCreateFileArgs = {
    ...args,
    format: 'docx',
    filename: args.filename,
    title: typeof parsed.title === 'string' ? parsed.title : args.title,
    design: reviewedDesign,
    blocks: imageSafeBlocks,
  };

  const before = JSON.stringify({
    title: args.title || '',
    design: args.design || {},
    blocks: args.blocks || [],
  });
  const after = JSON.stringify({
    title: reviewedArgs.title || '',
    design: reviewedArgs.design || {},
    blocks: reviewedArgs.blocks || [],
  });

  return {
    args: reviewedArgs,
    costUsd,
    applied: before !== after,
    respondingModel,
    rationale:
      typeof parsed.rationale === 'string'
        ? parsed.rationale.slice(0, 1000)
        : 'ChatGPT completed the visual Word-document review.',
  };
}

export async function executeGptDocumentCreation(
  options: ExecuteGptDocumentCreationOptions
): Promise<ExecuteGptDocumentCreationResult> {
  const {
    supabase,
    openai,
    discussionId,
    messageId,
    seatId,
    args,
    signal,
    durableSignal = signal,
    sourceDocx = null,
    availableImages = [],
    resourceContext,
    onImageCost,
    reviewModel,
    reviewModels = reviewModel ? [reviewModel] : [],
    originalUserPrompt = '',
    reviewSessionId,
  } = options;

  if (!discussionId) {
    throw new Error('A discussion is required for document creation.');
  }
  if (!args || (args.format !== 'docx' && args.format !== 'pdf')) {
    throw new Error('Only DOCX and PDF generation are supported in this rollout.');
  }

  const serviceClient = createServiceClient();
  const inferredTarget = requestedPageCount(args, originalUserPrompt);
  if (args.format === 'docx') {
    args.blocks = applyDocxDocumentConventions(
      coerceRichBlocksForDocx(args.blocks || []),
      originalUserPrompt
    );
    if (
      /[\u3040-\u30ff\u3400-\u9fff]/.test(
        originalUserPrompt + JSON.stringify(args.blocks || [])
      )
    ) {
      args.design = {
        ...(args.design || {}),
        fontFamily: args.design?.fontFamily || 'jp-sans',
        headingFontFamily: args.design?.headingFontFamily || 'jp-sans',
        locale: args.design?.locale || 'ja-JP',
      };
    }
    if (inferredTarget) {
      args.design = {
        ...(args.design || {}),
        targetPageCount: inferredTarget,
      };
    }
  }

  let imageCostUsd = 0;
  const costAwareCallback = (event: DocumentImageCostEvent) => {
    imageCostUsd += event.costUsd;
    onImageCost?.(event);
  };
  const useDirectDocxToPdf =
    args.format === 'pdf' &&
    Boolean(sourceDocx?.storagePath);

  const resolvedDocument = useDirectDocxToPdf
    ? { blocks: [] as RichDocumentBlock[], imageAssetCount: 0 }
    : await resolveDocumentBlocks(
        args.blocks || [],
        serviceClient,
        availableImages,
        resourceContext,
        signal,
        costAwareCallback
      );

  let finalBuffer: Buffer;
  let finalFilename: string;
  let renderedFullText: string;
  let generatedPdfPageCount: number | null = null;
  let finalImageAssetCount = resolvedDocument.imageAssetCount;
  let visualReviewCostUsd = 0;
  let visualReviewApplied = false;
  let finalDocxReviewPages: RenderedDocxPage[] = [];

  if (args.format === 'pdf' && useDirectDocxToPdf && sourceDocx) {
    const { data: sourceBlob, error: sourceDownloadError } =
      await serviceClient.storage
        .from('message-images')
        .download(sourceDocx.storagePath);

    if (sourceDownloadError || !sourceBlob) {
      throw new Error(
        `Could not load the source Word document for PDF conversion: ${
          sourceDownloadError?.message || 'not found'
        }`
      );
    }

    const sourceBytes = Buffer.from(await sourceBlob.arrayBuffer());
    const parsedSource = await parseDocx(sourceBytes);
    const converted = await convertDocxToPdf(sourceBytes, {
      signal,
      timeoutMs: 60_000,
    });

    finalBuffer = converted.buffer;
    finalFilename = args.filename.toLowerCase().endsWith('.pdf')
      ? args.filename
      : sourceDocx.filename.replace(/\.docx$/i, '.pdf');
    renderedFullText = parsedSource.markdown || '';
    generatedPdfPageCount = converted.totalPageCount;
    finalImageAssetCount = parsedSource.embeddedImages.length;

    console.log('[Generated PDF] Direct DOCX conversion:', {
      sourceFilename: sourceDocx.filename,
      filename: finalFilename,
      byteSize: finalBuffer.length,
      pageCount: generatedPdfPageCount,
      embeddedImageCount: finalImageAssetCount,
      usedSnapshot: converted.usedSnapshot,
      elapsedMs: converted.elapsedMs,
    });
  } else if (args.format === 'pdf') {
    const renderSession = await createRichPdfRenderSession({
      signal,
      timeoutMs: 90_000,
    });

    try {
      const initialPdf = await renderSession.render({
        filename: args.filename,
        title: args.title,
        design: args.design,
        blocks: resolvedDocument.blocks,
      });

      let selectedPdf = initialPdf;

      if (reviewModel && initialPdf.reviewPages.length > 0) {
        try {
          const review = await reviewRenderedPdfWithGpt({
            openai,
            model: reviewModel,
            models: reviewModels.length > 0 ? reviewModels : [reviewModel],
            args,
            pages: initialPdf.reviewPages,
            originalUserPrompt,
            signal,
            sessionId: reviewSessionId,
          });
          visualReviewCostUsd += review.costUsd;

          console.log('[Generated PDF Visual Review]', {
            applied: review.applied,
            respondingModel: review.respondingModel,
            initialPageCount: initialPdf.totalPageCount,
            rationale: review.rationale,
          });

          if (review.applied) {
            const blocksWithReusedImages = reuseResolvedImagePayloads(
              review.args.blocks,
              resolvedDocument.blocks
            );
            const reviewedResolvedDocument = await resolveDocumentBlocks(
              blocksWithReusedImages,
              serviceClient,
              availableImages,
              resourceContext,
              signal,
              costAwareCallback
            );

            const reviewedPdf = await renderSession.render({
              filename: review.args.filename,
              title: review.args.title,
              design: review.args.design,
              blocks: reviewedResolvedDocument.blocks,
            });

            selectedPdf = reviewedPdf;
            finalImageAssetCount = reviewedResolvedDocument.imageAssetCount;
            visualReviewApplied = true;

            console.log('[Generated PDF Visual Review] Final render:', {
              initialPageCount: initialPdf.totalPageCount,
              finalPageCount: reviewedPdf.totalPageCount,
              initialBytes: initialPdf.buffer.length,
              finalBytes: reviewedPdf.buffer.length,
            });
          }
        } catch (reviewErr) {
          console.warn(
            '[Generated PDF Visual Review] Non-critical review failure; using first render:',
            reviewErr
          );
        }
      }

      finalBuffer = selectedPdf.buffer;
      finalFilename = selectedPdf.filename;
      renderedFullText = selectedPdf.fullText;
      generatedPdfPageCount = selectedPdf.totalPageCount;

      console.log('[Generated PDF] Rendered rich PDF:', {
        filename: finalFilename,
        byteSize: finalBuffer.length,
        pageCount: generatedPdfPageCount,
        visualReviewApplied,
        visualReviewCostUsd,
        usedSnapshot: selectedPdf.usedSnapshot,
        elapsedMs: selectedPdf.elapsedMs,
      });
    } finally {
      await renderSession.close();
    }
  } else {
    const target = requestedPageCount(args, originalUserPrompt);
    const initialArgs: GptCreateFileArgs = target
      ? {
          ...args,
          design: {
            ...(args.design || {}),
            targetPageCount: target,
          },
        }
      : args;

    const initialDocument = renderDocx({
      filename: initialArgs.filename,
      title: initialArgs.title,
      design: initialArgs.design,
      blocks: resolvedDocument.blocks as DocxBlock[],
    });

    let selectedDocument = initialDocument;
    let selectedResolvedBlocks = resolvedDocument.blocks;
    let selectedPageCount: number | null = null;
    let selectedRenderedText = '';

    if (reviewModel) {
      try {
        const initialPages = await renderDocxPages(initialDocument.buffer, {
          signal,
          timeoutMs: 45_000,
        });
        selectedPageCount = initialPages.totalPageCount;
        selectedRenderedText = initialPages.renderedText;
        finalDocxReviewPages = initialPages.pages;
        const initialMissingTableValues = missingRenderedTableValues(
          resolvedDocument.blocks,
          initialPages.renderedText
        );

        console.log('[Generated DOCX Render Validation] Initial render', {
          missingTableValueCount: initialMissingTableValues.length,
          missingTableValues: initialMissingTableValues.slice(0, 8),
          pageCount: initialPages.totalPageCount,
        });

        const review = await reviewRenderedDocxWithGpt({
          openai,
          model: reviewModel,
          models: reviewModels.length > 0 ? reviewModels : [reviewModel],
          args: initialArgs,
          pages: initialPages.pages,
          totalPageCount: initialPages.totalPageCount,
          originalUserPrompt,
          signal,
          sessionId: reviewSessionId,
        });
        visualReviewCostUsd += review.costUsd;

        console.log('[Generated DOCX Visual Review]', {
          applied: review.applied,
          respondingModel: review.respondingModel,
          initialPageCount: initialPages.totalPageCount,
          targetPageCount: target,
          rationale: review.rationale,
        });

        if (review.applied) {
          const blocksWithReusedImages = reuseResolvedImagePayloads(
            review.args.blocks,
            resolvedDocument.blocks
          );
          const reviewedResolvedDocument = await resolveDocumentBlocks(
            blocksWithReusedImages,
            serviceClient,
            availableImages,
            resourceContext,
            signal,
            costAwareCallback
          );
          const reviewedDocument = renderDocx({
            filename: review.args.filename,
            title: review.args.title,
            design: review.args.design,
            blocks: reviewedResolvedDocument.blocks as DocxBlock[],
          });
          const reviewedPages = await renderDocxPages(reviewedDocument.buffer, {
            signal,
            timeoutMs: 45_000,
          });

          const initialDistance = pageCountDistance(
            initialPages.totalPageCount,
            target
          );
          const reviewedDistance = pageCountDistance(
            reviewedPages.totalPageCount,
            target
          );
          const reviewedMissingTableValues = missingRenderedTableValues(
            reviewedResolvedDocument.blocks,
            reviewedPages.renderedText
          );
          const tableVisibilityImproved =
            reviewedMissingTableValues.length <
            initialMissingTableValues.length;
          const tableVisibilitySafe =
            reviewedMissingTableValues.length === 0 ||
            reviewedMissingTableValues.length <=
              initialMissingTableValues.length;
          const chooseReviewed =
            tableVisibilitySafe &&
            (
              tableVisibilityImproved ||
              !target ||
              reviewedDistance < initialDistance ||
              reviewedDistance === 0 ||
              reviewedDistance === initialDistance
            );

          if (chooseReviewed) {
            selectedDocument = reviewedDocument;
            selectedResolvedBlocks = reviewedResolvedDocument.blocks;
            selectedPageCount = reviewedPages.totalPageCount;
            selectedRenderedText = reviewedPages.renderedText;
            finalDocxReviewPages = reviewedPages.pages;
            finalImageAssetCount = reviewedResolvedDocument.imageAssetCount;
            visualReviewApplied = true;
          }

          console.log('[Generated DOCX Visual Review] Reviewed render:', {
            initialPageCount: initialPages.totalPageCount,
            reviewedPageCount: reviewedPages.totalPageCount,
            selectedPageCount,
            targetPageCount: target,
            missingTableValueCount: reviewedMissingTableValues.length,
            missingTableValues: reviewedMissingTableValues.slice(0, 8),
          });
        }

        // If the model improved the layout but the file is still one page over an
        // explicit target, make one deterministic compacting attempt and keep it
        // only when it is objectively closer to the requested page count.
        if (
          target &&
          selectedPageCount &&
          selectedPageCount > target
        ) {
          const sourceArgs = visualReviewApplied
            ? {
                ...initialArgs,
                blocks: selectedResolvedBlocks,
              }
            : initialArgs;
          const compactArgs = compactDocxArgs(sourceArgs);
          const compactBlocks = reuseResolvedImagePayloads(
            compactArgs.blocks,
            selectedResolvedBlocks
          );
          const compactDocument = renderDocx({
            filename: compactArgs.filename,
            title: compactArgs.title,
            design: compactArgs.design,
            blocks: compactBlocks as DocxBlock[],
          });
          const compactPages = await renderDocxPages(compactDocument.buffer, {
            signal,
            timeoutMs: 45_000,
          });

          if (
            pageCountDistance(compactPages.totalPageCount, target) <
            pageCountDistance(selectedPageCount, target)
          ) {
            selectedDocument = compactDocument;
            selectedResolvedBlocks = compactBlocks;
            selectedPageCount = compactPages.totalPageCount;
            selectedRenderedText = compactPages.renderedText;
            finalDocxReviewPages = compactPages.pages;
            visualReviewApplied = true;
          }

          console.log('[Generated DOCX Page Fit]', {
            targetPageCount: target,
            compactPageCount: compactPages.totalPageCount,
            selectedPageCount,
          });
        }

        if (
          target &&
          selectedPageCount &&
          selectedPageCount < target
        ) {
          const spreadArgs = spreadDocxAcrossTargetPages(
            {
              ...initialArgs,
              blocks: selectedResolvedBlocks,
            },
            target
          );
          const spreadBlocks = reuseResolvedImagePayloads(
            spreadArgs.blocks,
            selectedResolvedBlocks
          );
          const spreadDocument = renderDocx({
            filename: spreadArgs.filename,
            title: spreadArgs.title,
            design: spreadArgs.design,
            blocks: spreadBlocks as DocxBlock[],
          });
          const spreadPages = await renderDocxPages(spreadDocument.buffer, {
            signal,
            timeoutMs: 45_000,
          });

          if (
            pageCountDistance(spreadPages.totalPageCount, target) <
            pageCountDistance(selectedPageCount, target)
          ) {
            selectedDocument = spreadDocument;
            selectedResolvedBlocks = spreadBlocks;
            selectedPageCount = spreadPages.totalPageCount;
            selectedRenderedText = spreadPages.renderedText;
            finalDocxReviewPages = spreadPages.pages;
            visualReviewApplied = true;
          }

          console.log('[Generated DOCX Page Spread]', {
            targetPageCount: target,
            spreadPageCount: spreadPages.totalPageCount,
            selectedPageCount,
          });
        }
      } catch (reviewErr) {
        console.warn(
          '[Generated DOCX Visual Review] Non-critical review failure; using best available render:',
          reviewErr
        );
      }
    }

    const finalMissingTableValues = selectedRenderedText
      ? missingRenderedTableValues(selectedResolvedBlocks, selectedRenderedText)
      : [];

    if (finalMissingTableValues.length > 0) {
      console.error('[Generated DOCX Render Validation] Refusing visually incomplete Word file', {
        filename: selectedDocument.filename,
        missingTableValueCount: finalMissingTableValues.length,
        missingTableValues: finalMissingTableValues.slice(0, 12),
      });
      throw new Error(
        `Word rendering validation failed: ${finalMissingTableValues.length} table value(s) were not visible in the rendered document.`
      );
    }

    finalBuffer = selectedDocument.buffer;
    finalFilename = selectedDocument.filename;
    renderedFullText = selectedDocument.fullText;

    console.log('[Generated DOCX] Final render:', {
      filename: finalFilename,
      byteSize: finalBuffer.length,
      pageCount: selectedPageCount,
      targetPageCount: target,
      visualReviewApplied,
      visualReviewCostUsd,
    });
  }

  const finalContent = `Created **${finalFilename}**.`;

  let persistedMsg: { id: string; created_at: string } | null = null;
  let insertedFresh = false;

  for (let attempt = 1; attempt <= 2; attempt++) {
    const { data, error } = await supabase
      .from('messages')
      .insert({
        id: messageId,
        discussion_id: discussionId,
        sender: seatId,
        content: finalContent,
      })
      .select('id, created_at, discussion_id, sender, content')
      .maybeSingle();

    if (!error && data) {
      persistedMsg = { id: data.id, created_at: data.created_at };
      insertedFresh = true;
      break;
    }

    if (error?.code === '23505') {
      const { data: existing, error: fetchErr } = await supabase
        .from('messages')
        .select('id, created_at, discussion_id, sender, content')
        .eq('id', messageId)
        .maybeSingle();

      // A single GPT turn may legitimately create more than one document.
      // Reuse the same assistant message and append each generated attachment.
      if (
        !fetchErr &&
        existing &&
        existing.id === messageId &&
        existing.discussion_id === discussionId &&
        existing.sender === seatId
      ) {
        persistedMsg = { id: existing.id, created_at: existing.created_at };
      }
      break;
    }

    if (attempt < 2) {
      await new Promise((resolve) => setTimeout(resolve, 100));
    }
  }

  if (!persistedMsg) {
    throw new Error('Failed to persist generated document response.');
  }

  let persistedDocument;
  try {
    persistedDocument = await persistGeneratedDocument({
      supabase,
      discussionId,
      messageId: persistedMsg.id,
      seatId,
      fileBuffer: finalBuffer,
      filename: finalFilename,
      format: args.format,
    });
  } catch (err) {
    if (insertedFresh) {
      try {
        await supabase
          .from('messages')
          .delete()
          .eq('id', persistedMsg.id)
          .eq('discussion_id', discussionId)
          .eq('sender', seatId)
          .eq('content', finalContent);
      } catch (cleanupErr) {
        console.warn(
          '[Generated Document] Failed to clean up message after storage error:',
          cleanupErr
        );
      }
    }
    throw err;
  }

  let renderedPageAttachments: Array<{ url: string; filename: string }> = [];
  if (args.format === 'docx' && finalDocxReviewPages.length > 0) {
    try {
      const persistedPages = await persistDocxRenderedPages({
        supabase,
        parentFilename: persistedDocument.filename,
        parentFileBytes: finalBuffer,
        pages: finalDocxReviewPages,
      });
      renderedPageAttachments = persistedPages.map((page) => ({
        url: page.signedUrl,
        filename: page.filename,
      }));
      console.log('[Generated DOCX Visual Handoff Cache]', {
        filename: persistedDocument.filename,
        pageCount: renderedPageAttachments.length,
      });
    } catch (pagePersistErr) {
      console.warn(
        '[Generated DOCX Visual Handoff Cache] Non-critical page persistence error:',
        pagePersistErr
      );
    }
  }

  // Make images embedded inside GPT-generated DOCX files durable, reusable discussion
  // assets. This lets later turns faithfully reuse/edit those exact illustrations
  // instead of trying to infer them from rendered page screenshots.
  if (args.format === 'docx') {
    try {
      const parsedDocx = await parseDocx(finalBuffer);
      if (parsedDocx.embeddedImages.length > 0) {
        const persistedEmbeddedImages = await persistDocxEmbeddedImages({
          supabase,
          parentFilename: persistedDocument.filename,
          parentFileBytes: finalBuffer,
          images: parsedDocx.embeddedImages,
        });

        if (persistedEmbeddedImages.length > 0) {
          const artifactResult = await ingestDiscussionArtifacts({
            serviceSupabase: serviceClient,
            discussionId,
            attachments: persistedEmbeddedImages.map((image) => ({
              url: image.signedUrl,
              filename: image.filename,
            })),
            sourceUserMessageId: persistedMsg.id,
            signal: durableSignal,
          });

          console.log('[Generated DOCX Embedded Images]', {
            discussionId,
            filename: persistedDocument.filename,
            extractedCount: parsedDocx.embeddedImages.length,
            persistedCount: persistedEmbeddedImages.length,
            indexedCount: artifactResult.ingestedCount,
            errorCount: artifactResult.errors.length,
          });
        }
      }
    } catch (embeddedImageErr) {
      console.warn(
        '[Generated DOCX Embedded Images] Non-critical extraction/indexing error:',
        embeddedImageErr
      );
    }
  }

  // Indexing is deliberately non-critical to file creation. The user should still
  // receive the successfully created file if embeddings are temporarily unavailable.
  try {
    const ingestResult = await ingestParsedDocument({
      serviceSupabase: serviceClient,
      openai,
      discussionId,
      filename: persistedDocument.filename,
      fullText: renderedFullText,
      fileBytes: finalBuffer,
      storagePath: persistedDocument.storagePath,
      signal: durableSignal,
    });

    console.log('[Generated Document Ingest]', {
      discussionId,
      filename: persistedDocument.filename,
      ingestedCount: ingestResult.ingestedCount,
      skippedCount: ingestResult.skippedCount,
      errorCount: ingestResult.errors.length,
    });
  } catch (docIngestErr) {
    console.warn(
      '[Generated Document Ingest] Non-critical indexing error:',
      docIngestErr
    );
  }

  return {
    finalContent,
    format: args.format,
    messageId: persistedMsg.id,
    createdAt: persistedMsg.created_at,
    filename: persistedDocument.filename,
    storagePath: persistedDocument.storagePath,
    signedUrl: persistedDocument.signedUrl,
    durableUrl: persistedDocument.durableUrl,
    fullText: renderedFullText,
    imageAssetCount: finalImageAssetCount,
    imageCostUsd,
    visualReviewCostUsd,
    visualReviewApplied,
    renderedPageAttachments,
  };
}
