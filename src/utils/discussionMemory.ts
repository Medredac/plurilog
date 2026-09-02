import OpenAI from 'openai';
import { SupabaseClient } from '@supabase/supabase-js';

export interface HistoryMessage {
  id?: string;
  discussion_id: string;
  sender: string;
  content: string;
  created_at?: string;
}

export interface Round {
  userMessageId?: string;
  userPrompt: string;
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
 * Formats a Round into the exact textual representation used in model context.
 * Special handling: omits userPrompt if it is equal to 'continue'.
 */
export function formatRoundForContext(round: Round): string {
  const isContinueUser = round.userPrompt.trim().toLowerCase() === 'continue';
  const userPart = isContinueUser
    ? ''
    : `User said:\n"""\n${round.userPrompt}\n"""`;
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
  currentPrompt: string
): Round[] {
  const rounds: Round[] = [];
  let currentRound: Round | null = null;

  for (const msg of messages) {
    if (msg.sender === 'user') {
      if (currentRound && currentRound.userPrompt.trim()) {
        rounds.push(currentRound);
      }
      currentRound = {
        userMessageId: msg.id,
        userPrompt: msg.content || '',
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

  if (currentRound && currentRound.userPrompt.trim()) {
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
 */
export function resolveDeterministicChronology(
  prompt: string,
  allRounds: Round[]
): ChronologicalMemoryResult | null {
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

  // Stage B v1. User-relative before / after: "What did I ask right/immediately/just before/after X?"
  const userRelMatch = cleanPrompt.match(
    /^(?:can you (?:please )?)?(?:tell me )?what did i (?:ask|say) (?:right|immediately|just) (before|after) (.+)$/i
  );

  if (userRelMatch) {
    const direction = userRelMatch[1].toLowerCase() as 'before' | 'after';
    const rawAnchor = userRelMatch[2].trim();
    const anchorIndex = findAnchorRoundIndex(rawAnchor, allRounds);

    if (anchorIndex !== null) {
      const origAnchorMatch = prompt.trim().replace(/[?.!]+$/, '').match(/(?:before|after)\s+(.+)$/i);
      const anchorDisplay = origAnchorMatch
        ? origAnchorMatch[1].replace(/["'?.!]+$/g, '').replace(/^["']/g, '').trim()
        : rawAnchor.replace(/["'?.!]+$/g, '').replace(/^["']/g, '').trim();

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

  // Stage B v1. Speaker-relative before / after: "What did [Speaker] say right/immediately/just before/after X?"
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
    const rawAnchor = speakerRelMatch[3].trim();
    const anchorIndex = findAnchorRoundIndex(rawAnchor, allRounds);

    if (anchorIndex !== null) {
      const origAnchorMatch = prompt.trim().replace(/[?.!]+$/, '').match(/(?:before|after)\s+(.+)$/i);
      const anchorDisplay = origAnchorMatch
        ? origAnchorMatch[1].replace(/["'?.!]+$/g, '').replace(/^["']/g, '').trim()
        : rawAnchor.replace(/["'?.!]+$/g, '').replace(/^["']/g, '').trim();

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

    const allRounds = groupMessagesIntoRounds(rawMessages || [], currentPrompt);
    console.log(`[Memory Debug] Grouped into ${allRounds.length} prior rounds:`, JSON.stringify(allRounds, null, 2));
    const totalRounds = allRounds.length;

    if (totalRounds === 0) {
      return {
        summary: discussion?.summary || undefined,
        recentRounds: [],
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

    const chronologicalMemory = resolveDeterministicChronology(currentPrompt, allRounds);
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
    };
  } catch (err) {
    console.error('[Memory] Exception in getScopedDiscussionMemory:', err, { discussion_id: discussionId });
    return { recentRounds: [] };
  }
}
