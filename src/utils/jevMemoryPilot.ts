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
      ordinalPosition: number | null;
      anchorOccurrence: string | null;
      anchorOrdinalPosition: number | null;
    };
    candidateBudgets: {
      semanticHistory: {
        candidateLimit: number;
        maxSelected: number;
        tokenBudget: number;
        metadataFirst: boolean;
      } | null;
      documentSearch: {
        candidateLimit: number;
        maxSelected: number;
        tokenBudget: number;
        metadataFirst: boolean;
      } | null;
    };
    escalationSuggested: boolean;
  };
};

export type JevMemoryOperation =
  | 'recent_exact'
  | 'semantic_history'
  | 'chronology'
  | 'rolling_summary'
  | 'document_search'
  | 'visual_evidence'
  | 'speaker_filter';

export type JevMemoryPlanConstraints =
  JevMemoryPilotShadowResult['compiledPlan']['constraints'];

function executableTemporalRelation(
  constraints: JevMemoryPlanConstraints
): string | null {
  const relation = constraints.temporalRelation;

  // "previous" has two structurally different meanings:
  // direct_position => previous event from the target speaker;
  // anchored chronology => relative navigation immediately before an anchor.
  // Keep the distinction in structured state rather than re-reading prompt text.
  if (
    relation === 'previous' &&
    constraints.chronologyRole !== 'direct_position' &&
    (
      (constraints.anchorSource && constraints.anchorSource !== 'none') ||
      (constraints.anchorOccurrence &&
        constraints.anchorOccurrence !== 'none')
    )
  ) {
    return 'before';
  }

  return relation;
}

export function closeJevMemoryOperationsUnderConstraints(
  requestedOperations: string[],
  baseOperations: string[],
  constraints: JevMemoryPlanConstraints
): string[] {
  const active = new Set(requestedOperations);
  const base = new Set(baseOperations);
  const temporalRelation = executableTemporalRelation(constraints);

  // A planner override may remove an unnecessary operator, but it may not
  // erase an explicit user constraint that another operator must enforce.
  if (
    constraints.temporalRelation &&
    constraints.temporalRelation !== 'none'
  ) {
    active.add('chronology');
  }

  if (
    constraints.speaker &&
    constraints.speaker !== 'none'
  ) {
    active.add('speaker_filter');
  }

  // Relative chronology cannot execute without a historical anchor source.
  // When no exact upstream anchor operator is active, semantic_history is the
  // composed system that supplies candidate historical anchors.
  if (
    active.has('chronology') &&
    (temporalRelation === 'before' ||
      temporalRelation === 'after') &&
    !active.has('semantic_history') &&
    !active.has('recent_exact')
  ) {
    active.add('semantic_history');
  }

  // If the original structured plan identified recent context as the source
  // of a topical/chronological referent, preserve that dependency whenever a
  // downstream historical operator still needs it.
  const historicalOperatorActive =
    active.has('semantic_history') || active.has('chronology');

  if (
    historicalOperatorActive &&
    base.has('recent_exact') &&
    (
      constraints.topicSource === 'recent_context' ||
      constraints.anchorSource === 'recent_context'
    )
  ) {
    active.add('recent_exact');
  }

  return Array.from(active);
}

export function buildJevMemoryDependencies(
  operations: string[],
  constraints: JevMemoryPlanConstraints
): Array<{ from: string; to: string; reason: string }> {
  const active = new Set(operations);
  const temporalRelation = executableTemporalRelation(constraints);
  const dependencies: Array<{ from: string; to: string; reason: string }> = [];
  const add = (from: JevMemoryOperation, to: JevMemoryOperation, reason: string) => {
    if (
      active.has(from) &&
      active.has(to) &&
      !dependencies.some((item) => item.from === from && item.to === to)
    ) {
      dependencies.push({ from, to, reason });
    }
  };

  if (
    constraints.chronologyRole === 'scope_for_semantic' &&
    active.has('chronology') &&
    active.has('semantic_history')
  ) {
    add(
      'chronology',
      'semantic_history',
      'Chronology establishes the historical scope before semantic retrieval.'
    );
  } else if (
    active.has('semantic_history') &&
    active.has('chronology') &&
    (
      constraints.anchorSource === 'semantic_result' ||
      constraints.chronologyRole === 'select_anchor_occurrence' ||
      constraints.chronologyRole === 'navigate_from_anchor' ||
      temporalRelation === 'before' ||
      temporalRelation === 'after'
    )
  ) {
    add(
      'semantic_history',
      'chronology',
      'Semantic retrieval supplies the historical candidates or anchor consumed by chronology.'
    );
  }

  if (
    constraints.topicSource === 'recent_context' &&
    active.has('recent_exact') &&
    active.has('semantic_history')
  ) {
    add(
      'recent_exact',
      'semantic_history',
      'Recent context supplies the topic or referent for semantic retrieval.'
    );
  }

  if (
    constraints.anchorSource === 'recent_context' &&
    active.has('recent_exact') &&
    active.has('chronology')
  ) {
    add(
      'recent_exact',
      'chronology',
      'Recent context supplies the anchor for chronological navigation.'
    );
  }

  add(
    'document_search',
    'visual_evidence',
    'Document identity must be resolved before canonical visual inspection.'
  );

  if (active.has('speaker_filter')) {
    if (active.has('chronology')) {
      add(
        'chronology',
        'speaker_filter',
        'Speaker filtering consumes chronologically selected evidence.'
      );
    } else if (active.has('semantic_history')) {
      add(
        'semantic_history',
        'speaker_filter',
        'Speaker filtering consumes semantically selected historical evidence.'
      );
    } else if (active.has('recent_exact')) {
      add(
        'recent_exact',
        'speaker_filter',
        'Speaker filtering consumes recent exact evidence.'
      );
    }
  }

  return dependencies;
}

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

function getChoiceConfidence(
  answers: Record<string, JevAnswer>,
  key: string
): number {
  const answer = answers[key];
  if (answer?.type !== 'choice') return 0;

  if (typeof answer.confidence === 'number') {
    return answer.confidence;
  }

  const selected = answer.choice;
  const probability = answer.probabilities?.[selected];
  return typeof probability === 'number' ? probability : 0;
}

function compileShadowPlan(answers: Record<string, JevAnswer>) {
  const dependencies: Array<{ from: string; to: string; reason: string }> = [];

  const historicalSignal = getNoul(
    answers,
    'historical_conversation_needed'
  );
  const recentSignal = getNoul(answers, 'recent_context_dependency');
  const semanticSignal = getNoul(answers, 'semantic_history_needed');
  const chronologySignal = getNoul(answers, 'chronology_needed');
  const summarySignal = getNoul(answers, 'rolling_summary_needed');
  const documentSignal = getNoul(answers, 'document_search_needed');
  const visualSignal = getNoul(answers, 'visual_evidence_needed');
  const primarySourceSignal = getNoul(
    answers,
    'primary_source_needed'
  );

  const speaker = getChoice(answers, 'speaker_target');
  const temporalRelation = getChoice(answers, 'temporal_relation');
  const semanticRole = getChoice(answers, 'semantic_role');
  const chronologyRole = getChoice(answers, 'chronology_role');
  const topicSource = getChoice(answers, 'topic_source');
  const anchorSource = getChoice(answers, 'anchor_source');
  const ordinalPositionChoice = getChoice(answers, 'ordinal_position');
  const anchorOccurrence = getChoice(answers, 'anchor_occurrence');
  const anchorOrdinalPositionChoice = getChoice(
    answers,
    'anchor_ordinal_position'
  );

  const speakerConfidence = getChoiceConfidence(answers, 'speaker_target');
  const temporalConfidence = getChoiceConfidence(
    answers,
    'temporal_relation'
  );
  const semanticRoleConfidence = getChoiceConfidence(
    answers,
    'semantic_role'
  );
  const chronologyRoleConfidence = getChoiceConfidence(
    answers,
    'chronology_role'
  );
  const topicSourceConfidence = getChoiceConfidence(
    answers,
    'topic_source'
  );
  const anchorSourceConfidence = getChoiceConfidence(
    answers,
    'anchor_source'
  );
  const ordinalPositionConfidence = getChoiceConfidence(
    answers,
    'ordinal_position'
  );
  const anchorOccurrenceConfidence = getChoiceConfidence(
    answers,
    'anchor_occurrence'
  );
  const anchorOrdinalPositionConfidence = getChoiceConfidence(
    answers,
    'anchor_ordinal_position'
  );

  const previousIsRelativeNavigation =
    temporalRelation === 'previous' &&
    chronologyRole !== 'direct_position' &&
    (
      (chronologyRole && chronologyRole !== 'none') ||
      (anchorSource && anchorSource !== 'none') ||
      (anchorOccurrence && anchorOccurrence !== 'none')
    );
  const executableRelation = previousIsRelativeNavigation
    ? 'before'
    : temporalRelation;

  const ordinalPosition =
    executableRelation === 'ordinal' &&
    ordinalPositionChoice &&
    ordinalPositionChoice !== 'none' &&
    ordinalPositionConfidence >= 0.55
      ? Number.parseInt(ordinalPositionChoice, 10)
      : null;
  const supportedAnchorOccurrence =
    anchorOccurrence &&
    anchorOccurrence !== 'none' &&
    anchorOccurrenceConfidence >= 0.55
      ? anchorOccurrence
      : null;
  const anchorOrdinalPosition =
    supportedAnchorOccurrence === 'ordinal' &&
    anchorOrdinalPositionChoice &&
    anchorOrdinalPositionChoice !== 'none' &&
    anchorOrdinalPositionConfidence >= 0.55
      ? Number.parseInt(anchorOrdinalPositionChoice, 10)
      : null;

  const speakerSupported =
    Boolean(speaker && speaker !== 'none') && speakerConfidence >= 0.75;
  const temporalSupported =
    Boolean(temporalRelation && temporalRelation !== 'none') &&
    temporalConfidence >= 0.55;
  const semanticRoleSupported =
    Boolean(semanticRole && semanticRole !== 'none') &&
    semanticRoleConfidence >= 0.45;
  const chronologyRoleSupported =
    Boolean(chronologyRole && chronologyRole !== 'none') &&
    chronologyRoleConfidence >= 0.45;
  const recentTopicSource =
    topicSource === 'recent_context' && topicSourceConfidence >= 0.7;
  const recentAnchorSource =
    anchorSource === 'recent_context' && anchorSourceConfidence >= 0.7;
  const semanticAnchorSource =
    anchorSource === 'semantic_result' && anchorSourceConfidence >= 0.55;

  // Broad Jev scores are proposals, not independent booleans. Require
  // compatible role/relation/source evidence before activating a retriever.
  let recentNeeded =
    recentSignal >= 0.55 && (recentTopicSource || recentAnchorSource);

  let chronologyNeeded =
    chronologySignal >= 0.55 &&
    (temporalSupported || chronologyRoleSupported) &&
    (historicalSignal >= 0.2 || recentSignal >= 0.65);

  let semanticNeeded =
    (semanticSignal >= 0.55 &&
      historicalSignal >= 0.4 &&
      semanticRoleSupported) ||
    (primarySourceSignal >= 0.55 &&
      (historicalSignal >= 0.1 || recentSignal >= 0.5));

  const speakerTopicCallbackNeedsSemantic =
    speakerSupported &&
    semanticRole === 'find_topic' &&
    semanticRoleSupported &&
    recentSignal >= 0.8 &&
    semanticSignal >= 0.3 &&
    chronologyRole !== 'direct_position';

  if (speakerTopicCallbackNeedsSemantic) {
    semanticNeeded = true;
  }

  // A chronological plan that explicitly says its anchor comes from semantic
  // retrieval must include semantic retrieval even when its broad semantic
  // score is only moderate.
  if (
    chronologyNeeded &&
    semanticAnchorSource &&
    semanticSignal >= 0.4 &&
    (semanticRoleSupported || semanticRoleConfidence < 0.6)
  ) {
    semanticNeeded = true;
  }

  const topicalOccurrenceNeedsSemantic =
    chronologyNeeded &&
    temporalSupported &&
    ['first', 'last', 'ordinal'].includes(executableRelation || '') &&
    recentTopicSource &&
    semanticRole === 'find_topic' &&
    semanticRoleSupported &&
    semanticSignal >= 0.3;

  const relativeTopicNavigationNeedsSemantic =
    chronologyNeeded &&
    temporalSupported &&
    ['before', 'after'].includes(executableRelation || '') &&
    semanticRole === 'find_topic' &&
    semanticSignal >= 0.3;

  if (
    topicalOccurrenceNeedsSemantic ||
    relativeTopicNavigationNeedsSemantic
  ) {
    semanticNeeded = true;
  }

  // If an active retrieval operation says recent context supplies its topic or
  // anchor, recent_exact is a dependency rather than an optional extra.
  if (
    (semanticNeeded && recentTopicSource) ||
    (chronologyNeeded && recentAnchorSource)
  ) {
    recentNeeded = true;
  }

  const summaryNeeded =
    (summarySignal >= 0.6 && historicalSignal >= 0.55) ||
    (summarySignal >= 0.75 && historicalSignal >= 0.35);

  const visualNeeded = visualSignal >= 0.65;
  const documentNeeded =
    documentSignal >= 0.65 ||
    (documentSignal >= 0.5 && visualNeeded);

  const retrievalNeeded =
    recentNeeded ||
    semanticNeeded ||
    chronologyNeeded ||
    documentNeeded ||
    visualNeeded;

  const speakerFilterNeeded = speakerSupported && retrievalNeeded;

  const operations: string[] = [];
  if (recentNeeded) operations.push('recent_exact');
  if (summaryNeeded) operations.push('rolling_summary');
  if (semanticNeeded) operations.push('semantic_history');
  if (chronologyNeeded) operations.push('chronology');
  if (documentNeeded) operations.push('document_search');
  if (visualNeeded) operations.push('visual_evidence');
  if (speakerFilterNeeded) operations.push('speaker_filter');

  const addDependency = (from: string, to: string, reason: string) => {
    if (
      operations.includes(from) &&
      operations.includes(to) &&
      !dependencies.some((d) => d.from === from && d.to === to)
    ) {
      dependencies.push({ from, to, reason });
    }
  };

  if (semanticNeeded && recentTopicSource) {
    addDependency(
      'recent_exact',
      'semantic_history',
      'Recent context supplies the topic/referent for semantic retrieval.'
    );
  }

  if (
    semanticNeeded &&
    chronologyNeeded &&
    (semanticAnchorSource ||
      topicalOccurrenceNeedsSemantic ||
      relativeTopicNavigationNeedsSemantic)
  ) {
    addDependency(
      'semantic_history',
      'chronology',
      topicalOccurrenceNeedsSemantic
        ? 'Semantic retrieval finds historical topic candidates before chronological occurrence selection.'
        : relativeTopicNavigationNeedsSemantic
          ? 'Semantic retrieval resolves the topical target before relative chronological navigation.'
          : 'Semantic retrieval locates the historical anchor/candidates before chronological navigation.'
    );
  }

  if (
    chronologyNeeded &&
    recentAnchorSource &&
    !topicalOccurrenceNeedsSemantic
  ) {
    addDependency(
      'recent_exact',
      'chronology',
      'Recent context resolves the historical anchor before chronological navigation.'
    );
  }

  if (
    semanticNeeded &&
    chronologyNeeded &&
    !semanticAnchorSource &&
    chronologyRole === 'scope_for_semantic' &&
    chronologyRoleSupported
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

  if (speakerFilterNeeded) {
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

  const memoryAmbiguitySignal =
    retrievalNeeded ||
    summaryNeeded ||
    historicalSignal >= 0.4 ||
    recentSignal >= 0.65 ||
    (semanticSignal >= 0.45 && semanticRoleSupported) ||
    (chronologySignal >= 0.45 &&
      (temporalSupported || chronologyRoleSupported)) ||
    documentSignal >= 0.5 ||
    visualSignal >= 0.5 ||
    primarySourceSignal >= 0.5;

  const recentOnlyPlanIsComplete =
    operations.length === 1 &&
    operations[0] === 'recent_exact' &&
    recentSignal >= 0.8 &&
    historicalSignal < 0.4 &&
    semanticSignal < 0.65 &&
    chronologySignal < 0.4 &&
    documentSignal < 0.5 &&
    visualSignal < 0.5 &&
    primarySourceSignal < 0.5;

  // An empty plan is not necessarily evidence that no memory is needed.
  // The fresh financing regression produced exactly this joint signature:
  // strong speaker + recent dependency + chronology, with a supported topical
  // semantic role, while individual operator gates narrowly missed. Escalate
  // that structurally incomplete historical callback to System 2.
  const incompleteEmptyHistoricalCallback =
    operations.length === 0 &&
    speakerSupported &&
    historicalSignal >= 0.2 &&
    recentSignal >= 0.8 &&
    semanticSignal >= 0.3 &&
    chronologySignal >= 0.7 &&
    semanticRole === 'find_topic' &&
    semanticRoleConfidence >= 0.4;

  return {
    operations,
    dependencies,
    constraints: {
      speaker: speakerFilterNeeded ? speaker : null,
      temporalRelation:
        chronologyNeeded && temporalSupported ? executableRelation : null,
      semanticRole:
        semanticNeeded && semanticRoleSupported ? semanticRole : null,
      chronologyRole:
        chronologyNeeded && chronologyRoleSupported ? chronologyRole : null,
      topicSource:
        semanticNeeded && topicSource && topicSource !== 'none'
          ? topicSource
          : null,
      anchorSource:
        chronologyNeeded
          ? topicalOccurrenceNeedsSemantic ||
            relativeTopicNavigationNeedsSemantic
            ? 'semantic_result'
            : anchorSource && anchorSource !== 'none'
              ? anchorSource
              : null
          : null,
      ordinalPosition:
        chronologyNeeded &&
        executableRelation === 'ordinal' &&
        Number.isInteger(ordinalPosition) &&
        (ordinalPosition as number) >= 1
          ? ordinalPosition
          : null,
      anchorOccurrence:
        chronologyNeeded ? supportedAnchorOccurrence : null,
      anchorOrdinalPosition:
        chronologyNeeded &&
        supportedAnchorOccurrence === 'ordinal' &&
        Number.isInteger(anchorOrdinalPosition) &&
        (anchorOrdinalPosition as number) >= 1
          ? anchorOrdinalPosition
          : null,
    },
    candidateBudgets: {
      semanticHistory: semanticNeeded
        ? {
            candidateLimit: 10,
            maxSelected: 3,
            tokenBudget: 2500,
            metadataFirst: true,
          }
        : null,
      documentSearch: documentNeeded
        ? {
            candidateLimit: 5,
            maxSelected: 2,
            tokenBudget: 1500,
            metadataFirst: true,
          }
        : null,
    },
    escalationSuggested:
      incompleteEmptyHistoricalCallback ||
      (!recentOnlyPlanIsComplete &&
        getNoul(answers, 'flexible_resolver_needed') >= 0.5 &&
        memoryAmbiguitySignal),
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
    primary_source_needed: {
      type: 'noul',
      instructions:
        'Does current_user_message explicitly require the original, primary, first-hand historical source rather than a later recap, paraphrase, quote, or reference to it?',
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
    ordinal_position: {
      type: 'choice',
      instructions:
        'When temporal_relation is ordinal, which numbered matching occurrence is requested? Choose none when no ordinal position is requested.',
      criteria: {
        none: 'No numbered occurrence is requested.',
        '1': 'The first occurrence is requested.',
        '2': 'The second occurrence is requested.',
        '3': 'The third occurrence is requested.',
        '4': 'The fourth occurrence is requested.',
        '5': 'The fifth occurrence is requested.',
        '6': 'The sixth occurrence is requested.',
        '7': 'The seventh occurrence is requested.',
        '8': 'The eighth occurrence is requested.',
        '9': 'The ninth occurrence is requested.',
        '10': 'The tenth occurrence is requested.',
      },
    },
    anchor_occurrence: {
      type: 'choice',
      instructions:
        'When before/after navigation is relative to a repeated historical topic or anchor, which occurrence of that anchor should chronology use? Choose none when the request does not specify an anchor occurrence.',
      criteria: {
        none: 'No particular anchor occurrence is specified.',
        first: 'Use the first occurrence of the anchor/topic.',
        last: 'Use the last or most recent occurrence of the anchor/topic.',
        ordinal: 'Use a numbered occurrence of the anchor/topic.',
      },
    },
    anchor_ordinal_position: {
      type: 'choice',
      instructions:
        'When anchor_occurrence is ordinal, which numbered anchor occurrence is requested? Choose none otherwise.',
      criteria: {
        none: 'No numbered anchor occurrence is requested.',
        '1': 'Use the first anchor occurrence.',
        '2': 'Use the second anchor occurrence.',
        '3': 'Use the third anchor occurrence.',
        '4': 'Use the fourth anchor occurrence.',
        '5': 'Use the fifth anchor occurrence.',
        '6': 'Use the sixth anchor occurrence.',
        '7': 'Use the seventh anchor occurrence.',
        '8': 'Use the eighth anchor occurrence.',
        '9': 'Use the ninth anchor occurrence.',
        '10': 'Use the tenth anchor occurrence.',
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
