const fs = require('fs');

function replaceOnce(source, oldValue, newValue, label) {
  if (source.includes(newValue)) return source;
  if (!source.includes(oldValue)) {
    throw new Error(label + ' target not found');
  }
  return source.replace(oldValue, newValue);
}

// 1) Jev consumes the same bounded MemoryControlContext packet as every
// other cheap memory-control model.
const jevPath = 'src/utils/jevMemoryPilot.ts';
let jevSource = fs.readFileSync(jevPath, 'utf8');

jevSource = replaceOnce(
  jevSource,
  "import type { Round } from '@/utils/discussionMemory';\n",
  "import type { Round } from '@/utils/discussionMemory';\nimport {\n  buildMemoryControlContext,\n  type MemoryControlContext,\n} from '@/utils/memoryControlContext';\n",
  'Jev memory-control import'
);

jevSource = replaceOnce(
  jevSource,
  `  prompt: string;
  recentRounds?: Round[];
  knownDocuments?: KnownDocumentLike[];`,
  `  prompt: string;
  recentRounds?: Round[];
  controlContext?: MemoryControlContext;
  knownDocuments?: KnownDocumentLike[];`,
  'Jev controlContext option'
);

jevSource = replaceOnce(
  jevSource,
  `  const startedAt = Date.now();
  const model = process.env.JEV_MEMORY_PILOT_MODEL || DEFAULT_JEV_MODEL;

  const state = {
    current_user_message: clip(options.prompt || '', 6000),
    recent_context: compactRecentRounds(options.recentRounds),`,
  `  const startedAt = Date.now();
  const model = process.env.JEV_MEMORY_PILOT_MODEL || DEFAULT_JEV_MODEL;
  const memoryControlContext =
    options.controlContext ||
    buildMemoryControlContext(options.prompt, options.recentRounds);

  const state = {
    current_user_message: memoryControlContext.currentRequest,
    immediate_prior_user_message:
      memoryControlContext.immediatePriorUserMessage,
    recent_context: memoryControlContext.recentRounds,`,
  'Jev control context state'
);


jevSource = replaceOnce(
  jevSource,
  `  const questions = {
    historical_conversation_needed: {`,
  `  const questions = {
    conversation_memory_evidence_needed: {
      type: 'noul',
      instructions:
        'Does answering current_user_message actually require using prior conversation content as evidence or context? This includes recalling, locating, comparing, verifying, continuing, or resolving an underspecified reference from prior turns. A self-contained substantive statement or opinion about the same topic should be near 0 even if recent_context is related.',
    },
    historical_conversation_needed: {`,
  'Jev conversation-memory evidence question'
);

jevSource = replaceOnce(
  jevSource,
  `  const historicalSignal = getNoul(
    answers,
    'historical_conversation_needed'
  );`,
  `  const memoryEvidenceSignal = getNoul(
    answers,
    'conversation_memory_evidence_needed'
  );
  const historicalSignal = getNoul(
    answers,
    'historical_conversation_needed'
  );`,
  'Jev conversation-memory evidence signal'
);

jevSource = replaceOnce(
  jevSource,
  `  const summaryNeeded =
    (summarySignal >= 0.6 && historicalSignal >= 0.55) ||
    (summarySignal >= 0.75 && historicalSignal >= 0.35);`,
  `  const conversationMemoryAllowed =
    memoryEvidenceSignal >= 0.7;

  if (!conversationMemoryAllowed) {
    recentNeeded = false;
    semanticNeeded = false;
    chronologyNeeded = false;
  }

  const summaryNeeded =
    conversationMemoryAllowed &&
    (
      (summarySignal >= 0.6 && historicalSignal >= 0.55) ||
      (summarySignal >= 0.75 && historicalSignal >= 0.35)
    );`,
  'Jev conversation-memory retrieval gate'
);

jevSource = replaceOnce(
  jevSource,
  `    escalationSuggested:
      incompleteEmptyHistoricalCallback ||
      (!recentOnlyPlanIsComplete &&
        getNoul(answers, 'flexible_resolver_needed') >= 0.5 &&
        memoryAmbiguitySignal),`,
  `    escalationSuggested:
      (
        memoryEvidenceSignal >= 0.35 &&
        memoryEvidenceSignal < 0.7 &&
        memoryAmbiguitySignal
      ) ||
      (
        memoryEvidenceSignal >= 0.35 &&
        incompleteEmptyHistoricalCallback
      ) ||
      (
        memoryEvidenceSignal >= 0.35 &&
        !recentOnlyPlanIsComplete &&
        getNoul(answers, 'flexible_resolver_needed') >= 0.5 &&
        memoryAmbiguitySignal
      ),`,
  'Jev memory escalation gate'
);

fs.writeFileSync(jevPath, jevSource);

// 2) Build one packet once in the debate route and reuse it everywhere.
const routePath = 'src/app/api/debate/route.ts';
let routeSource = fs.readFileSync(routePath, 'utf8');

routeSource = replaceOnce(
  routeSource,
  `import {
  executeConversationMemoryGraph,
  type ConversationMemoryGraphResult,
} from '@/utils/jevMemoryGraphExecutorV2';`,
  `import {
  executeConversationMemoryGraph,
  type ConversationMemoryGraphResult,
} from '@/utils/jevMemoryGraphExecutorV2';
import { buildMemoryControlContext } from '@/utils/memoryControlContext';`,
  'Route memory-control import'
);

routeSource = replaceOnce(
  routeSource,
  `    // Preview controller pilot. Jev and its optional resolver now finish before
    // retrieval begins so the effective plan can gate preview-only retrieval.`,
  `    const memoryControlContext = buildMemoryControlContext(
      prompt || '',
      discussionMemory?.recentRounds
    );

    console.log('[Memory Control Context]', {
      recentRoundCount: memoryControlContext.recentRounds.length,
      policy: memoryControlContext.policy,
    });

    // Preview controller pilot. Jev and its optional resolver now finish before
    // retrieval begins so the effective plan can gate preview-only retrieval.`,
  'Route memory-control construction'
);

routeSource = replaceOnce(
  routeSource,
  `          apiKey,
          prompt,
          recentRounds: discussionMemory?.recentRounds,`,
  `          apiKey,
          prompt,
          recentRounds: discussionMemory?.recentRounds,
          controlContext: memoryControlContext,`,
  'Jev shared context handoff'
);

routeSource = replaceOnce(
  routeSource,
  `                      prompt,
                      recentRounds: discussionMemory?.recentRounds?.slice(-3),
                      atomicAnswers: result.answers,`,
  `                      prompt: memoryControlContext.currentRequest,
                      controlContext: memoryControlContext,
                      atomicAnswers: result.answers,`,
  'System-2 shared context'
);

// Anchor-query helper: include the same control context for pronouns,
// ellipsis, and implicit historical anchors.
routeSource = replaceOnce(
  routeSource,
  `                                  currentRequest: prompt,
                                  constraints: jevEffectiveConstraints,
                                }),`,
  `                                  currentRequest:
                                    memoryControlContext.currentRequest,
                                  constraints: jevEffectiveConstraints,
                                  controlContext: memoryControlContext,
                                }),`,
  'Anchor-query shared context'
);

routeSource = routeSource.replace(
  'Return JSON only: {"anchorQuery":string}. Preserve names and distinctive wording from the described anchor.',
  'If the described anchor depends on pronouns, ellipsis, or an implicit referent, resolve it from controlContext.recentRounds. Return JSON only: {"anchorQuery":string}. Preserve names and distinctive wording from the resolved anchor.'
);

// Topic-query helper: replace the bespoke recent-context payload with the
// common bounded packet.
const oldTopicPayload = `                                content: JSON.stringify({
                                  currentRequest: prompt,
                                  constraints: jevEffectiveConstraints,
                                  recentContext:
                                    jevEffectiveConstraints?.topicSource ===
                                    'recent_context'
                                      ? (
                                          discussionMemory?.recentRounds || []
                                        )
                                          .slice(-3)
                                          .map((round) => ({
                                            userPrompt: (
                                              round.userPrompt || ''
                                            ).slice(0, 1000),
                                            modelResponses: (
                                              round.modelResponses || []
                                            ).map((response) => ({
                                              name: response.name,
                                              content: (
                                                response.content || ''
                                              ).slice(0, 500),
                                            })),
                                          }))
                                      : [],
                                  composedSemanticQuery: semanticQuery,
                                }),`;

const newTopicPayload = `                                content: JSON.stringify({
                                  currentRequest:
                                    memoryControlContext.currentRequest,
                                  constraints: jevEffectiveConstraints,
                                  controlContext: memoryControlContext,
                                  composedSemanticQuery: semanticQuery,
                                }),`;

routeSource = replaceOnce(
  routeSource,
  oldTopicPayload,
  newTopicPayload,
  'Topic-query shared context'
);

routeSource = routeSource.replace(
  'from the supplied recentContext before writing the topic query.',
  'from controlContext.recentRounds before writing the topic query.'
);

// Topical occurrence classifier gets the packet only for interpretation;
// candidate identities remain a separate bounded list.
routeSource = replaceOnce(
  routeSource,
  `                                    currentRequest: prompt,
                                    topicQuery: retrievalQuery,
                                    candidates: occurrenceCandidates,`,
  `                                    currentRequest:
                                      memoryControlContext.currentRequest,
                                    controlContext: memoryControlContext,
                                    topicQuery: retrievalQuery,
                                    candidates: occurrenceCandidates,`,
  'Occurrence classifier shared context'
);

// Candidate ambiguity resolver gets the same interpretation packet while
// remaining constrained to already-validated candidate IDs.
routeSource = replaceOnce(
  routeSource,
  `                              prompt: graphPrompt,
                              ambiguityReason: reason,
                              selectionRole,`,
  `                              prompt: graphPrompt,
                              controlContext: memoryControlContext,
                              ambiguityReason: reason,
                              selectionRole,`,
  'Ambiguity resolver shared context'
);


routeSource = routeSource.replace(
  'from controlContext.recentRounds before writing the topic query.',
  'First inspect controlContext.immediatePriorUserMessage. If it states a clear topic, preserve that user-stated semantic scope as the primary referent; use controlContext.recentRounds only to disambiguate it, not to replace or broaden it with panel elaborations. Never include a speaker identity in the topic query unless that speaker is intrinsically part of the topic itself.'
);

routeSource = routeSource.replace(
  'If the described anchor depends on pronouns, ellipsis, or an implicit referent, resolve it from controlContext.recentRounds. Return JSON only:',
  'If the described anchor depends on pronouns, ellipsis, or an implicit referent, first inspect controlContext.immediatePriorUserMessage and preserve its semantic scope when it clearly supplies the referent; use controlContext.recentRounds only for disambiguation. Return JSON only:'
);


routeSource = routeSource.replace(
  'You are a shadow memory-plan adjudicator. Do not answer the user. Decide whether the proposed memory operations are actually needed.',
  'You are a shadow memory-plan adjudicator. Do not answer the user. IMPORTANT: decide whether conversation memory is needed from controlContext.currentRequest alone. Do not infer a memory request merely because recentRounds contain earlier recall questions or related history. A self-contained declarative statement, opinion, or continuation must not trigger conversation-memory retrieval. Only after memory intent is established may recentRounds be used to resolve pronouns, ellipsis, or implicit referents. Decide whether the proposed memory operations are actually needed.'
);

fs.writeFileSync(routePath, routeSource);

console.log('Applied shared bounded MemoryControlContext preview patch');
