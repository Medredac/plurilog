const fs = require('fs');

const path = 'src/utils/jevMemoryPilot.ts';
let source = fs.readFileSync(path, 'utf8');

const oldTopical = `  const topicalOccurrenceNeedsSemantic =
    chronologyNeeded &&
    temporalSupported &&
    ['first', 'last', 'ordinal'].includes(executableRelation || '') &&
    semanticRole === 'find_topic' &&
    semanticRoleSupported &&
    semanticSignal >= 0.3;`;

const newTopical = `  const recentContextTopicalOccurrenceIntent =
    chronologyNeeded &&
    temporalSupported &&
    ['first', 'last', 'ordinal'].includes(executableRelation || '') &&
    speakerSupported &&
    recentTopicSource &&
    recentSignal >= 0.75 &&
    semanticSignal >= 0.2;

  const structuredTopicalOccurrenceIntent =
    chronologyNeeded &&
    temporalSupported &&
    ['first', 'last', 'ordinal'].includes(executableRelation || '') &&
    speakerSupported &&
    chronologySignal >= 0.75 &&
    semanticSignal >= 0.3 &&
    (
      chronologyRole !== 'direct_position' ||
      chronologyRoleConfidence < 0.55
    ) &&
    (
      chronologyRole === 'select_anchor_occurrence' ||
      ['first', 'last', 'ordinal'].includes(anchorOccurrence || '')
    );

  const topicalOccurrenceNeedsSemantic =
    chronologyNeeded &&
    temporalSupported &&
    ['first', 'last', 'ordinal'].includes(executableRelation || '') &&
    semanticSignal >= 0.2 &&
    (
      (semanticRole === 'find_topic' && semanticRoleSupported) ||
      structuredTopicalOccurrenceIntent ||
      recentContextTopicalOccurrenceIntent
    );`;

const oldConstraints = `      semanticRole:
        semanticNeeded && semanticRoleSupported ? semanticRole : null,
      chronologyRole:
        chronologyNeeded && chronologyRoleSupported ? chronologyRole : null,`;

const newConstraints = `      semanticRole:
        semanticNeeded && semanticRoleSupported
          ? semanticRole
          : topicalOccurrenceNeedsSemantic
            ? 'find_topic'
            : null,
      chronologyRole:
        chronologyNeeded && chronologyRoleSupported
          ? chronologyRole
          : topicalOccurrenceNeedsSemantic
            ? 'select_anchor_occurrence'
            : null,`;

const topicalAlreadyPatched = source.includes(newTopical);
const constraintsAlreadyPatched = source.includes(newConstraints);

if (!source.includes(oldTopical) && !topicalAlreadyPatched) {
  throw new Error('Topical occurrence compiler target not found');
}
if (!source.includes(oldConstraints) && !constraintsAlreadyPatched) {
  throw new Error('Constraint canonicalization target not found');
}

if (!topicalAlreadyPatched) {
  source = source.replace(oldTopical, newTopical);
}
if (!constraintsAlreadyPatched) {
  source = source.replace(oldConstraints, newConstraints);
}

fs.writeFileSync(path, source);
const routePath = 'src/app/api/debate/route.ts';
let routeSource = fs.readFileSync(routePath, 'utf8');

const oldRecentExclusion = `                  const excludedIds = new Set<string>();
                  for (const round of discussionMemory?.recentRounds || []) {
                    if (round.userMessageId) excludedIds.add(round.userMessageId);
                  }
                  if (sourceUserMessageId) excludedIds.add(sourceUserMessageId);`;

const newRecentExclusion = `                  const excludedIds = new Set<string>();
                  if (!topicalOccurrenceLookup) {
                    for (const round of discussionMemory?.recentRounds || []) {
                      if (round.userMessageId) {
                        excludedIds.add(round.userMessageId);
                      }
                    }
                  }
                  if (sourceUserMessageId) {
                    excludedIds.add(sourceUserMessageId);
                  }`;

const recentExclusionAlreadyPatched =
  routeSource.includes(newRecentExclusion);

if (
  !routeSource.includes(oldRecentExclusion) &&
  !recentExclusionAlreadyPatched
) {
  throw new Error('Recent-round semantic exclusion target not found');
}

if (!recentExclusionAlreadyPatched) {
  routeSource = routeSource.replace(
    oldRecentExclusion,
    newRecentExclusion
  );
  fs.writeFileSync(routePath, routeSource);
}


const oldOccurrenceSelection = `                  const selected = qualifying.slice(
                    0,
                    semanticCandidateLimit
                  );

                  console.log('[Jev Memory Graph] Semantic node complete', {
                    candidateCount: hybridRows.length,
                    validatedCount: qualifying.length,
                    selectedCount: selected.length,
                    candidateLimit: semanticCandidateLimit,
                    topicalOccurrenceLookup,
                    mode: 'candidate-first',
                  });

                  return selected;`;

const newOccurrenceSelection = `                  let selected = qualifying.slice(
                    0,
                    semanticCandidateLimit
                  );

                  if (
                    topicSemanticLookup &&
                    selected.length > 1
                  ) {
                    try {
                      const selectedIds = new Set(
                        selected
                          .map((row: any) => row?.source_user_message_id)
                          .filter(Boolean)
                      );
                      const occurrenceCandidates = (
                        discussionMemory?.allRounds || []
                      )
                        .filter(
                          (round) =>
                            round.userMessageId &&
                            selectedIds.has(round.userMessageId)
                        )
                        .map((round) => ({
                          roundUserMessageId: round.userMessageId,
                          userPrompt: (round.userPrompt || '').slice(0, 600),
                          modelResponses:
                            jevEffectiveConstraints?.speaker === 'user'
                              ? []
                              : jevEffectiveConstraints?.speaker &&
                                  jevEffectiveConstraints.speaker !== 'none' &&
                                  jevEffectiveConstraints.speaker !== 'multiple'
                                ? (round.modelResponses || [])
                                    .filter(
                                      (response) =>
                                        response.name.toLowerCase() ===
                                        jevEffectiveConstraints.speaker!.toLowerCase()
                                    )
                                    .map((response) => ({
                                      name: response.name,
                                      content: (response.content || '').slice(0, 700),
                                    }))
                                : (round.modelResponses || [])
                                    .map((response) => ({
                                      name: response.name,
                                      content: (response.content || '').slice(0, 700),
                                    })),
                        }));

                      if (occurrenceCandidates.length > 1) {
                        const occurrenceFilterModel =
                          process.env.JEV_MEMORY_RESOLVER_MODEL ||
                          'google/gemini-3.1-flash-lite';
                        const occurrenceFilterResponse =
                          await openai.chat.completions.create(
                            {
                              model: occurrenceFilterModel,
                              temperature: 0,
                              max_tokens: 700,
                              response_format: { type: 'json_object' },
                              messages: [
                                {
                                  role: 'system',
                                  content:
                                    'Classify historical conversation candidates for topical occurrence chronology. Keep only rounds whose user prompt or panel responses materially discuss the RESOLVED TOPIC represented by topicQuery. Do not keep a round merely because it discusses a broader parent topic or adjacent concept. Exclude meta-memory/retrieval rounds whose primary purpose is to ask what someone said earlier, recap prior answers, verify memory, or test retrieval. A turn may mention prior context and still be substantive if it materially continues the resolved topic. Do not answer the user. Return JSON only: {"substantiveRoundUserMessageIds":string[]}. Select only IDs from the supplied candidates.',
                                },
                                {
                                  role: 'user',
                                  content: JSON.stringify({
                                    currentRequest: prompt,
                                    topicQuery: retrievalQuery,
                                    candidates: occurrenceCandidates,
                                  }),
                                },
                              ],
                            },
                            { signal: req.signal }
                          );

                        const occurrenceFilterRaw =
                          occurrenceFilterResponse.choices?.[0]?.message
                            ?.content || '{}';
                        const occurrenceFilterParsed = JSON.parse(
                          occurrenceFilterRaw
                            .trim()
                            .replace(/^\`\`\`(?:json)?\\s*/i, '')
                            .replace(/\\s*\`\`\`$/, '')
                        );
                        const allowedIds = new Set(
                          Array.isArray(
                            occurrenceFilterParsed?.substantiveRoundUserMessageIds
                          )
                            ? occurrenceFilterParsed
                                .substantiveRoundUserMessageIds
                                .filter(
                                  (id: unknown): id is string =>
                                    typeof id === 'string' &&
                                    selectedIds.has(id)
                                )
                            : []
                        );

                        if (allowedIds.size > 0) {
                          selected = selected.filter((row: any) =>
                            allowedIds.has(row?.source_user_message_id)
                          );
                          
console.log(
                            '[Jev Topical Occurrence Filter]',
                            {
                              model:
                                occurrenceFilterResponse.model ||
                                occurrenceFilterModel,
                              inputCount: occurrenceCandidates.length,
                              substantiveCount: selected.length,
                            }
                          );
                        } else {
                          console.warn(
                            '[Jev Topical Occurrence Filter] No substantive candidates selected; preserving validated semantic candidates.'
                          );
                        }
                      }
                    } catch (occurrenceFilterErr: any) {
                      console.warn(
                        '[Jev Topical Occurrence Filter] Non-critical failure',
                        {
                          message:
                            occurrenceFilterErr?.message ||
                            String(occurrenceFilterErr),
                        }
                      );
                    }
                  }

                  console.log('[Jev Memory Graph] Semantic node complete', {
                    candidateCount: hybridRows.length,
                    validatedCount: qualifying.length,
                    selectedCount: selected.length,
                    candidateLimit: semanticCandidateLimit,
                    topicalOccurrenceLookup,
                    mode: 'candidate-first',
                  });

                  return selected;`;

const occurrenceFilterAlreadyPatched =
  routeSource.includes('[Jev Topical Occurrence Filter]');

if (
  !routeSource.includes(oldOccurrenceSelection) &&
  !occurrenceFilterAlreadyPatched
) {
  throw new Error('Topical occurrence candidate filter target not found');
}

if (!occurrenceFilterAlreadyPatched) {
  routeSource = routeSource.replace(
    oldOccurrenceSelection,
    newOccurrenceSelection
  );
  fs.writeFileSync(routePath, routeSource);
}

const oldTopicQueryInstruction = `                                  'Formulate a semantic retrieval query for the HISTORICAL TOPIC only. Do not answer the user. Remove meta-language about which speaker said something and about first, last, previous, before, after, or ordinal position. Return JSON only: {"topicQuery":string}. Preserve the topic meaning and distinctive concepts needed to retrieve every historical round about that topic.',`;

const newTopicQueryInstruction = `                                  'Formulate a semantic retrieval query for the HISTORICAL TOPIC only. Do not answer the user. Remove meta-language about which speaker said something and about first, last, previous, before, after, or ordinal position. If topicSource is recent_context, resolve pronouns or underspecified references such as that, it, this, or the issue from the supplied recentContext before writing the topic query. Return JSON only: {"topicQuery":string}. Preserve the resolved topic meaning and distinctive concepts needed to retrieve every historical round about that topic.',`;

const oldTopicQueryPayload = `                                content: JSON.stringify({
                                  currentRequest: prompt,
                                  constraints: jevEffectiveConstraints,
                                }),`;

const newTopicQueryPayload = `                                content: JSON.stringify({
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

const topicQueryContextAlreadyPatched =
  routeSource.includes('composedSemanticQuery: semanticQuery');

if (
  !routeSource.includes(oldTopicQueryInstruction) &&
  !topicQueryContextAlreadyPatched
) {
  throw new Error('Topic-query instruction target not found');
}

if (
  !routeSource.includes(oldTopicQueryPayload) &&
  !topicQueryContextAlreadyPatched
) {
  throw new Error('Topic-query payload target not found');
}

if (!topicQueryContextAlreadyPatched) {
  routeSource = routeSource.replace(
    oldTopicQueryInstruction,
    newTopicQueryInstruction
  );

  const topicQueryInstructionIndex =
    routeSource.indexOf(newTopicQueryInstruction);
  const payloadIndex = routeSource.indexOf(
    oldTopicQueryPayload,
    topicQueryInstructionIndex
  );

  if (payloadIndex === -1) {
    throw new Error('Topic-query payload not found after instruction');
  }

  routeSource =
    routeSource.slice(0, payloadIndex) +
    newTopicQueryPayload +
    routeSource.slice(
      payloadIndex + oldTopicQueryPayload.length
    );

  fs.writeFileSync(routePath, routeSource);
}


console.log(
  topicalAlreadyPatched && constraintsAlreadyPatched
    ? 'Preview topical-occurrence memory patch already applied'
    : 'Applied preview topical-occurrence memory patch'
);
