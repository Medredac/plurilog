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
  resolveVisualDocxDocument,
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
  | 'docx'
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
  historicalRounds?: Round[];

  // Image context
  knownImageSources?: KnownImageSource[];
  lastRoundEvidence?: MessageVisualEvidenceItem[];
  recentEvidenceSets?: MessageVisualEvidenceItem[][];
  visualContext?: DiscussionVisualContextState | null;
  previousUserPrompt?: string;
  currentUserPrompt?: string;
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

function isDocx(filenameOrPath?: string | null): boolean {
  if (!filenameOrPath) return false;
  const clean = filenameOrPath.split('?')[0].split('#')[0].toLowerCase();
  return clean.endsWith('.docx');
}

function isTextOnlyDocument(filenameOrPath?: string | null): boolean {
  if (!filenameOrPath) return false;
  const clean = filenameOrPath.split('?')[0].split('#')[0].toLowerCase();
  return (
    clean.endsWith('.txt') ||
    clean.endsWith('.md') ||
    clean.endsWith('.csv') ||
    clean.endsWith('.json')
  );
}

function inferExplicitDocumentKind(
  searchPrompt: string,
  explicitFilename?: string
): 'pdf' | 'docx' | null {
  const filename = (explicitFilename || '').trim().toLowerCase();
  if (filename.endsWith('.docx')) return 'docx';
  if (filename.endsWith('.pdf')) return 'pdf';

  const prompt = (searchPrompt || '').trim().toLowerCase();
  if (!prompt) return null;

  const strongDocxCue =
    /\b(?:existing|source|current|latest|previous|generated)\s+(?:word|docx)\b/i.test(prompt) ||
    /\b(?:word|docx)\s+(?:document|file|résumé|resume|cv)\b/i.test(prompt);
  const strongPdfCue =
    /\b(?:existing|source|current|latest|previous|generated)\s+pdf\b/i.test(prompt) ||
    /\bpdf\s+(?:document|file|résumé|resume|cv)\b/i.test(prompt);

  if (strongDocxCue && !strongPdfCue) return 'docx';
  if (strongPdfCue && !strongDocxCue) return 'pdf';

  const hasDocxCue = /\b(?:docx|word)\b/i.test(prompt);
  const hasPdfCue = /\bpdf\b/i.test(prompt);
  if (hasDocxCue && !hasPdfCue) return 'docx';
  if (hasPdfCue && !hasDocxCue) return 'pdf';

  return null;
}

function inferExplicitUserResourceType(
  userPrompt: string,
  context: ResourceBrokerContext
): 'image' | 'document' | null {
  const prompt = (userPrompt || '').trim().toLowerCase();
  if (!prompt) return null;

  const normalizeBase = (name?: string | null) =>
    (name || '')
      .split('?')[0]
      .split('#')[0]
      .toLowerCase()
      .replace(/\.(pdf|png|jpe?g|webp|gif)$/i, '')
      .trim();

  const docMatches = (context.knownDocuments || []).filter((doc) => {
    const filename = (doc.filename || '').toLowerCase();
    const base = normalizeBase(doc.filename);
    return (
      (filename.length >= 4 && prompt.includes(filename)) ||
      (base.length >= 4 && prompt.includes(base))
    );
  });

  const imageMatches = (context.knownImageSources || []).filter((source) => {
    const filename = (source.filename || '').toLowerCase();
    const base = normalizeBase(source.filename);
    return (
      (filename.length >= 4 && prompt.includes(filename)) ||
      (base.length >= 4 && prompt.includes(base))
    );
  });

  if (docMatches.length > 0 && imageMatches.length === 0) return 'document';
  if (imageMatches.length > 0 && docMatches.length === 0) return 'image';

  const documentCue = /\b(?:pdf|document|cv|resume|résumé)\b/i.test(userPrompt);
  const imageCue = /\b(?:image|photo|picture|screenshot|pic)\b/i.test(userPrompt);

  // A visual explicitly described as being inside/on a document is still document evidence.
  const embeddedDocumentCue =
    /\b(?:image|photo|picture)\s+(?:in|on|from)\s+(?:the\s+)?(?:pdf|document|cv|resume|résumé)\b/i.test(
      userPrompt
    ) ||
    /\b(?:pdf|document|cv|resume|résumé)\s+(?:image|photo|picture)\b/i.test(userPrompt);

  if (embeddedDocumentCue) return 'document';
  if (documentCue && !imageCue) return 'document';
  if (imageCue && !documentCue) return 'image';

  return null;
}

/**
 * Checks whether a PDF resolution was based on strong contextual signals
 * (explicit filename, retrieved chunk match, or recent round attachment)
 * rather than a generic discussion-wide singleton fallback.
 */
function isStrongDocumentResolution(
  resolvedDoc: ResolvedVisualDocument,
  searchPrompt: string,
  context: ResourceBrokerContext
): boolean {
  const pLower = searchPrompt.toLowerCase();
  const fn = resolvedDoc.filename.toLowerCase();
  const base = fn.replace(/\.(?:pdf|docx)$/i, '');
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
    'descriptive_edit_round',
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

  const isStrong = isStrongDocumentResolution(resolvedDoc, searchPrompt, context);
  return { resolved: resolvedDoc, isStrong };
}

/**
 * Resolves visual DOCX evidence. The broker only resolves identity here; the
 * debate route is responsible for rendering the canonical DOCX into page images.
 */
function resolveDocxVisual(
  searchPrompt: string,
  context: ResourceBrokerContext
): { resolved: ResolvedVisualDocument | null; isStrong: boolean } {
  const resolvedDoc = resolveVisualDocxDocument(
    searchPrompt,
    context.knownDocuments,
    context.retrievedDocuments,
    context.recentRounds
  );

  if (!resolvedDoc || !resolvedDoc.storagePath) {
    return { resolved: null, isStrong: false };
  }

  return {
    resolved: resolvedDoc,
    isStrong: isStrongDocumentResolution(resolvedDoc, searchPrompt, context),
  };
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
    historicalRounds: context.historicalRounds,
    allUserMessageIds: context.allUserMessageIds,
  });

  if (!resolvedImg || !Array.isArray(resolvedImg.sources) || resolvedImg.sources.length === 0) {
    return { resolved: null, isStrong: false };
  }

  const isStrong = isStrongImageResolution(resolvedImg);
  return { resolved: resolvedImg, isStrong };
}

/**
 * Constrains explicitly requested embedded images to their named parent document.
 */
function resolveNamedDocumentImage(
  request: ResourceBrokerRequest,
  context: ResourceBrokerContext
): InternalBrokerResult | null {
  if (request.modality !== 'visual' || request.resource_type !== 'image') return null;
  // An image explicitly named by the human remains an ordinary filename lookup.
  const requestedImage = (context.knownImageSources || []).find(source =>
    source.filename.toLowerCase() === (request.filename || '').toLowerCase()
  );
  if (requestedImage && (context.currentUserPrompt || '').toLowerCase().includes(requestedImage.filename.toLowerCase())) return null;
  const text = `${request.need || ''} ${context.currentUserPrompt || ''}`.toLowerCase();
  if (!/\b(?:embedded|original)\b/.test(text) ||
      !/\b(?:image|photo|picture|illustration|logo|diagram)\b/.test(text)) return null;
  const namedText = `${request.filename || ''} ${text}`.toLowerCase();
  const parents = (context.knownDocuments || []).filter(doc =>
    (isPdf(doc.filename) || isDocx(doc.filename)) &&
    Boolean(doc.filename) && namedText.includes(doc.filename.toLowerCase())
  );
  if (!parents.length) return null;
  if (parents.length !== 1) return {
    status: 'ambiguous',
    message: 'Multiple parent documents match this embedded-image request. Specify the source document.',
    candidates: parents.map(doc => ({ label: doc.filename, filename: doc.filename, kind: isPdf(doc.filename) ? 'pdf' : 'docx' })),
  };
  const parent = parents[0];
  const kind = isPdf(parent.filename) ? 'pdf' as const : 'docx' as const;
  // Extraction already stores assets under the exact parent byte hash. Do not
  // infer original-image identity from recency, upload sender, or rendered pages.
  const assetFolder = kind === 'pdf' ? 'pdf-assets' : 'docx-assets';
  const hash = parent.fileHash || '';
  const parentPaths = [parent.storagePath, ...(parent.sourcePaths || [])].filter(Boolean) as string[];
  const assetPrefixes = /^[a-f0-9]{64}$/i.test(hash)
    ? parentPaths.map(path => `${path.split('/')[0]}/${assetFolder}/${hash}/`)
    : [];
  const candidates = (context.knownImageSources || []).filter(source =>
    assetPrefixes.some(prefix => source.storagePath?.startsWith(prefix))
  );
  const distinct = [...new Map(candidates.map(source => [source.artifactId || source.storagePath, source])).values()];
  const explicitImage = candidates.filter(source =>
    source.filename.toLowerCase() === (request.filename || '').toLowerCase()
  );
  const selected = explicitImage.length === 1 ? explicitImage : distinct;
  if (selected.length === 1) {
    const source = selected[0];
    return {
      status: 'resolved', kind: 'image',
      message: `Resolved the original embedded image from "${parent.filename}" by its parent document identity.`,
      evidence: { kind: 'image', filename: source.filename, storagePath: source.storagePath,
        sourceIds: [source.sourceId], sources: [source], reason: 'parent_document_embedded_image' },
    };
  }
  if (selected.length > 1) return {
    status: 'ambiguous', kind: 'image',
    message: `Multiple embedded images belong to "${parent.filename}". Specify the image filename; no rendered page was substituted.`,
    candidates: selected.map(source => ({ label: source.filename, filename: source.filename, kind: 'image' })),
  };
  const storagePath = parent.storagePath || parent.sourcePaths?.[0];
  if (!storagePath) return { status: 'not_found', message: 'The named document has no retrievable original image or source file.' };
  return {
    status: 'resolved', kind,
    message: `An extracted original image is unavailable; reopen the actual source document "${parent.filename}" for visual inspection.`,
    evidence: { kind, filename: parent.filename, storagePath, documentId: parent.id || undefined,
      reason: 'embedded_image_parent_document_fallback' },
  };
}

/** Normalizes and resolves a resource request against existing discussion context. */
export function resolveRequestedEvidence(
  request: ResourceBrokerRequest,
  context: ResourceBrokerContext
): InternalBrokerResult {
  const documentImage = resolveNamedDocumentImage(request, context);
  if (documentImage) return documentImage;
  const { modality, resource_type = 'auto', need, filename } = request;
  const effectiveNeed = (need || '').trim();
  const explicitFilename = (filename || '').trim();
  const searchPrompt = explicitFilename
    ? `${explicitFilename} ${effectiveNeed}`.trim()
    : effectiveNeed;

  const knownPdfs = (context.knownDocuments || []).filter((d) =>
    isPdf(d.filename || d.storagePath)
  );
  const knownDocx = (context.knownDocuments || []).filter((d) =>
    isDocx(d.filename || d.storagePath)
  );
  const knownVisualDocuments = [...knownPdfs, ...knownDocx];
  const knownImgs = context.knownImageSources || [];

  let effectiveResourceType: RequestedResourceType = resource_type;
  if (
    modality === 'visual' &&
    knownVisualDocuments.length > 0 &&
    knownImgs.length > 0 &&
    !explicitFilename
  ) {
    const explicitUserType = inferExplicitUserResourceType(
      context.currentUserPrompt || '',
      context
    );

    // In a mixed PDF/image discussion, the model's own resource_type guess is not
    // enough to select evidence. Prefer an explicit cue from the user's words;
    // otherwise reconcile both modalities through the broker's ambiguity logic.
    effectiveResourceType = explicitUserType || 'auto';
  }

  // 1. Guard against visual requests on genuinely text-only document formats.
  // DOCX is visual-capable through server-side page rendering.
  if (modality === 'visual') {
    if (explicitFilename && isTextOnlyDocument(explicitFilename)) {
      return {
        status: 'unsupported',
        kind: 'document_text',
        message: `Visual inspection is not supported for ${explicitFilename}. PDF, DOCX, and images support visual inspection.`,
      };
    }

    if (
      effectiveResourceType === 'document' &&
      Array.isArray(context.knownDocuments) &&
      context.knownDocuments.length > 0 &&
      context.knownDocuments.every((d) =>
        isTextOnlyDocument(d.filename || d.storagePath)
      )
    ) {
      return {
        status: 'unsupported',
        kind: 'document_text',
        message:
          'Visual inspection is not supported for the plain-text documents in this discussion.',
      };
    }
  }

  // 2. Modality === 'text'
  if (modality === 'text') {
    if (effectiveResourceType === 'image') {
      return {
        status: 'unsupported',
        kind: 'image',
        message: 'Text extraction is not directly supported for standalone image artifacts.',
      };
    }
    return resolveDocumentText(searchPrompt, explicitFilename, context);
  }

  // 3. Modality === 'visual' with Explicit resource_type === 'document'
  if (effectiveResourceType === 'document') {
    const explicitDocumentKind = inferExplicitDocumentKind(
      searchPrompt,
      explicitFilename
    );

    if (explicitDocumentKind === 'docx') {
      const { resolved, isStrong } = resolveDocxVisual(searchPrompt, context);
      if (resolved?.storagePath && (isStrong || knownDocx.length === 1)) {
        return {
          status: 'resolved',
          kind: 'docx',
          message: `Resolved visual Word document "${resolved.filename}".`,
          evidence: {
            kind: 'docx',
            filename: resolved.filename,
            storagePath: resolved.storagePath,
            documentId: resolved.documentId || undefined,
            reason: 'resolved_visual_docx',
          },
        };
      }

      if (knownDocx.length > 1) {
        return {
          status: 'ambiguous',
          kind: 'docx',
          message: 'Multiple Word documents match this visual evidence request. Please specify the file.',
          candidates: knownDocx.map((d) => ({
            label: d.filename || 'Untitled Word document',
            filename: d.filename,
            kind: 'docx' as const,
          })),
        };
      }

      return {
        status: 'not_found',
        kind: 'docx',
        message: 'No matching Word document was found in this discussion.',
      };
    }

    if (explicitDocumentKind === 'pdf') {
      const { resolved, isStrong } = resolvePdfVisual(searchPrompt, context);
      if (resolved?.storagePath && (isStrong || knownPdfs.length === 1)) {
        return {
          status: 'resolved',
          kind: 'pdf',
          message: `Resolved visual PDF "${resolved.filename}".`,
          evidence: {
            kind: 'pdf',
            filename: resolved.filename,
            storagePath: resolved.storagePath,
            documentId: resolved.documentId || undefined,
            reason: 'resolved_visual_document',
          },
        };
      }

      if (knownPdfs.length > 1) {
        return {
          status: 'ambiguous',
          kind: 'pdf',
          message: 'Multiple PDFs match this visual evidence request. Please specify the file.',
          candidates: knownPdfs.map((d) => ({
            label: d.filename || 'Untitled PDF',
            filename: d.filename,
            kind: 'pdf' as const,
          })),
        };
      }

      return {
        status: 'not_found',
        kind: 'pdf',
        message: 'No matching PDF was found in this discussion.',
      };
    }

    const { resolved: resolvedPdf, isStrong: pdfStrong } =
      resolvePdfVisual(searchPrompt, context);
    const { resolved: resolvedDocx, isStrong: docxStrong } =
      resolveDocxVisual(searchPrompt, context);

    if (pdfStrong && docxStrong) {
      return {
        status: 'ambiguous',
        message: 'Multiple documents match this visual evidence request. Please specify the file.',
        candidates: [
          {
            label: resolvedPdf!.filename,
            filename: resolvedPdf!.filename,
            kind: 'pdf',
          },
          {
            label: resolvedDocx!.filename,
            filename: resolvedDocx!.filename,
            kind: 'docx',
          },
        ],
      };
    }

    const resolvedDoc = pdfStrong
      ? resolvedPdf
      : docxStrong
        ? resolvedDocx
        : resolvedPdf || resolvedDocx;

    if (resolvedDoc && resolvedDoc.storagePath) {
      const kind: ResourceBrokerKind = isDocx(
        resolvedDoc.filename || resolvedDoc.storagePath
      )
        ? 'docx'
        : 'pdf';
      return {
        status: 'resolved',
        kind,
        message:
          kind === 'docx'
            ? `Resolved visual Word document "${resolvedDoc.filename}".`
            : `Resolved visual PDF "${resolvedDoc.filename}".`,
        evidence: {
          kind,
          filename: resolvedDoc.filename,
          storagePath: resolvedDoc.storagePath,
          documentId: resolvedDoc.documentId || undefined,
          reason:
            kind === 'docx'
              ? 'resolved_visual_docx'
              : 'resolved_visual_document',
        },
      };
    }

    if (knownVisualDocuments.length > 1) {
      return {
        status: 'ambiguous',
        message: `Multiple visually inspectable documents exist in this discussion (${knownVisualDocuments.length} files). Please specify which document you need.`,
        candidates: knownVisualDocuments.map((d) => {
          const kind: ResourceBrokerKind = isDocx(d.filename || d.storagePath)
            ? 'docx'
            : 'pdf';
          return {
            label: d.filename || (kind === 'docx' ? 'Untitled Word document' : 'Untitled PDF'),
            filename: d.filename,
            kind,
          };
        }),
      };
    }

    return {
      status: 'not_found',
      message: 'No visually inspectable PDF or DOCX document was found in this discussion.',
    };
  }

  // 4. Modality === 'visual' with Explicit resource_type === 'image'
  if (effectiveResourceType === 'image') {
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
  const { resolved: pdfMatch, isStrong: isPdfStrong } = resolvePdfVisual(searchPrompt, context);
  const { resolved: docxMatch, isStrong: isDocxStrong } = resolveDocxVisual(searchPrompt, context);
  const { resolved: imgMatch, isStrong: isImgStrong } = resolveImageVisual(searchPrompt, context);
  const documentMatch = isPdfStrong
    ? pdfMatch
    : isDocxStrong
      ? docxMatch
      : pdfMatch || docxMatch;
  const isDocumentStrong = isPdfStrong || isDocxStrong;
  const documentKind: ResourceBrokerKind | null = documentMatch
    ? (isDocx(documentMatch.filename || documentMatch.storagePath) ? 'docx' : 'pdf')
    : null;

  if (isPdfStrong && isDocxStrong) {
    return {
      status: 'ambiguous',
      message: 'Multiple documents match this visual evidence request. Please specify the file.',
      candidates: [
        {
          label: pdfMatch!.filename,
          filename: pdfMatch!.filename,
          kind: 'pdf',
        },
        {
          label: docxMatch!.filename,
          filename: docxMatch!.filename,
          kind: 'docx',
        },
      ],
    };
  }

  // Case 5a: If one is strong and the other is not -> the strong one wins deterministically
  if (isDocumentStrong && !isImgStrong && documentMatch && documentKind) {
    return {
      status: 'resolved',
      kind: documentKind,
      message:
        documentKind === 'docx'
          ? `Resolved visual Word document "${documentMatch.filename}".`
          : `Resolved visual PDF "${documentMatch.filename}".`,
      evidence: {
        kind: documentKind,
        filename: documentMatch.filename,
        storagePath: documentMatch.storagePath,
        documentId: documentMatch.documentId || undefined,
        reason:
          documentKind === 'docx'
            ? 'resolved_visual_docx_contextual'
            : 'resolved_visual_document_contextual',
      },
    };
  }

  if (isImgStrong && !isDocumentStrong) {
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
  if (isDocumentStrong && isImgStrong && documentMatch && documentKind) {
    const candidates: ModelSafeCandidate[] = [
      {
        label:
          documentMatch.filename ||
          (documentKind === 'docx' ? 'Word Document' : 'PDF Document'),
        filename: documentMatch.filename,
        kind: documentKind,
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
  if (documentMatch && documentKind && knownImgs.length === 0) {
    return {
      status: 'resolved',
      kind: documentKind,
      message:
        documentKind === 'docx'
          ? `Resolved visual Word document "${documentMatch.filename}".`
          : `Resolved visual PDF "${documentMatch.filename}".`,
      evidence: {
        kind: documentKind,
        filename: documentMatch.filename,
        storagePath: documentMatch.storagePath,
        documentId: documentMatch.documentId || undefined,
        reason:
          documentKind === 'docx'
            ? 'resolved_visual_docx_singleton'
            : 'resolved_visual_document_singleton',
      },
    };
  }

  // If the discussion ONLY contains Images (and no PDFs) -> image resolution is valid
  if (imgMatch && knownVisualDocuments.length === 0) {
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
  if (knownVisualDocuments.length > 0 && knownImgs.length > 0) {
    const candidates: ModelSafeCandidate[] = [
      ...knownVisualDocuments.slice(0, 3).map((d) => {
        const kind: ResourceBrokerKind = isDocx(d.filename || d.storagePath)
          ? 'docx'
          : 'pdf';
        return {
          label: d.filename || (kind === 'docx' ? 'Word Document' : 'PDF Document'),
          filename: d.filename,
          kind,
        };
      }),
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

  // If multiple visually inspectable documents exist (no images)
  if (knownVisualDocuments.length > 1) {
    return {
      status: 'ambiguous',
      message: `Multiple visually inspectable documents exist in this discussion (${knownVisualDocuments.length} files). Please specify which document you need.`,
      candidates: knownVisualDocuments.map((d) => {
        const kind: ResourceBrokerKind = isDocx(d.filename || d.storagePath)
          ? 'docx'
          : 'pdf';
        return {
          label: d.filename || (kind === 'docx' ? 'Untitled Word document' : 'Untitled PDF'),
          filename: d.filename,
          kind,
        };
      }),
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
