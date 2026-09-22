import { ModelId } from '@/types/chat';
import { createServiceClient } from '@/utils/supabase/service';
import { ingestParsedDocument } from '@/utils/discussionMemory';
import { persistGeneratedDocument } from '@/utils/generatedDocumentStorage';
import { renderDocx } from '@/utils/docxWriter';
import type { DocxBlock, StructuredDocxInput } from '@/utils/docxWriter';
import {
  renderRichPdf,
  type PdfDesign,
  type RichDocumentBlock,
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

export interface ClaudeCreateFileArgs extends Omit<StructuredDocxInput, 'blocks'> {
  format: 'docx' | 'pdf';
  design?: PdfDesign;
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
export interface ExecuteClaudeDocumentCreationOptions {
  supabase: any;
  openai: any;
  discussionId: string;
  messageId: string;
  seatId: ModelId;
  args: ClaudeCreateFileArgs;
  signal?: AbortSignal;
  availableImages?: DocumentImageSource[];
  resourceContext?: ResourceBrokerContext;
  onImageCost?: (event: DocumentImageCostEvent) => void;
}

export interface ExecuteClaudeDocumentCreationResult {
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
}

const MAX_DOCUMENT_IMAGES = 12;
const MAX_DOCUMENT_IMAGE_BYTES = 15 * 1024 * 1024;

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
  const tokens = `${need} ${filename || ''}`.toLowerCase().match(/[a-z0-9]{3,}/g) || [];
  let score = 0;
  for (const token of tokens) if (sourceName.includes(token)) score += 20;
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
        throw new Error(`Could not uniquely resolve the image requested for the Word document: ${need}`);
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
export async function executeClaudeDocumentCreation(
  options: ExecuteClaudeDocumentCreationOptions
): Promise<ExecuteClaudeDocumentCreationResult> {
  const {
    supabase,
    openai,
    discussionId,
    messageId,
    seatId,
    args,
    signal,
    availableImages = [],
    resourceContext,
    onImageCost,
  } = options;

  if (seatId !== 'claude') {
    throw new Error('Only Claude can create downloadable documents in this rollout.');
  }
  if (!discussionId) {
    throw new Error('A discussion is required for document creation.');
  }
  if (!args || (args.format !== 'docx' && args.format !== 'pdf')) {
    throw new Error('Only DOCX and PDF generation are supported in this rollout.');
  }

  const serviceClient = createServiceClient();
  let imageCostUsd = 0;
  const costAwareCallback = (event: DocumentImageCostEvent) => {
    imageCostUsd += event.costUsd;
    onImageCost?.(event);
  };
  const resolvedDocument = await resolveDocumentBlocks(
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

  if (args.format === 'pdf') {
    const renderedPdf = await renderRichPdf(
      {
        filename: args.filename,
        title: args.title,
        design: args.design,
        blocks: resolvedDocument.blocks,
      },
      {
        signal,
        timeoutMs: 70_000,
      }
    );

    finalBuffer = renderedPdf.buffer;
    finalFilename = renderedPdf.filename;
    renderedFullText = renderedPdf.fullText;
    generatedPdfPageCount = renderedPdf.totalPageCount;

    console.log('[Generated PDF] Rendered rich PDF:', {
      filename: finalFilename,
      byteSize: finalBuffer.length,
      pageCount: generatedPdfPageCount,
      usedSnapshot: renderedPdf.usedSnapshot,
      elapsedMs: renderedPdf.elapsedMs,
    });
  } else {
    const renderedDocument = renderDocx({
      filename: args.filename,
      title: args.title,
      blocks: resolvedDocument.blocks as DocxBlock[],
    });
    finalBuffer = renderedDocument.buffer;
    finalFilename = renderedDocument.filename;
    renderedFullText = renderedDocument.fullText;
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

      if (
        !fetchErr &&
        existing &&
        existing.id === messageId &&
        existing.discussion_id === discussionId &&
        existing.sender === seatId &&
        existing.content === finalContent
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
    throw new Error('Failed to persist Claude document response.');
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
      signal,
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
    imageAssetCount: resolvedDocument.imageAssetCount,
    imageCostUsd,
  };
}
