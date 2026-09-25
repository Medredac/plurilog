import crypto from 'node:crypto';
import { ModelId } from '@/types/chat';
import { createServiceClient } from '@/utils/supabase/service';
import {
  ingestParsedDocument,
  ingestDiscussionArtifacts,
} from '@/utils/discussionMemory';
import { parseDocx } from '@/utils/docxParser';
import { persistDocxEmbeddedImages } from '@/utils/docxVisualAssets';
import {
  extractPdfEmbeddedImages,
  persistPdfEmbeddedImages,
} from '@/utils/pdfEmbeddedImages';
import { persistGeneratedDocument } from '@/utils/generatedDocumentStorage';
import { renderDocx } from '@/utils/docxWriter';
import type { DocxBlock, StructuredDocxInput } from '@/utils/docxWriter';
import {
  renderDocxPages,
  convertDocxToPdf,
  type RenderedDocxPage,
} from '@/utils/docxPageRenderer';
import { persistDocxRenderedPages } from '@/utils/docxRenderedPages';
import { persistPdfRenderedPages } from '@/utils/pdfRenderedPages';
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
import {
  inferDocumentStateImageBindings,
  missingPreservedDocumentContent,
  persistDocumentStateSnapshot,
  sanitizeDocumentSpecForState,
  type DocumentStateImageBinding,
  type DocumentStateSnapshot,
} from '@/utils/documentRevisionState';

export interface GptCreateFileArgs extends Omit<StructuredDocxInput, 'blocks'> {
  format: 'docx' | 'pdf';
  design?: PdfDesign;
  design_reference_ids?: string[];
  source_docx_filename?: string;
  blocks: RichDocumentBlock[];
}

export interface DocumentImageSource {
  filename: string;
  storagePath?: string | null;
  url?: string | null;
  artifactId?: string | null;
  sourceMessageId?: string | null;
  attachmentIndex?: number | null;
  createdAt?: string | null;
  sender?: string | null;
}

export interface DocumentImageCostEvent {
  costUsd: number;
  model: string;
  operation: 'generate' | 'edit';
}

export type DocumentCreationActivity =
  | 'generating_image'
  | 'editing_image'
  | 'generating_file'
  | 'generating_pdf'
  | 'generating_word'
  | 'editing_file'
  | 'editing_pdf'
  | 'editing_word';

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
  onActivity?: (activity: DocumentCreationActivity) => void;
  reviewModel?: string;
  reviewModels?: string[];
  originalUserPrompt?: string;
  reviewSessionId?: string | null;
  revisionContext?: {
    parentSnapshot?: DocumentStateSnapshot | null;
    sourceDocumentIds?: string[];
    generationKind?: 'create' | 'revision' | 'convert';
    preserveParentContent?: boolean;
  } | null;
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
  documentId?: string | null;
  documentStateId?: string | null;
  pageCount?: number | null;
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

function explicitlyRequestedPageCount(prompt?: string): number | null {
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

function requestedPageCount(args: GptCreateFileArgs, prompt?: string): number | null {
  const explicitPromptTarget = explicitlyRequestedPageCount(prompt);
  if (explicitPromptTarget) return explicitPromptTarget;

  if (
    typeof args.design?.targetPageCount === 'number' &&
    Number.isFinite(args.design.targetPageCount) &&
    args.design.targetPageCount > 0
  ) {
    return Math.max(1, Math.min(30, Math.floor(args.design.targetPageCount)));
  }

  return null;
}

function normalizeRenderedComparisonText(value: string): string {
  return (value || '')
    .normalize('NFKC')
    .replace(/[\p{Cf}\u00ad]/gu, '')
    .replace(/[\s\u00a0]+/g, '')
    .replace(/[‐‑‒–—―]/g, '-')
    .replace(/[〜～]/g, '~')
    .toLowerCase();
}

function japanesePairCoverage(
  needle: string,
  haystack: string
): number {
  const chars = Array.from(needle);
  if (chars.length === 0) return 1;
  if (chars.length <= 3) return haystack.includes(needle) ? 1 : 0;

  const coverageForOffset = (offset: number): number => {
    const pairs: string[] = [];
    for (let i = offset; i + 1 < chars.length; i += 2) {
      pairs.push(chars[i] + chars[i + 1]);
    }
    if (pairs.length === 0) return 0;
    let matched = 0;
    for (const pair of pairs) {
      if (haystack.includes(pair)) matched += 1;
    }
    return matched / pairs.length;
  };

  // A visual line/column boundary can break one adjacent pair. Evaluating both
  // pair alignments lets one alignment survive that boundary, while a genuinely
  // omitted phrase removes pairs from both alignments.
  return Math.max(coverageForOffset(0), coverageForOffset(1));
}

function renderedTableValuePresent(
  value: string,
  renderedText: string
): boolean {
  const needle = normalizeRenderedComparisonText(value);
  const haystack = normalizeRenderedComparisonText(renderedText);
  if (needle.length < 2) return true;
  if (!haystack) return false;
  if (haystack.includes(needle)) return true;

  // LibreOffice renders wrapped Word table cells correctly, but pdftotext may
  // emit pieces around neighbouring columns/rows instead of preserving one
  // contiguous cell string. Validate the substantive pieces rather than the
  // extraction order.
  const latinTokens =
    needle.match(/[a-z0-9][a-z0-9.+/#_-]*/gi)?.filter(
      (token) => token.length >= 2
    ) || [];
  // PDF text extraction can insert discretionary hyphens inside words that
  // are visibly intact in the rendered Word page (for example,
  // "demonstra-tions"). Compare a punctuation-free Latin projection as a
  // fallback so extraction artefacts do not masquerade as missing cells.
  const latinHaystack = haystack.replace(/[^a-z0-9]+/g, '');
  if (
    latinTokens.some((token) => {
      const literal = token.toLowerCase();
      if (haystack.includes(literal)) return false;
      const compactToken = literal.replace(/[^a-z0-9]+/g, '');
      return compactToken.length >= 2 && !latinHaystack.includes(compactToken);
    })
  ) {
    return false;
  }

  const japaneseRuns =
    needle.match(/[\u3040-\u30ff\u3400-\u9fff々〆ヶ]+/g) || [];
  for (const run of japaneseRuns) {
    if (run.length <= 3) {
      if (!haystack.includes(run)) return false;
      continue;
    }

    // A line/column extraction boundary normally destroys only one or two
    // adjacencies. A genuinely dropped phrase loses many of them.
    if (japanesePairCoverage(run, haystack) < 0.9) return false;
  }

  // Symbol-only cells are not useful visibility sentinels.
  return latinTokens.length > 0 || japaneseRuns.length > 0;
}

function isBlankFormScaffoldValue(value: string): boolean {
  const compact = (value || '')
    .normalize('NFKC')
    .replace(/[\s\u00a0]+/g, '')
    .trim();

  if (!compact) return true;

  // Standard blank form shells are layout scaffolding, not populated source
  // facts. Their visual presence is checked from rendered pages; they should
  // not hard-fail text extraction when LibreOffice/pdftotext omits or reorders
  // the blank unit/choice tokens.
  return (
    /^時間(?:[・･／/]?)分$/.test(compact) ||
    /^(?:有[・･／/]無|無[・･／/]有)$/.test(compact) ||
    /^(?:男[・･／/]女|女[・･／/]男)$/.test(compact) ||
    /^年(?:[・･／/]?)月(?:[・･／/]?)日(?:生)?(?:\(?満?歳\)?)?$/.test(compact) ||
    /^(?:満)?歳$/.test(compact)
  );
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
    const headers = Array.isArray((block as any).headers)
      ? (block as any).headers
      : [];
    const rows = Array.isArray((block as any).rows)
      ? (block as any).rows
      : [];
    const values = [...headers, ...rows.flat()]
      .map((value) => String(value || '').trim())
      .filter(
        (value) =>
          value.length >= 2 &&
          !isBlankFormScaffoldValue(value)
      );

    for (const value of values) {
      if (!renderedTableValuePresent(value, renderedText)) {
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

function repairMissingDocxTableValues(
  args: GptCreateFileArgs,
  missingValues: string[]
): GptCreateFileArgs {
  const missing = new Set(
    (missingValues || [])
      .map((value) => String(value || '').trim())
      .filter(Boolean)
  );
  if (missing.size === 0) return args;

  const output: RichDocumentBlock[] = [];
  let insertedBreak = false;

  for (const block of args.blocks || []) {
    if ((block as any)?.type !== 'table') {
      output.push(block);
      continue;
    }

    const headers = Array.isArray((block as any).headers)
      ? (block as any).headers
      : [];
    const rows = Array.isArray((block as any).rows)
      ? (block as any).rows
      : [];
    const tableValues = [...headers, ...rows.flat()].map((value) =>
      String(value || '').trim().slice(0, 240)
    );
    const containsMissing = tableValues.some((value) => missing.has(value));

    if (containsMissing) {
      // A table that begins in the final sliver of a page can trigger
      // LibreOffice pagination edge cases even when body rows are splittable.
      // Give only the affected table a clean page boundary. This preserves all
      // semantic blocks and table contents exactly.
      const previous = output[output.length - 1] as any;
      if (previous?.type !== 'page_break') {
        output.push({ type: 'page_break' } as RichDocumentBlock);
        insertedBreak = true;
      }
    }

    output.push(block);
  }

  if (!insertedBreak) return args;

  return {
    ...args,
    blocks: output,
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

function scoreImageSource(
  source: DocumentImageSource,
  need: string,
  filename?: string
): number {
  const sourceName = (source.filename || '').toLowerCase();
  const wantedFilename = (filename || '').trim().toLowerCase();
  if (wantedFilename && sourceName === wantedFilename) return 10000;
  if (wantedFilename && sourceName.includes(wantedFilename)) return 8000;

  const combinedNeed = `${need} ${filename || ''}`.toLowerCase();
  const tokens = combinedNeed.match(/[a-z0-9]{3,}/g) || [];
  let score = 0;
  for (const token of tokens) if (sourceName.includes(token)) score += 20;

  const wantsPortrait =
    /\b(photo|portrait|headshot|id\s*photo|profile\s*photo)\b/i.test(combinedNeed) ||
    /(?:証明写真|顔写真|写真|ポートレート)/.test(need || '');
  const wantsOriginal =
    /\b(?:original|source|existing|same|previous)\b/i.test(combinedNeed) ||
    /(?:元の|原本|同じ|既存)/.test(need || '');

  if (wantsPortrait && /portrait photo candidate|embedded image/.test(sourceName)) {
    score += 300;
  }

  // When the model explicitly asks to reuse the original/existing image, provenance
  // is stronger evidence than a generated-document filename. Prefer the earliest
  // user-originated canonical image over assistant-generated copies/re-encodes.
  if (wantsOriginal) {
    const sender = (source.sender || '').toLowerCase();
    if (sender === 'user') score += 1200;
    else if (sender) score += 100;
  }

  return score;
}

function fallbackResolveImageSource(
  availableImages: DocumentImageSource[],
  need: string,
  filename?: string
): DocumentImageSource | null {
  const rawCandidates = availableImages.filter((source) =>
    isImageFilename(source.filename || source.url || source.storagePath)
  );
  if (rawCandidates.length === 0) return null;

  // Collapse aliases/copies that point at the same canonical artifact. Prefer a
  // user-originated alias when available because it best represents "original".
  const byArtifact = new Map<string, DocumentImageSource>();
  for (const source of rawCandidates) {
    const key =
      source.artifactId ||
      source.storagePath ||
      source.url ||
      source.filename;
    const existing = byArtifact.get(key);
    if (!existing) {
      byArtifact.set(key, source);
      continue;
    }
    const existingUser = (existing.sender || '').toLowerCase() === 'user';
    const sourceUser = (source.sender || '').toLowerCase() === 'user';
    if (sourceUser && !existingUser) byArtifact.set(key, source);
  }
  const candidates = Array.from(byArtifact.values());

  const combinedNeed = `${need} ${filename || ''}`;
  const wantsPortrait =
    /\b(photo|portrait|headshot|id\s*photo|profile\s*photo)\b/i.test(combinedNeed) ||
    /(?:証明写真|顔写真|写真|ポートレート)/.test(need || '');
  const wantsOriginal =
    /\b(?:original|source|existing|same|previous)\b/i.test(combinedNeed) ||
    /(?:元の|原本|同じ|既存)/.test(need || '');

  const ranked = candidates
    .map((source) => ({
      source,
      score: scoreImageSource(source, need, filename),
    }))
    .sort((a, b) => {
      if (b.score !== a.score) return b.score - a.score;

      if (wantsOriginal) {
        const aUser = (a.source.sender || '').toLowerCase() === 'user' ? 1 : 0;
        const bUser = (b.source.sender || '').toLowerCase() === 'user' ? 1 : 0;
        if (aUser !== bUser) return bUser - aUser;

        const aTime = a.source.createdAt
          ? new Date(a.source.createdAt).getTime()
          : Number.POSITIVE_INFINITY;
        const bTime = b.source.createdAt
          ? new Date(b.source.createdAt).getTime()
          : Number.POSITIVE_INFINITY;
        if (aTime !== bTime) return aTime - bTime;
      }

      const aIndex =
        typeof a.source.attachmentIndex === 'number'
          ? a.source.attachmentIndex
          : Number.POSITIVE_INFINITY;
      const bIndex =
        typeof b.source.attachmentIndex === 'number'
          ? b.source.attachmentIndex
          : Number.POSITIVE_INFINITY;
      if (aIndex !== bIndex) return aIndex - bIndex;

      return (a.source.filename || '').localeCompare(
        b.source.filename || ''
      );
    });

  if (ranked[0]?.score > 0) {
    // Strong semantic requests such as "original portrait" are intentionally
    // deterministic. Generic image requests remain ambiguity-safe below.
    if (wantsOriginal || wantsPortrait || filename) {
      return ranked[0].source;
    }
    if (!ranked[1] || ranked[0].score > ranked[1].score) {
      return ranked[0].source;
    }
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
  onImageCost?: (event: DocumentImageCostEvent) => void,
  onActivity?: (activity: DocumentCreationActivity) => void
): Promise<{ data: Buffer; contentType: string; altText: string }> {
  const trimmed = (prompt || '').trim();
  if (!trimmed) throw new Error('Generated document images require a prompt.');
  onActivity?.('generating_image');
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
  onImageCost?: (event: DocumentImageCostEvent) => void,
  onActivity?: (activity: DocumentCreationActivity) => void
): Promise<{ data: Buffer; contentType: string; altText: string }> {
  const trimmed = (prompt || '').trim();
  if (!trimmed) throw new Error('Edited document images require an editing instruction.');
  onActivity?.('editing_image');
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


function documentImageExtension(contentType: string): string {
  const normalized = (contentType || '').toLowerCase();
  if (normalized === 'image/jpeg' || normalized === 'image/jpg') return 'jpg';
  if (normalized === 'image/webp') return 'webp';
  if (normalized === 'image/gif') return 'gif';
  return 'png';
}

async function persistGeneratedDocumentImageBinding(options: {
  supabase: any;
  payload: { data: Buffer; contentType: string; altText: string };
  imageOrdinal: number;
  seatId: ModelId;
}): Promise<DocumentStateImageBinding | null> {
  const { supabase, payload, imageOrdinal, seatId } = options;
  if (
    !supabase ||
    !Buffer.isBuffer(payload.data) ||
    payload.data.length === 0
  ) {
    return null;
  }

  const {
    data: { user },
    error: authError,
  } = await supabase.auth.getUser();

  if (authError || !user) {
    console.warn('[Generated Document Image] Could not persist canonical image binding: no authenticated user');
    return null;
  }

  const imageHash = crypto
    .createHash('sha256')
    .update(payload.data)
    .digest('hex');
  const extension = documentImageExtension(payload.contentType);
  const storagePath =
    `${user.id}/document-assets/${imageHash.slice(0, 32)}.${extension}`;
  const filename =
    `generated-document-image-${imageOrdinal + 1}-${imageHash.slice(0, 10)}.${extension}`;

  const { error: uploadError } = await supabase.storage
    .from('message-images')
    .upload(storagePath, payload.data, {
      contentType: payload.contentType,
      upsert: false,
    });

  if (
    uploadError &&
    !/already exists|duplicate/i.test(uploadError.message || '')
  ) {
    console.warn('[Generated Document Image] Canonical asset upload failed', {
      imageOrdinal,
      error: uploadError.message,
    });
    return null;
  }

  return {
    imageOrdinal,
    source: {
      filename,
      storagePath,
      artifactId: null,
      sourceMessageId: null,
      attachmentIndex: imageOrdinal,
      createdAt: new Date().toISOString(),
      sender: seatId,
    },
  };
}

function reusableParentImageBindings(
  parentSnapshot: DocumentStateSnapshot | null | undefined,
  currentBlocks: RichDocumentBlock[]
): DocumentStateImageBinding[] {
  if (!parentSnapshot) return [];

  const parentBindings = inferDocumentStateImageBindings(parentSnapshot);
  if (parentBindings.length === 0) return [];

  const parentImages = Array.isArray(parentSnapshot.spec?.blocks)
    ? parentSnapshot.spec.blocks.filter((block: any) => block?.type === 'image')
    : [];
  const currentImages = (currentBlocks || []).filter(
    (block: any) => block?.type === 'image'
  );

  const directive = (block: any) => JSON.stringify({
    mode: block?.mode || 'generate',
    prompt: block?.prompt || '',
    need: block?.need || '',
    filename: block?.filename || '',
  });

  return parentBindings.filter((binding) => {
    const parentImage = parentImages[binding.imageOrdinal];
    const currentImage = currentImages[binding.imageOrdinal];
    return Boolean(
      parentImage &&
      currentImage &&
      directive(parentImage) === directive(currentImage)
    );
  });
}

async function resolveDocumentBlocks(
  blocks: RichDocumentBlock[],
  serviceClient: any,
  availableImages: DocumentImageSource[],
  resourceContext: ResourceBrokerContext | undefined,
  signal: AbortSignal | undefined,
  onImageCost?: (event: DocumentImageCostEvent) => void,
  preferredImageBindings: DocumentStateImageBinding[] = [],
  onActivity?: (activity: DocumentCreationActivity) => void,
  assetSupabase?: any,
  seatId: ModelId = 'chatgpt'
): Promise<{
  blocks: RichDocumentBlock[];
  imageAssetCount: number;
  imageBindings: DocumentStateImageBinding[];
}> {
  const resolved: RichDocumentBlock[] = [];
  const imageBindings: DocumentStateImageBinding[] = [];
  let imageAssetCount = 0;
  let imageOrdinal = 0;

  for (const block of blocks || []) {
    if (block?.type !== 'image') {
      resolved.push(block);
      continue;
    }
    const currentImageOrdinal = imageOrdinal++;
    if (imageAssetCount >= MAX_DOCUMENT_IMAGES) continue;

    const preferredBinding = preferredImageBindings.find(
      (binding) => binding.imageOrdinal === currentImageOrdinal
    );

    if (
      Buffer.isBuffer(block.imageData) &&
      block.imageData.length > 0 &&
      typeof block.imageContentType === 'string'
    ) {
      resolved.push(block);
      if (preferredBinding) imageBindings.push(preferredBinding);
      imageAssetCount++;
      continue;
    }

    const mode = block.mode === 'existing' || block.mode === 'edit' ? block.mode : 'generate';
    const need = (block.need || block.prompt || block.caption || 'the requested image').trim();
    let payload: { data: Buffer; contentType: string; altText: string };

    if (mode === 'generate') {
      if (preferredBinding?.source?.storagePath) {
        const downloaded = await downloadImageBytes(
          serviceClient,
          preferredBinding.source,
          signal
        );
        payload = {
          data: downloaded.data,
          contentType: downloaded.contentType,
          altText: block.prompt || need,
        };
        imageBindings.push(preferredBinding);
        console.log('[Generated Document Image] Reused canonical generated asset', {
          imageOrdinal: currentImageOrdinal,
          storagePath: preferredBinding.source.storagePath,
        });
      } else {
        payload = await generateDocumentImage(
          block.prompt || need,
          signal,
          onImageCost,
          onActivity
        );

        if (assetSupabase) {
          const generatedBinding = await persistGeneratedDocumentImageBinding({
            supabase: assetSupabase,
            payload,
            imageOrdinal: currentImageOrdinal,
            seatId,
          });
          if (generatedBinding) {
            imageBindings.push(generatedBinding);
          }
        }
      }
    } else {
      let source: DocumentImageSource | null =
        preferredBinding?.source || null;
      if (!source && resourceContext) {
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
        payload = await editDocumentImage(
          block.prompt || need,
          signedUrl,
          signal,
          onImageCost,
          onActivity
        );
      }

      imageBindings.push({
        imageOrdinal: currentImageOrdinal,
        source: {
          filename: source.filename,
          storagePath: source.storagePath || null,
          artifactId: source.artifactId || null,
          sourceMessageId: source.sourceMessageId || null,
          attachmentIndex:
            typeof source.attachmentIndex === 'number'
              ? source.attachmentIndex
              : null,
          createdAt: source.createdAt || null,
          sender: source.sender || null,
        },
      });
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

  return { blocks: resolved, imageAssetCount, imageBindings };
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

function preserveDocxSemanticContent(
  originalBlocks: RichDocumentBlock[],
  revisedBlocks: RichDocumentBlock[]
): RichDocumentBlock[] | null {
  const originalContentBlocks = (originalBlocks || []).filter(
    (block: any) => block?.type !== 'page_break'
  );
  const revisedContentBlocks = (revisedBlocks || []).filter(
    (block: any) => block?.type !== 'page_break'
  );

  // Visual QA is a layout pass, not a rewriting pass. If the reviewer changes
  // the number/order/type of substantive blocks, reject the revision rather than
  // risk silently dropping or inventing document content.
  if (originalContentBlocks.length !== revisedContentBlocks.length) {
    return null;
  }

  for (let i = 0; i < originalContentBlocks.length; i += 1) {
    if (
      (originalContentBlocks[i] as any)?.type !==
      (revisedContentBlocks[i] as any)?.type
    ) {
      return null;
    }
  }

  let contentIndex = 0;
  return revisedBlocks.map((block: any) => {
    if (block?.type === 'page_break') return block;

    const original = originalContentBlocks[contentIndex++] as any;
    if (!original) return block;

    switch (block.type) {
      case 'heading':
      case 'paragraph':
        return {
          ...block,
          text: original.text,
        } as RichDocumentBlock;

      case 'bullets':
      case 'numbered':
        return {
          ...block,
          items: Array.isArray(original.items)
            ? [...original.items]
            : original.items,
        } as RichDocumentBlock;

      case 'table':
        return {
          ...block,
          headers: Array.isArray(original.headers)
            ? [...original.headers]
            : original.headers,
          rows: Array.isArray(original.rows)
            ? original.rows.map((row: any[]) =>
                Array.isArray(row) ? [...row] : row
              )
            : original.rows,
        } as RichDocumentBlock;

      case 'image':
        return {
          ...block,
          mode: original.mode,
          prompt: original.prompt,
          need: original.need,
          filename: original.filename,
          caption: original.caption,
        } as RichDocumentBlock;

      default:
        return block;
    }
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
        'This is a layout-only pass: preserve the number, order, and type of every substantive non-page-break block. You may add, remove, or move page_break blocks; adjust the design object; resize/reposition images; and adjust table width/column widths. Do not turn paragraphs into bullets, split/merge sections, reorder headings, or add/remove substantive blocks.',
        'Preserve all factual text and table content exactly. Do not rewrite, shorten, paraphrase, or expand the document during this pass; the server will preserve source text and reject structural content changes.',
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

  const contentSafeBlocks = preserveDocxSemanticContent(
    args.blocks || [],
    imageSafeBlocks
  );
  if (!contentSafeBlocks) {
    return {
      args,
      costUsd,
      applied: false,
      respondingModel,
      rationale:
        'Word visual review attempted to change substantive block structure, so the original specification was retained.',
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
    blocks: contentSafeBlocks,
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
    onActivity,
    reviewModel,
    reviewModels = reviewModel ? [reviewModel] : [],
    originalUserPrompt = '',
    reviewSessionId,
    revisionContext = null,
  } = options;

  const protectNarrowRevisionFromVisualMutation =
    revisionContext?.generationKind === 'revision' &&
    revisionContext?.preserveParentContent === true;

  if (!discussionId) {
    throw new Error('A discussion is required for document creation.');
  }
  if (!args || (args.format !== 'docx' && args.format !== 'pdf')) {
    throw new Error('Only DOCX and PDF generation are supported in this rollout.');
  }

  const serviceClient = createServiceClient();

  // A model-supplied page target is not a user requirement. For a fresh
  // document, trust targetPageCount only when the user actually asked for an
  // exact number of pages. Revisions/conversions may legitimately inherit a
  // canonical page target from the source document.
  const explicitPromptTarget = explicitlyRequestedPageCount(originalUserPrompt);
  const isFreshCreation =
    !revisionContext ||
    revisionContext.generationKind === 'create';
  if (
    isFreshCreation &&
    !explicitPromptTarget &&
    args.design &&
    typeof args.design.targetPageCount === 'number'
  ) {
    const { targetPageCount: _ignoredTargetPageCount, ...restDesign } = args.design;
    args.design = restDesign;
    console.log('[Document Layout] Ignored model-invented page target', {
      format: args.format,
      filename: args.filename,
    });
  }

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

  const parentImageBindings = revisionContext?.parentSnapshot
    ? reusableParentImageBindings(
        revisionContext.parentSnapshot,
        args.blocks || []
      )
    : [];

  const resolvedDocument = useDirectDocxToPdf
    ? {
        blocks: [] as RichDocumentBlock[],
        imageAssetCount: 0,
        imageBindings: [] as DocumentStateImageBinding[],
      }
    : await resolveDocumentBlocks(
        args.blocks || [],
        serviceClient,
        availableImages,
        resourceContext,
        signal,
        costAwareCallback,
        parentImageBindings,
        onActivity,
        supabase,
        seatId
      );

  const finalDocumentActivity: DocumentCreationActivity =
    revisionContext?.generationKind === 'revision'
      ? args.format === 'pdf'
        ? 'editing_pdf'
        : args.format === 'docx'
          ? 'editing_word'
          : 'editing_file'
      : args.format === 'pdf'
        ? 'generating_pdf'
        : args.format === 'docx'
          ? 'generating_word'
          : 'generating_file';

  onActivity?.(finalDocumentActivity);

  let finalBuffer: Buffer;
  let finalFilename: string;
  let renderedFullText: string;
  let generatedPdfPageCount: number | null = null;
  let finalImageAssetCount = resolvedDocument.imageAssetCount;
  let finalImageBindings = resolvedDocument.imageBindings;
  let visualReviewCostUsd = 0;
  let visualReviewApplied = false;
  let finalDocxReviewPages: RenderedDocxPage[] = [];
  let finalPdfReviewPages: RenderedPdfReviewPage[] = [];
  let finalPageCount: number | null = null;
  let finalSpecForState: GptCreateFileArgs =
    sanitizeDocumentSpecForState(args) as GptCreateFileArgs;

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
    finalPageCount = generatedPdfPageCount;
    finalSpecForState = sanitizeDocumentSpecForState({
      ...args,
      filename: finalFilename,
    }) as GptCreateFileArgs;
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
      let selectedPdfArgs: GptCreateFileArgs = args;

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

          if (review.applied && !protectNarrowRevisionFromVisualMutation) {
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
              costAwareCallback,
              resolvedDocument.imageBindings,
              onActivity,
              supabase,
              seatId
            );

            const reviewedPdf = await renderSession.render({
              filename: review.args.filename,
              title: review.args.title,
              design: review.args.design,
              blocks: reviewedResolvedDocument.blocks,
            });

            selectedPdf = reviewedPdf;
            selectedPdfArgs = review.args;
            finalImageAssetCount = reviewedResolvedDocument.imageAssetCount;
            finalImageBindings = reviewedResolvedDocument.imageBindings;
            visualReviewApplied = true;

            console.log('[Generated PDF Visual Review] Final render:', {
              initialPageCount: initialPdf.totalPageCount,
              finalPageCount: reviewedPdf.totalPageCount,
              initialBytes: initialPdf.buffer.length,
              finalBytes: reviewedPdf.buffer.length,
            });
          }
          else if (review.applied && protectNarrowRevisionFromVisualMutation) {
            console.log(
              '[Generated PDF Visual Review] Ignored layout mutation for protected narrow revision',
              {
                parentSnapshotId:
                  revisionContext?.parentSnapshot?.id || null,
                filename: args.filename,
                rationale: review.rationale,
              }
            );
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
      finalPdfReviewPages = selectedPdf.reviewPages;
      finalPageCount = generatedPdfPageCount;
      finalSpecForState = sanitizeDocumentSpecForState({
        ...selectedPdfArgs,
        filename: finalFilename,
      }) as GptCreateFileArgs;

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
    let selectedArgsForState: GptCreateFileArgs = initialArgs;
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

        if (review.applied && !protectNarrowRevisionFromVisualMutation) {
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
            costAwareCallback,
            [],
            onActivity,
            supabase,
            seatId
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
            selectedArgsForState = review.args;
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

        if (review.applied && protectNarrowRevisionFromVisualMutation) {
          console.log(
            '[Generated DOCX Visual Review] Ignored layout mutation for protected narrow revision',
            {
              parentSnapshotId:
                revisionContext?.parentSnapshot?.id || null,
              filename: initialArgs.filename,
              rationale: review.rationale,
            }
          );
        }

        // If the model improved the layout but the file is still one page over an
        // explicit target, make one deterministic compacting attempt and keep it
        // only when it is objectively closer to the requested page count.
        if (
          !protectNarrowRevisionFromVisualMutation &&
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

          const selectedMissingBeforeCompact = selectedRenderedText
            ? missingRenderedTableValues(
                selectedResolvedBlocks,
                selectedRenderedText
              ).length
            : Number.POSITIVE_INFINITY;
          const compactMissingTableValues = missingRenderedTableValues(
            compactBlocks,
            compactPages.renderedText
          );

          if (
            compactMissingTableValues.length <=
              selectedMissingBeforeCompact &&
            pageCountDistance(compactPages.totalPageCount, target) <
              pageCountDistance(selectedPageCount, target)
          ) {
            selectedDocument = compactDocument;
            selectedResolvedBlocks = compactBlocks;
            selectedArgsForState = {
              ...compactArgs,
              blocks: compactBlocks,
            };
            selectedPageCount = compactPages.totalPageCount;
            selectedRenderedText = compactPages.renderedText;
            finalDocxReviewPages = compactPages.pages;
            visualReviewApplied = true;
          }

          console.log('[Generated DOCX Page Fit]', {
            targetPageCount: target,
            compactPageCount: compactPages.totalPageCount,
            compactMissingTableValueCount:
              compactMissingTableValues.length,
            selectedPageCount,
          });
        }

        if (
          !protectNarrowRevisionFromVisualMutation &&
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

          const selectedMissingBeforeSpread = selectedRenderedText
            ? missingRenderedTableValues(
                selectedResolvedBlocks,
                selectedRenderedText
              ).length
            : Number.POSITIVE_INFINITY;
          const spreadMissingTableValues = missingRenderedTableValues(
            spreadBlocks,
            spreadPages.renderedText
          );

          if (
            spreadMissingTableValues.length <= selectedMissingBeforeSpread &&
            pageCountDistance(spreadPages.totalPageCount, target) <
              pageCountDistance(selectedPageCount, target)
          ) {
            selectedDocument = spreadDocument;
            selectedResolvedBlocks = spreadBlocks;
            selectedArgsForState = {
              ...spreadArgs,
              blocks: spreadBlocks,
            };
            selectedPageCount = spreadPages.totalPageCount;
            selectedRenderedText = spreadPages.renderedText;
            finalDocxReviewPages = spreadPages.pages;
            visualReviewApplied = true;
          }

          console.log('[Generated DOCX Page Spread]', {
            targetPageCount: target,
            spreadPageCount: spreadPages.totalPageCount,
            spreadMissingTableValueCount:
              spreadMissingTableValues.length,
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

    let finalMissingTableValues = selectedRenderedText
      ? missingRenderedTableValues(selectedResolvedBlocks, selectedRenderedText)
      : [];

    if (
      finalMissingTableValues.length > 0 &&
      !protectNarrowRevisionFromVisualMutation
    ) {
      const repairArgs = repairMissingDocxTableValues(
        {
          ...selectedArgsForState,
          blocks: selectedResolvedBlocks,
        },
        finalMissingTableValues
      );

      if (repairArgs !== selectedArgsForState) {
        const repairedDocument = renderDocx({
          filename: repairArgs.filename,
          title: repairArgs.title,
          design: repairArgs.design,
          blocks: repairArgs.blocks as DocxBlock[],
        });
        const repairedPages = await renderDocxPages(repairedDocument.buffer, {
          signal,
          timeoutMs: 45_000,
        });
        const repairedMissingTableValues = missingRenderedTableValues(
          repairArgs.blocks || [],
          repairedPages.renderedText
        );

        console.log('[Generated DOCX Table Repair]', {
          beforeMissingTableValueCount: finalMissingTableValues.length,
          afterMissingTableValueCount: repairedMissingTableValues.length,
          repairedPageCount: repairedPages.totalPageCount,
          missingTableValues: repairedMissingTableValues.slice(0, 8),
        });

        if (
          repairedMissingTableValues.length < finalMissingTableValues.length
        ) {
          selectedDocument = repairedDocument;
          selectedResolvedBlocks = repairArgs.blocks || [];
          selectedArgsForState = repairArgs;
          selectedPageCount = repairedPages.totalPageCount;
          selectedRenderedText = repairedPages.renderedText;
          finalDocxReviewPages = repairedPages.pages;
          finalMissingTableValues = repairedMissingTableValues;
          visualReviewApplied = true;
        }
      }
    }

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
    finalPageCount = selectedPageCount;
    finalSpecForState = sanitizeDocumentSpecForState({
      ...selectedArgsForState,
      filename: finalFilename,
      blocks: selectedResolvedBlocks,
    }) as GptCreateFileArgs;

    console.log('[Generated DOCX] Final render:', {
      filename: finalFilename,
      byteSize: finalBuffer.length,
      pageCount: selectedPageCount,
      targetPageCount: target,
      visualReviewApplied,
      visualReviewCostUsd,
    });
  }

  if (
    revisionContext?.preserveParentContent &&
    revisionContext.parentSnapshot?.pageCount &&
    finalPageCount &&
    finalPageCount !== revisionContext.parentSnapshot.pageCount
  ) {
    console.error('[Document Revision] Refusing page-count regression', {
      parentSnapshotId: revisionContext.parentSnapshot.id,
      filename: finalFilename,
      parentPageCount: revisionContext.parentSnapshot.pageCount,
      nextPageCount: finalPageCount,
    });
    throw new Error(
      `Narrow document revision changed the page count from ${revisionContext.parentSnapshot.pageCount} to ${finalPageCount}, which the user did not request.`
    );
  }

  if (
    revisionContext?.preserveParentContent &&
    revisionContext.parentSnapshot?.spec
  ) {
    const missingParentContent = missingPreservedDocumentContent(
      revisionContext.parentSnapshot.spec,
      finalSpecForState
    );
    if (missingParentContent.length > 0) {
      console.error('[Document Revision] Refusing content regression', {
        parentSnapshotId: revisionContext.parentSnapshot.id,
        filename: finalFilename,
        missingCount: missingParentContent.length,
        missing: missingParentContent.slice(0, 12),
      });
      throw new Error(
        `Document revision would remove ${missingParentContent.length} existing content value(s) that the user did not ask to remove.`
      );
    }
  }

  let validatedPdfEmbeddedImages:
    | Awaited<ReturnType<typeof extractPdfEmbeddedImages>>
    | null = null;

  if (args.format === 'pdf' && finalImageAssetCount > 0) {
    validatedPdfEmbeddedImages = await extractPdfEmbeddedImages(finalBuffer, {
      signal: durableSignal,
      timeoutMs: 30_000,
    });

    if (validatedPdfEmbeddedImages.length < finalImageAssetCount) {
      console.error('[Generated PDF] Embedded image validation failed', {
        filename: finalFilename,
        expectedImageCount: finalImageAssetCount,
        extractedImageCount: validatedPdfEmbeddedImages.length,
        revision:
          revisionContext?.generationKind === 'revision',
      });
      throw new Error(
        `Generated PDF lost an embedded image during rendering (expected ${finalImageAssetCount}, found ${validatedPdfEmbeddedImages.length}).`
      );
    }
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
  if (args.format === 'pdf' && finalPdfReviewPages.length > 0) {
    try {
      const persistedPages = await persistPdfRenderedPages({
        supabase,
        parentFilename: persistedDocument.filename,
        parentFileBytes: finalBuffer,
        pages: finalPdfReviewPages,
      });
      renderedPageAttachments = persistedPages.map((page) => ({
        url: page.signedUrl,
        filename: page.filename,
      }));
      console.log('[Generated PDF Visual Handoff Cache]', {
        filename: persistedDocument.filename,
        pageCount: renderedPageAttachments.length,
      });
    } catch (pagePersistErr) {
      console.warn(
        '[Generated PDF Visual Handoff Cache] Non-critical page persistence error:',
        pagePersistErr
      );
    }
  } else if (args.format === 'docx' && finalDocxReviewPages.length > 0) {
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

  // Make raster images embedded inside GPT-generated PDFs durable reusable assets too.
  // This mirrors the DOCX path so later turns can reuse/edit an illustration that
  // existed only inside a generated PDF.
  if (args.format === 'pdf' && finalImageAssetCount > 0) {
    try {
      const extractedPdfImages =
        validatedPdfEmbeddedImages ||
        (await extractPdfEmbeddedImages(finalBuffer, {
          signal: durableSignal,
          timeoutMs: 30_000,
        }));
      if (extractedPdfImages.length > 0) {
        const persistedPdfImages = await persistPdfEmbeddedImages({
          supabase,
          parentFilename: persistedDocument.filename,
          parentFileBytes: finalBuffer,
          images: extractedPdfImages,
        });

        if (persistedPdfImages.length > 0) {
          const artifactResult = await ingestDiscussionArtifacts({
            serviceSupabase: serviceClient,
            discussionId,
            attachments: persistedPdfImages.map((image) => ({
              url: image.signedUrl,
              filename: image.filename,
            })),
            sourceUserMessageId: persistedMsg.id,
            signal: durableSignal,
          });

          console.log('[Generated PDF Embedded Images]', {
            discussionId,
            filename: persistedDocument.filename,
            extractedCount: extractedPdfImages.length,
            persistedCount: persistedPdfImages.length,
            indexedCount: artifactResult.ingestedCount,
            errorCount: artifactResult.errors.length,
          });
        }
      }
    } catch (pdfImageErr) {
      console.warn(
        '[Generated PDF Embedded Images] Non-critical extraction/indexing error:',
        pdfImageErr
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

  let indexedDocumentId: string | null = null;
  let documentStateId: string | null = null;

  try {
    const { data: indexedDocument, error: indexedDocumentError } =
      await serviceClient
        .from('discussion_documents')
        .select('id')
        .eq('discussion_id', discussionId)
        .eq('storage_path', persistedDocument.storagePath)
        .maybeSingle();

    if (!indexedDocumentError && indexedDocument?.id) {
      indexedDocumentId = indexedDocument.id;
    }

    const state = await persistDocumentStateSnapshot({
      serviceSupabase: serviceClient,
      discussionId,
      documentId: indexedDocumentId,
      filename: persistedDocument.filename,
      storagePath: persistedDocument.storagePath,
      messageId: persistedMsg.id,
      format: args.format,
      spec: finalSpecForState,
      fullText: renderedFullText,
      pageCount: finalPageCount,
      parentSnapshotId: revisionContext?.parentSnapshot?.id || null,
      parentDocumentId:
        revisionContext?.parentSnapshot?.documentId || null,
      parentStoragePath:
        revisionContext?.parentSnapshot?.storagePath || null,
      sourceDocumentIds: revisionContext?.sourceDocumentIds || [],
      imageSources: availableImages,
      imageBindings: finalImageBindings,
      generationKind:
        revisionContext?.generationKind ||
        (sourceDocx ? 'convert' : 'create'),
    });
    documentStateId = state?.id || null;
  } catch (stateErr) {
    console.warn(
      '[Document State] Non-critical snapshot persistence error:',
      stateErr
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
    documentId: indexedDocumentId,
    documentStateId,
    pageCount: finalPageCount,
  };
}
