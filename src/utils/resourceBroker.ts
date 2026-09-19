/**
 * Resource Broker / Evidence Broker
 *
 * Isolated, read-only façade over Plurilog's existing resource resolvers.
 * Answers: "What canonical resource does this evidence request refer to, using existing systems?"
 *
 * Purely additive utility:
 * - Zero DB writes
 * - Zero state mutation
 * - Zero memory creation
 * - Zero model invocations
 */

import {
  KnownDiscussionDocument,
  RetrievedDocumentExcerpt,
  Round,
  KnownImageSource,
  MessageVisualEvidenceItem,
  DiscussionVisualContextState,
  ResolvedVisualDocument,
  ResolvedImageEvidenceResult,
  resolveVisualDocument,
  resolveImageEvidence,
} from '@/utils/discussionMemory';

export type ResourceModality = 'visual' | 'text';
export type RequestedResourceType = 'auto' | 'image' | 'document';

export type ResourceBrokerStatus =
  | 'resolved'
  | 'ambiguous'
  | 'not_found'
  | 'unsupported';

export type ResourceBrokerKind =
  | 'image'
  | 'pdf'
  | 'document_text';

export interface ResourceBrokerRequest {
  modality: ResourceModality;
  resource_type?: RequestedResourceType;
  need: string;
  filename?: string;
}

export interface ResourceBrokerContext {
  // Document context
  knownDocuments?: KnownDiscussionDocument[];
  retrievedDocuments?: RetrievedDocumentExcerpt[];
  recentRounds?: Round[];

  // Image context
  knownImageSources?: KnownImageSource[];
  lastRoundEvidence?: MessageVisualEvidenceItem[];
  recentEvidenceSets?: MessageVisualEvidenceItem[][];
  visualContext?: DiscussionVisualContextState | null;
  previousUserPrompt?: string;
  allUserMessageIds?: string[];
}

export interface ModelSafeCandidate {
  label: string;
  filename?: string;
  kind: ResourceBrokerKind;
}

export interface InternalResolvedEvidence {
  kind: ResourceBrokerKind;
  filename: string;
  storagePath?: string;
  documentId?: string;
  sourceIds?: string[];
  sources?: KnownImageSource[];
  textContent?: string;
  reason?: string;
}

/**
 * Full internal result returned by the broker for server-side route orchestration.
 * Contains canonical identifiers, storage paths, and source arrays needed for execution.
 */
export interface InternalBrokerResult {
  status: ResourceBrokerStatus;
  kind?: ResourceBrokerKind;
  message: string;
  evidence?: InternalResolvedEvidence;
  candidates?: ModelSafeCandidate[];
}

/**
 * Model-safe result intended for tool-call response serialization.
 * Strictly excludes storage paths, database UUIDs, source IDs, signed URLs, or raw source structures.
 */
export interface ModelSafeBrokerResult {
  status: ResourceBrokerStatus;
  kind?: ResourceBrokerKind;
  message: string;
  filename?: string;
  candidates?: ModelSafeCandidate[];
}

/**
 * Explicit conversion boundary transforming an internal broker result into a safe model response.
 * Guarantees zero internal storage paths or private database IDs can leak to the model context.
 */
export function toModelSafeBrokerResult(
  internal: InternalBrokerResult
): ModelSafeBrokerResult {
  const safe: ModelSafeBrokerResult = {
    status: internal.status,
    kind: internal.kind,
    message: internal.message,
  };

  if (internal.status === 'resolved' && internal.evidence?.filename) {
    safe.filename = internal.evidence.filename;
  }

  if (Array.isArray(internal.candidates) && internal.candidates.length > 0) {
    safe.candidates = internal.candidates.map((c) => ({
      label: c.label,
      filename: c.filename,
      kind: c.kind,
    }));
  }

  return safe;
}

function isPdf(filenameOrPath?: string | null): boolean {
  if (!filenameOrPath) return false;
  const clean = filenameOrPath.split('?')[0].split('#')[0].toLowerCase();
  return clean.endsWith('.pdf');
}

function isDocxOrText(filenameOrPath?: string | null): boolean {
  if (!filenameOrPath) return false;
  const clean = filenameOrPath.split('?')[0].split('#')[0].toLowerCase();
  return (
    clean.endsWith('.docx') ||
    clean.endsWith('.txt') ||
    clean.endsWith('.md') ||
    clean.endsWith('.csv') ||
    clean.endsWith('.json')
  );
}

/**
 * Checks whether a PDF resolution was based on strong contextual signals
 * (explicit filename, retrieved chunk match, or recent round attachment)
 * rather than a generic discussion-wide singleton fallback.
 */
function isStrongPdfResolution(
  resolvedDoc: ResolvedVisualDocument,
  searchPrompt: string,
  context: ResourceBrokerContext
): boolean {
  const pLower = searchPrompt.toLowerCase();
  const fn = resolvedDoc.filename.toLowerCase();
  const base = fn.replace(/\.pdf$/i, '');
  const hasFilenameMatch =
    pLower.includes(fn) || (base.length >= 4 && pLower.includes(base));
  if (hasFilenameMatch) return true;

  if (
    Array.isArray(context.retrievedDocuments) &&
    context.retrievedDocuments.some((d) => d.documentId === resolvedDoc.documentId)
  ) {
    return true;
  }

  if (
    Array.isArray(context.recentRounds) &&
    context.recentRounds.some((r) =>
      r.attachments?.some(
        (a) =>
          a.filename?.toLowerCase() === fn ||
          a.storagePath === resolvedDoc.storagePath
      )
    )
  ) {
    return true;
  }

  return false;
}

/**
 * Checks whether an image resolution was based on strong contextual signals
 * (filename, explicit ordinal, subset, generated reference, active referent recovery)
 * rather than a generic singleton fallback.
 */
function isStrongImageResolution(
  resolvedImg: ResolvedImageEvidenceResult
): boolean {
  const strongReasons = new Set([
    'exact_filename',
    'multiple_exact_filenames',
    'unique_filename_shorthand',
    'multiple_filename_shorthands',
    'comparative_subset',
    'recent_ordinal',
    'scoped_ordinal',
    'discussion_ordinal',
    'ordinal_scope_inheritance',
    'active_referent_recovery',
    'comparative_contextual_set',
    'generated_artifact_sender_reference',
    'generated_artifact_recent',
  ]);
  return strongReasons.has(resolvedImg.reason);
}

/**
 * Resolves document text evidence from pre-retrieved excerpts.
 */
function resolveDocumentText(
  searchPrompt: string,
  explicitFilename: string,
  context: ResourceBrokerContext
): InternalBrokerResult {
  if (
    Array.isArray(context.retrievedDocuments) &&
    context.retrievedDocuments.length > 0
  ) {
    let matchingExcerpts = context.retrievedDocuments;
    if (explicitFilename) {
      const normFn = explicitFilename.toLowerCase();
      matchingExcerpts = context.retrievedDocuments.filter((d) =>
        d.filename.toLowerCase().includes(normFn)
      );
    }

    if (matchingExcerpts.length > 0) {
      const combinedText = matchingExcerpts
        .map((d) => `[${d.filename}]\n${d.content}`)
        .join('\n\n---\n\n');

      return {
        status: 'resolved',
        kind: 'document_text',
        message: `Resolved text excerpts for ${matchingExcerpts[0].filename}.`,
        evidence: {
          kind: 'document_text',
          filename: matchingExcerpts[0].filename,
          documentId: matchingExcerpts[0].documentId,
          textContent: combinedText,
          reason: 'retrieved_document_excerpts',
        },
      };
    }
  }

  if (
    Array.isArray(context.knownDocuments) &&
    context.knownDocuments.length > 0
  ) {
    if (explicitFilename) {
      const normFn = explicitFilename.toLowerCase();
      const docMatch = context.knownDocuments.find(
        (d) => d.filename && d.filename.toLowerCase().includes(normFn)
      );
      if (docMatch) {
        return {
          status: 'not_found',
          kind: 'document_text',
          message: `Document "${docMatch.filename}" is known, but no relevant text excerpts were retrieved for this turn.`,
        };
      }
    }
  }

  return {
    status: 'not_found',
    kind: 'document_text',
    message: 'No relevant document text excerpts were found.',
  };
}

/**
 * Resolves visual PDF evidence using existing resolveVisualDocument().
 */
function resolvePdfVisual(
  searchPrompt: string,
  context: ResourceBrokerContext
): { resolved: ResolvedVisualDocument | null; isStrong: boolean } {
  const resolvedDoc = resolveVisualDocument(
    searchPrompt,
    context.knownDocuments,
    context.retrievedDocuments,
    context.recentRounds
  );

  if (!resolvedDoc || !resolvedDoc.storagePath) {
    return { resolved: null, isStrong: false };
  }

  const isStrong = isStrongPdfResolution(resolvedDoc, searchPrompt, context);
  return { resolved: resolvedDoc, isStrong };
}

/**
 * Resolves image evidence using existing resolveImageEvidence().
 */
function resolveImageVisual(
  searchPrompt: string,
  context: ResourceBrokerContext
): { resolved: ResolvedImageEvidenceResult | null; isStrong: boolean } {
  const resolvedImg = resolveImageEvidence({
    prompt: searchPrompt,
    knownSources: context.knownImageSources || [],
    lastRoundEvidence: context.lastRoundEvidence || [],
    recentEvidenceSets: context.recentEvidenceSets,
    visualContext: context.visualContext,
    previousUserPrompt: context.previousUserPrompt,
    allUserMessageIds: context.allUserMessageIds,
  });

  if (!resolvedImg || !Array.isArray(resolvedImg.sources) || resolvedImg.sources.length === 0) {
    return { resolved: null, isStrong: false };
  }

  const isStrong = isStrongImageResolution(resolvedImg);
  return { resolved: resolvedImg, isStrong };
}

/**
 * Normalizes and resolves a resource request against existing discussion context.
 */
export function resolveRequestedEvidence(
  request: ResourceBrokerRequest,
  context: ResourceBrokerContext
): InternalBrokerResult {
  const { modality, resource_type = 'auto', need, filename } = request;
  const effectiveNeed = (need || '').trim();
  const explicitFilename = (filename || '').trim();
  const searchPrompt = explicitFilename
    ? `${explicitFilename} ${effectiveNeed}`.trim()
    : effectiveNeed;

  // 1. Guard against visual requests on non-visual document formats (DOCX/TXT/MD)
  if (modality === 'visual') {
    if (explicitFilename && isDocxOrText(explicitFilename)) {
      return {
        status: 'unsupported',
        kind: 'document_text',
        message: `Visual inspection is not supported for ${explicitFilename}. Only PDF files and images support visual inspection.`,
      };
    }

    if (
      resource_type === 'document' &&
      Array.isArray(context.knownDocuments) &&
      context.knownDocuments.length > 0 &&
      context.knownDocuments.every((d) => isDocxOrText(d.filename || d.storagePath))
    ) {
      return {
        status: 'unsupported',
        kind: 'document_text',
        message:
          'Visual inspection is not supported for DOCX or plain text files in this discussion. Text extraction is available.',
      };
    }
  }

  // 2. Modality === 'text'
  if (modality === 'text') {
    if (resource_type === 'image') {
      return {
        status: 'unsupported',
        kind: 'image',
        message: 'Text extraction is not directly supported for standalone image artifacts.',
      };
    }
    return resolveDocumentText(searchPrompt, explicitFilename, context);
  }

  // 3. Modality === 'visual' with Explicit resource_type === 'document'
  if (resource_type === 'document') {
    const { resolved: resolvedDoc } = resolvePdfVisual(searchPrompt, context);
    if (resolvedDoc && resolvedDoc.storagePath) {
      return {
        status: 'resolved',
        kind: 'pdf',
        message: `Resolved visual PDF "${resolvedDoc.filename}".`,
        evidence: {
          kind: 'pdf',
          filename: resolvedDoc.filename,
          storagePath: resolvedDoc.storagePath,
          documentId: resolvedDoc.documentId || undefined,
          reason: 'resolved_visual_document',
        },
      };
    }

    const knownPdfs = (context.knownDocuments || []).filter((d) =>
      isPdf(d.filename || d.storagePath)
    );
    if (knownPdfs.length > 1) {
      return {
        status: 'ambiguous',
        kind: 'pdf',
        message: `Multiple PDF documents exist in this discussion (${knownPdfs.length} files). Please specify which document you need.`,
        candidates: knownPdfs.map((d) => ({
          label: d.filename || 'Untitled PDF',
          filename: d.filename,
          kind: 'pdf',
        })),
      };
    }

    return {
      status: 'not_found',
      kind: 'pdf',
      message: 'No PDF documents were found in this discussion.',
    };
  }

  // 4. Modality === 'visual' with Explicit resource_type === 'image'
  if (resource_type === 'image') {
    const { resolved: resolvedImg } = resolveImageVisual(searchPrompt, context);
    if (resolvedImg && resolvedImg.sources.length > 0) {
      const primarySource = resolvedImg.sources[0];
      return {
        status: 'resolved',
        kind: 'image',
        message: `Resolved ${resolvedImg.sources.length} image source(s) (${resolvedImg.reason}).`,
        evidence: {
          kind: 'image',
          filename: primarySource.filename || 'image.png',
          storagePath: primarySource.storagePath,
          sourceIds: resolvedImg.sources.map((s) => s.sourceId),
          sources: resolvedImg.sources,
          reason: resolvedImg.reason,
        },
      };
    }

    const knownImgs = context.knownImageSources || [];
    if (knownImgs.length > 1) {
      return {
        status: 'ambiguous',
        kind: 'image',
        message: `Multiple images exist in this discussion (${knownImgs.length} images). Please specify which image you need.`,
        candidates: knownImgs.slice(0, 5).map((s, idx) => ({
          label: s.filename || `Image ${idx + 1}`,
          filename: s.filename,
          kind: 'image',
        })),
      };
    }

    return {
      status: 'not_found',
      kind: 'image',
      message: 'No images were found in this discussion.',
    };
  }

  // 5. Modality === 'visual' with resource_type === 'auto'
  // Evaluate both PDF and Image resolvers independently and reconcile safely
  const knownPdfs = (context.knownDocuments || []).filter((d) => isPdf(d.filename || d.storagePath));
  const knownImgs = context.knownImageSources || [];

  const { resolved: pdfMatch, isStrong: isPdfStrong } = resolvePdfVisual(searchPrompt, context);
  const { resolved: imgMatch, isStrong: isImgStrong } = resolveImageVisual(searchPrompt, context);

  // Case 5a: If one is strong and the other is not -> the strong one wins deterministically
  if (isPdfStrong && !isImgStrong) {
    return {
      status: 'resolved',
      kind: 'pdf',
      message: `Resolved visual PDF "${pdfMatch!.filename}".`,
      evidence: {
        kind: 'pdf',
        filename: pdfMatch!.filename,
        storagePath: pdfMatch!.storagePath,
        documentId: pdfMatch!.documentId || undefined,
        reason: 'resolved_visual_document_contextual',
      },
    };
  }

  if (isImgStrong && !isPdfStrong) {
    const primarySource = imgMatch!.sources[0];
    return {
      status: 'resolved',
      kind: 'image',
      message: `Resolved ${imgMatch!.sources.length} image source(s) (${imgMatch!.reason}).`,
      evidence: {
        kind: 'image',
        filename: primarySource.filename || 'image.png',
        storagePath: primarySource.storagePath,
        sourceIds: imgMatch!.sources.map((s) => s.sourceId),
        sources: imgMatch!.sources,
        reason: imgMatch!.reason,
      },
    };
  }

  // Case 5b: If BOTH are strong -> Ambiguous (prompt matches both a PDF and an Image)
  if (isPdfStrong && isImgStrong) {
    const candidates: ModelSafeCandidate[] = [
      {
        label: pdfMatch!.filename || 'PDF Document',
        filename: pdfMatch!.filename,
        kind: 'pdf',
      },
      ...imgMatch!.sources.slice(0, 3).map((s, idx) => ({
        label: s.filename || `Image ${idx + 1}`,
        filename: s.filename,
        kind: 'image' as const,
      })),
    ];

    return {
      status: 'ambiguous',
      message: 'Multiple visual resources match this request (PDF and image). Please specify which resource you need.',
      candidates,
    };
  }

  // Case 5c: If NEITHER is strong:
  // If the discussion ONLY contains PDFs (and no images) -> singleton PDF resolution is valid
  if (pdfMatch && knownImgs.length === 0) {
    return {
      status: 'resolved',
      kind: 'pdf',
      message: `Resolved visual PDF "${pdfMatch.filename}".`,
      evidence: {
        kind: 'pdf',
        filename: pdfMatch.filename,
        storagePath: pdfMatch.storagePath,
        documentId: pdfMatch.documentId || undefined,
        reason: 'resolved_visual_document_singleton',
      },
    };
  }

  // If the discussion ONLY contains Images (and no PDFs) -> image resolution is valid
  if (imgMatch && knownPdfs.length === 0) {
    const primarySource = imgMatch.sources[0];
    return {
      status: 'resolved',
      kind: 'image',
      message: `Resolved ${imgMatch.sources.length} image source(s) (${imgMatch.reason}).`,
      evidence: {
        kind: 'image',
        filename: primarySource.filename || 'image.png',
        storagePath: primarySource.storagePath,
        sourceIds: imgMatch.sources.map((s) => s.sourceId),
        sources: imgMatch.sources,
        reason: imgMatch.reason,
      },
    };
  }

  // If both PDFs and Images exist in discussion, but neither is strongly identified -> Ambiguous!
  if (knownPdfs.length > 0 && knownImgs.length > 0) {
    const candidates: ModelSafeCandidate[] = [
      ...knownPdfs.slice(0, 3).map((d) => ({
        label: d.filename || 'PDF Document',
        filename: d.filename,
        kind: 'pdf' as const,
      })),
      ...knownImgs.slice(0, 3).map((s, idx) => ({
        label: s.filename || `Image ${idx + 1}`,
        filename: s.filename,
        kind: 'image' as const,
      })),
    ];

    return {
      status: 'ambiguous',
      message: 'Multiple visual resources exist in this discussion. Please specify which file or image you need.',
      candidates,
    };
  }

  // If multiple PDFs exist (no images)
  if (knownPdfs.length > 1) {
    return {
      status: 'ambiguous',
      kind: 'pdf',
      message: `Multiple PDF documents exist in this discussion (${knownPdfs.length} files). Please specify which document you need.`,
      candidates: knownPdfs.map((d) => ({
        label: d.filename || 'Untitled PDF',
        filename: d.filename,
        kind: 'pdf',
      })),
    };
  }

  // If multiple images exist (no PDFs)
  if (knownImgs.length > 1) {
    return {
      status: 'ambiguous',
      kind: 'image',
      message: `Multiple images exist in this discussion (${knownImgs.length} images). Please specify which image you need.`,
      candidates: knownImgs.slice(0, 5).map((s, idx) => ({
        label: s.filename || `Image ${idx + 1}`,
        filename: s.filename,
        kind: 'image',
      })),
    };
  }

  return {
    status: 'not_found',
    message: 'Could not resolve any matching resource in this discussion.',
  };
}
