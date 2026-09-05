import OpenAI from "openai";
import { SupabaseClient } from "@supabase/supabase-js";
import {
  KnownImageSource,
  MessageVisualEvidenceItem,
  fetchKnownImageSources,
  fetchRecentVisualEvidenceSets,
  resolveImageEvidence,
} from "@/utils/discussionMemory";

export const SEMANTIC_IMAGE_MIN_SIMILARITY = 0.36;
export const SEMANTIC_IMAGE_CLEAR_GAP = 0.05;
export const SEMANTIC_IMAGE_MAX_CANDIDATES = 2;
export const SEMANTIC_IMAGE_RPC_MATCH_COUNT = 5;

export interface SemanticCandidateMatch {
  artifact_id: string;
  similarity: number;
}

export interface SemanticImageRetrievalOptions {
  serviceSupabase: SupabaseClient;
  discussionId: string;
  prompt: string;
  openai: OpenAI;
  signal?: AbortSignal;
  lastRoundEvidence?: MessageVisualEvidenceItem[];
  recentEvidenceSets?: MessageVisualEvidenceItem[][];
}

export interface SemanticImageRetrievalResult {
  sources: KnownImageSource[];
  candidates: SemanticCandidateMatch[];
  topSimilarity: number;
  topGap: number | null;
}

/**
 * Deterministic classifier for semantic visual queries targeting historical images/screenshots.
 * Returns true if the query is a content-based visual reference or retrieval request.
 * Returns false for "Continue", generic verification follow-ups, and unrelated text.
 */
export function isSemanticVisualQuery(prompt?: string | null): boolean {
  if (!prompt || typeof prompt !== 'string') return false;
  const p = prompt.trim();
  if (!p) return false;

  // Reject generic continue commands
  if (/^(continue|proceed|next|go on|more|ok|okay|keep going)\b/i.test(p)) {
    return false;
  }

  // Reject generic verification follow-ups without content clauses
  if (
    /^(are you sure|is that correct|is this right|really\??|are you certain|double check|confirm|verify)(\s+(that|this|it|again|response|answer|details))?[\.\?!]?$/i.test(
      p
    )
  ) {
    return false;
  }

  // Reject generation / creation requests
  if (
    /\b(generate|create|make|draw|render|produce)\s+(a|an|the|me)?\s*(photo|picture|image|screenshot|snapshot|illustration|graphic|drawing)\b/i.test(
      p
    )
  ) {
    return false;
  }

  // Reject instructional, procedural, how-to, or generic format/compression questions
  if (
    /^(how\s+(do|can|to|should)\s+(i|we|you)|how\s+to|what\s+(is|are)\s+the\s+best|explain\s+|describe\s+how|tutorial|guide)\b/i.test(
      p
    )
  ) {
    return false;
  }

  // Reject taking a screenshot commands
  if (/\b(take|capture|grab)\s+(a|an)?\s*screenshot\b/i.test(p)) {
    return false;
  }

  // 1. "Which photo/picture/image/screenshot had/shows/depicts..." or "Which one had..."
  if (
    /\b(which|what|where)\s+(photo|picture|image|screenshot|snapshot|graphic|capture|diagram)\s+(had|has|showed|shows|showing|contained|contains|containing|mentions|mentioned|depicted|depicts|depicting|with|where|is|was|of)\b/i.test(
      p
    ) ||
    /\b(which|what)\s+one\s+(had|has|showed|shows|showing|contained|contains|containing|mentions|mentioned|depicted|depicts|depicting|with|where|is|was)\b/i.test(
      p
    )
  ) {
    return true;
  }

  // 2. "The one with...", "The one showing...", "That one with...", "The photo with..."
  if (
    /\b(the|that|this)\s+(one|photo|picture|image|screenshot|snapshot)\s+(with|had|has|showed|shows|showing|containing|contains|depicting|depicts|where|of|about)\b/i.test(
      p
    )
  ) {
    return true;
  }

  // 3. Action + visual media reference ("Find the image with...", "Show me the photo where...", "Reopen the screenshot with...", "Look at the one showing...", "Verify the screenshot with...", "Check the image showing...")
  if (
    /\b(find|show(\s+me)?|open|reopen|pull\s+up|bring\s+up|inspect|display|get|look\s+at|check|examine|verify)\s+(the|that|a|any)?\s*(photo|picture|image|screenshot|snapshot|one)\b/i.test(
      p
    ) &&
    /\b(with|had|has|showed|shows|showing|containing|contains|depicting|depicts|where|of|about|mentioning|that\s+shows|that\s+has|that\s+had)\b/i.test(
      p
    )
  ) {
    return true;
  }

  // 4. Media noun + descriptive participle ("Screenshot containing...", "Photo showing...", "Picture with...", "Image depicting...")
  if (
    /\b(photo|picture|image|screenshot|snapshot)\s+(containing|showing|depicting|mentioning|having|that\s+shows|that\s+has|that\s+had|where)\b/i.test(
      p
    )
  ) {
    return true;
  }

  // 5. Query asking about visual details/attributes inside a photo/image/screenshot ("what color was the handbag in that photo?", "who was wearing glasses in the picture?")
  if (
    /\b(what|which|who|where|how|tell\s+me)\b.*\b(in|on|from)\s+(the|that|this|a)\s+(photo|picture|image|screenshot|snapshot)\b/i.test(
      p
    )
  ) {
    return true;
  }

  // 6. Direct concise descriptive phrases like "job description screenshot", "sunset photo", "error screenshot"
  if (
    /^(the\s+)?([a-z0-9_\-]+\s+){1,4}(photo|picture|image|screenshot|snapshot)[\.\?!]?$/i.test(p)
  ) {
    return true;
  }

  return false;
}

/**
 * Evaluates semantic candidate scores and applies the calibrated ranking logic:
 * 1. S1 < 0.36 -> return null
 * 2. S1 >= 0.36 and (no S2 or S2 < 0.36 or S1 - S2 >= 0.05) -> [C1]
 * 3. S1 >= 0.36 and S2 >= 0.36 and S1 - S2 < 0.05 -> [C1, C2]
 * Hard max: 2 candidates, preserving descending similarity order.
 */
export function rankSemanticImageCandidates(
  candidates: SemanticCandidateMatch[]
): {
  selected: SemanticCandidateMatch[];
  topSimilarity: number;
  topGap: number | null;
} | null {
  if (!Array.isArray(candidates) || candidates.length === 0) {
    return null;
  }

  // Filter valid rows and sort descending by similarity
  const valid = candidates
    .filter(
      (c) =>
        c &&
        typeof c.artifact_id === "string" &&
        c.artifact_id.trim() !== "" &&
        typeof c.similarity === "number" &&
        Number.isFinite(c.similarity)
    )
    .sort((a, b) => b.similarity - a.similarity);

  if (valid.length === 0) {
    return null;
  }

  const c1 = valid[0];
  const s1 = c1.similarity;

  if (s1 < SEMANTIC_IMAGE_MIN_SIMILARITY) {
    return null;
  }

  const c2 = valid.length > 1 ? valid[1] : null;
  const s2 = c2 ? c2.similarity : null;
  const gap = s2 !== null ? s1 - s2 : null;

  let selected: SemanticCandidateMatch[] = [];

  if (c2 && s2 !== null && s2 >= SEMANTIC_IMAGE_MIN_SIMILARITY && (gap === null || gap < SEMANTIC_IMAGE_CLEAR_GAP)) {
    selected = [c1, c2];
  } else {
    selected = [c1];
  }

  // Enforce hard maximum
  if (selected.length > SEMANTIC_IMAGE_MAX_CANDIDATES) {
    selected = selected.slice(0, SEMANTIC_IMAGE_MAX_CANDIDATES);
  }

  return {
    selected,
    topSimilarity: s1,
    topGap: gap,
  };
}

/**
 * Executes Phase 3B Semantic Historical Image Retrieval:
 * 1. Checks deterministic precedence (resolveImageEvidence). If resolved -> bypasses with 0 embedding calls.
 * 2. Generates dedicated float[1536] query embedding via google/gemini-embedding-2.
 * 3. Invokes match_discussion_image_descriptors vector RPC.
 * 4. Applies calibrated ranking (0.36 min similarity, 0.05 gap, max 2).
 * 5. Resolves candidate artifact IDs to canonical KnownImageSource objects.
 */
export async function retrieveSemanticImageCandidates(
  options: SemanticImageRetrievalOptions
): Promise<SemanticImageRetrievalResult | null> {
  const {
    serviceSupabase,
    discussionId,
    prompt,
    openai,
    signal,
    lastRoundEvidence = [],
    recentEvidenceSets,
  } = options;

  if (!serviceSupabase || !discussionId || !prompt || !prompt.trim() || !openai) {
    return null;
  }

  if (signal?.aborted) {
    return null;
  }

  try {
    // 1. Fetch known image sources
    const knownSources = await fetchKnownImageSources(serviceSupabase, discussionId);
    if (!knownSources || knownSources.length === 0) {
      return null;
    }

    // 2. Strict Deterministic Precedence Check (Section 6)
    // Phase 3B must NEVER reinterpret a request that the deterministic resolver can resolve.
    const resolvedRecentEvidenceSets =
      recentEvidenceSets ?? (await fetchRecentVisualEvidenceSets(serviceSupabase, discussionId));

    const deterministicResolution = resolveImageEvidence({
      prompt,
      knownSources,
      lastRoundEvidence,
      recentEvidenceSets: resolvedRecentEvidenceSets,
    });

    if (deterministicResolution && deterministicResolution.sources.length > 0) {
      // Deterministic resolver resolved image evidence -> bypass semantic retrieval (0 embedding calls)
      return null;
    }

    if (signal?.aborted) {
      return null;
    }

    // 3. Dedicated Query Embedding Generation
    let queryEmbedding: number[] | null = null;
    try {
      const embRes = await (openai.embeddings.create as any)(
        {
          model: "google/gemini-embedding-2",
          dimensions: 1536,
          input: prompt.trim(),
          encoding_format: "float",
        },
        {
          timeout: 10000,
          signal,
        }
      );

      const vector = embRes?.data?.[0]?.embedding;
      if (
        Array.isArray(vector) &&
        vector.length === 1536 &&
        vector.every((val: any) => typeof val === "number" && Number.isFinite(val))
      ) {
        queryEmbedding = vector;
      } else {
        console.warn("[Semantic Image Retrieval] Embedding response format invalid or non-1536 dim");
        return null;
      }
    } catch (embErr: any) {
      if (signal?.aborted) return null;
      console.warn("[Semantic Image Retrieval] Query embedding generation failed:", embErr?.message || embErr);
      return null;
    }

    if (!queryEmbedding || signal?.aborted) {
      return null;
    }

    // 4. Vector RPC Execution
    let rpcRows: any[] | null = null;
    try {
      const { data, error } = await serviceSupabase.rpc("match_discussion_image_descriptors", {
        p_discussion_id: discussionId,
        p_query_embedding: queryEmbedding,
        p_match_count: SEMANTIC_IMAGE_RPC_MATCH_COUNT,
      });

      if (error) {
        console.warn("[Semantic Image Retrieval] Vector RPC execution error:", error);
        return null;
      }
      rpcRows = data;
    } catch (rpcErr: any) {
      if (signal?.aborted) return null;
      console.warn("[Semantic Image Retrieval] Vector RPC call threw error:", rpcErr?.message || rpcErr);
      return null;
    }

    if (!Array.isArray(rpcRows) || rpcRows.length === 0) {
      return null;
    }

    // 5. Calibrated Ranking
    const candidateMatches: SemanticCandidateMatch[] = rpcRows.map((r: any) => ({
      artifact_id: r.artifact_id,
      similarity: typeof r.similarity === "number" ? r.similarity : parseFloat(r.similarity),
    }));

    const rankingResult = rankSemanticImageCandidates(candidateMatches);
    if (!rankingResult || rankingResult.selected.length === 0) {
      return null;
    }

    // 6. Source Resolution
    // Build canonical earliest source map
    const earliestSourceMap = new Map<string, KnownImageSource>();
    for (const src of knownSources) {
      if (!earliestSourceMap.has(src.artifactId)) {
        earliestSourceMap.set(src.artifactId, src);
      }
    }

    const mappedSources: KnownImageSource[] = [];
    for (const candidate of rankingResult.selected) {
      const src = earliestSourceMap.get(candidate.artifact_id);
      if (src && src.storagePath) {
        mappedSources.push(src);
      }
    }

    if (mappedSources.length === 0) {
      return null;
    }

    // 7. Diagnostic Logging (Section 11)
    // Log candidate metrics without exposing embeddings, signed URLs, descriptor text, or visible text
    console.log(
      "[Semantic Image Retrieval] candidates:",
      candidateMatches.slice(0, 5).map((c) => ({
        artifactId: c.artifact_id,
        similarity: Number(c.similarity.toFixed(4)),
      }))
    );
    console.log("[Semantic Image Retrieval] selection summary:", {
      selectedCount: mappedSources.length,
      topSimilarity: Number(rankingResult.topSimilarity.toFixed(4)),
      topGap: rankingResult.topGap !== null ? Number(rankingResult.topGap.toFixed(4)) : null,
    });

    return {
      sources: mappedSources,
      candidates: rankingResult.selected,
      topSimilarity: rankingResult.topSimilarity,
      topGap: rankingResult.topGap,
    };
  } catch (err: any) {
    if (signal?.aborted) return null;
    console.warn("[Semantic Image Retrieval] Non-critical error during semantic image retrieval:", err);
    return null;
  }
}
