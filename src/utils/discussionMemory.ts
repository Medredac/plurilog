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

export interface DiscussionMemoryResult {
  summary?: string;
  recentRounds: Round[];
}

export const SEMANTIC_KEYS = [
  'user_facts',
  'topics_and_context',
  'decisions_and_conclusions',
  'panel_disagreements_and_nuance',
  'unresolved_questions',
  'likely_future_callbacks',
] as const;

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
    user_facts: (parsed.user_facts as string[]).map((s) => s.trim()).filter(Boolean),
    topics_and_context: (parsed.topics_and_context as string[]).map((s) => s.trim()).filter(Boolean),
    decisions_and_conclusions: (parsed.decisions_and_conclusions as string[]).map((s) => s.trim()).filter(Boolean),
    panel_disagreements_and_nuance: (parsed.panel_disagreements_and_nuance as string[]).map((s) => s.trim()).filter(Boolean),
    unresolved_questions: (parsed.unresolved_questions as string[]).map((s) => s.trim()).filter(Boolean),
    likely_future_callbacks: (parsed.likely_future_callbacks as string[]).map((s) => s.trim()).filter(Boolean),
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
3. Preserve specific names, numbers, constraints, decisions, and distinctions when materially useful.
4. 'user_facts' Rules:
   - 'user_facts' may contain ONLY real-world facts that the user explicitly states about themselves, their circumstances, preferences, goals, profession, technical/project environment, constraints, possessions, relationships, location, or similar personal/project facts.
   - A user merely asking about, discussing, requesting information about, or repeatedly returning to a topic is NOT evidence of an interest, preference, identity, occupation, expertise, belief, or personal fact.
   - Explicitly PROHIBITED derived statements: NEVER generate statements such as "User is interested in X", "User likes X", "User prefers X", "User wants to learn about X", or "User is knowledgeable about X" unless the user actually stated that fact about themselves.
   - Panelist statements, recommendations, assumptions, roleplay, jokes, hypotheticals, and the summarizer's own deductions must NEVER create user_facts.
   - If whether something qualifies as a user fact is uncertain, omit it. An empty user_facts array is preferable to an inferred fact.
   - During incremental updates, existing user_facts should normally be carried forward unchanged. Add, correct, supersede, or remove a user fact only when the newly supplied USER messages explicitly support that change. Do not try to infer the provenance of existing facts from their wording.
   - During a full rebuild, derive user_facts only from explicit statements in the supplied USER messages. Do not infer them from the topics of those messages.
5. NEVER treat roleplay, fictional personas, jokes, hypotheticals, or quoted examples as real-world user facts. Recurring roleplay or jokes may instead appear in 'likely_future_callbacks' when they have genuinely become a running thread.
6. Preserve meaningful panel disagreements and attribute them accurately (e.g., "Claude favored X due to Y, while Gemini preferred Z"). Do not flatten disagreement into false consensus.
7. Update or supersede stale conclusions when later conversation changes them.
8. Remove unresolved questions once they have actually been resolved.
9. Merge semantically duplicate entries rather than accumulating copies.
10. Prioritize durable context, recurring themes, decisions, unresolved work, meaningful distinctions, and callbacks likely to matter later.
11. 'likely_future_callbacks' must be grounded in something that actually recurred, was explicitly deferred, or was explicitly flagged for later. Do not invent predictions about what the user may discuss.
12. Keep the entire structure compact because it is injected on every panel turn.`;

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
      max_tokens: 2500,
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

    const formattedSummary = parsedSummary.structured
      ? formatStructuredMemoryForContext(parsedSummary.structured)
      : (parsedSummary.legacyProse || undefined);

    return {
      summary: formattedSummary || undefined,
      recentRounds,
    };
  } catch (err) {
    console.error('[Memory] Exception in getScopedDiscussionMemory:', err, { discussion_id: discussionId });
    return { recentRounds: [] };
  }
}
