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
      const sender = String(response.sender || '').toLowerCase();
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
    composition_pattern: {
      type: 'choice',
      instructions:
        'Choose the best dependency pattern for obtaining the evidence required by current_user_message. This is about retrieval order, not about answering the user.',
      criteria: {
        direct_no_memory:
          'No historical memory retrieval is needed; current input is sufficient.',
        recent_only:
          'Recent exact context is sufficient to interpret and answer the request.',
        semantic_only:
          'Meaning-based historical conversation search is sufficient.',
        chronology_only:
          'Chronological navigation alone is sufficient.',
        recent_then_semantic:
          'Recent context must first resolve the user\'s referent or topic, then semantic history should search for older matching rounds.',
        semantic_then_chronology:
          'Semantic history should first locate a topical historical anchor or candidate set, then chronology should navigate or enforce ordering.',
        chronology_then_semantic:
          'Chronology should first establish a historical range/event scope, then semantic search should find topical evidence within that scope.',
        document_only:
          'Document text retrieval is the main operation and no visual inspection is required.',
        recent_then_document:
          'Recent context must first identify which document or document topic the user means, then document retrieval should run.',
        document_then_visual:
          'A document must first be identified, then its canonical visual evidence should be inspected.',
        semantic_and_document:
          'Conversation semantic history and document retrieval provide complementary evidence and both are needed.',
        parallel_complementary:
          'Two or more memory systems should retrieve independent complementary evidence before synthesis.',
        other_complex:
          'The required dependency pattern is not adequately represented by the other choices.',
      },
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
    };
  } finally {
    clearTimeout(timeout);
    options.signal?.removeEventListener('abort', relayAbort);
  }
}
