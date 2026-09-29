import OpenAI from 'openai';
import type { SupabaseClient } from '@supabase/supabase-js';
import {
  retrieveDiscussionDocuments,
  retrieveDiscussionDocumentById,
  type KnownDiscussionDocument,
  type RetrievedDocumentExcerpt,
} from '@/utils/discussionMemory';
import {
  registerAgenticArtifactEvidence,
  type AgenticEvidenceLedgerEntry,
} from '@/utils/agenticConversationMemory';

export const AGENTIC_DOCUMENT_EVIDENCE_TOOLS = [
  {
    type: 'function',
    function: {
      name: 'search_document_evidence',
      description:
        'Search the parsed text of documents already available in this discussion when the current task needs facts or wording from a prior file that are not already present in your context. Use a focused query. If you know the filename, provide it so Plurilog deterministically scopes the search to that document. Results are compact grounded excerpts with evidence IDs; expand an evidence ID only when more context is genuinely needed.',
      parameters: {
        type: 'object',
        properties: {
          query: {
            type: 'string',
            description:
              'Focused query for the fact, wording, section, or passage needed from prior document text.',
          },
          filename: {
            type: 'string',
            description:
              'Optional known filename or distinctive filename fragment to scope the search to one document.',
          },
          max_results: {
            type: 'integer',
            minimum: 1,
            maximum: 3,
          },
        },
        required: ['query'],
        additionalProperties: false,
      },
    },
  },
] as const;

export const AGENTIC_DOCUMENT_TOOL_NAMES = new Set(
  AGENTIC_DOCUMENT_EVIDENCE_TOOLS.map((tool) => tool.function.name)
);

export interface AgenticDocumentToolResolution {
  toolName: string;
  result: Record<string, unknown>;
  addedEvidenceIds: string[];
  reusedEvidenceIds: string[];
  query: string | null;
  latencyMs: number;
}

function normalizeFilename(value?: string | null): string {
  return String(value || '')
    .trim()
    .toLowerCase()
    .replace(/\s+/g, ' ');
}

function compactExcerpt(text: string, maxChars = 1600): string {
  const clean = String(text || '').trim();
  if (clean.length <= maxChars) return clean;
  return `${clean.slice(0, maxChars - 1).trimEnd()}…`;
}

async function embedQuery(
  openai: OpenAI,
  query: string,
  signal?: AbortSignal
): Promise<number[] | null> {
  const result = await (openai.embeddings.create as any)(
    {
      model: 'google/gemini-embedding-2',
      dimensions: 1536,
      input: query,
      encoding_format: 'float',
    },
    {
      timeout: 10000,
      ...(signal ? { signal } : {}),
    }
  );

  const embedding = result?.data?.[0]?.embedding;
  return Array.isArray(embedding) && embedding.length === 1536
    ? embedding
    : null;
}

function selectKnownDocument(
  knownDocuments: KnownDiscussionDocument[],
  filename: string
): {
  status: 'none' | 'resolved' | 'ambiguous';
  document?: KnownDiscussionDocument;
  candidates?: KnownDiscussionDocument[];
} {
  const normalized = normalizeFilename(filename);
  if (!normalized) return { status: 'none' };

  const exact = knownDocuments.filter(
    (doc) => normalizeFilename(doc.filename) === normalized
  );
  if (exact.length === 1) {
    return { status: 'resolved', document: exact[0] };
  }
  if (exact.length > 1) {
    return { status: 'ambiguous', candidates: exact };
  }

  const partial = knownDocuments.filter((doc) => {
    const candidate = normalizeFilename(doc.filename);
    return (
      candidate.includes(normalized) ||
      normalized.includes(candidate.replace(/\.[a-z0-9]+$/i, ''))
    );
  });

  if (partial.length === 1) {
    return { status: 'resolved', document: partial[0] };
  }
  if (partial.length > 1) {
    return { status: 'ambiguous', candidates: partial };
  }

  return { status: 'none' };
}

function publicExcerpt(
  excerpt: RetrievedDocumentExcerpt,
  evidenceId: string
) {
  return {
    evidence_id: evidenceId,
    filename: excerpt.filename,
    chunk_index: excerpt.chunkIndex,
    snippet: compactExcerpt(excerpt.content),
    semantic_similarity: excerpt.semanticSimilarity,
    hybrid_score: excerpt.hybridScore,
  };
}

export async function resolveAgenticDocumentEvidenceTool(options: {
  toolName: string;
  toolArgs: Record<string, unknown>;
  serviceSupabase: SupabaseClient;
  openai: OpenAI;
  discussionId: string;
  knownDocuments: KnownDiscussionDocument[];
  ledger: AgenticEvidenceLedgerEntry[];
  requestedBySeatId: string;
  createEvidenceId: () => string;
  signal?: AbortSignal;
}): Promise<AgenticDocumentToolResolution> {
  const startedAt = Date.now();
  const {
    toolName,
    toolArgs,
    serviceSupabase,
    openai,
    discussionId,
    knownDocuments,
    ledger,
    requestedBySeatId,
    createEvidenceId,
    signal,
  } = options;

  if (toolName !== 'search_document_evidence') {
    return {
      toolName,
      result: { ok: false, error: 'unsupported_document_evidence_tool' },
      addedEvidenceIds: [],
      reusedEvidenceIds: [],
      query: null,
      latencyMs: Date.now() - startedAt,
    };
  }

  const query =
    typeof toolArgs.query === 'string'
      ? toolArgs.query.trim().slice(0, 4000)
      : '';
  const filename =
    typeof toolArgs.filename === 'string'
      ? toolArgs.filename.trim().slice(0, 500)
      : '';
  const maxResults = Math.max(
    1,
    Math.min(3, Math.floor(Number(toolArgs.max_results) || 2))
  );

  if (!query) {
    return {
      toolName,
      result: { ok: false, error: 'query_required' },
      addedEvidenceIds: [],
      reusedEvidenceIds: [],
      query,
      latencyMs: Date.now() - startedAt,
    };
  }

  const queryEmbedding = await embedQuery(openai, query, signal);
  if (!queryEmbedding) {
    return {
      toolName,
      result: { ok: false, error: 'embedding_unavailable' },
      addedEvidenceIds: [],
      reusedEvidenceIds: [],
      query,
      latencyMs: Date.now() - startedAt,
    };
  }

  let excerpts: RetrievedDocumentExcerpt[] = [];

  if (filename) {
    const selected = selectKnownDocument(knownDocuments, filename);
    if (selected.status === 'ambiguous') {
      return {
        toolName,
        result: {
          ok: true,
          status: 'ambiguous',
          query,
          requested_filename: filename,
          candidates: (selected.candidates || []).map((doc) => ({
            filename: doc.filename,
          })),
          note:
            'Multiple known documents match the requested filename. Refine the filename before relying on document text.',
        },
        addedEvidenceIds: [],
        reusedEvidenceIds: [],
        query,
        latencyMs: Date.now() - startedAt,
      };
    }

    if (selected.status === 'resolved' && selected.document?.id) {
      excerpts = await retrieveDiscussionDocumentById({
        serviceSupabase,
        discussionId,
        documentId: selected.document.id,
        queryText: query,
        queryEmbedding,
        signal,
      });
    } else if (selected.status === 'none') {
      return {
        toolName,
        result: {
          ok: true,
          status: 'not_found',
          query,
          requested_filename: filename,
          evidence: [],
          note: 'No known document matched that filename.',
        },
        addedEvidenceIds: [],
        reusedEvidenceIds: [],
        query,
        latencyMs: Date.now() - startedAt,
      };
    }
  } else {
    excerpts = await retrieveDiscussionDocuments({
      serviceSupabase,
      discussionId,
      queryText: query,
      queryEmbedding,
      signal,
    });
  }

  excerpts = excerpts.slice(0, maxResults);

  const evidence: Array<Record<string, unknown>> = [];
  const addedEvidenceIds: string[] = [];
  const reusedEvidenceIds: string[] = [];

  for (const excerpt of excerpts) {
    const registration = registerAgenticArtifactEvidence({
      ledger,
      createEvidenceId,
      requestedBySeatId,
      artifactKind: 'document_text',
      filename: excerpt.filename,
      provenanceReason: 'parsed_document_chunk',
      artifactIdentityKey: `${excerpt.documentId}|${excerpt.chunkId}`,
      compactText: compactExcerpt(excerpt.content),
      expandedText: excerpt.content,
      query,
      sourceUserMessageId: null,
    });

    if (registration.reused) {
      reusedEvidenceIds.push(registration.entry.evidenceId);
    } else {
      addedEvidenceIds.push(registration.entry.evidenceId);
    }

    evidence.push(
      publicExcerpt(excerpt, registration.entry.evidenceId)
    );
  }

  return {
    toolName,
    result: {
      ok: true,
      status: evidence.length > 0 ? 'resolved' : 'not_found',
      query,
      requested_filename: filename || null,
      evidence,
      note:
        evidence.length > 0
          ? 'These are grounded parsed-document excerpts. Use expand_grounded_evidence only if a compact excerpt is insufficient.'
          : 'No relevant parsed-document excerpt was found.',
    },
    addedEvidenceIds,
    reusedEvidenceIds,
    query,
    latencyMs: Date.now() - startedAt,
  };
}
