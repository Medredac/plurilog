import OpenAI from 'openai';
import type { SupabaseClient } from '@supabase/supabase-js';
import {
  estimateTokens,
  formatRoundForContext,
  type Round,
} from '@/utils/discussionMemory';

const WORKING_CONTEXT_MEMORY_TYPE = 'working_context_v5';
const WORKING_CONTEXT_TOKEN_LIMIT = 500;
const WORKING_CONTEXT_REFRESH_ROUNDS = 2;
const WORKING_CONTEXT_MODEL = 'google/gemini-3.1-flash-lite';

type SpeakerConstraint = 'any' | 'user' | 'chatgpt' | 'claude' | 'gemini';

export interface ConversationWorkingContext {
  _meta: {
    version: 5;
    processed_rounds_count: number;
    last_processed_user_message_id?: string;
    updated_at?: string;
  };
  ongoing_task: string[];
  standing_instructions: string[];
  durable_decisions: string[];
  active_threads: string[];
  open_questions: string[];
  retrieval_cues: string[];
}

interface ConversationWorkingContextEnvelope {
  _memory_type: typeof WORKING_CONTEXT_MEMORY_TYPE;
  working_context: ConversationWorkingContext;
  legacy_summary_backup?: string | null;
}

export interface WorkingContextRefreshResult {
  context: ConversationWorkingContext | null;
  formatted: string;
  refreshed: boolean;
  refreshReason:
    | 'none'
    | 'bootstrap'
    | 'incremental'
    | 'rebuild_missing_checkpoint';
  inputTokens: number | null;
  outputTokens: number | null;
  costUsd: number | null;
}

export interface ProactiveMemoryIntent {
  kind: 'semantic' | 'first' | 'last';
  query: string;
  speaker: SpeakerConstraint;
  max_results: number;
}

export interface ProactiveMemoryPlan {
  should_retrieve: boolean;
  confidence: number;
  intents: ProactiveMemoryIntent[];
  reason: string;
  inputTokens: number | null;
  outputTokens: number | null;
  costUsd: number | null;
}

const WORKING_CONTEXT_LIMITS = {
  ongoing_task: 2,
  standing_instructions: 4,
  durable_decisions: 5,
  active_threads: 6,
  open_questions: 4,
  retrieval_cues: 4,
} as const;

const WORKING_CONTEXT_KEYS = [
  'ongoing_task',
  'standing_instructions',
  'durable_decisions',
  'active_threads',
  'open_questions',
  'retrieval_cues',
] as const;

function clipText(value: string, maxChars: number): string {
  const clean = String(value || '').trim();
  if (clean.length <= maxChars) return clean;
  if (maxChars <= 40) return clean.slice(0, maxChars);
  const tailChars = Math.floor(maxChars * 0.35);
  const headChars = maxChars - tailChars - 1;
  return `${clean.slice(0, headChars).trimEnd()}…${clean
    .slice(-tailChars)
    .trimStart()}`;
}

function cleanWorkingContextItem(value: unknown): string | null {
  if (typeof value !== 'string') return null;
  const clean = value.replace(/\s+/g, ' ').trim();
  if (!clean) return null;
  return clipText(clean, 190);
}

function validateWorkingContextBody(
  raw: any
): Omit<ConversationWorkingContext, '_meta'> | null {
  if (!raw || typeof raw !== 'object' || Array.isArray(raw)) return null;

  const out: Record<string, string[]> = {};
  for (const key of WORKING_CONTEXT_KEYS) {
    if (!Array.isArray(raw[key])) return null;
    const limit = WORKING_CONTEXT_LIMITS[key];
    const cleaned = raw[key]
      .map(cleanWorkingContextItem)
      .filter((item: string | null): item is string => Boolean(item))
      .slice(0, limit);
    out[key] = Array.from(new Set(cleaned));
  }

  return out as Omit<ConversationWorkingContext, '_meta'>;
}

export function parseConversationWorkingContextEnvelope(
  rawSummary?: string | null
): {
  envelope: ConversationWorkingContextEnvelope | null;
  legacySummaryBackup: string | null;
} {
  const raw = String(rawSummary || '').trim();
  if (!raw) {
    return { envelope: null, legacySummaryBackup: null };
  }

  try {
    const parsed = JSON.parse(raw);
    if (
      !parsed ||
      typeof parsed !== 'object' ||
      Array.isArray(parsed) ||
      parsed._memory_type !== WORKING_CONTEXT_MEMORY_TYPE ||
      !parsed.working_context
    ) {
      const isOlderWorkingContext =
        parsed &&
        typeof parsed === 'object' &&
        !Array.isArray(parsed) &&
        typeof parsed._memory_type === 'string' &&
        /^working_context_v\d+$/.test(parsed._memory_type);
      return {
        envelope: null,
        legacySummaryBackup: isOlderWorkingContext
          ? (typeof parsed.legacy_summary_backup === 'string'
              ? parsed.legacy_summary_backup
              : null)
          : raw,
      };
    }

    const body = validateWorkingContextBody(parsed.working_context);
    const meta = parsed.working_context?._meta;
    const processedCount =
      Number.isInteger(meta?.processed_rounds_count) &&
      meta.processed_rounds_count >= 0
        ? meta.processed_rounds_count
        : null;

    if (!body || processedCount === null) {
      return {
        envelope: null,
        legacySummaryBackup:
          typeof parsed.legacy_summary_backup === 'string'
            ? parsed.legacy_summary_backup
            : null,
      };
    }

    const context: ConversationWorkingContext = {
      _meta: {
        version: 5,
        processed_rounds_count: processedCount,
        ...(typeof meta?.last_processed_user_message_id === 'string' &&
        meta.last_processed_user_message_id.trim()
          ? {
              last_processed_user_message_id:
                meta.last_processed_user_message_id.trim(),
            }
          : {}),
        ...(typeof meta?.updated_at === 'string' && meta.updated_at.trim()
          ? { updated_at: meta.updated_at.trim() }
          : {}),
      },
      ...body,
    };

    return {
      envelope: {
        _memory_type: WORKING_CONTEXT_MEMORY_TYPE,
        working_context: context,
        legacy_summary_backup:
          typeof parsed.legacy_summary_backup === 'string'
            ? parsed.legacy_summary_backup
            : null,
      },
      legacySummaryBackup:
        typeof parsed.legacy_summary_backup === 'string'
          ? parsed.legacy_summary_backup
          : null,
    };
  } catch {
    return { envelope: null, legacySummaryBackup: raw };
  }
}

function compactRoundForWorkingContext(round: Round, index: number): string {
  const userText = clipText(round.userPrompt || '', 900);
  const responses = (round.modelResponses || [])
    .map((response) => {
      const content = clipText(response.content || '', 220);
      return content ? `${response.name}: ${content}` : '';
    })
    .filter(Boolean)
    .join('\n');

  return [
    `[Round ${index + 1}]`,
    userText ? `User: ${userText}` : '',
    responses,
  ]
    .filter(Boolean)
    .join('\n');
}

function compactRoundsForWorkingContext(
  rounds: Round[],
  tokenBudget: number = 30000
): string {
  if (!Array.isArray(rounds) || rounds.length === 0) return '';

  const blocks = rounds.map(compactRoundForWorkingContext);
  const all = blocks.join('\n\n---\n\n');
  if (estimateTokens(all) <= tokenBudget) return all;

  const selected = new Set<number>();
  const firstCount = Math.min(5, rounds.length);
  const lastCount = Math.min(24, Math.max(0, rounds.length - firstCount));

  for (let i = 0; i < firstCount; i += 1) selected.add(i);
  for (let i = Math.max(firstCount, rounds.length - lastCount); i < rounds.length; i += 1) {
    selected.add(i);
  }

  const middleStart = firstCount;
  const middleEnd = Math.max(middleStart, rounds.length - lastCount);
  const middleLength = middleEnd - middleStart;
  if (middleLength > 0) {
    const sampleCount = Math.min(20, middleLength);
    for (let sample = 0; sample < sampleCount; sample += 1) {
      const ratio = sampleCount <= 1 ? 0 : sample / (sampleCount - 1);
      const idx =
        middleStart +
        Math.min(
          middleLength - 1,
          Math.round(ratio * Math.max(0, middleLength - 1))
        );
      selected.add(idx);
    }
  }

  const ordered = Array.from(selected).sort((a, b) => a - b);
  let chosen = ordered.map((idx) => blocks[idx]).join('\n\n---\n\n');

  while (estimateTokens(chosen) > tokenBudget && ordered.length > firstCount + 8) {
    const removable = ordered.findIndex(
      (idx, position) =>
        idx >= middleStart &&
        idx < middleEnd &&
        position > 0 &&
        position < ordered.length - 1
    );
    if (removable < 0) break;
    ordered.splice(removable, 1);
    chosen = ordered.map((idx) => blocks[idx]).join('\n\n---\n\n');
  }

  return chosen;
}

function contextWithoutMeta(
  context: ConversationWorkingContext
): Omit<ConversationWorkingContext, '_meta'> {
  return {
    ongoing_task: context.ongoing_task,
    standing_instructions: context.standing_instructions,
    durable_decisions: context.durable_decisions,
    active_threads: context.active_threads,
    open_questions: context.open_questions,
    retrieval_cues: context.retrieval_cues,
  };
}

async function generateWorkingContext(options: {
  openai: OpenAI;
  allRounds: Round[];
  roundsToIncorporate: Round[];
  existingContext: ConversationWorkingContext | null;
  mode: 'bootstrap' | 'incremental' | 'rebuild';
  signal?: AbortSignal;
}): Promise<{
  context: ConversationWorkingContext | null;
  inputTokens: number | null;
  outputTokens: number | null;
  costUsd: number | null;
}> {
  const {
    openai,
    allRounds,
    roundsToIncorporate,
    existingContext,
    mode,
    signal,
  } = options;

  const sourceRounds =
    mode === 'incremental' ? roundsToIncorporate : allRounds;
  const formattedRounds = compactRoundsForWorkingContext(
    sourceRounds,
    mode === 'incremental' ? 10000 : 30000
  );

  const systemPrompt = `You maintain a compact WORKING CONTEXT for an ongoing multi-model conversation.

This is NOT a historical summary and NOT source evidence. It is a navigation map used to preserve task state and decide when older conversation evidence may matter.

Return JSON only with exactly these six arrays:
{
  "ongoing_task": [],
  "standing_instructions": [],
  "durable_decisions": [],
  "active_threads": [],
  "open_questions": [],
  "retrieval_cues": []
}

Rules:
1. Keep the result extremely compact. Prefer fewer, stronger entries.
2. ongoing_task: what the user and panel are actually doing across turns right now. Do not promote a hypothetical example, possible future test, illustrative scenario, or merely proposed next step into the ongoing task unless the user actually begins that task.
3. standing_instructions: ONLY explicit persistent instructions or constraints the user actually stated for the ongoing task. Never infer a standing instruction from tone, repeated behavior, jokes, wording style, or what the assistants happened to do.
4. durable_decisions: ONLY operational/project/task choices explicitly settled or adopted for future work. Ordinary factual conclusions, explanations, opinions, analogies, and answers about an external topic are NOT durable decisions.
5. active_threads: a small set of neutral labels for genuinely ongoing concepts, entities, requirements, artifacts, hypotheses, or workstreams likely to matter across future turns. Prune threads that the conversation has clearly moved away from unless a durable decision/instruction still depends on them. Do not preserve every topic mentioned in casual conversation. Do not add chronology claims such as "X first appeared in Y".
6. open_questions: ONLY questions or issues the user explicitly leaves unresolved, deferred, undecided, or marked for later follow-up. Planned examples, demos, possible future tests, rhetorical questions, and questions already answered by the panel are NOT open questions. Never infer an open question merely because a future scenario could be tested.
7. retrieval_cues: ONLY durable, history-sensitive task conditions where older exact conversation evidence may later matter. Ordinary topical discussion, factual Q&A, opinions, or a recurring subject do NOT justify a retrieval cue. Example shape: "When a new change touches a previously settled architecture decision, retrieve the earlier decision before evaluating it." Do not hard-code a single missed phrase or isolated incident unless the user explicitly made it a standing requirement.
8. The working context is a MAP, never evidence. Do not include quotations, exact chronology, or claims whose correctness depends on a specific historical occurrence.
9. Default to EMPTY arrays for standing_instructions, durable_decisions, and open_questions unless the conversation clearly satisfies their strict definitions. It is better to omit state than to invent persistence.
10. Panel responses may help you understand the task, but do not preserve panel disagreements, speculation, factual answers, or unsupported interpretations as durable state.
11. When the user explicitly corrects the panel, the corrected constraint/state should supersede the stale one.
12. For fiction, roleplay, examples, or hypothetical material, keep labels neutral and inside the task context. Never turn fictional details into real-world user facts.
13. Maximum items: ongoing_task 2; standing_instructions 4; durable_decisions 5; active_threads 6; open_questions 4; retrieval_cues 4.
14. Each item should usually be under 24 words.
15. Do not include metadata; the application adds it.`;

  const existingBlock = existingContext
    ? `EXISTING WORKING CONTEXT:\n${JSON.stringify(
        contextWithoutMeta(existingContext),
        null,
        2
      )}\n\n`
    : '';

  const taskPrompt =
    mode === 'incremental'
      ? `Update the existing working context using ONLY the new completed rounds below. Carry forward still-valid state, supersede stale state when the new user messages require it, and avoid expanding into a historical summary.\n\n${existingBlock}NEW COMPLETED ROUNDS:\n"""\n${formattedRounds}\n"""`
      : `Build the working context for this ongoing conversation from the completed rounds below. Focus on task state, standing instructions, active work, unresolved issues, and generic retrieval cues rather than retelling history.\n\nCOMPLETED ROUNDS:\n"""\n${formattedRounds}\n"""`;

  try {
    const response = await openai.chat.completions.create(
      {
        model: WORKING_CONTEXT_MODEL,
        messages: [
          { role: 'system', content: systemPrompt },
          { role: 'user', content: taskPrompt },
        ],
        response_format: { type: 'json_object' },
        temperature: 0.1,
        max_tokens: 900,
      },
      signal ? { signal } : undefined
    );

    const raw = response.choices?.[0]?.message?.content?.trim();
    if (!raw) {
      return {
        context: null,
        inputTokens: response.usage?.prompt_tokens ?? null,
        outputTokens: response.usage?.completion_tokens ?? null,
        costUsd:
          typeof (response.usage as any)?.cost === 'number'
            ? (response.usage as any).cost
            : null,
      };
    }

    const parsed = JSON.parse(
      raw
        .replace(/^\`\`\`(?:json)?\s*/i, '')
        .replace(/\s*\`\`\`$/, '')
    );
    const body = validateWorkingContextBody(parsed);
    if (!body) {
      return {
        context: null,
        inputTokens: response.usage?.prompt_tokens ?? null,
        outputTokens: response.usage?.completion_tokens ?? null,
        costUsd:
          typeof (response.usage as any)?.cost === 'number'
            ? (response.usage as any).cost
            : null,
      };
    }

    const lastRound = allRounds[allRounds.length - 1];
    const context: ConversationWorkingContext = {
      _meta: {
        version: 5,
        processed_rounds_count: allRounds.length,
        ...(lastRound?.userMessageId
          ? { last_processed_user_message_id: lastRound.userMessageId }
          : {}),
        updated_at: new Date().toISOString(),
      },
      ...body,
    };

    return {
      context,
      inputTokens: response.usage?.prompt_tokens ?? null,
      outputTokens: response.usage?.completion_tokens ?? null,
      costUsd:
        typeof (response.usage as any)?.cost === 'number'
          ? (response.usage as any).cost
          : null,
    };
  } catch (error: any) {
    console.warn('[Working Context] Non-critical generation failure', {
      message: error?.message || String(error),
      mode,
    });
    return {
      context: null,
      inputTokens: null,
      outputTokens: null,
      costUsd: null,
    };
  }
}

export function formatConversationWorkingContext(
  context: ConversationWorkingContext | null
): string {
  if (!context) return '';

  const sections: Array<[string, string[]]> = [
    ['ONGOING TASK', context.ongoing_task],
    ['STANDING INSTRUCTIONS', context.standing_instructions],
    ['DURABLE DECISIONS', context.durable_decisions],
    ['RETRIEVAL CUES', context.retrieval_cues],
    ['ACTIVE THREADS / ANCHORS', context.active_threads],
    ['OPEN QUESTIONS', context.open_questions],
  ];

  const accepted = new Map<string, string[]>();

  for (const [label, items] of sections) {
    for (const item of items) {
      const current = Array.from(accepted.entries())
        .filter(([, values]) => values.length > 0)
        .map(
          ([sectionLabel, values]) =>
            `${sectionLabel}\n${values.map((value) => `- ${value}`).join('\n')}`
        )
        .join('\n\n');

      const nextValues = [...(accepted.get(label) || []), item];
      const candidateMap = new Map(accepted);
      candidateMap.set(label, nextValues);
      const candidate = Array.from(candidateMap.entries())
        .filter(([, values]) => values.length > 0)
        .map(
          ([sectionLabel, values]) =>
            `${sectionLabel}\n${values.map((value) => `- ${value}`).join('\n')}`
        )
        .join('\n\n');

      if (
        estimateTokens(candidate) <= WORKING_CONTEXT_TOKEN_LIMIT ||
        !current
      ) {
        accepted.set(label, nextValues);
      }
    }
  }

  return Array.from(accepted.entries())
    .filter(([, values]) => values.length > 0)
    .map(
      ([label, values]) =>
        `${label}\n${values.map((value) => `- ${value}`).join('\n')}`
    )
    .join('\n\n');
}

export async function getOrRefreshConversationWorkingContext(options: {
  discussionId: string;
  allRounds: Round[];
  openai: OpenAI;
  supabase: SupabaseClient;
  signal?: AbortSignal;
}): Promise<WorkingContextRefreshResult> {
  const { discussionId, allRounds, openai, supabase, signal } = options;

  if (!discussionId || !supabase || !Array.isArray(allRounds)) {
    return {
      context: null,
      formatted: '',
      refreshed: false,
      refreshReason: 'none',
      inputTokens: null,
      outputTokens: null,
      costUsd: null,
    };
  }

  const { data: discussion, error } = await supabase
    .from('discussions')
    .select('summary')
    .eq('id', discussionId)
    .single();

  if (error) {
    console.warn('[Working Context] Could not read stored state', {
      discussionId,
      message: error.message,
    });
    return {
      context: null,
      formatted: '',
      refreshed: false,
      refreshReason: 'none',
      inputTokens: null,
      outputTokens: null,
      costUsd: null,
    };
  }

  const rawSummary =
    typeof discussion?.summary === 'string' ? discussion.summary : '';
  const parsed = parseConversationWorkingContextEnvelope(rawSummary);
  let context = parsed.envelope?.working_context || null;
  let refreshReason: WorkingContextRefreshResult['refreshReason'] = 'none';
  let roundsToIncorporate: Round[] = [];

  if (!context) {
    if (allRounds.length >= 2) {
      refreshReason = 'bootstrap';
      roundsToIncorporate = allRounds;
    }
  } else {
    const lastProcessedId = context._meta.last_processed_user_message_id;
    let lastProcessedIndex = -1;
    if (lastProcessedId) {
      lastProcessedIndex = allRounds.findIndex(
        (round) => round.userMessageId === lastProcessedId
      );
    }

    if (
      (lastProcessedId && lastProcessedIndex < 0) ||
      context._meta.processed_rounds_count > allRounds.length
    ) {
      refreshReason = 'rebuild_missing_checkpoint';
      roundsToIncorporate = allRounds;
    } else {
      const startIndex =
        lastProcessedIndex >= 0
          ? lastProcessedIndex + 1
          : Math.min(context._meta.processed_rounds_count, allRounds.length);
      roundsToIncorporate = allRounds.slice(startIndex);
      if (roundsToIncorporate.length >= WORKING_CONTEXT_REFRESH_ROUNDS) {
        refreshReason = 'incremental';
      }
    }
  }

  let metrics = {
    inputTokens: null as number | null,
    outputTokens: null as number | null,
    costUsd: null as number | null,
  };
  let didRefresh = false;

  if (refreshReason !== 'none') {
    const generated = await generateWorkingContext({
      openai,
      allRounds,
      roundsToIncorporate,
      existingContext:
        refreshReason === 'incremental' ? context : null,
      mode:
        refreshReason === 'incremental'
          ? 'incremental'
          : refreshReason === 'bootstrap'
            ? 'bootstrap'
            : 'rebuild',
      signal,
    });

    metrics = {
      inputTokens: generated.inputTokens,
      outputTokens: generated.outputTokens,
      costUsd: generated.costUsd,
    };

    if (generated.context) {
      context = generated.context;
      didRefresh = true;
      const envelope: ConversationWorkingContextEnvelope = {
        _memory_type: WORKING_CONTEXT_MEMORY_TYPE,
        working_context: generated.context,
        legacy_summary_backup:
          parsed.legacySummaryBackup || null,
      };

      const { error: updateError } = await supabase
        .from('discussions')
        .update({ summary: JSON.stringify(envelope) })
        .eq('id', discussionId);

      if (updateError) {
        console.warn('[Working Context] Could not persist refreshed state', {
          discussionId,
          message: updateError.message,
        });
      }
    }
  }

  const formatted = formatConversationWorkingContext(context);

  console.log('[Working Context]', {
    discussionId,
    refreshReason,
    refreshed: didRefresh,
    processedRounds: context?._meta.processed_rounds_count || 0,
    formattedTokens: formatted ? estimateTokens(formatted) : 0,
    inputTokens: metrics.inputTokens,
    outputTokens: metrics.outputTokens,
    costUsd: metrics.costUsd,
  });

  return {
    context,
    formatted,
    refreshed: didRefresh,
    refreshReason,
    ...metrics,
  };
}

function compactRecentRoundsForPlanner(rounds: Round[]): string {
  return (rounds || [])
    .slice(-2)
    .map((round, index, selected) => {
      const absoluteIndex = rounds.length - selected.length + index + 1;
      const user = clipText(round.userPrompt || '', 1800);
      const responses = (round.modelResponses || [])
        .map((response) => {
          const text = clipText(response.content || '', 500);
          return text ? `${response.name}: ${text}` : '';
        })
        .filter(Boolean)
        .join('\n');
      return [
        `[Recent round ${absoluteIndex}]`,
        user ? `User: ${user}` : '',
        responses,
      ]
        .filter(Boolean)
        .join('\n');
    })
    .join('\n\n---\n\n');
}

function validateProactiveMemoryPlan(raw: any): Omit<
  ProactiveMemoryPlan,
  'inputTokens' | 'outputTokens' | 'costUsd'
> | null {
  if (!raw || typeof raw !== 'object' || Array.isArray(raw)) return null;

  const shouldRetrieve = raw.should_retrieve === true;
  const confidence =
    typeof raw.confidence === 'number' && Number.isFinite(raw.confidence)
      ? Math.max(0, Math.min(1, raw.confidence))
      : 0;
  const reason =
    typeof raw.reason === 'string' ? clipText(raw.reason, 240) : '';

  if (!shouldRetrieve) {
    return {
      should_retrieve: false,
      confidence,
      intents: [],
      reason,
    };
  }

  const intents: ProactiveMemoryIntent[] = Array.isArray(raw.intents)
    ? raw.intents
        .map((intent: any) => {
          const kind =
            intent?.kind === 'first' || intent?.kind === 'last'
              ? intent.kind
              : 'semantic';
          const query =
            typeof intent?.query === 'string'
              ? clipText(intent.query, 500)
              : '';
          const speaker: SpeakerConstraint = [
            'user',
            'chatgpt',
            'claude',
            'gemini',
          ].includes(intent?.speaker)
            ? intent.speaker
            : 'any';
          const maxResults =
            Number.isInteger(intent?.max_results) &&
            intent.max_results >= 1 &&
            intent.max_results <= 3
              ? intent.max_results
              : 2;

          if (!query) return null;
          return {
            kind,
            query,
            speaker,
            max_results: maxResults,
          } satisfies ProactiveMemoryIntent;
        })
        .filter(
          (intent: ProactiveMemoryIntent | null): intent is ProactiveMemoryIntent =>
            Boolean(intent)
        )
        .slice(0, 2)
    : [];

  return {
    should_retrieve: intents.length > 0,
    confidence,
    intents,
    reason,
  };
}

export async function planProactiveConversationRetrieval(options: {
  currentPrompt: string;
  workingContext: string;
  recentRounds: Round[];
  olderRoundCount: number;
  openai: OpenAI;
  signal?: AbortSignal;
}): Promise<ProactiveMemoryPlan> {
  const {
    currentPrompt,
    workingContext,
    recentRounds,
    olderRoundCount,
    openai,
    signal,
  } = options;

  if (!currentPrompt?.trim() || olderRoundCount <= 0) {
    return {
      should_retrieve: false,
      confidence: 1,
      intents: [],
      reason: 'No older history is available beyond the exact recent baseline.',
      inputTokens: null,
      outputTokens: null,
      costUsd: null,
    };
  }

  const systemPrompt = `You are the SHARED conversation-memory relevance planner for a multi-model panel.

Your job is NOT to answer the user. Decide whether the current request actually DEPENDS on older conversation evidence beyond the exact recent context already provided.

The default is NO RETRIEVAL.

The WORKING CONTEXT is a navigation map only. It is NOT evidence. Active threads and retrieval cues are hints, never automatic triggers.

Core test:
Would an otherwise competent answer that used only the current message + exact recent context risk being wrong about THIS CONVERSATION, violate a durable task constraint, miss a genuine callback/cross-turn dependency, or make an unsupported historical claim? If not, return should_retrieve=false.

Retrieve only when older exact conversation evidence is genuinely needed for one or more of these:
- a prior user instruction, decision, constraint, correction, or settled project state materially controls the current answer;
- the user explicitly or implicitly asks what happened/was said/was decided earlier, including first/last/origin/chronology;
- the current material plausibly invokes a tracked callback, unresolved thread, recurring artifact/entity, or continuity-sensitive task where older evidence could change the interpretation;
- the current prompt is underspecified and the exact recent context cannot resolve the referent;
- a claim about conversation history must be verified.

Do NOT retrieve merely for:
- general knowledge, explanation, speculation, opinion, brainstorming, or advice that can be answered from the current prompt;
- maintaining "consistency with the panel's established stance" or recalling what the panel previously believed;
- the same broad topic continuing across turns;
- background context that would be nice to have but would not materially change the answer;
- repeated words/entities without a genuine cross-turn dependency;
- subjective prompts such as "what do you think?", "is this exciting or scary?", or conceptual follow-ups that the exact recent rounds already make intelligible.

Additional rules:
1. If the working context establishes an explicit history-sensitive goal—such as tracking callbacks across chapters or respecting earlier architecture decisions—retrieve when the current material plausibly touches that goal.
2. This rule is domain-general. Do not invent case-specific patches.
3. Generate focused retrieval intents only for the older evidence actually needed. Do not paste the whole current request as a search query.
4. Use kind="first" or kind="last" only when chronological origin/most-recent occurrence itself matters. Otherwise use kind="semantic".
5. At most 2 intents. Prefer 1 when sufficient.
6. The two exact recent rounds are already visible to every seat. NEVER retrieve them proactively. If the needed evidence is already present there, return should_retrieve=false.
7. Do not treat working-context statements as proof of historical facts. Retrieval is how exact evidence is established.
8. When uncertain whether retrieval is necessary versus merely potentially useful, choose NO RETRIEVAL.
9. Return JSON only.

Schema:
{
  "should_retrieve": boolean,
  "confidence": number,
  "reason": string,
  "intents": [
    {
      "kind": "semantic" | "first" | "last",
      "query": string,
      "speaker": "any" | "user" | "chatgpt" | "claude" | "gemini",
      "max_results": 1 | 2 | 3
    }
  ]
}`;

  const recent = compactRecentRoundsForPlanner(recentRounds);
  const current = clipText(currentPrompt, 16000);
  const userPrompt = `WORKING CONTEXT — NAVIGATION MAP, NOT EVIDENCE:
"""
${workingContext || '(none yet)'}
"""

EXACT RECENT CONTEXT:
"""
${recent || '(none)'}
"""

CURRENT USER MESSAGE:
"""
${current}
"""

OLDER ROUNDS AVAILABLE BEYOND THE EXACT RECENT BASELINE: ${olderRoundCount}`;

  try {
    const response = await openai.chat.completions.create(
      {
        model: WORKING_CONTEXT_MODEL,
        messages: [
          { role: 'system', content: systemPrompt },
          { role: 'user', content: userPrompt },
        ],
        response_format: { type: 'json_object' },
        temperature: 0,
        max_tokens: 420,
      },
      signal ? { signal } : undefined
    );

    const raw = response.choices?.[0]?.message?.content?.trim();
    const usage = response.usage;
    const costUsd =
      typeof (usage as any)?.cost === 'number' ? (usage as any).cost : null;

    if (!raw) {
      return {
        should_retrieve: false,
        confidence: 0,
        intents: [],
        reason: 'Planner returned no decision.',
        inputTokens: usage?.prompt_tokens ?? null,
        outputTokens: usage?.completion_tokens ?? null,
        costUsd,
      };
    }

    const parsed = JSON.parse(
      raw
        .replace(/^\`\`\`(?:json)?\s*/i, '')
        .replace(/\s*\`\`\`$/, '')
    );
    const validated = validateProactiveMemoryPlan(parsed);

    if (!validated) {
      return {
        should_retrieve: false,
        confidence: 0,
        intents: [],
        reason: 'Planner output failed validation.',
        inputTokens: usage?.prompt_tokens ?? null,
        outputTokens: usage?.completion_tokens ?? null,
        costUsd,
      };
    }

    const result: ProactiveMemoryPlan = {
      ...validated,
      inputTokens: usage?.prompt_tokens ?? null,
      outputTokens: usage?.completion_tokens ?? null,
      costUsd,
    };

    console.log('[Proactive Memory Planner]', {
      shouldRetrieve: result.should_retrieve,
      confidence: result.confidence,
      intents: result.intents,
      reason: result.reason,
      inputTokens: result.inputTokens,
      outputTokens: result.outputTokens,
      costUsd: result.costUsd,
      olderRoundCount,
    });

    return result;
  } catch (error: any) {
    console.warn('[Proactive Memory Planner] Non-critical failure', {
      message: error?.message || String(error),
    });
    return {
      should_retrieve: false,
      confidence: 0,
      intents: [],
      reason: 'Planner unavailable.',
      inputTokens: null,
      outputTokens: null,
      costUsd: null,
    };
  }
}
