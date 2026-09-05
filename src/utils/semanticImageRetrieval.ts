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

export interface LexicalCandidateMatch {
  artifact_id: string;
  lexical_rank: number;
}

export interface NormalizedLexicalQuery {
  rawPrompt: string;
  queryText: string;
  terms: string[];
  informativeTerms: string[];
  eligibleForRescue: boolean;
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
  decisionReason?: "semantic_clear" | "semantic_ambiguous" | "lexical_rescue";
  lexicalRank?: number;
}

export const BROAD_VISUAL_TERMS = new Set([
  "window",
  "tree",
  "building",
  "wall",
  "view",
  "scene",
  "photo",
  "image",
  "picture",
  "screenshot",
  "snapshot",
]);

export const RETRIEVAL_STOPWORDS = new Set([
  "which",
  "what",
  "where",
  "who",
  "how",
  "when",
  "why",
  "find",
  "show",
  "showed",
  "showing",
  "shows",
  "open",
  "reopen",
  "pull",
  "bring",
  "inspect",
  "display",
  "get",
  "look",
  "check",
  "examine",
  "verify",
  "tell",
  "photo",
  "picture",
  "image",
  "screenshot",
  "snapshot",
  "graphic",
  "capture",
  "diagram",
  "illustration",
  "drawing",
  "one",
  "the",
  "that",
  "this",
  "these",
  "those",
  "a",
  "an",
  "any",
  "with",
  "in",
  "on",
  "at",
  "by",
  "for",
  "from",
  "of",
  "through",
  "about",
  "under",
  "over",
  "between",
  "had",
  "has",
  "have",
  "having",
  "contained",
  "contains",
  "containing",
  "mention",
  "mentions",
  "mentioned",
  "mentioning",
  "said",
  "says",
  "saying",
  "depicted",
  "depicts",
  "depicting",
  "was",
  "is",
  "are",
  "were",
  "be",
  "been",
  "being",
  "there",
  "me",
  "you",
  "we",
  "i",
  "he",
  "she",
  "it",
  "they",
  "to",
  "and",
  "or",
  "so",
  "if",
  "then",
  "else",
]);

/**
 * Normalizes a user prompt into cleaned lexical search terms and determines eligibility for Phase 3B.1 Lexical Rescue.
 * 1. Strips conversational/retrieval framing and punctuation while preserving hyphens and alphanumeric identifiers.
 * 2. Filters common retrieval stopwords.
 * 3. Classifies terms into informative vs broad visual terms.
 * 4. Determines eligibility:
 *    - (A) >= 2 terms AND >= 1 informative/non-broad term, OR
 *    - (B) Contains >= 1 distinctive token (has hyphen or digits, length >= 3).
 *    - Rejects broad-only single words or broad-only pairs (e.g. "window", "tree", "window tree").
 */
export function normalizeImageLexicalQuery(prompt?: string | null): NormalizedLexicalQuery {
  if (!prompt || typeof prompt !== "string") {
    return {
      rawPrompt: "",
      queryText: "",
      terms: [],
      informativeTerms: [],
      eligibleForRescue: false,
    };
  }

  const rawPrompt = prompt.trim();
  if (!rawPrompt) {
    return {
      rawPrompt: "",
      queryText: "",
      terms: [],
      informativeTerms: [],
      eligibleForRescue: false,
    };
  }

  // Tokenize preserving alphanumeric characters, hyphens, and underscores
  const rawTokens = rawPrompt
    .replace(/[^\w\s\-]/g, " ")
    .split(/\s+/)
    .map((t) => t.trim())
    .filter((t) => t.length > 0);

  const terms: string[] = [];
  let hasDistinctiveToken = false;

  for (const token of rawTokens) {
    const lower = token.toLowerCase();

    // Check for distinctive token: contains hyphen (e.g., FIRE-FEU) or digit (e.g., 502, IMG_1402)
    if (token.length >= 3 && (/^[a-z0-9]+-[a-z0-9]+$/i.test(token) || /\d/.test(token))) {
      hasDistinctiveToken = true;
    }

    if (!RETRIEVAL_STOPWORDS.has(lower) && lower.length > 1) {
      terms.push(lower);
    }
  }

  const informativeTerms = terms.filter((t) => !BROAD_VISUAL_TERMS.has(t));

  const eligibleForRescue =
    (terms.length >= 2 && informativeTerms.length >= 1) ||
    (hasDistinctiveToken && terms.length >= 1);

  return {
    rawPrompt,
    queryText: terms.join(" "),
    terms,
    informativeTerms,
    eligibleForRescue,
  };
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
 * Executes Phase 3B Semantic Historical Image Retrieval with Phase 3B.1 Lexical Rescue:
 * 1. Checks deterministic precedence (resolveImageEvidence). If resolved -> bypasses with 0 embedding calls.
 * 2. Generates dedicated float[1536] query embedding via google/gemini-embedding-2.
 * 3. Invokes match_discussion_image_descriptors vector RPC.
 * 4. Logs raw vector candidates.
 * 5. Applies calibrated ranking (0.36 min similarity, 0.05 gap, max 2).
 * 6. If semantic ranking succeeds -> returns semantic results (authoritative).
 * 7. If semantic ranking fails (S1 < 0.36) -> evaluates conservative lexical query normalization.
 * 8. If eligible -> calls match_discussion_image_descriptors_lexical RPC, deduplicates, selects top <= 2.
 * 9. Resolves candidate artifact IDs to canonical KnownImageSource objects.
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

    // Build canonical earliest source map
    const earliestSourceMap = new Map<string, KnownImageSource>();
    for (const src of knownSources) {
      if (!earliestSourceMap.has(src.artifactId)) {
        earliestSourceMap.set(src.artifactId, src);
      }
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

    const candidateMatches: SemanticCandidateMatch[] = Array.isArray(rpcRows)
      ? rpcRows
          .filter(
            (r) =>
              r &&
              typeof r.artifact_id === "string" &&
              r.artifact_id.trim() !== "" &&
              (typeof r.similarity === "number" || typeof r.similarity === "string")
          )
          .map((r: any) => ({
            artifact_id: r.artifact_id,
            similarity: typeof r.similarity === "number" ? r.similarity : parseFloat(r.similarity),
          }))
          .sort((a, b) => b.similarity - a.similarity)
      : [];

    // Diagnostic log: raw vector candidates emitted unconditionally
    console.log(
      "[Semantic Image Retrieval] raw vector candidates:",
      candidateMatches.slice(0, 5).map((c) => ({
        artifactId: c.artifact_id,
        similarity: Number(c.similarity.toFixed(4)),
      }))
    );

    // 5. Calibrated Semantic Ranking
    const rankingResult = rankSemanticImageCandidates(candidateMatches);

    if (rankingResult && rankingResult.selected.length > 0) {
      const mappedSources: KnownImageSource[] = [];
      for (const candidate of rankingResult.selected) {
        const src = earliestSourceMap.get(candidate.artifact_id);
        if (src && src.storagePath) {
          mappedSources.push(src);
        }
      }

      if (mappedSources.length > 0) {
        const reason = rankingResult.selected.length === 1 ? "semantic_clear" : "semantic_ambiguous";
        console.log("[Semantic Image Retrieval] resolution summary:", {
          decisionReason: reason,
          selectedCount: mappedSources.length,
          topSimilarity: Number(rankingResult.topSimilarity.toFixed(4)),
          topGap: rankingResult.topGap !== null ? Number(rankingResult.topGap.toFixed(4)) : null,
          topLexicalRank: null,
        });

        return {
          sources: mappedSources,
          candidates: rankingResult.selected,
          topSimilarity: rankingResult.topSimilarity,
          topGap: rankingResult.topGap,
          decisionReason: reason,
        };
      }
    }

    // 6. Phase 3B.1 Conservative Lexical Rescue Fallback
    // Semantic threshold was not met (S1 < 0.36) or produced no matches
    const norm = normalizeImageLexicalQuery(prompt);

    console.log("[Semantic Image Retrieval] lexical query:", {
      queryText: norm.queryText,
      termCount: norm.terms.length,
      informativeTermCount: norm.informativeTerms.length,
      eligibleForRescue: norm.eligibleForRescue,
    });

    if (!norm.eligibleForRescue || !norm.queryText.trim() || signal?.aborted) {
      console.log("[Semantic Image Retrieval] resolution summary:", {
        decisionReason: "none",
        selectedCount: 0,
        topSimilarity: candidateMatches.length > 0 ? Number(candidateMatches[0].similarity.toFixed(4)) : 0,
        topGap: null,
        topLexicalRank: null,
      });
      return null;
    }

    // 7. Lexical RPC Execution
    let lexicalRows: any[] | null = null;
    try {
      const { data, error } = await serviceSupabase.rpc("match_discussion_image_descriptors_lexical", {
        p_discussion_id: discussionId,
        p_query_text: norm.queryText,
        p_match_count: SEMANTIC_IMAGE_RPC_MATCH_COUNT,
      });

      if (error) {
        console.warn("[Semantic Image Retrieval] Lexical RPC execution error:", error);
      } else {
        lexicalRows = data;
      }
    } catch (lexErr: any) {
      if (signal?.aborted) return null;
      console.warn("[Semantic Image Retrieval] Lexical RPC call threw error:", lexErr?.message || lexErr);
    }

    const rawLexicalMatches: LexicalCandidateMatch[] = Array.isArray(lexicalRows)
      ? lexicalRows
          .filter((r) => r && typeof r.artifact_id === "string" && r.artifact_id.trim() !== "")
          .map((r: any) => ({
            artifact_id: r.artifact_id,
            lexical_rank:
              typeof r.lexical_rank === "number"
                ? r.lexical_rank
                : parseFloat(r.lexical_rank || "0"),
          }))
          .filter((r) => Number.isFinite(r.lexical_rank) && r.lexical_rank > 0)
          .sort((a, b) => b.lexical_rank - a.lexical_rank)
      : [];

    console.log(
      "[Semantic Image Retrieval] raw lexical candidates:",
      rawLexicalMatches.slice(0, 5).map((m) => ({
        artifactId: m.artifact_id,
        lexicalRank: Number(m.lexical_rank.toFixed(4)),
      }))
    );

    if (rawLexicalMatches.length === 0) {
      console.log("[Semantic Image Retrieval] resolution summary:", {
        decisionReason: "none",
        selectedCount: 0,
        topSimilarity: candidateMatches.length > 0 ? Number(candidateMatches[0].similarity.toFixed(4)) : 0,
        topGap: null,
        topLexicalRank: null,
      });
      return null;
    }

    // 8. Deduplicate and select top candidates (max SEMANTIC_IMAGE_MAX_CANDIDATES = 2)
    const seenArtifactIds = new Set<string>();
    const selectedLexicalCandidates: LexicalCandidateMatch[] = [];

    for (const match of rawLexicalMatches) {
      if (!seenArtifactIds.has(match.artifact_id)) {
        seenArtifactIds.add(match.artifact_id);
        selectedLexicalCandidates.push(match);
        if (selectedLexicalCandidates.length >= SEMANTIC_IMAGE_MAX_CANDIDATES) {
          break;
        }
      }
    }

    const lexicalMappedSources: KnownImageSource[] = [];
    for (const cand of selectedLexicalCandidates) {
      const src = earliestSourceMap.get(cand.artifact_id);
      if (src && src.storagePath) {
        lexicalMappedSources.push(src);
      }
    }

    if (lexicalMappedSources.length === 0) {
      console.log("[Semantic Image Retrieval] resolution summary:", {
        decisionReason: "none",
        selectedCount: 0,
        topSimilarity: candidateMatches.length > 0 ? Number(candidateMatches[0].similarity.toFixed(4)) : 0,
        topGap: null,
        topLexicalRank: Number(selectedLexicalCandidates[0].lexical_rank.toFixed(4)),
      });
      return null;
    }

    console.log("[Semantic Image Retrieval] resolution summary:", {
      decisionReason: "lexical_rescue",
      selectedCount: lexicalMappedSources.length,
      topSimilarity: candidateMatches.length > 0 ? Number(candidateMatches[0].similarity.toFixed(4)) : 0,
      topGap: null,
      topLexicalRank: Number(selectedLexicalCandidates[0].lexical_rank.toFixed(4)),
    });

    return {
      sources: lexicalMappedSources,
      candidates: selectedLexicalCandidates.map((c) => ({
        artifact_id: c.artifact_id,
        similarity: candidateMatches.find((cm) => cm.artifact_id === c.artifact_id)?.similarity ?? 0,
      })),
      topSimilarity: candidateMatches.length > 0 ? candidateMatches[0].similarity : 0,
      topGap: null,
      decisionReason: "lexical_rescue",
      lexicalRank: selectedLexicalCandidates[0].lexical_rank,
    };
  } catch (err: any) {
    if (signal?.aborted) return null;
    console.warn("[Semantic Image Retrieval] Non-critical error during semantic image retrieval:", err);
    return null;
  }
}
