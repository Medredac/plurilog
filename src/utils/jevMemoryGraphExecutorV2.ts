import type {
  ChronologicalMemoryResult,
  Round,
} from '@/utils/discussionMemory';
import type {
  JevMemoryPlanConstraints,
} from '@/utils/jevMemoryPilot';

export type ConversationMemoryOperation =
  | 'recent_exact'
  | 'rolling_summary'
  | 'semantic_history'
  | 'chronology'
  | 'speaker_filter';

export interface MemoryGraphDependency {
  from: string;
  to: string;
  reason: string;
}

export interface SemanticMemoryRow {
  source_user_message_id?: string | null;
  content?: string | null;
  semantic_similarity?: number | null;
  keyword_rank?: number | null;
  hybrid_score?: number | null;
  [key: string]: unknown;
}

export interface MemoryGraphStep {
  operation: ConversationMemoryOperation;
  inputFrom: string[];
  outputCount: number;
  status: 'executed' | 'skipped' | 'insufficient';
  reason?: string;
}

export interface ConversationMemoryGraphResult {
  executionOrder: ConversationMemoryOperation[];
  semanticRows: SemanticMemoryRow[];
  finalEvidence: ChronologicalMemoryResult[];
  selectedRoundUserMessageIds: string[];
  steps: MemoryGraphStep[];
  needsResolver: boolean;
  resolverReason: string | null;
  semanticQuery: string;
}

export interface ExecuteConversationMemoryGraphOptions {
  prompt: string;
  operations: string[];
  dependencies: MemoryGraphDependency[];
  constraints: JevMemoryPlanConstraints;
  allRounds: Round[];
  recentRounds?: Round[];
  summary?: string;
  runSemanticHistory: (query: string) => Promise<SemanticMemoryRow[]>;
  resolveAmbiguity?: (input: {
    prompt: string;
    reason: string;
    constraints: JevMemoryPlanConstraints;
    candidateRoundUserMessageIds: string[];
  }) => Promise<string | null>;
}

function unique<T>(values: T[]): T[] {
  return Array.from(new Set(values));
}

function topoSort(
  operations: ConversationMemoryOperation[],
  dependencies: MemoryGraphDependency[]
): ConversationMemoryOperation[] {
  const nodes = unique(operations);
  const indegree = new Map<ConversationMemoryOperation, number>();
  const outgoing = new Map<ConversationMemoryOperation, ConversationMemoryOperation[]>();

  for (const node of nodes) {
    indegree.set(node, 0);
    outgoing.set(node, []);
  }

  for (const dependency of dependencies) {
    const from = dependency.from as ConversationMemoryOperation;
    const to = dependency.to as ConversationMemoryOperation;
    if (!indegree.has(from) || !indegree.has(to) || from === to) continue;
    outgoing.get(from)!.push(to);
    indegree.set(to, (indegree.get(to) || 0) + 1);
  }

  const stableOrder: ConversationMemoryOperation[] = [
    'recent_exact',
    'rolling_summary',
    'semantic_history',
    'chronology',
    'speaker_filter',
  ];
  const queue = stableOrder.filter(
    (node) => indegree.has(node) && indegree.get(node) === 0
  );
  const result: ConversationMemoryOperation[] = [];

  while (queue.length > 0) {
    const node = queue.shift()!;
    result.push(node);
    for (const next of outgoing.get(node) || []) {
      indegree.set(next, (indegree.get(next) || 0) - 1);
      if (indegree.get(next) === 0) {
        queue.push(next);
        queue.sort((a, b) => stableOrder.indexOf(a) - stableOrder.indexOf(b));
      }
    }
  }

  // A compiled Jev graph should be acyclic. Fail closed to stable operation order
  // if a malformed override ever introduces a cycle.
  if (result.length !== nodes.length) {
    return stableOrder.filter((node) => nodes.includes(node));
  }

  return result;
}

function composeSemanticQuery(
  prompt: string,
  recentRounds: Round[] | undefined,
  constraints: JevMemoryPlanConstraints
): string {
  if (
    (
      constraints.topicSource !== 'recent_context' &&
      constraints.anchorSource !== 'recent_context'
    ) ||
    !Array.isArray(recentRounds) ||
    recentRounds.length === 0
  ) {
    return prompt.trim();
  }

  const recent = recentRounds
    .slice(-3)
    .map((round) => {
      const parts = [`User: ${round.userPrompt}`];
      for (const response of round.modelResponses || []) {
        if (response.content?.trim()) {
          parts.push(`${response.name}: ${response.content.trim()}`);
        }
      }
      return parts.join('\n');
    })
    .join('\n---\n');

  return `RECENT CONTEXT:\n${recent}\n\nCURRENT REQUEST:\n${prompt.trim()}`;
}

function mapSemanticRowsToRoundIds(
  rows: SemanticMemoryRow[],
  allRounds: Round[]
): string[] {
  const allowed = new Set(
    allRounds
      .map((round) => round.userMessageId)
      .filter((id): id is string => Boolean(id))
  );

  return unique(
    rows
      .map((row) => row.source_user_message_id)
      .filter(
        (id): id is string =>
          typeof id === 'string' && id.length > 0 && allowed.has(id)
      )
  );
}

function roundIndexById(allRounds: Round[]): Map<string, number> {
  const map = new Map<string, number>();
  allRounds.forEach((round, index) => {
    if (round.userMessageId) map.set(round.userMessageId, index);
  });
  return map;
}

function selectOccurrence(
  candidateIds: string[],
  allRounds: Round[],
  constraints: JevMemoryPlanConstraints
): { selectedIds: string[]; needsResolver: boolean; reason: string | null } {
  const indexById = roundIndexById(allRounds);
  const ordered = unique(candidateIds)
    .filter((id) => indexById.has(id))
    .sort((a, b) => indexById.get(a)! - indexById.get(b)!);

  if (ordered.length === 0) {
    return {
      selectedIds: [],
      needsResolver: true,
      reason: 'Chronology had no validated historical candidates.',
    };
  }

  const relation = constraints.temporalRelation;
  if (relation === 'first') {
    return { selectedIds: [ordered[0]], needsResolver: false, reason: null };
  }
  if (relation === 'last' || relation === 'previous') {
    return {
      selectedIds: [ordered[ordered.length - 1]],
      needsResolver: false,
      reason: null,
    };
  }
  if (relation === 'ordinal') {
    const ordinal = constraints.ordinalPosition;
    if (!ordinal || ordinal < 1 || ordinal > ordered.length) {
      return {
        selectedIds: [],
        needsResolver: true,
        reason: 'The ordinal occurrence could not be satisfied by the validated candidates.',
      };
    }
    return {
      selectedIds: [ordered[ordinal - 1]],
      needsResolver: false,
      reason: null,
    };
  }

  if (relation === 'before' || relation === 'after') {
    if (constraints.anchorOccurrence === 'first') {
      return { selectedIds: [ordered[0]], needsResolver: false, reason: null };
    }
    if (constraints.anchorOccurrence === 'last') {
      return {
        selectedIds: [ordered[ordered.length - 1]],
        needsResolver: false,
        reason: null,
      };
    }
    if (constraints.anchorOccurrence === 'ordinal') {
      const anchorOrdinal = constraints.anchorOrdinalPosition;
      if (
        !anchorOrdinal ||
        anchorOrdinal < 1 ||
        anchorOrdinal > ordered.length
      ) {
        return {
          selectedIds: [],
          needsResolver: true,
          reason:
            'The requested anchor occurrence could not be satisfied by the validated candidates.',
        };
      }
      return {
        selectedIds: [ordered[anchorOrdinal - 1]],
        needsResolver: false,
        reason: null,
      };
    }
  }

  if (ordered.length === 1) {
    return { selectedIds: [ordered[0]], needsResolver: false, reason: null };
  }

  return {
    selectedIds: ordered,
    needsResolver: true,
    reason: 'Multiple historical candidates remain after semantic retrieval.',
  };
}

function speakerName(
  speaker: string | null
): 'Claude' | 'Gemini' | 'ChatGPT' | 'User' | null {
  if (speaker === 'claude') return 'Claude';
  if (speaker === 'gemini') return 'Gemini';
  if (speaker === 'chatgpt') return 'ChatGPT';
  if (speaker === 'user') return 'User';
  return null;
}

function evidenceFromRound(
  round: Round,
  roundIndex: number,
  target: 'Claude' | 'Gemini' | 'ChatGPT' | 'User'
): ChronologicalMemoryResult | null {
  if (target === 'User') {
    const content = round.userPrompt?.trim();
    if (!content) return null;
    return {
      roundUserMessageId: round.userMessageId,
      kind: 'user_prompt',
      speaker: 'User',
      content,
      label: `User evidence from historical round ${roundIndex + 1}`,
      roundIndex,
    };
  }

  const response = (round.modelResponses || []).find(
    (item) => item.name.toLowerCase() === target.toLowerCase()
  );
  if (!response?.content?.trim()) return null;

  return {
    roundUserMessageId: round.userMessageId,
    kind: 'model_response',
    speaker: target,
    content: response.content.trim(),
    label: `${target} evidence from historical round ${roundIndex + 1}`,
    roundIndex,
  };
}

function directSpeakerChronology(
  allRounds: Round[],
  target: 'Claude' | 'Gemini' | 'ChatGPT' | 'User',
  constraints: JevMemoryPlanConstraints
): ChronologicalMemoryResult[] {
  const evidence = allRounds
    .map((round, index) => evidenceFromRound(round, index, target))
    .filter(
      (item): item is ChronologicalMemoryResult => Boolean(item)
    );

  if (evidence.length === 0) return [];

  const relation = constraints.temporalRelation;
  if (relation === 'first') return [evidence[0]];
  if (relation === 'last' || relation === 'previous') {
    return [evidence[evidence.length - 1]];
  }
  if (relation === 'ordinal') {
    const ordinal = constraints.ordinalPosition;
    if (!ordinal || ordinal < 1 || ordinal > evidence.length) return [];
    return [evidence[ordinal - 1]];
  }

  return evidence;
}

function relativeSpeakerEvidence(
  allRounds: Round[],
  anchorRoundId: string,
  target: 'Claude' | 'Gemini' | 'ChatGPT' | 'User',
  relation: 'before' | 'after'
): ChronologicalMemoryResult | null {
  const anchorIndex = allRounds.findIndex(
    (round) => round.userMessageId === anchorRoundId
  );
  if (anchorIndex < 0) return null;

  if (relation === 'after') {
    // Assistant responses in the anchor round occur after its user prompt.
    const sameRound = evidenceFromRound(allRounds[anchorIndex], anchorIndex, target);
    if (target !== 'User' && sameRound) return sameRound;

    for (let index = anchorIndex + 1; index < allRounds.length; index += 1) {
      const item = evidenceFromRound(allRounds[index], index, target);
      if (item) return item;
    }
    return null;
  }

  for (let index = anchorIndex - 1; index >= 0; index -= 1) {
    const item = evidenceFromRound(allRounds[index], index, target);
    if (item) return item;
  }
  return null;
}

export async function executeConversationMemoryGraph(
  options: ExecuteConversationMemoryGraphOptions
): Promise<ConversationMemoryGraphResult> {
  const conversationOperations = options.operations.filter(
    (operation): operation is ConversationMemoryOperation =>
      [
        'recent_exact',
        'rolling_summary',
        'semantic_history',
        'chronology',
        'speaker_filter',
      ].includes(operation)
  );

  const executionOrder = topoSort(
    conversationOperations,
    options.dependencies
  );
  const steps: MemoryGraphStep[] = [];
  const semanticQuery = composeSemanticQuery(
    options.prompt,
    options.recentRounds,
    options.constraints
  );

  let semanticRows: SemanticMemoryRow[] = [];
  let selectedRoundUserMessageIds: string[] = [];
  let finalEvidence: ChronologicalMemoryResult[] = [];
  let needsResolver = false;
  let resolverReason: string | null = null;

  const incoming = (operation: ConversationMemoryOperation) =>
    options.dependencies
      .filter((dependency) => dependency.to === operation)
      .map((dependency) => dependency.from);

  for (const operation of executionOrder) {
    if (operation === 'recent_exact') {
      const count = options.recentRounds?.length || 0;
      steps.push({
        operation,
        inputFrom: incoming(operation),
        outputCount: count,
        status: count > 0 ? 'executed' : 'insufficient',
        reason: count > 0 ? undefined : 'No recent rounds were available.',
      });
      continue;
    }

    if (operation === 'rolling_summary') {
      const count = options.summary?.trim() ? 1 : 0;
      steps.push({
        operation,
        inputFrom: incoming(operation),
        outputCount: count,
        status: count > 0 ? 'executed' : 'insufficient',
        reason: count > 0 ? undefined : 'No rolling summary was available.',
      });
      continue;
    }

    if (operation === 'semantic_history') {
      semanticRows = await options.runSemanticHistory(semanticQuery);
      selectedRoundUserMessageIds = mapSemanticRowsToRoundIds(
        semanticRows,
        options.allRounds
      );
      steps.push({
        operation,
        inputFrom: incoming(operation),
        outputCount: selectedRoundUserMessageIds.length,
        status:
          selectedRoundUserMessageIds.length > 0 ? 'executed' : 'insufficient',
        reason:
          selectedRoundUserMessageIds.length > 0
            ? undefined
            : 'Semantic retrieval returned no candidates that mapped to real discussion rounds.',
      });
      if (selectedRoundUserMessageIds.length === 0) {
        needsResolver = true;
        resolverReason =
          'Semantic history returned no validated historical candidates.';
      }
      continue;
    }

    if (operation === 'chronology') {
      if (options.constraints.chronologyRole === 'direct_position') {
        // The exact speaker event is selected in speaker_filter when a speaker
        // constraint exists. Without one, direct chronology remains unresolved.
        if (options.operations.includes('speaker_filter')) {
          steps.push({
            operation,
            inputFrom: incoming(operation),
            outputCount: options.allRounds.length,
            status: 'executed',
          });
        } else {
          needsResolver = true;
          resolverReason =
            'Direct chronological selection requires an exact event target.';
          steps.push({
            operation,
            inputFrom: incoming(operation),
            outputCount: 0,
            status: 'insufficient',
            reason: resolverReason,
          });
        }
        continue;
      }

      const candidateIds =
        selectedRoundUserMessageIds.length > 0
          ? selectedRoundUserMessageIds
          : mapSemanticRowsToRoundIds(semanticRows, options.allRounds);

      const selected = selectOccurrence(
        candidateIds,
        options.allRounds,
        options.constraints
      );
      selectedRoundUserMessageIds = selected.selectedIds;
      if (selected.needsResolver) {
        needsResolver = true;
        resolverReason = selected.reason;
      }
      steps.push({
        operation,
        inputFrom: incoming(operation),
        outputCount: selectedRoundUserMessageIds.length,
        status:
          selectedRoundUserMessageIds.length > 0 ? 'executed' : 'insufficient',
        reason: selected.reason || undefined,
      });
      continue;
    }

    if (operation === 'speaker_filter') {
      const target = speakerName(options.constraints.speaker);
      if (!target) {
        needsResolver = true;
        resolverReason =
          options.constraints.speaker === 'multiple'
            ? 'Multiple-speaker selection requires flexible evidence resolution.'
            : 'Speaker filter had no executable speaker target.';
        steps.push({
          operation,
          inputFrom: incoming(operation),
          outputCount: 0,
          status: 'insufficient',
          reason: resolverReason,
        });
        continue;
      }

      if (options.constraints.chronologyRole === 'direct_position') {
        finalEvidence = directSpeakerChronology(
          options.allRounds,
          target,
          options.constraints
        );
      } else if (
        (options.constraints.temporalRelation === 'before' ||
          options.constraints.temporalRelation === 'after') &&
        selectedRoundUserMessageIds.length === 1
      ) {
        const item = relativeSpeakerEvidence(
          options.allRounds,
          selectedRoundUserMessageIds[0],
          target,
          options.constraints.temporalRelation
        );
        finalEvidence = item ? [item] : [];
      } else {
        const indexById = roundIndexById(options.allRounds);
        finalEvidence = selectedRoundUserMessageIds
          .map((id) => {
            const index = indexById.get(id);
            if (index === undefined) return null;
            return evidenceFromRound(options.allRounds[index], index, target);
          })
          .filter(
            (item): item is ChronologicalMemoryResult => Boolean(item)
          );
      }

      steps.push({
        operation,
        inputFrom: incoming(operation),
        outputCount: finalEvidence.length,
        status: finalEvidence.length > 0 ? 'executed' : 'insufficient',
        reason:
          finalEvidence.length > 0
            ? undefined
            : 'No exact speaker evidence survived the composed graph.',
      });

      if (finalEvidence.length === 0) {
        needsResolver = true;
        resolverReason =
          'The composed graph could not resolve exact speaker evidence.';
      }
    }
  }

  if (
    needsResolver &&
    options.resolveAmbiguity &&
    selectedRoundUserMessageIds.length > 1
  ) {
    const resolverSelectedId = await options.resolveAmbiguity({
      prompt: options.prompt,
      reason: resolverReason || 'Multiple validated historical candidates remain.',
      constraints: options.constraints,
      candidateRoundUserMessageIds: selectedRoundUserMessageIds,
    });

    if (
      resolverSelectedId &&
      selectedRoundUserMessageIds.includes(resolverSelectedId)
    ) {
      selectedRoundUserMessageIds = [resolverSelectedId];
      needsResolver = false;
      resolverReason = null;

      const target = speakerName(options.constraints.speaker);
      if (target) {
        if (
          options.constraints.temporalRelation === 'before' ||
          options.constraints.temporalRelation === 'after'
        ) {
          const item = relativeSpeakerEvidence(
            options.allRounds,
            resolverSelectedId,
            target,
            options.constraints.temporalRelation
          );
          finalEvidence = item ? [item] : [];
        } else {
          const index = options.allRounds.findIndex(
            (round) => round.userMessageId === resolverSelectedId
          );
          const item =
            index >= 0
              ? evidenceFromRound(options.allRounds[index], index, target)
              : null;
          finalEvidence = item ? [item] : [];
        }
      }

      steps.push({
        operation: 'chronology',
        inputFrom: ['resolver'],
        outputCount: selectedRoundUserMessageIds.length,
        status: 'executed',
        reason: 'Cheap resolver disambiguated validated graph candidates.',
      });
    }
  }

  return {
    executionOrder,
    semanticRows,
    finalEvidence,
    selectedRoundUserMessageIds,
    steps,
    needsResolver,
    resolverReason,
    semanticQuery,
  };
}
