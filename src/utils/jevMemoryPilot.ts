import type { Round } from '@/utils/discussionMemory';

const DEFAULT_JEV_MODEL = '~typesafe/jev-latest';
const DECISIONS_URL = 'https://openrouter.ai/api/alpha/decisions';

type KnownDocumentLike = {
  filename?: string | null;
  createdAt?: string | null;
};

type JevAnswer =
  | {
      type: 'noul';
      noul: number;
    }
  | {
      type: 'choice';
      choice: string;
      probabilities?: Record<string, number>;
      confidence?: number;
    }
  | {
      type: 'score';
      score: number;
      probabilities?: Record<string, number>;
      confidence?: number;
      legend?: Record<string, string>;
    };

export type JevMemoryPilotShadowResult = {
  requestId: string | null;
  model: string | null;
  provider: string | null;
  latencyMs: number;
  usage: {
    input_tokens?: number;
    output_tokens?: number;
    cost?: number;
  } | null;
  answers: Record<string, JevAnswer>;
  compiledPlan: {
    operations: string[];
    dependencies: Array<{ from: string; to: string; reason: string }>;
    constraints: {
      speaker: string | null;
      temporalRelation: string | null;
      semanticRole: string | null;
      chronologyRole: string | null;
      topicSource: string | null;
      anchorSource: string | null;
    };
    escalationSuggested: boolean;
  };
};

export function isJevMemoryPilotShadowEnabled(): boolean {
  const configured = process.env.JEV_MEMORY_PILOT_SHADOW;
  if (configured === 'true') return true;
  if (configured === 'false') return false;

  // Shadow-only by default on Preview. Production remains untouched.
  return process.env.VERCEL_ENV === 'preview';
}

function clip(value: string, maxChars: number): string {
  if (value.length <= maxChars) return value;
  return `${value.slice(0, maxChars)}\n[truncated]`;
}

function compactRecentRounds(rounds: Round[] | undefined): Array<{
  user: string;
  chatgpt?: string;
  claude?: string;
  gemini?: string;
}> {
  const recent = Array.isArray(rounds) ? rounds.slice(-3) : [];

  return recent.map((round) => {
    const compact: {
      user: string;
      chatgpt?: string;
      claude?: string;
      gemini?: string;
    } = {
      user: clip(round.userPrompt || '', 2200),
    };

    for (const response of round.modelResponses || []) {
      const sender = String(response.name || '').toLowerCase();
      const content = clip(response.content || '', 2200);
      if (!content) continue;

      if (sender.includes('chatgpt') || sender === 'gpt' || sender.includes('openai')) {
        compact.chatgpt = content;
      } else if (sender.includes('claude') || sender.includes('anthropic')) {
        compact.claude = content;
      } else if (sender.includes('gemini') || sender.includes('google')) {
        compact.gemini = content;
      }
    }

    return compact;
  });
}


function getNoul(
  answers: Record<string, JevAnswer>,
  key: string
): number {
  const answer = answers[key];
  return answer?.type === 'noul' && typeof answer.noul === 'number'
    ? answer.noul
    : 0;
}

function getChoice(
  answers: Record<string, JevAnswer>,
  key: string
): string | null {
  const answer = answers[key];
  return answer?.type === 'choice' && typeof answer.choice === 'string'
    ? answer.choice
    : null;
}

function compileShadowPlan(answers: Record<string, JevAnswer>) {
  const operations: string[] = [];
  const dependencies: Array<{ from: string; to: string; reason: string }> = [];

  const recentNeeded = getNoul(answers, 'recent_context_dependency') >= 0.5;
  const semanticNeeded = getNoul(answers, 'semantic_history_needed') >= 0.5;
  const chronologyNeeded = getNoul(answers, 'chronology_needed') >= 0.5;
  const summaryNeeded = getNoul(answers, 'rolling_summary_needed') >= 0.5;
  const documentNeeded = getNoul(answers, 'document_search_needed') >= 0.5;
  const visualNeeded = getNoul(answers, 'visual_evidence_needed') >= 0.5;

  const speaker = getChoice(answers, 'speaker_target');
  const temporalRelation = getChoice(answers, 'temporal_relation');
  const semanticRole = getChoice(answers, 'semantic_role');
  const chronologyRole = getChoice(answers, 'chronology_role');
  const topicSource = getChoice(answers, 'topic_source');
  const anchorSource = getChoice(answers, 'anchor_source');

  if (recentNeeded) operations.push('recent_exact');
  if (summaryNeeded) operations.push('rolling_summary');
  if (semanticNeeded) operations.push('semantic_history');
  if (chronologyNeeded) operations.push('chronology');
  if (documentNeeded) operations.push('document_search');
  if (visualNeeded) operations.push('visual_evidence');
  if (speaker && speaker !== 'none') operations.push('speaker_filter');

  const addDependency = (from: string, to: string, reason: string) => {
    if (
      operations.includes(from) &&
      operations.includes(to) &&
      !dependencies.some((d) => d.from === from && d.to === to)
    ) {
      dependencies.push({ from, to, reason });
    }
  };

  if (semanticNeeded && topicSource === 'recent_context') {
    addDependency(
      'recent_exact',
      'semantic_history',
      'Recent context supplies the topic/referent for semantic retrieval.'
    );
  }

  if (semanticNeeded && chronologyNeeded && anchorSource === 'semantic_result') {
    addDependency(
      'semantic_history',
      'chronology',
      'Semantic retrieval locates the historical anchor/candidates before chronological navigation.'
    );
  }

  if (chronologyNeeded && anchorSource === 'recent_context') {
    addDependency(
      'recent_exact',
      'chronology',
      'Recent context resolves the historical anchor before chronological navigation.'
    );
  }

  if (
    semanticNeeded &&
    chronologyNeeded &&
    anchorSource !== 'semantic_result' &&
    chronologyRole === 'scope_for_semantic'
  ) {
    addDependency(
      'chronology',
      'semantic_history',
      'Chronology establishes the historical scope before topical retrieval.'
    );
  }

  if (documentNeeded && visualNeeded) {
    addDependency(
      'document_search',
      'visual_evidence',
      'The document must be identified before canonical visual inspection.'
    );
  }

  if (speaker && speaker !== 'none') {
    if (chronologyNeeded) {
      addDependency(
        'chronology',
        'speaker_filter',
        'Apply the requested speaker constraint to chronologically selected evidence.'
      );
    } else if (semanticNeeded) {
      addDependency(
        'semantic_history',
        'speaker_filter',
        'Extract the requested speaker from semantically selected historical rounds.'
      );
    } else if (recentNeeded) {
      addDependency(
        'recent_exact',
        'speaker_filter',
        'Extract the requested speaker from recent exact context.'
      );
    }
  }

  return {
    operations,
    dependencies,
    constraints: {
      speaker: speaker && speaker !== 'none' ? speaker : null,
      temporalRelation:
        temporalRelation && temporalRelation !== 'none'
          ? temporalRelation
          : null,
      semanticRole:
        semanticNeeded && semanticRole && semanticRole !== 'none'
          ? semanticRole
          : null,
      chronologyRole:
        chronologyNeeded && chronologyRole && chronologyRole !== 'none'
          ? chronologyRole
          : null,
      topicSource:
        topicSource && topicSource !== 'none' ? topicSource : null,
      anchorSource:
        anchorSource && anchorSource !== 'none' ? anchorSource : null,
    },
    escalationSuggested:
      getNoul(answers, 'flexible_resolver_needed') >= 0.5,
  };
}

export async function runJevMemoryPilotShadow(options: {
  apiKey: string;
  prompt: string;
  recentRounds?: Round[];
  knownDocuments?: KnownDocumentLike[];
  signal?: AbortSignal;
}): Promise<JevMemoryPilotShadowResult> {
  const startedAt = Date.now();
  const model = process.env.JEV_MEMORY_PILOT_MODEL || DEFAULT_JEV_MODEL;

  const state = {
    current_user_message: clip(options.prompt || '', 6000),
    recent_context: compactRecentRounds(options.recentRounds),
    known_documents: (options.knownDocuments || []).slice(-20).map((doc) => ({
      filename: doc.filename || 'unknown',
      created_at: doc.createdAt || null,
    })),
    available_memory_systems: [
      'recent_exact',
      'semantic_history',
      'chronology',
      'rolling_summary',
      'document_search',
      'visual_evidence',
      'speaker_filter',
    ],
    controller_role:
      'Choose what evidence operations Plurilog needs. Do not answer the user. Multiple systems may be needed and one system may need to feed or constrain another.',
  };

  const questions = {
    historical_conversation_needed: {
      type: 'noul',
      instructions:
        'Does answering current_user_message require evidence from older conversation turns beyond the recent_context shown here?',
    },
    recent_context_dependency: {
      type: 'noul',
      instructions:
        'Does accurately interpreting current_user_message depend on recent_context, for example because of pronouns, ellipsis, a follow-up, or an implicit referent?',
    },
    semantic_history_needed: {
      type: 'noul',
      instructions:
        'Is topical or meaning-based search over older conversation rounds needed to obtain the evidence requested by current_user_message?',
    },
    chronology_needed: {
      type: 'noul',
      instructions:
        'Is chronological navigation or ordering over historical conversation events needed, such as first, last, previous, before, after, immediately after, or an ordinal occurrence?',
    },
    rolling_summary_needed: {
      type: 'noul',
      instructions:
        'Would the rolling structured discussion summary be useful evidence for this request, rather than exact historical messages or documents?',
    },
    document_search_needed: {
      type: 'noul',
      instructions:
        'Does current_user_message require finding or reading text from a known document or file from this discussion?',
    },
    visual_evidence_needed: {
      type: 'noul',
      instructions:
        'Does current_user_message require the actual visual appearance of an image, PDF, or Word document, such as layout, photo placement, colours, signatures, or rendered pages?',
    },
    speaker_target: {
      type: 'choice',
      instructions:
        'Which historical speaker is explicitly or implicitly the target of the requested conversation evidence? Choose none when no specific speaker is requested.',
      criteria: {
        none: 'No specific historical speaker is requested.',
        user: 'The user\'s own earlier message or wording is requested.',
        chatgpt: 'ChatGPT or GPT\'s earlier response is requested.',
        claude: 'Claude\'s earlier response is requested.',
        gemini: 'Gemini\'s earlier response is requested.',
        multiple: 'Two or more speakers\' historical responses are requested or compared.',
      },
    },
    temporal_relation: {
      type: 'choice',
      instructions:
        'What temporal relation is required by current_user_message for historical conversation evidence?',
      criteria: {
        none: 'No temporal ordering constraint is required.',
        first: 'The first matching event or response is requested.',
        last: 'The last or latest matching event or response is requested.',
        previous: 'The immediately previous relevant event or response is requested.',
        before: 'Evidence before an anchor or topic is requested.',
        after: 'Evidence after an anchor or topic is requested.',
        ordinal: 'A numbered occurrence such as second or third is requested.',
      },
    },
    semantic_role: {
      type: 'choice',
      instructions:
        'If semantic history is useful, what job should it perform? Choose none when semantic history is not needed.',
      criteria: {
        none: 'Semantic history is not needed.',
        find_topic:
          'Find older rounds about the topic or concept the user is referring to.',
        find_anchor:
          'Locate a historical event/round that chronology should navigate relative to.',
        broaden_candidates:
          'Broaden or recover candidates when a deterministic lookup may be too narrow or ambiguous.',
      },
    },
    chronology_role: {
      type: 'choice',
      instructions:
        'If chronology is useful, what job should it perform? Choose none when chronological navigation is not needed.',
      criteria: {
        none: 'Chronology is not needed.',
        direct_position:
          'Directly select a first, last, previous, or ordinal historical message/response without needing a topical anchor first.',
        navigate_from_anchor:
          'Navigate before/after/immediately around a resolved historical anchor.',
        select_anchor_occurrence:
          'Choose the first, last, or numbered occurrence of a repeated historical anchor/topic.',
        scope_for_semantic:
          'Establish a historical range or event scope first, then semantic search should operate within that scope.',
      },
    },
    topic_source: {
      type: 'choice',
      instructions:
        'Where should the topical meaning used for memory retrieval come from?',
      criteria: {
        none: 'No topical historical retrieval is required.',
        current_prompt:
          'The current user message itself states the topic clearly enough.',
        recent_context:
          'Recent context is needed to resolve a pronoun, ellipsis, callback, or implicit topic before retrieval.',
        semantic_result:
          'The topic should be established from an initial semantic historical result rather than directly from the current/recent text.',
      },
    },
    anchor_source: {
      type: 'choice',
      instructions:
        'If chronological navigation needs a historical anchor, where should that anchor come from?',
      criteria: {
        none: 'No anchor is needed.',
        current_prompt:
          'The current message explicitly identifies the historical anchor.',
        recent_context:
          'Recent context must resolve what historical event/topic the user means.',
        semantic_result:
          'Semantic history should first locate the relevant historical anchor/candidate round.',
      },
    },
    flexible_resolver_needed: {
      type: 'noul',
      instructions:
        'Is the request too ambiguous, novel, or difficult to express with the structured memory decisions above such that a flexible language-model resolver would likely be useful before executing retrieval?',
    },
  };

  const controller = new AbortController();
  const timeout = setTimeout(() => controller.abort(), 4500);
  const relayAbort = () => controller.abort();
  options.signal?.addEventListener('abort', relayAbort, { once: true });

  try {
    const response = await fetch(DECISIONS_URL, {
      method: 'POST',
      headers: {
        Authorization: `Bearer ${options.apiKey.trim()}`,
        'Content-Type': 'application/json',
        'HTTP-Referer': 'https://plurilogai.com',
        'X-Title': 'Plurilog Memory Pilot',
      },
      body: JSON.stringify({
        model,
        state,
        questions,
      }),
      signal: controller.signal,
    });

    if (!response.ok) {
      const body = await response.text();
      throw new Error(
        `Jev Decisions API returned ${response.status}: ${clip(body, 600)}`
      );
    }

    const payload = (await response.json()) as any;

    return {
      requestId: typeof payload?.id === 'string' ? payload.id : null,
      model: typeof payload?.model === 'string' ? payload.model : null,
      provider: typeof payload?.provider === 'string' ? payload.provider : null,
      latencyMs: Date.now() - startedAt,
      usage:
        payload?.usage && typeof payload.usage === 'object'
          ? {
              input_tokens:
                typeof payload.usage.input_tokens === 'number'
                  ? payload.usage.input_tokens
                  : undefined,
              output_tokens:
                typeof payload.usage.output_tokens === 'number'
                  ? payload.usage.output_tokens
                  : undefined,
              cost:
                typeof payload.usage.cost === 'number'
                  ? payload.usage.cost
                  : undefined,
            }
          : null,
      answers:
        payload?.answers && typeof payload.answers === 'object'
          ? payload.answers
          : {},
      compiledPlan: compileShadowPlan(
        payload?.answers && typeof payload.answers === 'object'
          ? payload.answers
          : {}
      ),
    };
  } finally {
    clearTimeout(timeout);
    options.signal?.removeEventListener('abort', relayAbort);
  }
}
