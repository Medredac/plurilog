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

const newTopical = `  const structuredTopicalOccurrenceIntent =
    chronologyNeeded &&
    temporalSupported &&
    ['first', 'last', 'ordinal'].includes(executableRelation || '') &&
    speakerSupported &&
    chronologySignal >= 0.75 &&
    semanticSignal >= 0.3 &&
    chronologyRole !== 'direct_position' &&
    (
      chronologyRole === 'select_anchor_occurrence' ||
      ['first', 'last', 'ordinal'].includes(anchorOccurrence || '')
    );

  const topicalOccurrenceNeedsSemantic =
    chronologyNeeded &&
    temporalSupported &&
    ['first', 'last', 'ordinal'].includes(executableRelation || '') &&
    semanticSignal >= 0.3 &&
    (
      (semanticRole === 'find_topic' && semanticRoleSupported) ||
      structuredTopicalOccurrenceIntent
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
                    topicalOccurrenceLookup &&
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
                                    'Classify historical conversation candidates for topical occurrence chronology. Keep rounds whose primary purpose is to substantively introduce, continue, expand, debate, compare, analyze, or return to the historical topic. Exclude meta-memory/retrieval rounds whose primary purpose is to ask what someone said earlier, recap prior answers, verify memory, or test retrieval. A turn may mention prior context and still be substantive if it actually continues the topic. Do not answer the user. Return JSON only: {"substantiveRoundUserMessageIds":string[]}. Select only IDs from the supplied candidates.',
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

console.log(
  topicalAlreadyPatched && constraintsAlreadyPatched
    ? 'Preview topical-occurrence memory patch already applied'
    : 'Applied preview topical-occurrence memory patch'
);
