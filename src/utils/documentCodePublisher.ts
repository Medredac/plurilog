import type { ModelId } from '@/types/chat';
import type { DocumentCodeDraft } from './documentCodeSandbox';
import type { ExecuteGptDocumentCreationResult } from './gptDocumentCreation';
import { persistGeneratedDocument } from './generatedDocumentStorage';
import { persistDocxRenderedPages } from './docxRenderedPages';
import { persistPdfRenderedPages } from './pdfRenderedPages';
import { ingestParsedDocument, ingestDiscussionArtifacts } from './discussionMemory';
import { findDocumentStateSnapshot, persistDocumentStateSnapshot } from './documentRevisionState';
import { parseDocx } from './docxParser';
import { persistDocxEmbeddedImages } from './docxVisualAssets';
import { extractPdfEmbeddedImages, persistPdfEmbeddedImages } from './pdfEmbeddedImages';

/** Uses the same message, storage, retrieval and revision-state contracts as the production engine. */
export async function publishCodeDocument(options: {
  supabase: any; service: any; openai: any; discussionId: string; messageId: string; seatId: ModelId;
  draft: DocumentCodeDraft; review: unknown[]; limitations: string[]; signal: AbortSignal;
  sources: Array<{ filename: string; storagePath: string }>;
}): Promise<ExecuteGptDocumentCreationResult> {
  const { supabase, service, openai, discussionId, messageId, seatId, draft, signal } = options;
  signal.throwIfAborted();
  const row = await supabase.from('messages').upsert({ id: messageId, discussion_id: discussionId, sender: seatId, content: '' }, { onConflict: 'id', ignoreDuplicates: true });
  if (row.error) throw new Error('Could not save document message.');
  const saved = await persistGeneratedDocument({ supabase, discussionId, messageId, seatId, fileBuffer: draft.buffer, filename: draft.args.filename, format: draft.args.format });
  let renderedPageAttachments: Array<{ url: string; filename: string }> = [];
  let documentId: string | null = null;
  let documentStateId: string | null = null;
  let imageAssetCount = 0;
  // The final document is already durable. Auxiliary indexing failure must not trigger another generation.
  try {
    const persist = draft.args.format === 'docx' ? persistDocxRenderedPages : persistPdfRenderedPages;
    const pages = await persist({ supabase, parentFilename: saved.filename, parentFileBytes: draft.buffer, pages: draft.pages });
    renderedPageAttachments = pages.map(page => ({ url: page.signedUrl, filename: page.filename }));
  } catch (error) { console.warn('[Document Code] Page cache deferred', error); }
  try {
    const images = draft.args.format === 'docx'
      ? await persistDocxEmbeddedImages({ supabase, parentFilename: saved.filename, parentFileBytes: draft.buffer, images: (await parseDocx(draft.buffer)).embeddedImages })
      : draft.report.image_count > 0 ? await persistPdfEmbeddedImages({ supabase, parentFilename: saved.filename, parentFileBytes: draft.buffer, images: await extractPdfEmbeddedImages(draft.buffer, { signal, timeoutMs: 30_000 }) }) : [];
    imageAssetCount = images.length;
    if (images.length) await ingestDiscussionArtifacts({ serviceSupabase: service, discussionId, sourceUserMessageId: messageId, attachments: images.map(image => ({ url: image.signedUrl, filename: image.filename })), signal });
  } catch (error) { console.warn('[Document Code] Embedded image indexing deferred', error); }
  try {
    await ingestParsedDocument({ serviceSupabase: service, openai, discussionId, filename: saved.filename, fullText: draft.fullText, fileBytes: draft.buffer, storagePath: saved.storagePath, signal });
    const { data } = await service.from('discussion_documents').select('id').eq('discussion_id', discussionId).eq('storage_path', saved.storagePath).maybeSingle();
    documentId = data?.id || null;
  } catch (error) { console.warn('[Document Code] Text indexing deferred', error); }
  try {
    const parentSource = options.sources.find(source => /\.(docx|pdf)$/i.test(source.filename));
    const parent = parentSource ? await findDocumentStateSnapshot({ serviceSupabase: service, discussionId, storagePath: parentSource.storagePath }) : null;
    const state = await persistDocumentStateSnapshot({ serviceSupabase: service, discussionId, documentId,
      filename: saved.filename, storagePath: saved.storagePath, messageId, format: draft.args.format,
      spec: { engine: 'document-code-v1', ...draft.args, review: options.review, limitations: options.limitations,
        // Retain normal text blocks for existing retrieval; code revisions operate on the original file.
        blocks: [{ type: 'paragraph', text: draft.fullText }] },
      fullText: draft.fullText, pageCount: draft.pages.length,
      parentSnapshotId: parent?.id || null, parentDocumentId: parent?.documentId || null,
      parentStoragePath: parentSource?.storagePath || null,
      sourceDocumentIds: parent?.documentId ? [parent.documentId] : [], imageSources: options.sources.filter(s => !/\.(docx|pdf)$/i.test(s.filename)), imageBindings: [],
      generationKind: parentSource ? 'revision' : 'create',
    });
    documentStateId = state?.id || null;
  } catch (error) { console.warn('[Document Code] Revision state deferred', error); }
  return { ...saved, format: draft.args.format, messageId, createdAt: new Date().toISOString(),
    finalContent: `Created ${saved.filename}.${options.limitations.length ? ' Limitations: ' + options.limitations.join('; ') : ''}`,
    fullText: draft.fullText, imageAssetCount, imageCostUsd: 0, visualReviewCostUsd: 0, visualReviewApplied: true,
    renderedPageAttachments, documentId, documentStateId, pageCount: draft.pages.length };
}
