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
    recent_context: memoryControlContext.recentRounds,`,
  'Jev control context state'
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

fs.writeFileSync(routePath, routeSource);

console.log('Applied shared bounded MemoryControlContext preview patch');
