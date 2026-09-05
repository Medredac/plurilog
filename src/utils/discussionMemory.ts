import OpenAI from 'openai';
import crypto from 'node:crypto';
import { SupabaseClient } from '@supabase/supabase-js';
import { createServiceClient } from '@/utils/supabase/service';

export interface HistoryMessage {
  id?: string;
  discussion_id: string;
  sender: string;
  content: string;
  attachment_urls?: string[] | null;
  image_url?: string | null;
  visual_document_id?: string | null;
  created_at?: string;
}

export interface KnownDiscussionDocument {
  id?: string | null;
  filename: string;
  storagePath?: string | null;
  sourcePaths?: string[];
  createdAt?: string;
}

export interface RoundAttachment {
  filename: string;
  storagePath?: string | null;
  documentId?: string | null;
}

export interface Round {
  userMessageId?: string;
  userPrompt: string;
  attachments?: RoundAttachment[];
  visualDocumentId?: string | null;
  modelResponses: { name: string; content: string }[];
}

export interface DiscussionStructuredMemory {
  _meta: {
    last_summarized_user_message_id?: string;
    summarized_rounds_count: number;
  };
  user_facts: string[];
  topics_and_context: string[];
  decisions_and_conclusions: string[];
  panel_disagreements_and_nuance: string[];
  unresolved_questions: string[];
  likely_future_callbacks: string[];
}

export interface ChronologicalMemoryResult {
  roundUserMessageId?: string;
  kind: 'user_prompt' | 'model_response';
  speaker?: 'Claude' | 'Gemini' | 'ChatGPT' | 'User';
  content: string;
  label: string;
}

export interface DiscussionMemoryResult {
  summary?: string;
  recentRounds: Round[];
  chronologicalMemory?: ChronologicalMemoryResult;
  knownDocuments?: KnownDiscussionDocument[];
}

export const SEMANTIC_KEYS = [
  'user_facts',
  'topics_and_context',
  'decisions_and_conclusions',
  'panel_disagreements_and_nuance',
  'unresolved_questions',
  'likely_future_callbacks',
] as const;

export const STRUCTURED_MEMORY_LIMITS = {
  user_facts: 5,
  topics_and_context: 8,
  decisions_and_conclusions: 8,
  panel_disagreements_and_nuance: 6,
  unresolved_questions: 5,
  likely_future_callbacks: 5,
} as const;

/**
 * Distinguishes between valid structured JSON memory, legacy prose summary, and empty summary.
 * Strict validation: requires all 6 semantic keys to exist as arrays of strings.
 */
export function parseDiscussionSummary(rawSummary?: string | null): {
  structured: DiscussionStructuredMemory | null;
  legacyProse: string | null;
} {
  if (!rawSummary || !rawSummary.trim()) {
    return { structured: null, legacyProse: null };
  }

  const trimmed = rawSummary.trim();
  if (trimmed.startsWith('{') && trimmed.endsWith('}')) {
    try {
      const parsed = JSON.parse(trimmed);
      if (parsed && typeof parsed === 'object' && !Array.isArray(parsed)) {
        let allValid = true;
        for (const key of SEMANTIC_KEYS) {
          if (!Array.isArray(parsed[key])) {
            allValid = false;
            break;
          }
          for (const item of parsed[key]) {
            if (typeof item !== 'string') {
              allValid = false;
              break;
            }
          }
          if (!allValid) break;
        }

        const meta = parsed._meta;
        const isMetaValid =
          meta &&
          typeof meta === 'object' &&
          !Array.isArray(meta) &&
          typeof meta.summarized_rounds_count === 'number' &&
          Number.isInteger(meta.summarized_rounds_count) &&
          meta.summarized_rounds_count >= 0 &&
          (meta.last_summarized_user_message_id === undefined ||
            (typeof meta.last_summarized_user_message_id === 'string' &&
              meta.last_summarized_user_message_id.trim() !== ''));

        if (!isMetaValid) {
          allValid = false;
        }

        if (allValid) {
          return {
            structured: {
              _meta: {
                summarized_rounds_count: meta.summarized_rounds_count,
                ...(meta.last_summarized_user_message_id
                  ? { last_summarized_user_message_id: meta.last_summarized_user_message_id }
                  : {}),
              },
              user_facts: parsed.user_facts,
              topics_and_context: parsed.topics_and_context,
              decisions_and_conclusions: parsed.decisions_and_conclusions,
              panel_disagreements_and_nuance: parsed.panel_disagreements_and_nuance,
              unresolved_questions: parsed.unresolved_questions,
              likely_future_callbacks: parsed.likely_future_callbacks,
            },
            legacyProse: null,
          };
        }
      }
    } catch {
      // Not valid JSON, fall through to legacy prose
    }
  }

  return { structured: null, legacyProse: trimmed };
}

/**
 * Formats structured memory into human-readable compact text for panel context.
 * Omit empty sections and NEVER injects _meta into prompt context.
 */
export function formatStructuredMemoryForContext(
  memory: DiscussionStructuredMemory
): string {
  const sections: string[] = [];

  if (memory.user_facts && memory.user_facts.length > 0) {
    sections.push(`USER FACTS\n${memory.user_facts.map((item) => `- ${item}`).join('\n')}`);
  }

  if (memory.topics_and_context && memory.topics_and_context.length > 0) {
    sections.push(`TOPICS & CONTEXT\n${memory.topics_and_context.map((item) => `- ${item}`).join('\n')}`);
  }

  if (memory.decisions_and_conclusions && memory.decisions_and_conclusions.length > 0) {
    sections.push(`DECISIONS & CONCLUSIONS\n${memory.decisions_and_conclusions.map((item) => `- ${item}`).join('\n')}`);
  }

  if (memory.panel_disagreements_and_nuance && memory.panel_disagreements_and_nuance.length > 0) {
    sections.push(
      `PANEL DISAGREEMENTS & NUANCE\n${memory.panel_disagreements_and_nuance.map((item) => `- ${item}`).join('\n')}`
    );
  }

  if (memory.unresolved_questions && memory.unresolved_questions.length > 0) {
    sections.push(`UNRESOLVED QUESTIONS\n${memory.unresolved_questions.map((item) => `- ${item}`).join('\n')}`);
  }

  if (memory.likely_future_callbacks && memory.likely_future_callbacks.length > 0) {
    sections.push(`CALLBACKS / RUNNING THREADS\n${memory.likely_future_callbacks.map((item) => `- ${item}`).join('\n')}`);
  }

  return sections.join('\n\n');
}

/**
 * Helper to determine if a URL or storage path points to a PDF.
 */
export function isPdfUrl(url?: string | null, storagePath?: string | null): boolean {
  if (!url && !storagePath) return false;
  const pathToCheck = (storagePath || url || '').split('?')[0].toLowerCase();
  return pathToCheck.endsWith('.pdf');
}

/**
 * Supported standalone image file extensions reliably accepted across visual model seats.
 */
export const SUPPORTED_IMAGE_EXTENSIONS = [
  '.png',
  '.jpg',
  '.jpeg',
  '.webp',
  '.gif',
] as const;

/**
 * Deterministically checks if a URL or storage path refers to a supported standalone image file.
 * Explicitly excludes PDFs, DOCX, XLSX, etc.
 */
export function isImageUrl(url?: string | null, storagePath?: string | null): boolean {
  if (!url && !storagePath) return false;
  const pathToCheck = (storagePath || url || '').split('?')[0].toLowerCase();
  // Ensure PDFs, Word, Excel, and non-image documents are never matched
  if (
    pathToCheck.endsWith('.pdf') ||
    pathToCheck.endsWith('.docx') ||
    pathToCheck.endsWith('.doc') ||
    pathToCheck.endsWith('.xlsx') ||
    pathToCheck.endsWith('.xls') ||
    pathToCheck.endsWith('.txt') ||
    pathToCheck.endsWith('.csv')
  ) {
    return false;
  }
  return SUPPORTED_IMAGE_EXTENSIONS.some((ext) => pathToCheck.endsWith(ext));
}

/**
 * Extracts clean attachment metadata (filename and storagePath) from a stored attachment URL or image URL.
 * Deterministically resolves documentId using canonical storagePath and source-alias paths if knownDocuments is provided.
 */
export function extractAttachmentMetadata(
  url?: string | null,
  knownDocuments?: KnownDiscussionDocument[]
): RoundAttachment | null {
  if (!url || typeof url !== 'string') return null;

  const storagePath = extractStoragePathFromSignedUrl(url);
  const isPdf = isPdfUrl(url, storagePath);
  let filename = isPdf ? 'attachment.pdf' : 'attachment';

  if (storagePath) {
    const rawFilename = storagePath.split('/').pop() || '';
    const cleaned = rawFilename.replace(/^\d+-\d+-[^-]+-/, '');
    if (cleaned) {
      filename = decodeURIComponent(cleaned);
    }
  } else {
    const rawName = url.split('?')[0].split('/').pop() || '';
    if (rawName) {
      filename = decodeURIComponent(rawName);
    }
  }

  let documentId: string | null = null;
  if (isPdf && Array.isArray(knownDocuments) && knownDocuments.length > 0) {
    if (storagePath) {
      const matchByPath = knownDocuments.find(
        (d) =>
          (d.storagePath && d.storagePath === storagePath && d.id) ||
          (Array.isArray(d.sourcePaths) && d.sourcePaths.includes(storagePath) && d.id)
      );
      if (matchByPath && matchByPath.id) {
        documentId = matchByPath.id;
      }
    }

    if (!documentId && filename) {
      const normFilename = filename.toLowerCase().trim();
      const matchByName = knownDocuments.filter(
        (d) => d.filename && d.filename.toLowerCase().trim() === normFilename && d.id
      );
      if (matchByName.length === 1 && matchByName[0].id) {
        documentId = matchByName[0].id;
      }
    }
  }

  return {
    filename,
    storagePath: storagePath || null,
    documentId: documentId || null,
  };
}

/**
 * Formats a Round into the exact textual representation used in model context.
 * Special handling: omits userPrompt if it is equal to 'continue'.
 */
export function formatRoundForContext(round: Round): string {
  const isContinueUser = round.userPrompt.trim().toLowerCase() === 'continue';
  if (isContinueUser) {
    return round.modelResponses
      .map((mr) => `${mr.name} said:\n"""\n${mr.content}\n"""`)
      .join('\n\n');
  }

  const attachmentLines: string[] = [];
  if (round.attachments && round.attachments.length > 0) {
    for (const att of round.attachments) {
      const docLabel = att.documentId ? `[doc_${att.documentId}] ` : '';
      attachmentLines.push(`- ${docLabel}${att.filename}`);
    }
  }

  let userPart = '';
  if (attachmentLines.length > 0) {
    const attachBlock = `User attached:\n${attachmentLines.join('\n')}`;
    if (round.userPrompt.trim()) {
      userPart = `${attachBlock}\n\nUser said:\n"""\n${round.userPrompt}\n"""`;
    } else {
      userPart = `${attachBlock}\n\nNo text prompt was provided.`;
    }
  } else if (round.userPrompt.trim()) {
    userPart = `User said:\n"""\n${round.userPrompt}\n"""`;
  } else {
    userPart = 'User shared attachment(s) without a text prompt.';
  }

  const modelParts = round.modelResponses
    .map((mr) => `${mr.name} said:\n"""\n${mr.content}\n"""`)
    .join('\n\n');

  if (!userPart) return modelParts;
  return modelParts ? `${userPart}\n\n${modelParts}` : userPart;
}

/**
 * Conservative cross-model / multilingual token estimator based on JavaScript character length
 * and UTF-8 byte length. Used strictly for context window budgeting, not provider billing.
 */
export function estimateTokens(text: string): number {
  const utf8Bytes = new TextEncoder().encode(text).length;
  return Math.ceil(Math.max(text.length / 4, utf8Bytes / 3));
}

export const RECENT_MEMORY_TOKEN_BUDGET = 4000;
export const RETRIEVED_MEMORY_TOKEN_BUDGET = 2500;

/**
 * Determines the split index in a rounds array so that the newest complete rounds backwards
 * fit within the given token budget. Always includes at least the newest round if rounds exist.
 */
export function getRecentRoundsSplitIndex(
  rounds: Round[],
  tokenBudget: number = RECENT_MEMORY_TOKEN_BUDGET
): number {
  const total = rounds.length;
  if (total <= 1) return 0;

  let splitIndex = total - 1;
  let accumulatedTokens = estimateTokens(formatRoundForContext(rounds[splitIndex]));

  for (let i = total - 2; i >= 0; i--) {
    const roundTokens = estimateTokens(formatRoundForContext(rounds[i]));
    if (accumulatedTokens + roundTokens <= tokenBudget) {
      accumulatedTokens += roundTokens;
      splitIndex = i;
    } else {
      break;
    }
  }

  return splitIndex;
}

/**
 * Groups raw chronological messages from the messages table into conversational rounds.
 * A round begins with a user prompt followed by all panelist responses for that turn.
 */
export function groupMessagesIntoRounds(
  messages: HistoryMessage[],
  currentPrompt: string,
  knownDocuments?: KnownDiscussionDocument[]
): Round[] {
  const rounds: Round[] = [];
  let currentRound: Round | null = null;

  for (const msg of messages) {
    if (msg.sender === 'user') {
      if (
        currentRound &&
        (currentRound.userPrompt.trim() ||
          currentRound.modelResponses.length > 0 ||
          (currentRound.attachments && currentRound.attachments.length > 0))
      ) {
        rounds.push(currentRound);
      }

      const attachments: RoundAttachment[] = [];
      const rawUrls: string[] = [];
      if (Array.isArray(msg.attachment_urls)) {
        for (const u of msg.attachment_urls) {
          if (u) rawUrls.push(u);
        }
      }
      if (msg.image_url && !rawUrls.includes(msg.image_url)) {
        rawUrls.push(msg.image_url);
      }

      for (const url of rawUrls) {
        const attMeta = extractAttachmentMetadata(url, knownDocuments);
        if (attMeta) {
          attachments.push(attMeta);
        }
      }

      currentRound = {
        userMessageId: msg.id,
        userPrompt: msg.content || '',
        ...(attachments.length > 0 ? { attachments } : {}),
        visualDocumentId: msg.visual_document_id || null,
        modelResponses: [],
      };
    } else if (currentRound) {
      let modelName = msg.sender;
      const lower = msg.sender.toLowerCase();
      if (lower.includes('gemini') || lower.includes('google')) modelName = 'Gemini';
      else if (lower.includes('claude') || lower.includes('anthropic')) modelName = 'Claude';
      else if (lower.includes('chatgpt') || lower.includes('gpt') || lower.includes('openai')) modelName = 'ChatGPT';

      currentRound.modelResponses.push({
        name: modelName,
        content: msg.content || '',
      });
    }
  }

  if (
    currentRound &&
    (currentRound.userPrompt.trim() ||
      currentRound.modelResponses.length > 0 ||
      (currentRound.attachments && currentRound.attachments.length > 0))
  ) {
    // If this round matches the active prompt (or is a continue round with prompt='') and has 0 model responses yet, it's the currently in-flight turn
    const isCurrentInFlight =
      currentRound.modelResponses.length === 0 &&
      (currentPrompt.trim() === '' || currentRound.userPrompt.trim() === currentPrompt.trim());

    if (!isCurrentInFlight) {
      rounds.push(currentRound);
    }
  }

  return rounds;
}

export const ORDINAL_MAP: Record<string, number> = {
  first: 0,
  '1st': 0,
  second: 1,
  '2nd': 1,
  third: 2,
  '3rd': 2,
  fourth: 3,
  '4th': 3,
  fifth: 4,
  '5th': 4,
  sixth: 5,
  '6th': 5,
  seventh: 6,
  '7th': 6,
  eighth: 7,
  '8th': 7,
  ninth: 8,
  '9th': 8,
  tenth: 9,
  '10th': 9,
};

export const ANCHOR_NOISE_WORDS = new Set([
  'the',
  'a',
  'an',
  'my',
  'our',
  'question',
  'questions',
  'prompt',
  'prompts',
  'turn',
  'turns',
  'discussion',
  'discussions',
  'conversation',
  'conversations',
  'when',
  'we',
  'talked',
  'talking',
  'discussed',
  'discussing',
  'about',
  'comparison',
  'comparisons',
  'i',
  'made',
  'asked',
  'said',
  'started',
  'start',
]);

/**
 * Detects whether a prompt matches any supported Stage A or Stage B chronology query.
 * Used to exclude chronology meta-queries from historical content-anchor matching.
 */
export function isChronologyQuery(prompt: string): boolean {
  if (!prompt) return false;
  const clean = prompt.trim().toLowerCase().replace(/[?.!]+$/, '').trim();

  // 1. Stage B current-turn & relative intents
  if (
    /^(?:can you (?:please )?)?(?:tell me )?what did i (?:ask|say) (?:right|immediately|just) (?:before|after)\b/i.test(
      clean
    )
  ) {
    return true;
  }
  if (
    /^(?:can you (?:please )?)?(?:tell me )?what did (?:claude|gemini|chatgpt) (?:say|ask|reply|state) (?:right|immediately|just) (?:before|after)\b/i.test(
      clean
    )
  ) {
    return true;
  }

  // 2. Stage A speaker first/last intents
  const isSpeakerStageA =
    /^(?:can you (?:please )?)?(?:tell me )?what did (?:claude|gemini|chatgpt) (?:say|ask|reply|state) (?:first|initially|last|most recently)$/i.test(
      clean
    ) ||
    /^(?:can you (?:please )?)?(?:tell me )?what was the (?:first|earliest|initial|last|latest|most recent) thing (?:claude|gemini|chatgpt) (?:said|asked|stated|replied)$/i.test(
      clean
    ) ||
    /^(?:can you (?:please )?)?(?:tell me )?what was (?:claude|gemini|chatgpt)('s|s)? (?:first|earliest|initial|last|latest|most recent) (?:response|message|reply|statement)$/i.test(
      clean
    ) ||
    /^(?:can you (?:please )?)?(?:tell me )?what was the (?:first|earliest|initial|last|latest|most recent) (?:response|message|reply|statement) (?:from|by) (?:claude|gemini|chatgpt)$/i.test(
      clean
    ) ||
    /^(?:the )?(?:first|earliest|initial|last|latest|most recent) thing (?:claude|gemini|chatgpt) (?:said|asked|stated|replied)$/i.test(
      clean
    ) ||
    /^(?:claude|gemini|chatgpt)('s|s)? (?:first|earliest|initial|last|latest|most recent) (?:response|message|reply|statement)$/i.test(
      clean
    );

  if (isSpeakerStageA) {
    return true;
  }

  // 3. Stage A user ordinal / first / earliest intents (anchored full-query matching)
  const isUserStageA =
    /^(?:can you (?:please )?)?(?:tell me )?what (?:was|did i (?:ask|say) in) (?:my |the )?(?:first|second|third|fourth|fifth|sixth|seventh|eighth|ninth|tenth|1st|2nd|3rd|4th|5th|6th|7th|8th|9th|10th) (?:thing|question|prompt|turn)$/i.test(
      clean
    ) ||
    /^(?:can you (?:please )?)?(?:tell me )?what did i (?:ask|say) (?:first|second|third|fourth|fifth|sixth|seventh|eighth|ninth|tenth|1st|2nd|3rd|4th|5th|6th|7th|8th|9th|10th)$/i.test(
      clean
    ) ||
    /^(?:can you (?:please )?)?(?:tell me )?what was (?:my |the )?(?:first|earliest) (?:thing|question|prompt|turn)(?: i (?:asked|said))?$/i.test(
      clean
    ) ||
    /^(?:can you (?:please )?)?(?:tell me )?what was the (?:first|earliest) thing i said$/i.test(
      clean
    );

  return isUserStageA;
}

/**
 * Deterministically locates an anchor round in allRounds based on userPrompt matching only.
 * Returns the round index k, or null if 0 or >1 matches are found (no guessing on ties).
 */
export function findAnchorRoundIndex(rawAnchor: string, allRounds: Round[]): number | null {
  if (!rawAnchor || !allRounds || allRounds.length === 0) {
    return null;
  }

  const normalizedRaw = rawAnchor
    .toLowerCase()
    .replace(/[-_]/g, ' ')
    .replace(/[^\w\s]/g, '')
    .trim();

  const tokens = normalizedRaw.split(/\s+/).filter(Boolean);
  const meaningfulTerms = tokens.filter(
    (t) => !ANCHOR_NOISE_WORDS.has(t) && t.length >= 2
  );

  if (meaningfulTerms.length === 0) {
    return null;
  }

  const phrase = meaningfulTerms.join(' ');

  const phraseMatches: number[] = [];
  const allTermsMatches: number[] = [];

  for (let i = 0; i < allRounds.length; i++) {
    // Exclude prior chronology/navigation meta-queries from becoming substantive anchors
    if (isChronologyQuery(allRounds[i].userPrompt)) {
      continue;
    }

    const promptNorm = allRounds[i].userPrompt
      .toLowerCase()
      .replace(/[-_]/g, ' ')
      .replace(/[^\w\s]/g, '');

    if (promptNorm.includes(phrase)) {
      phraseMatches.push(i);
    }
    const hasAllTerms = meaningfulTerms.every((term) => promptNorm.includes(term));
    if (hasAllTerms) {
      allTermsMatches.push(i);
    }
  }

  // If there is exactly one contiguous phrase match, return it
  if (phraseMatches.length === 1) {
    return phraseMatches[0];
  }
  // If multiple contiguous phrase matches, tie -> return null
  if (phraseMatches.length > 1) {
    return null;
  }

  // If no contiguous phrase match, check if all meaningful terms appear in exactly one round
  if (allTermsMatches.length === 1) {
    return allTermsMatches[0];
  }

  // 0 or >1 matches -> return null
  return null;
}

export const MIN_ANCHOR_SEMANTIC_SIMILARITY = 0.68;
export const MIN_ANCHOR_SEMANTIC_MARGIN = 0.025;

export interface SemanticAnchorOptions {
  supabase?: SupabaseClient;
  openai?: OpenAI;
  discussionId?: string;
}

/**
 * Stage B v2: Semantic anchor fallback.
 * Used ONLY when local deterministic anchor matching cannot uniquely resolve rawAnchor.
 * Retrieves candidates via search_discussion_memory_hybrid, filters to eligible non-meta historical rounds,
 * and requires strict semantic dominance (similarity >= 0.68 and top1 - top2 >= 0.025).
 */
export async function resolveSemanticAnchorRoundIndex(
  rawAnchor: string,
  allRounds: Round[],
  options?: SemanticAnchorOptions
): Promise<number | null> {
  if (!rawAnchor || !allRounds || allRounds.length === 0) return null;
  if (!options?.supabase || !options?.openai || !options?.discussionId) return null;

  try {
    const embRes = await (options.openai.embeddings.create as any)(
      {
        model: 'google/gemini-embedding-2',
        dimensions: 1536,
        input: rawAnchor,
        encoding_format: 'float',
      },
      { timeout: 10000 }
    );

    const queryEmbedding = embRes?.data?.[0]?.embedding;
    if (!Array.isArray(queryEmbedding) || queryEmbedding.length !== 1536) {
      console.error('[Memory Chronology Semantic] Missing or invalid 1536-dimension embedding for anchor');
      return null;
    }

    // Empirically chosen Stage B v2 candidate pool based on the current calibration
    const { data: hybridRows, error: searchErr } = await options.supabase.rpc(
      'search_discussion_memory_hybrid',
      {
        p_discussion_id: options.discussionId,
        p_query_text: rawAnchor,
        p_query_embedding: queryEmbedding,
        p_match_count: 20,
      }
    );

    if (searchErr || !Array.isArray(hybridRows) || hybridRows.length === 0) {
      return null;
    }

    // Map source_user_message_id to historical round in allRounds and aggregate max semantic_similarity
    const roundMap = new Map<number, { roundIndex: number; sourceId: string; maxSim: number }>();

    for (const row of hybridRows) {
      const srcId = row?.source_user_message_id;
      if (!srcId) continue;

      const roundIdx = allRounds.findIndex((r) => r.userMessageId === srcId);
      if (roundIdx === -1) continue; // Discard results that do not map to allRounds

      // Discard rounds where isChronologyQuery is true
      if (isChronologyQuery(allRounds[roundIdx].userPrompt)) {
        continue;
      }

      const sim = typeof row?.semantic_similarity === 'number' ? row.semantic_similarity : 0;
      const existing = roundMap.get(roundIdx);
      if (!existing) {
        roundMap.set(roundIdx, { roundIndex: roundIdx, sourceId: srcId, maxSim: sim });
      } else if (sim > existing.maxSim) {
        existing.maxSim = sim;
      }
    }

    const eligibleCandidates = Array.from(roundMap.values());
    if (eligibleCandidates.length === 0) {
      return null;
    }

    // Sort strictly by semantic_similarity DESC (hybrid_score and keyword_rank are not used for final decision)
    eligibleCandidates.sort((a, b) => b.maxSim - a.maxSim);

    const top1 = eligibleCandidates[0];
    if (top1.maxSim < MIN_ANCHOR_SEMANTIC_SIMILARITY) {
      return null;
    }

    const totalEligibleHistoricalRounds = allRounds.filter(
      (r) => !isChronologyQuery(r.userPrompt)
    ).length;

    if (eligibleCandidates.length < 2) {
      // If fewer than two eligible historical candidates survive, return null,
      // unless the entire discussion genuinely contains only one eligible historical substantive round.
      if (totalEligibleHistoricalRounds <= 1) {
        console.log('[Memory Chronology Semantic] Resolved unique single-round anchor fallback', {
          rawAnchor,
          chosenSourceUserMessageId: top1.sourceId,
          chosenSemanticSimilarity: top1.maxSim,
          runnerUpSemanticSimilarity: null,
          margin: null,
        });
        return top1.roundIndex;
      }
      return null;
    }

    const top2 = eligibleCandidates[1];
    const margin = top1.maxSim - top2.maxSim;

    if (margin < MIN_ANCHOR_SEMANTIC_MARGIN) {
      return null;
    }

    console.log('[Memory Chronology Semantic] Resolved semantic fallback anchor', {
      rawAnchor,
      chosenSourceUserMessageId: top1.sourceId,
      chosenSemanticSimilarity: top1.maxSim,
      runnerUpSemanticSimilarity: top2.maxSim,
      margin,
    });

    return top1.roundIndex;
  } catch (err) {
    console.error('[Memory Chronology Semantic] Exception during semantic anchor resolution:', err);
    return null;
  }
}

/**
 * Resolves Stage A & Stage B deterministic chronology intents from already-ordered allRounds:
 * Stage A:
 * 1. User first/earliest
 * 2. User ordinal (1st-10th)
 * 3. Speaker latest/last (Claude, Gemini, ChatGPT)
 * 4. Speaker first/earliest (Claude, Gemini, ChatGPT)
 * Stage B v1 (Relative chronology):
 * 5. Current-turn special case: "What did I ask right before this question?"
 * 6. User-relative before/after: "What did I ask right/immediately/just before/after X?"
 * 7. Speaker-relative before/after: "What did [Speaker] say right/immediately/just before/after X?"
 * Stage B v2 (Semantic anchor fallback):
 * - If local deterministic anchor matching returns null for 6 or 7, attempts semantic anchor fallback
 *   to locate anchor round k, then executes deterministic adjacency navigation.
 */
export async function resolveDeterministicChronology(
  prompt: string,
  allRounds: Round[],
  semanticOptions?: SemanticAnchorOptions
): Promise<ChronologicalMemoryResult | null> {
  if (!prompt || !allRounds || allRounds.length === 0) {
    return null;
  }

  const trimmed = prompt.trim();
  const lower = trimmed.toLowerCase();
  const cleanPrompt = lower.replace(/[?.!]+$/, '').trim();

  // Stage B v1. Current-turn special case: "What did I ask right/immediately/just before this question?"
  const isCurrentTurnBefore =
    /^(?:can you (?:please )?)?(?:tell me )?what did i (?:ask|say) (?:right|immediately|just) before (?:this|this question|this prompt|this turn)$/i.test(
      cleanPrompt
    );

  if (isCurrentTurnBefore) {
    if (allRounds.length === 0) {
      return null;
    }
    const lastRoundIndex = allRounds.length - 1;
    const lastRound = allRounds[lastRoundIndex];
    return {
      roundUserMessageId: lastRound.userMessageId,
      kind: 'user_prompt',
      speaker: 'User',
      content: lastRound.userPrompt.trim(),
      label: `User's question immediately before this question (Round ${lastRoundIndex + 1})`,
    };
  }

  // Stage B. User-relative before / after: "What did I ask right/immediately/just before/after X?"
  const userRelMatch = cleanPrompt.match(
    /^(?:can you (?:please )?)?(?:tell me )?what did i (?:ask|say) (?:right|immediately|just) (before|after) (.+)$/i
  );

  if (userRelMatch) {
    const direction = userRelMatch[1].toLowerCase() as 'before' | 'after';
    const origAnchorMatch = prompt.trim().replace(/[?.!]+$/, '').match(/(?:before|after)\s+(.+)$/i);
    const rawAnchor = origAnchorMatch ? origAnchorMatch[1].trim() : userRelMatch[2].trim();

    let anchorIndex = findAnchorRoundIndex(rawAnchor, allRounds);
    if (anchorIndex !== null) {
      console.log('[Memory Chronology Local] Resolved local deterministic anchor', {
        rawAnchor,
        chosenSourceUserMessageId: allRounds[anchorIndex].userMessageId,
        roundIndex: anchorIndex + 1,
      });
    } else if (semanticOptions) {
      anchorIndex = await resolveSemanticAnchorRoundIndex(rawAnchor, allRounds, semanticOptions);
    }

    if (anchorIndex !== null) {
      const anchorDisplay = rawAnchor.replace(/["'?.!]+$/g, '').replace(/^["']/g, '').trim();

      if (direction === 'before') {
        const targetIndex = anchorIndex - 1;
        if (targetIndex >= 0 && targetIndex < allRounds.length) {
          const targetRound = allRounds[targetIndex];
          return {
            roundUserMessageId: targetRound.userMessageId,
            kind: 'user_prompt',
            speaker: 'User',
            content: targetRound.userPrompt.trim(),
            label: `User's question immediately before "${anchorDisplay}" (Round ${targetIndex + 1})`,
          };
        }
      } else if (direction === 'after') {
        const targetIndex = anchorIndex + 1;
        if (targetIndex >= 0 && targetIndex < allRounds.length) {
          const targetRound = allRounds[targetIndex];
          return {
            roundUserMessageId: targetRound.userMessageId,
            kind: 'user_prompt',
            speaker: 'User',
            content: targetRound.userPrompt.trim(),
            label: `User's question immediately after "${anchorDisplay}" (Round ${targetIndex + 1})`,
          };
        }
      }
    }
    return null;
  }

  // Stage B. Speaker-relative before / after: "What did [Speaker] say right/immediately/just before/after X?"
  const speakerRelMatch = cleanPrompt.match(
    /^(?:can you (?:please )?)?(?:tell me )?what did (claude|gemini|chatgpt) (?:say|ask|reply|state) (?:right|immediately|just) (before|after) (.+)$/i
  );

  if (speakerRelMatch) {
    let relSpeaker: 'Claude' | 'Gemini' | 'ChatGPT';
    const rawSpeakerName = speakerRelMatch[1].toLowerCase();
    if (rawSpeakerName === 'claude') relSpeaker = 'Claude';
    else if (rawSpeakerName === 'gemini') relSpeaker = 'Gemini';
    else relSpeaker = 'ChatGPT';

    const direction = speakerRelMatch[2].toLowerCase() as 'before' | 'after';
    const origAnchorMatch = prompt.trim().replace(/[?.!]+$/, '').match(/(?:before|after)\s+(.+)$/i);
    const rawAnchor = origAnchorMatch ? origAnchorMatch[1].trim() : speakerRelMatch[3].trim();

    let anchorIndex = findAnchorRoundIndex(rawAnchor, allRounds);
    if (anchorIndex !== null) {
      console.log('[Memory Chronology Local] Resolved local deterministic anchor', {
        rawAnchor,
        chosenSourceUserMessageId: allRounds[anchorIndex].userMessageId,
        roundIndex: anchorIndex + 1,
      });
    } else if (semanticOptions) {
      anchorIndex = await resolveSemanticAnchorRoundIndex(rawAnchor, allRounds, semanticOptions);
    }

    if (anchorIndex !== null) {
      const anchorDisplay = rawAnchor.replace(/["'?.!]+$/g, '').replace(/^["']/g, '').trim();

      if (direction === 'after') {
        // Speaker response inside anchor round k (produced after user prompt k)
        const anchorRound = allRounds[anchorIndex];
        const resp = anchorRound.modelResponses.find(
          (m) => m.name.toLowerCase() === relSpeaker.toLowerCase()
        );
        if (resp && resp.content.trim()) {
          return {
            roundUserMessageId: anchorRound.userMessageId,
            kind: 'model_response',
            speaker: relSpeaker,
            content: resp.content.trim(),
            label: `${relSpeaker}'s response to "${anchorDisplay}" (Round ${anchorIndex + 1})`,
          };
        }
      } else if (direction === 'before') {
        // Nearest completed response from that named speaker before anchor user prompt k
        for (let j = anchorIndex - 1; j >= 0; j--) {
          const resp = allRounds[j].modelResponses.find(
            (m) => m.name.toLowerCase() === relSpeaker.toLowerCase()
          );
          if (resp && resp.content.trim()) {
            return {
              roundUserMessageId: allRounds[j].userMessageId,
              kind: 'model_response',
              speaker: relSpeaker,
              content: resp.content.trim(),
              label: `${relSpeaker}'s response prior to "${anchorDisplay}" (Round ${j + 1})`,
            };
          }
        }
      }
    }
    return null;
  }

  // Stage A. 1. Speaker-specific chronology (literal panel names only)
  let speaker: 'Claude' | 'Gemini' | 'ChatGPT' | null = null;
  if (/\bclaude\b/i.test(lower)) speaker = 'Claude';
  else if (/\bgemini\b/i.test(lower)) speaker = 'Gemini';
  else if (/\bchatgpt\b/i.test(lower)) speaker = 'ChatGPT';

  if (speaker) {
    const speakerLower = speaker.toLowerCase();

    const isSpeakerFirst =
      new RegExp(`^(?:can you (?:please )?)?(?:tell me )?what did ${speakerLower} (?:say|ask|reply|state) (?:first|initially)$`, 'i').test(cleanPrompt) ||
      new RegExp(`^(?:can you (?:please )?)?(?:tell me )?what was the (?:first|earliest|initial) thing ${speakerLower} (?:said|asked|stated|replied)$`, 'i').test(cleanPrompt) ||
      new RegExp(`^(?:can you (?:please )?)?(?:tell me )?what was ${speakerLower}('s|s)? (?:first|earliest|initial) (?:response|message|reply|statement)$`, 'i').test(cleanPrompt) ||
      new RegExp(`^(?:can you (?:please )?)?(?:tell me )?what was the (?:first|earliest|initial) (?:response|message|reply|statement) (?:from|by) ${speakerLower}$`, 'i').test(cleanPrompt) ||
      new RegExp(`^(?:the )?(?:first|earliest|initial) thing ${speakerLower} (?:said|asked|stated|replied)$`, 'i').test(cleanPrompt) ||
      new RegExp(`^${speakerLower}('s|s)? (?:first|earliest|initial) (?:response|message|reply|statement)$`, 'i').test(cleanPrompt);

    const isSpeakerLast =
      new RegExp(`^(?:can you (?:please )?)?(?:tell me )?what did ${speakerLower} (?:say|ask|reply|state) (?:last|most recently)$`, 'i').test(cleanPrompt) ||
      new RegExp(`^(?:can you (?:please )?)?(?:tell me )?what was the (?:last|latest|most recent) thing ${speakerLower} (?:said|asked|stated|replied)$`, 'i').test(cleanPrompt) ||
      new RegExp(`^(?:can you (?:please )?)?(?:tell me )?what was ${speakerLower}('s|s)? (?:last|latest|most recent) (?:response|message|reply|statement)$`, 'i').test(cleanPrompt) ||
      new RegExp(`^(?:can you (?:please )?)?(?:tell me )?what was the (?:last|latest|most recent) (?:response|message|reply|statement) (?:from|by) ${speakerLower}$`, 'i').test(cleanPrompt) ||
      new RegExp(`^(?:the )?(?:last|latest|most recent) thing ${speakerLower} (?:said|asked|stated|replied)$`, 'i').test(cleanPrompt) ||
      new RegExp(`^${speakerLower}('s|s)? (?:last|latest|most recent) (?:response|message|reply|statement)$`, 'i').test(cleanPrompt);

    if (isSpeakerLast) {
      // Walk backwards to find latest response from speaker
      for (let i = allRounds.length - 1; i >= 0; i--) {
        const resp = allRounds[i].modelResponses.find(
          (m) => m.name.toLowerCase() === speaker!.toLowerCase()
        );
        if (resp && resp.content.trim()) {
          return {
            roundUserMessageId: allRounds[i].userMessageId,
            kind: 'model_response',
            speaker,
            content: resp.content.trim(),
            label: `${speaker}'s most recent response`,
          };
        }
      }
      return null;
    }

    if (isSpeakerFirst) {
      // Walk forwards to find first response from speaker
      for (let i = 0; i < allRounds.length; i++) {
        const resp = allRounds[i].modelResponses.find(
          (m) => m.name.toLowerCase() === speaker!.toLowerCase()
        );
        if (resp && resp.content.trim()) {
          return {
            roundUserMessageId: allRounds[i].userMessageId,
            kind: 'model_response',
            speaker,
            content: resp.content.trim(),
            label: `${speaker}'s first response`,
          };
        }
      }
      return null;
    }
  }

  // 2. User ordinal / first / earliest queries
  const ordinalMatch =
    lower.match(
      /\bwhat (?:was|did I (?:ask|say) in) (?:my |the )?(first|second|third|fourth|fifth|sixth|seventh|eighth|ninth|tenth|1st|2nd|3rd|4th|5th|6th|7th|8th|9th|10th) (?:thing|question|prompt|turn)\b/i
    ) ||
    lower.match(
      /\bwhat did I (?:ask|say) (first|second|third|fourth|fifth|sixth|seventh|eighth|ninth|tenth|1st|2nd|3rd|4th|5th|6th|7th|8th|9th|10th)\b/i
    ) ||
    lower.match(
      /\bwhat was (?:my |the )?(first|earliest) (?:thing|question|prompt|turn)(?: I (?:asked|said))?\b/i
    ) ||
    lower.match(
      /\bwhat was the (first|earliest) thing I said\b/i
    );

  if (ordinalMatch) {
    const rawOrdinal = ordinalMatch[1]?.toLowerCase();
    const targetIndex = rawOrdinal === 'earliest' ? 0 : (rawOrdinal ? ORDINAL_MAP[rawOrdinal] : 0);

    if (typeof targetIndex === 'number' && targetIndex >= 0 && targetIndex < allRounds.length) {
      const targetRound = allRounds[targetIndex];
      const ordinalWord = rawOrdinal === 'earliest' ? 'first' : rawOrdinal;
      const capitalizedOrdinal = ordinalWord.charAt(0).toUpperCase() + ordinalWord.slice(1);
      return {
        roundUserMessageId: targetRound.userMessageId,
        kind: 'user_prompt',
        speaker: 'User',
        content: targetRound.userPrompt.trim(),
        label: `User's ${capitalizedOrdinal} question / statement`,
      };
    }
    return null;
  }

  return null;
}

function validateAndCleanSemanticMemory(
  parsed: any
): Omit<DiscussionStructuredMemory, '_meta'> | null {
  if (!parsed || typeof parsed !== 'object' || Array.isArray(parsed)) {
    return null;
  }

  for (const key of SEMANTIC_KEYS) {
    if (!Array.isArray(parsed[key])) {
      return null;
    }
    for (const item of parsed[key]) {
      if (typeof item !== 'string') {
        return null;
      }
    }
  }

  return {
    user_facts: (parsed.user_facts as string[])
      .map((s) => s.trim())
      .filter(Boolean)
      .slice(0, STRUCTURED_MEMORY_LIMITS.user_facts),
    topics_and_context: (parsed.topics_and_context as string[])
      .map((s) => s.trim())
      .filter(Boolean)
      .slice(0, STRUCTURED_MEMORY_LIMITS.topics_and_context),
    decisions_and_conclusions: (parsed.decisions_and_conclusions as string[])
      .map((s) => s.trim())
      .filter(Boolean)
      .slice(0, STRUCTURED_MEMORY_LIMITS.decisions_and_conclusions),
    panel_disagreements_and_nuance: (parsed.panel_disagreements_and_nuance as string[])
      .map((s) => s.trim())
      .filter(Boolean)
      .slice(0, STRUCTURED_MEMORY_LIMITS.panel_disagreements_and_nuance),
    unresolved_questions: (parsed.unresolved_questions as string[])
      .map((s) => s.trim())
      .filter(Boolean)
      .slice(0, STRUCTURED_MEMORY_LIMITS.unresolved_questions),
    likely_future_callbacks: (parsed.likely_future_callbacks as string[])
      .map((s) => s.trim())
      .filter(Boolean)
      .slice(0, STRUCTURED_MEMORY_LIMITS.likely_future_callbacks),
  };
}

/**
 * Generates or updates structured long-term discussion memory using google/gemini-3.1-flash-lite.
 * Strictly outputs semantic JSON categories without _meta.
 */
async function generateStructuredMemory(
  openai: OpenAI,
  olderRounds: Round[],
  existingStructured: DiscussionStructuredMemory | null,
  legacyProse: string | null
): Promise<DiscussionStructuredMemory | null> {
  let roundsToIncorporate = olderRounds;
  let previousMemoryForPrompt: Record<string, string[]> | null = null;
  let isIncremental = false;

  if (existingStructured) {
    const lastSummarizedId = existingStructured._meta?.last_summarized_user_message_id;
    let lastIdx = -1;
    if (lastSummarizedId) {
      lastIdx = olderRounds.findIndex((r) => r.userMessageId === lastSummarizedId);
    }

    if (lastIdx !== -1) {
      roundsToIncorporate = olderRounds.slice(lastIdx + 1);
      isIncremental = true;
      // Supply existing structured memory WITHOUT _meta
      previousMemoryForPrompt = {
        user_facts: existingStructured.user_facts,
        topics_and_context: existingStructured.topics_and_context,
        decisions_and_conclusions: existingStructured.decisions_and_conclusions,
        panel_disagreements_and_nuance: existingStructured.panel_disagreements_and_nuance,
        unresolved_questions: existingStructured.unresolved_questions,
        likely_future_callbacks: existingStructured.likely_future_callbacks,
      };
    } else {
      console.warn(
        '[Memory] Could not find last_summarized_user_message_id in olderRounds, falling back to full rebuild'
      );
      roundsToIncorporate = olderRounds;
      previousMemoryForPrompt = null;
    }
  }

  // If incremental update and no new rounds have aged out, return existing without calling model
  if (isIncremental && roundsToIncorporate.length === 0 && existingStructured) {
    return existingStructured;
  }

  if (isIncremental) {
    console.log(
      `[Memory] Generating incremental structured memory from ${roundsToIncorporate.length} new rounds (${olderRounds.length} older rounds total)...`
    );
  } else {
    console.log(
      `[Memory] Generating full structured memory from ${olderRounds.length} older rounds...`
    );
  }

  const olderRoundsFormatted = roundsToIncorporate
    .map((r, i) => {
      const isContinueUser = r.userPrompt.trim().toLowerCase() === 'continue';
      const userPart = isContinueUser ? '' : `User asked: "${r.userPrompt}"\n`;
      const responses = r.modelResponses
        .map((mr) => `${mr.name} said:\n"""\n${mr.content}\n"""`)
        .join('\n\n');
      return `[Round ${i + 1}]\n${userPart}${responses}`.trim();
    })
    .join('\n\n---\n\n');

  const systemPrompt = `You are an expert discussion-memory synthesizer. Maintain compact, high-precision structured long-term memory for an ongoing multi-assistant panel discussion.

Output MUST be a JSON object with exactly these six keys:
{
  "user_facts": [],
  "topics_and_context": [],
  "decisions_and_conclusions": [],
  "panel_disagreements_and_nuance": [],
  "unresolved_questions": [],
  "likely_future_callbacks": []
}

Strict Rules:
1. Return JSON only. Do not include markdown code fences or conversational text.
2. Do NOT generate any '_meta' key or internal metadata.
3. Category Item & Length Caps:
   - 'user_facts': maximum 5 items
   - 'topics_and_context': maximum 8 items
   - 'decisions_and_conclusions': maximum 8 items
   - 'panel_disagreements_and_nuance': maximum 6 items
   - 'unresolved_questions': maximum 5 items
   - 'likely_future_callbacks': maximum 5 items
   - Each item should be 25 words or fewer whenever possible.
   - Every category must be ordered from highest long-term importance to lowest.
   - Merge overlapping entries rather than consuming multiple slots.
   - Prefer preserving specific decisions, constraints, distinctions, unresolved issues, and durable context over conversational detail.
   - When a category exceeds its allowance, retain only the highest-priority items.
   - These caps apply to both full rebuilds and incremental updates.
4. Preserve specific names, numbers, constraints, decisions, and distinctions when materially useful.
5. 'user_facts' Rules:
   - 'user_facts' may contain ONLY real-world facts that the user explicitly states about themselves, their circumstances, preferences, goals, profession, technical/project environment, constraints, possessions, relationships, location, or similar personal/project facts.
   - A user merely asking about, discussing, requesting information about, or repeatedly returning to a topic is NOT evidence of an interest, preference, identity, occupation, expertise, belief, or personal fact.
   - Explicitly PROHIBITED derived statements: NEVER generate statements such as "User is interested in X", "User likes X", "User prefers X", "User wants to learn about X", or "User is knowledgeable about X" unless the user actually stated that fact about themselves.
   - Panelist statements, recommendations, assumptions, roleplay, jokes, hypotheticals, and the summarizer's own deductions must NEVER create user_facts.
   - If whether something qualifies as a user fact is uncertain, omit it. An empty user_facts array is preferable to an inferred fact.
   - During incremental updates, existing user_facts should normally be carried forward unchanged. Add, correct, supersede, or remove a user fact only when the newly supplied USER messages explicitly support that change. Do not try to infer the provenance of existing facts from their wording.
   - During a full rebuild, derive user_facts only from explicit statements in the supplied USER messages. Do not infer them from the topics of those messages.
6. NEVER treat roleplay, fictional personas, jokes, hypotheticals, or quoted examples as real-world user facts. Recurring roleplay or jokes may instead appear in 'likely_future_callbacks' when they have genuinely become a running thread.
7. Preserve meaningful panel disagreements and attribute them accurately (e.g., "Claude favored X due to Y, while Gemini preferred Z"). Do not flatten disagreement into false consensus.
8. Update or supersede stale conclusions when later conversation changes them.
9. Remove unresolved questions once they have actually been resolved.
10. Merge semantically duplicate entries rather than accumulating copies.
11. Prioritize durable context, recurring themes, decisions, unresolved work, meaningful distinctions, and callbacks likely to matter later.
12. 'likely_future_callbacks' must be grounded in something that actually recurred, was explicitly deferred, or was explicitly flagged for later. Do not invent predictions about what the user may discuss.
13. Keep the entire structure compact because it is injected on every panel turn.`;

  let userPrompt = '';
  if (previousMemoryForPrompt) {
    userPrompt = `Update the existing structured memory by incorporating the newly archived conversation rounds below.

Existing structured memory to update:
"""
${JSON.stringify(previousMemoryForPrompt, null, 2)}
"""

New conversation rounds to incorporate:
"""
${olderRoundsFormatted}
"""`;
  } else if (legacyProse) {
    userPrompt = `Convert and integrate the existing legacy prose summary and all older conversation rounds into the new structured semantic memory format.

Existing legacy prose summary:
"""
${legacyProse}
"""

Older conversation rounds:
"""
${olderRoundsFormatted}
"""`;
  } else {
    userPrompt = `Synthesize the following older conversation rounds into the structured semantic memory format:

Conversation rounds:
"""
${olderRoundsFormatted}
"""`;
  }

  try {
    const res = await openai.chat.completions.create({
      model: 'google/gemini-3.1-flash-lite',
      messages: [
        { role: 'system', content: systemPrompt },
        { role: 'user', content: userPrompt },
      ],
      response_format: { type: 'json_object' },
      max_tokens: 4000,
      temperature: 0.2,
    });

    const choice = res.choices[0];
    const finishReason = choice?.finish_reason;

    if (finishReason === 'length') {
      console.error('[Memory] Summarizer output was truncated due to max_tokens limit');
      return null;
    }

    const rawContent = choice?.message?.content?.trim();
    if (!rawContent) {
      console.error('[Memory] Empty response received from summarizer model');
      return null;
    }

    let parsed: any = null;
    try {
      parsed = JSON.parse(rawContent);
    } catch (parseErr) {
      console.error('[Memory] Failed to JSON.parse summarizer model response:', parseErr);
      return null;
    }

    const cleaned = validateAndCleanSemanticMemory(parsed);
    if (!cleaned) {
      console.error(
        '[Memory] Summarizer output failed strict schema validation (missing or non-string array keys)'
      );
      return null;
    }

    const lastArchivedRound = olderRounds[olderRounds.length - 1];
    const structuredResult: DiscussionStructuredMemory = {
      _meta: {
        last_summarized_user_message_id: lastArchivedRound?.userMessageId || undefined,
        summarized_rounds_count: olderRounds.length,
      },
      user_facts: cleaned.user_facts,
      topics_and_context: cleaned.topics_and_context,
      decisions_and_conclusions: cleaned.decisions_and_conclusions,
      panel_disagreements_and_nuance: cleaned.panel_disagreements_and_nuance,
      unresolved_questions: cleaned.unresolved_questions,
      likely_future_callbacks: cleaned.likely_future_callbacks,
    };

    return structuredResult;
  } catch (err) {
    console.error('[Memory] Error generating structured memory with gemini-3.1-flash-lite:', err);
    return null;
  }
}

/**
 * Fetches historical context strictly scoped to the provided discussionId using the authenticated server Supabase client.
 * 
 * Strict discussion isolation: Every query pulling historical messages or summary
 * MUST filter strictly by discussion_id — memory must NEVER leak across discussions.
 */
export async function getScopedDiscussionMemory(
  discussionId: string,
  currentPrompt: string,
  openai: OpenAI,
  supabase: SupabaseClient
): Promise<DiscussionMemoryResult> {
  if (!supabase || !discussionId) {
    return { recentRounds: [] };
  }

  try {
    // 1. Fetch raw messages strictly filtered by this discussion_id using authenticated client
    // Strict discussion isolation: Memory is strictly scoped to this discussion_id and must never leak across discussions.
    const { data: rawMessages, error: msgError } = await supabase
      .from('messages')
      .select('*')
      .eq('discussion_id', discussionId)
      .order('created_at', { ascending: true });

    if (msgError) {
      console.error('[Memory] Error fetching messages for discussion:', msgError, { discussion_id: discussionId });
      return { recentRounds: [] };
    }

    console.log(`[Memory Debug] Fetched ${rawMessages?.length || 0} raw messages from DB for discussion ${discussionId}`);

    // 2. Fetch discussion metadata (summary) strictly filtered by this discussion_id
    // Strict discussion isolation: Memory is strictly scoped to this discussion_id and must never leak across discussions.
    const { data: discussion, error: discError } = await supabase
      .from('discussions')
      .select('id, summary')
      .eq('id', discussionId)
      .single();

    if (discError && discError.code !== 'PGRST116') {
      console.warn('[Memory] Warning fetching discussion summary:', discError, { discussion_id: discussionId });
    }

    // Security check: only proceed with service client document registry if authenticated user owns the discussion
    const isOwner = Boolean(discussion?.id);
    let knownDocuments: KnownDiscussionDocument[] = [];

    if (isOwner) {
      const docMap = new Map<string, KnownDiscussionDocument>();

      // 3a. Fetch authoritative indexed documents from discussion_documents using service client
      try {
        const serviceClient = createServiceClient();
        const { data: docRows, error: docErr } = await serviceClient
          .from('discussion_documents')
          .select('id, filename, storage_path, created_at')
          .eq('discussion_id', discussionId)
          .order('created_at', { ascending: true });

        // Fetch source aliases from discussion_document_sources if available
        let sourceAliases: { document_id: string; storage_path: string; filename: string }[] = [];
        try {
          const { data: aliasRows, error: aliasErr } = await serviceClient
            .from('discussion_document_sources')
            .select('document_id, storage_path, filename')
            .eq('discussion_id', discussionId);
          if (!aliasErr && Array.isArray(aliasRows)) {
            sourceAliases = aliasRows;
          }
        } catch {
          // Table may not exist prior to migration
        }

        if (!docErr && Array.isArray(docRows)) {
          for (const d of docRows) {
            const matchingAliases = sourceAliases
              .filter((a) => a.document_id === d.id && a.storage_path)
              .map((a) => a.storage_path);
            const sourcePaths = Array.from(
              new Set([
                ...(d.storage_path ? [d.storage_path] : []),
                ...matchingAliases,
              ])
            );

            // Key by logical document UUID
            docMap.set(`doc_${d.id}`, {
              id: d.id,
              filename: d.filename,
              storagePath: d.storage_path || sourcePaths[0] || null,
              sourcePaths,
              createdAt: d.created_at,
            });
          }
        }
      } catch (docFetchErr) {
        console.warn('[Memory] Non-critical warning fetching known documents:', docFetchErr);
      }

      // 3b. Merge authoritative PDF attachments from rawMessages to include any unparsed/failed-ingestion PDFs
      if (Array.isArray(rawMessages)) {
        for (const msg of rawMessages) {
          if (msg.sender !== 'user') continue;
          const urls: string[] = [];
          if (Array.isArray(msg.attachment_urls)) {
            for (const u of msg.attachment_urls) {
              if (u) urls.push(u);
            }
          }
          if (msg.image_url && !urls.includes(msg.image_url)) {
            urls.push(msg.image_url);
          }

          for (const url of urls) {
            const storagePath = extractStoragePathFromSignedUrl(url);
            if (isPdfUrl(url, storagePath)) {
              let filename = 'attachment.pdf';
              if (storagePath) {
                const rawFilename = storagePath.split('/').pop() || '';
                const cleaned = rawFilename.replace(/^\d+-\d+-[^-]+-/, '');
                if (cleaned) filename = decodeURIComponent(cleaned);
              } else {
                const rawName = url.split('?')[0].split('/').pop() || '';
                if (rawName) filename = decodeURIComponent(rawName);
              }

              let alreadyMatched = false;
              if (storagePath) {
                for (const existing of docMap.values()) {
                  if (
                    existing.storagePath === storagePath ||
                    (existing.sourcePaths && existing.sourcePaths.includes(storagePath))
                  ) {
                    alreadyMatched = true;
                    break;
                  }
                }
              }

              if (!alreadyMatched) {
                const key = storagePath || `name_${filename.toLowerCase()}`;
                docMap.set(key, {
                  id: null,
                  filename,
                  storagePath: storagePath || null,
                  sourcePaths: storagePath ? [storagePath] : [],
                  createdAt: msg.created_at,
                });
              }
            }
          }
        }
      }

      knownDocuments = Array.from(docMap.values());
    }

    const allRounds = groupMessagesIntoRounds(rawMessages || [], currentPrompt, knownDocuments);
    console.log(`[Memory] Grouped into ${allRounds.length} prior rounds`);
    const totalRounds = allRounds.length;

    if (totalRounds === 0) {
      return {
        summary: discussion?.summary || undefined,
        recentRounds: [],
        knownDocuments: knownDocuments.length > 0 ? knownDocuments : undefined,
      };
    }

    // Token-budgeted sliding window: walk backwards from newest completed round
    const splitIndex = getRecentRoundsSplitIndex(allRounds, RECENT_MEMORY_TOKEN_BUDGET);
    const recentRounds = allRounds.slice(splitIndex);
    const olderRounds = allRounds.slice(0, splitIndex);
    const rawStoredSummary = discussion?.summary || '';
    let parsedSummary = parseDiscussionSummary(rawStoredSummary);

    // Determine if rolling summary should be generated/updated:
    // Check older rounds count compared to prior state (before newest round)
    const currentOlderCount = olderRounds.length;
    const priorHistory = allRounds.slice(0, -1);
    const priorSplitIndex = getRecentRoundsSplitIndex(priorHistory, RECENT_MEMORY_TOKEN_BUDGET);
    const previousOlderCount = priorHistory.slice(0, priorSplitIndex).length;
    const summarizedRoundsCount =
      parsedSummary.structured?._meta.summarized_rounds_count;

    const shouldRegenerateSummary =
      currentOlderCount > 0 &&
      (!rawStoredSummary ||
        (typeof summarizedRoundsCount === 'number'
          ? currentOlderCount - summarizedRoundsCount >= 5
          : Math.floor(currentOlderCount / 5) > Math.floor(previousOlderCount / 5)));

    if (shouldRegenerateSummary) {
      const newStructured = await generateStructuredMemory(
        openai,
        olderRounds,
        parsedSummary.structured,
        parsedSummary.legacyProse
      );

      if (newStructured) {
        parsedSummary = { structured: newStructured, legacyProse: null };
        const serializedJson = JSON.stringify(newStructured);
        // Persist rolling summary to discussions table strictly for this discussion_id
        // Strict discussion isolation: Memory is strictly scoped to this discussion_id and must never leak across discussions.
        try {
          const { error: updateErr } = await supabase
            .from('discussions')
            .update({ summary: serializedJson })
            .eq('id', discussionId);

          if (updateErr) {
            console.error('[Memory] Failed to save summary on discussions table:', updateErr, { discussion_id: discussionId });
          } else {
            console.log(`[Memory] Successfully stored updated structured summary on discussion ${discussionId}`);
          }
        } catch (updateEx) {
          console.error('[Memory] Exception updating summary on discussions table:', updateEx);
        }
      }
    }

    const chronologicalMemory = await resolveDeterministicChronology(currentPrompt, allRounds, {
      supabase,
      openai,
      discussionId,
    });
    if (chronologicalMemory) {
      console.log(
        `[Memory Chronology] Resolved deterministic chronology: ${chronologicalMemory.label}`,
        {
          kind: chronologicalMemory.kind,
          speaker: chronologicalMemory.speaker,
          roundUserMessageId: chronologicalMemory.roundUserMessageId,
        }
      );
    }

    const formattedSummary = parsedSummary.structured
      ? formatStructuredMemoryForContext(parsedSummary.structured)
      : (parsedSummary.legacyProse || undefined);

    return {
      summary: formattedSummary || undefined,
      recentRounds,
      chronologicalMemory: chronologicalMemory || undefined,
      knownDocuments: knownDocuments.length > 0 ? knownDocuments : undefined,
    };
  } catch (err) {
    console.error('[Memory] Exception in getScopedDiscussionMemory:', err, { discussion_id: discussionId });
    return { recentRounds: [] };
  }
}

/**
 * Extracts and cleans parsed document text from an OpenRouter FileAnnotation.
 * Strips transport wrapper-only tags (<file ...> and </file>) and ignores image ContentParts.
 */
export function extractDocumentText(annotation: any): {
  filename: string;
  fileHash: string;
  fullText: string;
  contentPartsCount: number;
} | null {
  if (annotation?.type !== 'file' || !annotation?.file?.hash) {
    return null;
  }

  const file = annotation.file;
  const fileHash = String(file.hash).trim();
  const filename = String(file.name || 'document.pdf').trim();

  if (!fileHash || !Array.isArray(file.content) || file.content.length === 0) {
    return null;
  }

  const textBlocks: string[] = [];
  let contentPartsCount = 0;

  for (const part of file.content) {
    if (part?.type === 'text' && typeof part.text === 'string') {
      const trimmed = part.text.trim();
      if (!trimmed) continue;

      // Strip wrapper-only <file ...> and </file> transport tags
      if (/^<file(\s+[^>]*)?>$/i.test(trimmed) || /^<\/file>$/i.test(trimmed)) {
        continue;
      }

      contentPartsCount++;
      textBlocks.push(trimmed);
    }
  }

  if (textBlocks.length === 0) {
    return null;
  }

  const fullText = textBlocks.join('\n\n').trim();
  if (!fullText) {
    return null;
  }

  return {
    filename,
    fileHash,
    fullText,
    contentPartsCount,
  };
}

/**
 * Splits an oversized text block into smaller pieces adhering to targetTokenMax.
 * Follows hierarchy: sentence -> line -> word -> hard slice.
 */
function splitOversizedText(
  text: string,
  targetTokenMax: number
): string[] {
  const totalTokens = estimateTokens(text);
  if (totalTokens <= targetTokenMax) {
    return [text];
  }

  // 1. Try splitting by sentence boundary (. ! ?)
  const sentences = text.split(/(?<=[.!?])\s+/).filter(Boolean);
  if (sentences.length > 1) {
    const pieces: string[] = [];
    let currentPiece: string[] = [];
    let currentTokens = 0;

    for (const sent of sentences) {
      const sentTokens = estimateTokens(sent);
      if (sentTokens > targetTokenMax) {
        if (currentPiece.length > 0) {
          pieces.push(currentPiece.join(' '));
          currentPiece = [];
          currentTokens = 0;
        }
        const subPieces = splitOversizedText(sent, targetTokenMax);
        pieces.push(...subPieces);
      } else if (currentTokens + sentTokens > targetTokenMax && currentPiece.length > 0) {
        pieces.push(currentPiece.join(' '));
        currentPiece = [sent];
        currentTokens = sentTokens;
      } else {
        currentPiece.push(sent);
        currentTokens += sentTokens;
      }
    }
    if (currentPiece.length > 0) {
      pieces.push(currentPiece.join(' '));
    }
    return pieces.filter((p) => p.trim().length > 0);
  }

  // 2. Try splitting by line breaks (\n)
  const lines = text.split(/\n+/).filter(Boolean);
  if (lines.length > 1) {
    const pieces: string[] = [];
    let currentPiece: string[] = [];
    let currentTokens = 0;

    for (const line of lines) {
      const lineTokens = estimateTokens(line);
      if (lineTokens > targetTokenMax) {
        if (currentPiece.length > 0) {
          pieces.push(currentPiece.join('\n'));
          currentPiece = [];
          currentTokens = 0;
        }
        const subPieces = splitOversizedText(line, targetTokenMax);
        pieces.push(...subPieces);
      } else if (currentTokens + lineTokens > targetTokenMax && currentPiece.length > 0) {
        pieces.push(currentPiece.join('\n'));
        currentPiece = [line];
        currentTokens = lineTokens;
      } else {
        currentPiece.push(line);
        currentTokens += lineTokens;
      }
    }
    if (currentPiece.length > 0) {
      pieces.push(currentPiece.join('\n'));
    }
    return pieces.filter((p) => p.trim().length > 0);
  }

  // 3. Try splitting by whitespace / words
  const words = text.split(/\s+/).filter(Boolean);
  if (words.length > 1) {
    const pieces: string[] = [];
    let currentPiece: string[] = [];
    let currentTokens = 0;

    for (const word of words) {
      const wordTokens = estimateTokens(word);
      if (wordTokens > targetTokenMax) {
        if (currentPiece.length > 0) {
          pieces.push(currentPiece.join(' '));
          currentPiece = [];
          currentTokens = 0;
        }
        const charLimit = Math.max(100, targetTokenMax * 3);
        for (let i = 0; i < word.length; i += charLimit) {
          pieces.push(word.slice(i, i + charLimit));
        }
      } else if (currentTokens + wordTokens > targetTokenMax && currentPiece.length > 0) {
        pieces.push(currentPiece.join(' '));
        currentPiece = [word];
        currentTokens = wordTokens;
      } else {
        currentPiece.push(word);
        currentTokens += wordTokens;
      }
    }
    if (currentPiece.length > 0) {
      pieces.push(currentPiece.join(' '));
    }
    return pieces.filter((p) => p.trim().length > 0);
  }

  // 4. Final deterministic fallback: hard character slice
  const charLimit = Math.max(100, targetTokenMax * 3);
  const slices: string[] = [];
  for (let i = 0; i < text.length; i += charLimit) {
    slices.push(text.slice(i, i + charLimit));
  }
  return slices.filter((s) => s.trim().length > 0);
}

/**
 * Chunks extracted document Markdown text into segments targeting 500-800 tokens.
 * Respects headings, paragraphs, sentences, lines, and words, preserving deterministic document order.
 */
export function chunkDocumentText(
  fullText: string,
  targetTokenMin: number = 500,
  targetTokenMax: number = 800
): string[] {
  const trimmed = fullText.trim();
  if (!trimmed) return [];

  const totalTokens = estimateTokens(trimmed);
  if (totalTokens <= targetTokenMax) {
    return [trimmed];
  }

  // Split by headings (#, ##, ###) or paragraph double newlines
  const paragraphs = trimmed
    .split(/\n\n+/)
    .map((p) => p.trim())
    .filter(Boolean);

  const chunks: string[] = [];
  let currentChunkParagraphs: string[] = [];
  let currentChunkTokens = 0;

  for (const para of paragraphs) {
    const paraTokens = estimateTokens(para);

    if (paraTokens > targetTokenMax) {
      if (currentChunkParagraphs.length > 0) {
        chunks.push(currentChunkParagraphs.join('\n\n'));
        currentChunkParagraphs = [];
        currentChunkTokens = 0;
      }

      const subPieces = splitOversizedText(para, targetTokenMax);
      for (const piece of subPieces) {
        chunks.push(piece);
      }
      continue;
    }

    if (currentChunkTokens + paraTokens > targetTokenMax && currentChunkParagraphs.length > 0) {
      chunks.push(currentChunkParagraphs.join('\n\n'));
      currentChunkParagraphs = [para];
      currentChunkTokens = paraTokens;
    } else {
      currentChunkParagraphs.push(para);
      currentChunkTokens += paraTokens;
    }
  }

  if (currentChunkParagraphs.length > 0) {
    chunks.push(currentChunkParagraphs.join('\n\n'));
  }

  return chunks.filter((c) => c.trim().length > 0);
}

/**
 * Extracts a clean, bucket-relative storage object path from a Supabase Storage URL.
 * Example input:
 * "https://<ref>.supabase.co/storage/v1/object/sign/message-images/c08361ba-.../1725401234567-0-a8x9z-document.pdf?token=..."
 * Returns:
 * "c08361ba-.../1725401234567-0-a8x9z-document.pdf"
 */
export function extractStoragePathFromSignedUrl(url?: string | null): string | null {
  if (!url || typeof url !== 'string') return null;
  const bucketIndex = url.indexOf('message-images/');
  if (bucketIndex === -1) return null;
  const rawPath = url.slice(bucketIndex + 'message-images/'.length).split('?')[0];
  const decodedPath = decodeURIComponent(rawPath);
  return decodedPath || null;
}

/**
 * Deterministically resolves the bucket-relative storage path for a parsed PDF annotation.
 * 
 * Strict Fail-Safe:
 * - If exactly 1 PDF attachment exists in the request, maps unambiguously.
 * - If multiple PDF attachments exist, matches by normalized (case-insensitive & URL-decoded) filename.
 * - If multiple attachments share the exact same filename or no match is found, returns NULL (never guesses).
 */
export function resolveAttachmentStoragePath(
  filename: string,
  attachments?: { url: string; filename: string }[] | null
): string | null {
  if (!filename || !Array.isArray(attachments) || attachments.length === 0) {
    return null;
  }

  const pdfAttachments = attachments.filter((att) => {
    if (!att?.url) return false;
    const cleanUrl = att.url.split('?')[0].toLowerCase();
    return cleanUrl.endsWith('.pdf');
  });

  if (pdfAttachments.length === 0) {
    return null;
  }

  // Single PDF attachment in turn: unambiguous 1:1 mapping
  if (pdfAttachments.length === 1) {
    const single = pdfAttachments[0];
    const normTarget = decodeURIComponent(filename).toLowerCase().trim();
    const normSingle = decodeURIComponent(single.filename || '').toLowerCase().trim();
    if (!normSingle || normSingle === normTarget || normSingle === 'attachment' || normSingle === 'attachment.pdf') {
      return extractStoragePathFromSignedUrl(single.url);
    }
  }

  // Multi-PDF turn: Match by normalized filename
  const normTarget = decodeURIComponent(filename).toLowerCase().trim();
  const exactMatches = pdfAttachments.filter((att) => {
    const normAtt = decodeURIComponent(att.filename || '').toLowerCase().trim();
    return normAtt === normTarget;
  });

  // Strict uniqueness requirement: exactly one attachment in this request must match this filename
  if (exactMatches.length === 1) {
    return extractStoragePathFromSignedUrl(exactMatches[0].url);
  }

  // Ambiguous (e.g. duplicate filenames in same turn) or no match: FAIL SAFE to null
  return null;
}

export interface IngestDocumentsOptions {
  serviceSupabase: SupabaseClient;
  openai: OpenAI;
  discussionId: string;
  fileAnnotations: any[];
  attachments?: { url: string; filename: string }[] | null;
  sourceUserMessageId?: string | null;
  signal?: AbortSignal;
}

export interface IngestDocumentsResult {
  ingestedCount: number;
  skippedCount: number;
  errors: { filename: string; fileHash: string; error: string }[];
}

/**
 * Ingests all unique parsed PDF annotations into discussion_documents, discussion_document_sources,
 * and discussion_document_chunks using authoritative SHA-256 byte hashing.
 * Fully idempotent and atomic based on (discussion_id, stable_sha256).
 * Operates strictly via the privileged serviceSupabase client on backend-only tables.
 */
export async function ingestDiscussionDocuments(
  options: IngestDocumentsOptions
): Promise<IngestDocumentsResult> {
  const { serviceSupabase, openai, discussionId, fileAnnotations, attachments, sourceUserMessageId, signal } = options;

  const result: IngestDocumentsResult = {
    ingestedCount: 0,
    skippedCount: 0,
    errors: [],
  };

  if (!discussionId || !Array.isArray(fileAnnotations) || fileAnnotations.length === 0 || !serviceSupabase) {
    return result;
  }

  // Deduplicate annotations by file.hash
  const uniqueAnnotations: any[] = [];
  for (const ann of fileAnnotations) {
    if (ann?.type === 'file' && ann?.file?.hash) {
      if (!uniqueAnnotations.some((existing) => existing?.file?.hash === ann.file.hash)) {
        uniqueAnnotations.push(ann);
      }
    }
  }

  for (const ann of uniqueAnnotations) {
    if (signal?.aborted) break;

    const extracted = extractDocumentText(ann);
    if (!extracted) {
      continue;
    }

    const { filename, fullText } = extracted;
    const parserFileHash = extracted.fileHash;
    let stableFileHash: string | null = null;

    // Resolve matching stable storage object path if available in request attachments
    const matchingStoragePath = resolveAttachmentStoragePath(filename, attachments);

    // Compute authoritative cryptographic SHA-256 from actual PDF storage bytes
    if (matchingStoragePath) {
      try {
        const { data: fileBlob, error: downloadErr } = await serviceSupabase.storage
          .from('message-images')
          .download(matchingStoragePath);

        if (!downloadErr && fileBlob) {
          const arrayBuffer = await fileBlob.arrayBuffer();
          const buffer = Buffer.from(arrayBuffer);
          stableFileHash = crypto.createHash('sha256').update(buffer).digest('hex');
          console.log('[Doc Ingest] Computed authoritative SHA-256 for PDF bytes:', {
            filename,
            storagePath: matchingStoragePath,
            sha256: stableFileHash,
            byteSize: buffer.length,
          });
        } else {
          console.warn('[Doc Ingest] Warning downloading storage object for SHA-256:', downloadErr);
        }
      } catch (hashEx) {
        console.warn('[Doc Ingest] Exception computing byte SHA-256:', hashEx);
      }
    }

    // STRICT INVARIANT: If stable byte identity could not be established, FAIL SAFE.
    // Never persist unstable parser hashes as durable document records.
    if (!stableFileHash) {
      console.warn(
        '[Doc Ingest] Skipping durable PDF indexing because stable byte identity could not be established:',
        { filename, matchingStoragePath, parserFileHash }
      );
      result.skippedCount++;
      continue;
    }

    const fileHash = stableFileHash;

    try {
      // 1. Compute expected deterministic chunks first
      const expectedChunks = chunkDocumentText(fullText);
      if (expectedChunks.length === 0) {
        result.skippedCount++;
        continue;
      }

      // 2. Check existing logical document record by (discussion_id, file_hash)
      const { data: existingDoc, error: checkDocErr } = await serviceSupabase
        .from('discussion_documents')
        .select('id, storage_path, full_text')
        .eq('discussion_id', discussionId)
        .eq('file_hash', fileHash)
        .maybeSingle();

      if (checkDocErr && checkDocErr.code !== 'PGRST116') {
        console.warn('[Doc Ingest] Error checking existing document:', checkDocErr);
      }

      let documentId = existingDoc?.id;

      if (documentId) {
        // CASE 2: Same logical document already exists
        // If existing record was missing storage_path, backfill it
        if (matchingStoragePath && !existingDoc?.storage_path) {
          try {
            await serviceSupabase
              .from('discussion_documents')
              .update({ storage_path: matchingStoragePath })
              .eq('id', documentId);
          } catch (updatePathErr) {
            console.warn('[Doc Ingest] Non-critical error updating storage_path:', updatePathErr);
          }
        }

        // Upsert durable source alias into discussion_document_sources
        if (matchingStoragePath) {
          try {
            await serviceSupabase
              .from('discussion_document_sources')
              .upsert(
                {
                  discussion_id: discussionId,
                  document_id: documentId,
                  storage_path: matchingStoragePath,
                  filename: filename,
                },
                { onConflict: 'discussion_id,storage_path' }
              );
            console.log('[Doc Ingest] Upserted source alias for existing logical document:', {
              documentId,
              storagePath: matchingStoragePath,
            });
          } catch (sourceAliasErr) {
            // Non-critical if table not yet migrated
          }
        }

        // Robust completeness check: skip embedding if existing chunk count matches expected chunk count exactly
        const { count, error: chunkCountErr } = await serviceSupabase
          .from('discussion_document_chunks')
          .select('id', { count: 'exact', head: true })
          .eq('document_id', documentId);

        if (!chunkCountErr && typeof count === 'number' && count === expectedChunks.length) {
          console.log('[Doc Ingest] Logical document already fully indexed, skipping embedding generation:', {
            discussionId,
            fileHash,
            filename,
            expectedChunks: expectedChunks.length,
            existingChunks: count,
          });
          if (sourceUserMessageId && documentId && (!attachments || attachments.length === 1)) {
            try {
              await serviceSupabase
                .from('messages')
                .update({ visual_document_id: documentId })
                .eq('id', sourceUserMessageId);
            } catch (updateMsgErr) {
              console.warn('[Doc Ingest] Non-critical error updating visual_document_id on message:', updateMsgErr);
            }
          }
          result.skippedCount++;
          continue;
        }

        console.log('[Doc Ingest] Logical document exists with incomplete chunks, rebuilding index:', {
          discussionId,
          documentId,
          fileHash,
          expectedChunks: expectedChunks.length,
          existingChunks: count || 0,
        });
      } else {
        // CASE 1: Brand-new logical document
        const { data: insertedDoc, error: insertDocErr } = await serviceSupabase
          .from('discussion_documents')
          .insert({
            discussion_id: discussionId,
            file_hash: fileHash,
            filename: filename,
            full_text: fullText,
            storage_path: matchingStoragePath || null,
          })
          .select('id')
          .single();

        if (insertDocErr) {
          const { data: retryDoc } = await serviceSupabase
            .from('discussion_documents')
            .select('id, storage_path')
            .eq('discussion_id', discussionId)
            .eq('file_hash', fileHash)
            .maybeSingle();

          if (retryDoc?.id) {
            documentId = retryDoc.id;
            if (matchingStoragePath && !retryDoc.storage_path) {
              try {
                await serviceSupabase
                  .from('discussion_documents')
                  .update({ storage_path: matchingStoragePath })
                  .eq('id', documentId);
              } catch (retryUpdateErr) {
                console.warn('[Doc Ingest] Non-critical error updating storage_path on retry:', retryUpdateErr);
              }
            }
          } else {
            throw new Error(`Failed to insert document: ${insertDocErr.message}`);
          }
        } else {
          documentId = insertedDoc.id;
        }

        // Upsert durable source alias into discussion_document_sources
        if (matchingStoragePath && documentId) {
          try {
            await serviceSupabase
              .from('discussion_document_sources')
              .upsert(
                {
                  discussion_id: discussionId,
                  document_id: documentId,
                  storage_path: matchingStoragePath,
                  filename: filename,
                },
                { onConflict: 'discussion_id,storage_path' }
              );
          } catch (sourceAliasErr) {
            // Non-critical if table not yet migrated
          }
        }
      }

      if (signal?.aborted) {
        console.warn('[Doc Ingest] Ingestion aborted before embedding generation');
        break;
      }

      // 3. Generate embeddings using bounded batch embedding (up to 16 chunks per API request)
      const EMBEDDING_BATCH_SIZE = 16;
      const chunkInserts: {
        document_id: string;
        discussion_id: string;
        chunk_index: number;
        content: string;
        embedding: number[];
      }[] = [];

      let hasAbortOrFailure = false;

      for (let batchStart = 0; batchStart < expectedChunks.length; batchStart += EMBEDDING_BATCH_SIZE) {
        if (signal?.aborted) {
          hasAbortOrFailure = true;
          break;
        }

        const batchEnd = Math.min(batchStart + EMBEDDING_BATCH_SIZE, expectedChunks.length);
        const batchTexts = expectedChunks.slice(batchStart, batchEnd);

        const embRes = await (openai.embeddings.create as any)(
          {
            model: 'google/gemini-embedding-2',
            dimensions: 1536,
            input: batchTexts,
            encoding_format: 'float',
          },
          {
            timeout: 10000,
            signal,
          }
        );

        if (signal?.aborted) {
          hasAbortOrFailure = true;
          break;
        }

        const returnedData = embRes?.data;
        if (!Array.isArray(returnedData) || returnedData.length !== batchTexts.length) {
          throw new Error(
            `Batch embedding count mismatch: expected ${batchTexts.length}, received ${returnedData?.length || 0}`
          );
        }

        for (let i = 0; i < returnedData.length; i++) {
          const item = returnedData[i];
          const embedding = item?.embedding;
          const chunkIndex = batchStart + i;

          if (!Array.isArray(embedding) || embedding.length !== 1536) {
            throw new Error(
              `Embedding generation returned invalid vector for chunk ${chunkIndex} of ${filename}`
            );
          }

          chunkInserts.push({
            document_id: documentId,
            discussion_id: discussionId,
            chunk_index: chunkIndex,
            content: batchTexts[i],
            embedding,
          });
        }
      }

      // 4. Atomic commit check: Only commit and increment if ALL expected chunks were generated without abort
      if (hasAbortOrFailure || signal?.aborted || chunkInserts.length !== expectedChunks.length) {
        console.warn('[Doc Ingest] Document embedding incomplete or aborted, skipping commit:', {
          discussionId,
          filename,
          generatedChunks: chunkInserts.length,
          expectedChunks: expectedChunks.length,
          isAborted: Boolean(signal?.aborted),
        });
        continue;
      }

      // 5. Commit complete chunk set to database
      const { error: insertChunksErr } = await serviceSupabase
        .from('discussion_document_chunks')
        .upsert(chunkInserts, { onConflict: 'document_id,chunk_index' });

      if (insertChunksErr) {
        throw new Error(`Failed to insert document chunks: ${insertChunksErr.message}`);
      }

      console.log('[Doc Ingest] Successfully ingested document:', {
        discussionId,
        documentId,
        filename,
        fileHash,
        chunksCount: chunkInserts.length,
        characterCount: fullText.length,
      });

      if (sourceUserMessageId && documentId && (!attachments || attachments.length === 1)) {
        try {
          await serviceSupabase
            .from('messages')
            .update({ visual_document_id: documentId })
            .eq('id', sourceUserMessageId);
        } catch (updateMsgErr) {
          console.warn('[Doc Ingest] Non-critical error updating visual_document_id on message:', updateMsgErr);
        }
      }

      result.ingestedCount++;
    } catch (err: any) {
      console.error('[Doc Ingest] Error ingesting document:', {
        filename,
        fileHash,
        error: err?.message || String(err),
      });
      result.errors.push({
        filename,
        fileHash,
        error: err?.message || String(err),
      });
    }
  }

  return result;
}

export interface IngestArtifactsOptions {
  serviceSupabase: SupabaseClient;
  discussionId: string;
  attachments?: { url: string; filename: string }[] | null;
  sourceUserMessageId?: string | null;
  signal?: AbortSignal;
}

export interface IngestArtifactsResult {
  ingestedCount: number;
  skippedCount: number;
  errors: {
    filename?: string;
    storagePath?: string;
    error: string;
  }[];
}

/**
 * Ingests standalone image attachments into canonical discussion_artifacts and physical discussion_artifact_sources.
 * Invariants:
 * 1. Same exact image bytes uploaded multiple times in same discussion -> 1 canonical artifact, multiple physical source aliases.
 * 2. Same filename but different bytes -> separate canonical artifacts.
 * 3. Preserves original attachment_index from the full request attachments array.
 * 4. Zero paid AI calls (crypto hashing + storage only).
 * 5. Partial failure semantics: successful ingestion requires BOTH canonical artifact AND source alias upsert.
 * 6. Non-critical fail-safe: errors do not throw or disrupt callers.
 */
export async function ingestDiscussionArtifacts(
  options: IngestArtifactsOptions
): Promise<IngestArtifactsResult> {
  const result: IngestArtifactsResult = {
    ingestedCount: 0,
    skippedCount: 0,
    errors: [],
  };

  const { serviceSupabase, discussionId, attachments, sourceUserMessageId, signal } = options;

  if (
    !serviceSupabase ||
    !discussionId ||
    !Array.isArray(attachments) ||
    attachments.length === 0 ||
    signal?.aborted
  ) {
    return result;
  }

  for (let i = 0; i < attachments.length; i++) {
    if (signal?.aborted) break;

    const attachment = attachments[i];
    const url = attachment?.url;
    if (!url || typeof url !== 'string') {
      result.skippedCount++;
      continue;
    }

    let storagePath: string | null = null;
    try {
      try {
        storagePath = extractStoragePathFromSignedUrl(url);
      } catch (pathErr: any) {
        console.warn('[Artifact Ingest] Error extracting storage path from URL:', {
          url,
          error: pathErr?.message || pathErr,
        });
        result.errors.push({
          filename: attachment.filename || 'attachment',
          error: `Failed to extract storage path: ${pathErr?.message || String(pathErr)}`,
        });
        continue;
      }

      // Strictly check if attachment is a supported image (explicitly excluding PDF, DOCX, XLSX, etc.)
      if (!isImageUrl(url, storagePath)) {
        result.skippedCount++;
        continue;
      }

      if (!storagePath) {
        console.warn('[Artifact Ingest] Missing storage_path for image attachment; skipping:', {
          url,
          filename: attachment.filename,
        });
        result.skippedCount++;
        continue;
      }

      // Clean filename fail-safely inside per-item try/catch
      let filename = attachment.filename || 'attachment';
      const rawFilename = storagePath.split('/').pop() || '';
      const cleaned = rawFilename.replace(/^\d+-\d+-[^-]+-/, '');
      if (cleaned) {
        try {
          filename = decodeURIComponent(cleaned);
        } catch {
          filename = cleaned || filename;
        }
      }

      // 1. Download raw image bytes from Supabase storage using serviceSupabase
      const { data: fileBlob, error: downloadErr } = await serviceSupabase.storage
        .from('message-images')
        .download(storagePath);

      if (downloadErr || !fileBlob) {
        console.warn('[Artifact Ingest] Error downloading storage object for image:', {
          storagePath,
          error: downloadErr?.message || downloadErr,
        });
        result.errors.push({
          filename,
          storagePath,
          error: downloadErr?.message || 'Storage download failed',
        });
        continue;
      }

      // 2. Compute authoritative SHA-256 byte hash & byte size
      const arrayBuffer = await fileBlob.arrayBuffer();
      const buffer = Buffer.from(arrayBuffer);
      const fileHash = crypto.createHash('sha256').update(buffer).digest('hex');
      const byteSize = buffer.length;

      // 3. Upsert / retrieve canonical record from discussion_artifacts
      let artifactId: string | null = null;

      const { data: existingArtifact } = await serviceSupabase
        .from('discussion_artifacts')
        .select('id')
        .eq('discussion_id', discussionId)
        .eq('file_hash', fileHash)
        .maybeSingle();

      if (existingArtifact?.id) {
        artifactId = existingArtifact.id;
      } else {
        const { data: insertedArtifact, error: insertErr } = await serviceSupabase
          .from('discussion_artifacts')
          .insert({
            discussion_id: discussionId,
            artifact_type: 'image',
            file_hash: fileHash,
            byte_size: byteSize,
            metadata: {},
          })
          .select('id')
          .single();

        if (insertErr) {
          // Handle potential concurrent insert race condition gracefully
          const { data: retryArtifact } = await serviceSupabase
            .from('discussion_artifacts')
            .select('id')
            .eq('discussion_id', discussionId)
            .eq('file_hash', fileHash)
            .maybeSingle();

          artifactId = retryArtifact?.id || null;
          if (!artifactId) {
            console.warn('[Artifact Ingest] Non-critical warning inserting discussion_artifact:', insertErr);
            result.errors.push({
              filename,
              storagePath,
              error: insertErr.message || 'Failed to insert canonical discussion_artifact',
            });
            continue;
          }
        } else {
          artifactId = insertedArtifact?.id || null;
        }
      }

      if (!artifactId) {
        result.errors.push({
          filename,
          storagePath,
          error: 'Canonical artifact ID could not be established',
        });
        continue;
      }

      // 4. Upsert physical source alias into discussion_artifact_sources preserving original array index
      const { error: sourceErr } = await serviceSupabase
        .from('discussion_artifact_sources')
        .upsert(
          {
            discussion_id: discussionId,
            artifact_id: artifactId,
            storage_path: storagePath,
            filename: filename,
            source_message_id: sourceUserMessageId || null,
            attachment_index: i,
          },
          { onConflict: 'discussion_id,storage_path' }
        );

      if (sourceErr) {
        console.warn('[Artifact Ingest] Source alias upsert failed for image artifact:', {
          discussionId,
          artifactId,
          storagePath,
          error: sourceErr.message,
        });
        result.errors.push({
          filename,
          storagePath,
          error: sourceErr.message || 'Failed to upsert discussion_artifact_sources alias',
        });
        continue;
      }

      console.log('[Artifact Ingest] Successfully indexed canonical image artifact:', {
        discussionId,
        artifactId,
        fileHash,
        byteSize,
        storagePath,
        filename,
        attachmentIndex: i,
      });

      result.ingestedCount++;
    } catch (itemErr: any) {
      console.warn('[Artifact Ingest] Non-critical error processing image artifact:', itemErr);
      result.errors.push({
        filename: attachment?.filename || 'attachment',
        storagePath: storagePath || undefined,
        error: itemErr?.message || String(itemErr),
      });
    }
  }

  return result;
}

export const DOCUMENT_RETRIEVAL_TOKEN_BUDGET = 1500;
export const DOCUMENT_SEMANTIC_SIMILARITY_THRESHOLD = 0.60;

export interface RetrievedDocumentExcerpt {
  chunkId: string;
  documentId: string;
  filename: string;
  chunkIndex: number;
  content: string;
  semanticSimilarity: number;
  keywordRank: number | null;
  filenameMatch: boolean;
  hybridScore: number;
}

export interface RetrieveDiscussionDocumentsOptions {
  serviceSupabase: SupabaseClient;
  discussionId: string;
  queryText: string;
  queryEmbedding?: number[] | null;
  signal?: AbortSignal;
}

/**
 * Retrieves relevant document chunks for a discussion using the dedicated document hybrid search RPC.
 * Runs strictly with serviceSupabase after user discussion ownership has been verified.
 * Fails non-critically and returns [] on any error or missing input.
 */
export async function retrieveDiscussionDocuments(
  options: RetrieveDiscussionDocumentsOptions
): Promise<RetrievedDocumentExcerpt[]> {
  const { serviceSupabase, discussionId, queryText, queryEmbedding, signal } = options;

  if (
    !serviceSupabase ||
    !discussionId ||
    !queryText ||
    !queryText.trim() ||
    !Array.isArray(queryEmbedding) ||
    queryEmbedding.length !== 1536 ||
    signal?.aborted
  ) {
    return [];
  }

  try {
    const { data: rows, error } = await serviceSupabase.rpc(
      'match_discussion_documents_hybrid',
      {
        p_discussion_id: discussionId,
        p_query_text: queryText.trim(),
        p_query_embedding: queryEmbedding,
        p_match_count: 5,
      }
    );

    if (error) {
      console.error('[Doc Retrieval] Error calling match_discussion_documents_hybrid:', error);
      return [];
    }

    if (!Array.isArray(rows) || rows.length === 0) {
      return [];
    }

    // Filter, deduplicate, and enforce DOCUMENT_RETRIEVAL_TOKEN_BUDGET (max 2 chunks)
    const qualifying: RetrievedDocumentExcerpt[] = [];
    const seenChunkKeys = new Set<string>();
    let accumulatedTokens = 0;

    for (const row of rows) {
      if (qualifying.length >= 2) break;

      const chunkId = String(row?.chunk_id || '');
      const documentId = String(row?.document_id || '');
      const filename = String(row?.filename || 'document.pdf');
      const chunkIndex = Number(row?.chunk_index ?? 0);
      const content = typeof row?.content === 'string' ? row.content.trim() : '';

      if (!content) continue;

      const dedupeKey = `${documentId}:${chunkIndex}`;
      if (seenChunkKeys.has(dedupeKey)) continue;

      const semanticSimilarity = typeof row?.semantic_similarity === 'number' ? row.semantic_similarity : 0.0;
      const keywordRank = typeof row?.keyword_rank === 'number' ? row.keyword_rank : null;
      const filenameMatch = Boolean(row?.filename_match);
      const hybridScore = typeof row?.hybrid_score === 'number' ? row.hybrid_score : 0.0;

      // Ensure candidate meets relevance threshold:
      // 1. Semantic similarity meets or exceeds provisional threshold (0.58), OR
      // 2. Exact keyword match occurred, OR
      // 3. Explicit filename match occurred
      if (
        semanticSimilarity < DOCUMENT_SEMANTIC_SIMILARITY_THRESHOLD &&
        keywordRank === null &&
        !filenameMatch
      ) {
        continue;
      }

      const chunkTokens = estimateTokens(content);

      if (qualifying.length === 0) {
        // Always retain highest-ranked qualifying chunk
        qualifying.push({
          chunkId,
          documentId,
          filename,
          chunkIndex,
          content,
          semanticSimilarity,
          keywordRank,
          filenameMatch,
          hybridScore,
        });
        seenChunkKeys.add(dedupeKey);
        accumulatedTokens += chunkTokens;
      } else if (accumulatedTokens + chunkTokens <= DOCUMENT_RETRIEVAL_TOKEN_BUDGET) {
        qualifying.push({
          chunkId,
          documentId,
          filename,
          chunkIndex,
          content,
          semanticSimilarity,
          keywordRank,
          filenameMatch,
          hybridScore,
        });
        seenChunkKeys.add(dedupeKey);
        accumulatedTokens += chunkTokens;
      }
    }

    return qualifying;
  } catch (err: any) {
    console.error('[Doc Retrieval] Non-critical error retrieving discussion documents:', err);
    return [];
  }
}

export interface ResolvedVisualDocument {
  documentId?: string | null;
  filename: string;
  storagePath: string;
}

/**
 * Deterministic lightweight visual query classifier.
 * Detects questions that require visual inspection of original 2D layout, signatures, stamps, photos, colors, etc.
 * Avoids false positives on generic words like "top", "bottom", "above", "below", or temporal "when was ... signed".
 */
export function isVisualEvidenceQuery(prompt?: string | null): boolean {
  if (!prompt || typeof prompt !== 'string') return false;
  const p = prompt.trim();
  if (!p) return false;

  // 1. Explicit spatial / layout position queries
  if (
    /\b(which|what|either)\s+(side|corner|margin|half|part|quadrant)\b/i.test(p) ||
    /\b(left|right|top|bottom|upper|lower|center|centre|middle)\s*(-|\s)+(hand|side|corner|margin|aligned|alignment|edge|portion|half|quadrant|section)\b/i.test(p) ||
    /\b(which\s+side|what\s+side|left\s+side|right\s+side|top\s+side|bottom\s+side)\b/i.test(p)
  ) {
    return true;
  }

  // 2. Relative visual positioning
  if (
    /\b(visually|positioned|located|placed|aligned|arranged)\s+(above|below|beside|under|underneath|next to|on top of|beneath)\b/i.test(p) ||
    /\b(above|below|beside|under|underneath|next to)\s+(the\s+)?(signature|stamp|seal|photo|picture|header|footer|logo|line|box|table|cnie)\b/i.test(p)
  ) {
    return true;
  }

  // 3. Signature appearance, position, color, or handwriting
  if (
    /\b(signature|handwriting|handwritten)\b/i.test(p) &&
    /\b(side|position|where|located|colour|color|ink|blue|black|red|appearance|look like|looks like|blurry|sharp|faded|clear|legible|overlap|overlapping)\b/i.test(p)
  ) {
    return true;
  }

  // 4. Stamp / Seal / Logo appearance or location
  if (
    /\b(stamp|stamped|seal|logo)\b/i.test(p) &&
    /\b(side|position|where|located|colour|color|ink|appearance|look like|looks like|round|circular|square|overlap|overlapping)\b/i.test(p)
  ) {
    return true;
  }

  // 5. Photo / Image visual inspection (e.g. on ID/CNIE/passport)
  if (
    /\b(photo|picture|portrait|image)\b/i.test(p) &&
    /\b(cnie|id|card|passport|document|page|blurry|sharp|glasses|clothing|background|face|wearing|color|colour|black and white|grayscale)\b/i.test(p)
  ) {
    return true;
  }

  // 6. Visual color / ink queries strictly anchored to document objects
  if (
    /\b(colour|color|ink)\b/i.test(p) &&
    /\b(signature|handwriting|stamp|seal|logo|photo|picture|image|cnie|id|card|passport|document|page|scan|background|text|font|border|line|box|header|footer|table)\b/i.test(p)
  ) {
    return true;
  }

  // 7. General document layout / visual appearance
  if (
    /\b(visual layout|page layout|2d layout|spatial layout|page orientation|landscape|portrait)\b/i.test(p) ||
    /\b(is\s+the\s+scan\s+(blurry|sharp|crooked|clear|clean))\b/i.test(p) ||
    /\b(does\s+the\s+.*(overlap|cover|cross))\b/i.test(p)
  ) {
    return true;
  }

  return false;
}

/**
 * Detects whether a prompt is a short conversational verification/challenge follow-up
 * (e.g. "are you sure?", "really?", "double check that", "look again", "I don't think so").
 * Strictly returns false for continuations, explanations, or prompts with new subject matter.
 */
export function isVerificationFollowUpQuery(prompt?: string | null): boolean {
  if (!prompt || typeof prompt !== 'string') return false;
  const p = prompt.trim().toLowerCase().replace(/[?!.,;:]+$/, '').trim();
  if (!p) return false;

  // 1. Direct certainty / doubt questions
  if (
    /^(?:are you|r u)\s+(?:completely\s+|100%\s+|totally\s+|really\s+|absolutely\s+)?(?:sure|certain|positive|confident)(?:\s+about\s+(?:that|this|it))?$/i.test(p) ||
    /^(?:really|for real|rly|seriously)$/i.test(p) ||
    /^(?:is that|are you)\s+(?:really|actually|truly)?\s*(?:so|correct|accurate|the case|true|positive|confident)$/i.test(p)
  ) {
    return true;
  }

  // 2. Re-inspection / re-verification imperatives
  if (
    /^(?:please\s+)?(?:check|double[- ]check|re[- ]check|recheck|verify|re[- ]verify|reverify|look|look closer|take another look)(?:\s+(?:that|this|it))?(?:\s+(?:again|one more time))?(?:\s+please)?$/i.test(p) ||
    /^(?:can you|could you)\s+(?:please\s+)?(?:check|double[- ]check|re[- ]check|recheck|verify|re[- ]verify|reverify|look|look closer|take another look)(?:\s+(?:that|this|it))?(?:\s+(?:again|one more time))?(?:\s+please)?$/i.test(p) ||
    /^(?:check\s+again|double\s+check\s+that|look\s+again|look\s+closer)$/i.test(p)
  ) {
    return true;
  }

  // 3. Mild disagreement / skepticism challenging the previous answer
  if (
    /^(?:i don't think so|i doubt (?:that|it)|that doesn't (?:seem|look) (?:right|correct)|that seems (?:wrong|incorrect))$/i.test(p)
  ) {
    return true;
  }

  return false;
}

/**
 * Deterministically resolves which candidate PDF document from the discussion should be reopened for visual inspection.
 * Priority:
 * 1. Explicit deterministic filename reference (outranks semantic retrieval)
 * 2. Unambiguous retrieved document identity from hybrid search
 * 3. Contextually recent single PDF attachment in history (strict uniqueness check)
 * 4. Single known logical PDF with storage_path in discussion
 * 5. Ambiguity -> never guess
 */
export function resolveVisualDocument(
  prompt: string,
  knownDocuments?: KnownDiscussionDocument[],
  retrievedDocuments?: RetrievedDocumentExcerpt[],
  recentRounds?: Round[]
): ResolvedVisualDocument | null {
  if (!Array.isArray(knownDocuments) || knownDocuments.length === 0) {
    return null;
  }

  // 1. Explicit deterministic filename reference (highest priority)
  const promptLower = prompt.toLowerCase();
  const filenameMatches = knownDocuments.filter((d) => {
    const hasPath = Boolean(d.storagePath || (d.sourcePaths && d.sourcePaths.length > 0));
    if (!hasPath || !d.filename) return false;
    const normName = d.filename.toLowerCase();
    const baseName = normName.replace(/\.pdf$/i, '');
    return promptLower.includes(normName) || (baseName.length >= 4 && promptLower.includes(baseName));
  });
  if (filenameMatches.length === 1) {
    const m = filenameMatches[0];
    const path = m.storagePath || (m.sourcePaths && m.sourcePaths[0]);
    if (path) {
      return {
        documentId: m.id,
        filename: m.filename,
        storagePath: path,
      };
    }
  }

  // 2. Unambiguous retrieved document identity from hybrid search
  if (Array.isArray(retrievedDocuments) && retrievedDocuments.length > 0) {
    const docIds = Array.from(new Set(retrievedDocuments.map((d) => d.documentId).filter(Boolean)));
    if (docIds.length === 1) {
      const match = knownDocuments.find(
        (d) => d.id === docIds[0] && (d.storagePath || (d.sourcePaths && d.sourcePaths.length > 0))
      );
      if (match) {
        const path = match.storagePath || (match.sourcePaths && match.sourcePaths[0]);
        if (path) {
          return {
            documentId: match.id,
            filename: match.filename,
            storagePath: path,
          };
        }
      }
    }
  }

  // 3. Contextually recent PDF attachments across recent history (strict uniqueness check)
  if (Array.isArray(recentRounds) && recentRounds.length > 0) {
    const recentPdfMap = new Map<string, ResolvedVisualDocument>();
    for (const r of recentRounds) {
      if (r.attachments && r.attachments.length > 0) {
        for (const att of r.attachments) {
          if (att.storagePath && att.filename.toLowerCase().endsWith('.pdf')) {
            const key = att.documentId || att.storagePath;
            if (!recentPdfMap.has(key)) {
              recentPdfMap.set(key, {
                documentId: att.documentId || null,
                filename: att.filename,
                storagePath: att.storagePath,
              });
            }
          }
        }
      }
    }

    const distinctRecentPdfs = Array.from(recentPdfMap.values());
    if (distinctRecentPdfs.length === 1) {
      return distinctRecentPdfs[0];
    }
    if (distinctRecentPdfs.length > 1) {
      // Multiple distinct PDFs in recent history without explicit name/search resolution: do not guess
      return null;
    }
  }

  // 4. Single known logical PDF with storage_path in discussion
  const validDocs = knownDocuments.filter((d) =>
    Boolean(d.storagePath || (d.sourcePaths && d.sourcePaths.length > 0))
  );
  if (validDocs.length === 1) {
    const d = validDocs[0];
    const path = d.storagePath || (d.sourcePaths && d.sourcePaths[0]);
    if (path) {
      return {
        documentId: d.id,
        filename: d.filename,
        storagePath: path,
      };
    }
  }

  // 5. Ambiguity -> never guess
  return null;
}

export interface PersistActiveImageEvidenceOptions {
  serviceSupabase: SupabaseClient;
  discussionId: string;
  sourceUserMessageId: string;
  signal?: AbortSignal;
}

export interface PersistActiveImageEvidenceResult {
  persistedCount: number;
  errors: string[];
}

/**
 * Persists contiguous visual evidence ordinals (0..N-1) in message_visual_evidence for current-turn image uploads.
 * Invariants:
 * 1. Verifies that sourceUserMessageId exists, belongs to discussionId, and has sender = 'user'.
 * 2. Filters strictly for canonical artifacts where artifact_type = 'image'.
 * 3. Ordinals are contiguous 0..N-1 based on original attachment_index ASC order among images.
 * 4. Non-destructive idempotency:
 *    - If no evidence exists: inserts calculated current-upload image evidence set (0..N-1).
 *    - If existing evidence matches ordered source_id set: idempotent success / no-op.
 *    - If existing evidence differs (e.g. established earlier or combined): preserves existing evidence, never deletes or overwrites.
 * 5. Enforces discussion consistency (rejects cross-discussion sources).
 * 6. Partial failure semantics: only successfully indexed image sources become evidence; non-critical fail-safe.
 */
export async function persistActiveImageEvidence(
  options: PersistActiveImageEvidenceOptions
): Promise<PersistActiveImageEvidenceResult> {
  const result: PersistActiveImageEvidenceResult = {
    persistedCount: 0,
    errors: [],
  };

  const { serviceSupabase, discussionId, sourceUserMessageId, signal } = options;

  if (
    !serviceSupabase ||
    !discussionId ||
    !sourceUserMessageId ||
    signal?.aborted
  ) {
    return result;
  }

  try {
    // 1. Verify user message exists, belongs to discussionId, and has sender = 'user'
    const { data: messageRow, error: msgErr } = await serviceSupabase
      .from('messages')
      .select('id, discussion_id, sender')
      .eq('id', sourceUserMessageId)
      .maybeSingle();

    if (msgErr || !messageRow) {
      console.warn('[Image Evidence Persist] User message verification failed (message not found or query error):', {
        discussionId,
        sourceUserMessageId,
        error: msgErr?.message || msgErr,
      });
      result.errors.push(msgErr?.message || `User message not found: ${sourceUserMessageId}`);
      return result;
    }

    if (messageRow.discussion_id !== discussionId) {
      console.warn('[Image Evidence Persist] User message discussion mismatch rejected:', {
        expectedDiscussionId: discussionId,
        messageDiscussionId: messageRow.discussion_id,
        sourceUserMessageId,
      });
      result.errors.push(`Message discussion mismatch: ${messageRow.discussion_id} !== ${discussionId}`);
      return result;
    }

    if (messageRow.sender !== 'user') {
      console.warn('[Image Evidence Persist] Non-user message rejected for active user evidence persistence:', {
        sourceUserMessageId,
        sender: messageRow.sender,
      });
      result.errors.push(`Non-user message sender rejected: ${messageRow.sender}`);
      return result;
    }

    // 2. Fetch physical source aliases recorded for this message in this discussion
    const { data: sourceRows, error: fetchErr } = await serviceSupabase
      .from('discussion_artifact_sources')
      .select('id, discussion_id, artifact_id, attachment_index, created_at')
      .eq('discussion_id', discussionId)
      .eq('source_message_id', sourceUserMessageId)
      .order('attachment_index', { ascending: true });

    if (fetchErr) {
      console.warn('[Image Evidence Persist] Error fetching source aliases for message:', fetchErr);
      result.errors.push(fetchErr.message || 'Failed to fetch source aliases');
      return result;
    }

    if (!Array.isArray(sourceRows) || sourceRows.length === 0) {
      return result;
    }

    // 3. Fetch canonical artifact types to strictly filter artifact_type = 'image' (excluding future docx, xlsx, etc.)
    const artifactIds = Array.from(new Set(sourceRows.map((s: any) => s.artifact_id).filter(Boolean)));
    if (artifactIds.length === 0) {
      return result;
    }

    const { data: artifactRows, error: artErr } = await serviceSupabase
      .from('discussion_artifacts')
      .select('id, artifact_type')
      .in('id', artifactIds);

    if (artErr) {
      console.warn('[Image Evidence Persist] Error fetching artifact types:', artErr);
      result.errors.push(artErr.message || 'Failed to verify artifact types');
      return result;
    }

    const imageArtifactIdSet = new Set(
      (artifactRows || [])
        .filter((a: any) => a.artifact_type === 'image')
        .map((a: any) => a.id)
    );

    // 4. Filter valid image sources and enforce discussion consistency
    const validImageSources: typeof sourceRows = [];
    for (const s of sourceRows) {
      if (s.discussion_id !== discussionId) {
        console.warn('[Image Evidence Persist] Rejected cross-discussion source alias:', {
          expectedDiscussionId: discussionId,
          sourceDiscussionId: s.discussion_id,
          sourceId: s.id,
        });
        result.errors.push(`Cross-discussion source rejected: ${s.id}`);
        continue;
      }

      if (imageArtifactIdSet.has(s.artifact_id)) {
        validImageSources.push(s);
      }
    }

    if (validImageSources.length === 0) {
      return result;
    }

    // 5. Sort by original attachment_index ASC to establish contiguous visual evidence order (0..N-1)
    validImageSources.sort((a: any, b: any) => (a.attachment_index ?? 0) - (b.attachment_index ?? 0));

    // 6. Non-destructive idempotency check against existing evidence for this message
    const { data: existingEvidence, error: existErr } = await serviceSupabase
      .from('message_visual_evidence')
      .select('id, source_id, ordinal')
      .eq('message_id', sourceUserMessageId)
      .order('ordinal', { ascending: true });

    if (existErr) {
      console.warn('[Image Evidence Persist] Error checking existing message evidence:', existErr);
      result.errors.push(existErr.message || 'Failed to check existing evidence');
      return result;
    }

    if (Array.isArray(existingEvidence) && existingEvidence.length > 0) {
      const isExactMatch =
        existingEvidence.length === validImageSources.length &&
        existingEvidence.every(
          (e: any, idx: number) =>
            e.source_id === validImageSources[idx].id && e.ordinal === idx
        );

      if (isExactMatch) {
        // Case B: Idempotent match/no-op
        result.persistedCount = existingEvidence.length;
        console.log('[Image Evidence Persist] Idempotent match: existing evidence preserved:', {
          discussionId,
          sourceUserMessageId,
          evidenceCount: existingEvidence.length,
        });
        return result;
      } else {
        // Case C: Existing evidence differs (e.g. combined/mixed evidence established earlier) -> DO NOT DELETE OR OVERWRITE
        console.warn('[Image Evidence Persist] Pre-existing evidence differs from active upload set; preserving existing evidence:', {
          discussionId,
          sourceUserMessageId,
          existingEvidenceCount: existingEvidence.length,
          calculatedImageCount: validImageSources.length,
        });
        result.errors.push('Pre-existing evidence differs from active upload set; existing evidence preserved.');
        result.persistedCount = existingEvidence.length;
        return result;
      }
    }

    // Case A: No existing evidence rows -> insert fresh contiguous evidence items (0..N-1)
    const rowsToInsert = validImageSources.map((source: any, ordinal: number) => ({
      discussion_id: discussionId,
      message_id: sourceUserMessageId,
      source_id: source.id,
      ordinal: ordinal,
    }));

    const { data: insertedData, error: insertErr } = await serviceSupabase
      .from('message_visual_evidence')
      .insert(rowsToInsert)
      .select('id, ordinal');

    if (insertErr) {
      console.warn('[Image Evidence Persist] Error inserting visual evidence items:', insertErr);
      result.errors.push(insertErr.message || 'Insert visual evidence failed');
    } else {
      result.persistedCount = insertedData?.length || rowsToInsert.length;
    }

    console.log('[Image Evidence Persist] Persisted active image evidence set:', {
      discussionId,
      sourceUserMessageId,
      totalSources: sourceRows.length,
      validImageSources: validImageSources.length,
      persistedCount: result.persistedCount,
    });

    return result;
  } catch (err: any) {
    console.warn('[Image Evidence Persist] Non-critical unexpected error persisting active image evidence:', err);
    result.errors.push(err?.message || String(err));
    return result;
  }
}

