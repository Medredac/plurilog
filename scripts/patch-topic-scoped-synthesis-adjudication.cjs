const fs = require('fs');

const path = 'src/app/api/debate/route.ts';
let source = fs.readFileSync(path, 'utf8');

if (!source.includes('topicScopedSummaryNeedsAdjudication')) {
  const anchor = `        const needsResolver =
          result.compiledPlan.escalationSuggested ||
          relativeChronologyNeedsAdjudication ||
          semanticChronologyNeedsAdjudication ||`;

  if (!source.includes(anchor)) {
    throw new Error('topic-scoped synthesis adjudication target not found');
  }

  const block = `        const semanticHistoryAnswer =
          result.answers?.semantic_history_needed;
        const semanticHistorySignal =
          semanticHistoryAnswer?.type === 'noul' &&
          typeof semanticHistoryAnswer.noul === 'number'
            ? semanticHistoryAnswer.noul
            : 0;
        const rollingSummaryAnswer =
          result.answers?.rolling_summary_needed;
        const rollingSummarySignal =
          rollingSummaryAnswer?.type === 'noul' &&
          typeof rollingSummaryAnswer.noul === 'number'
            ? rollingSummaryAnswer.noul
            : 0;
        const semanticRoleAnswer =
          result.answers?.semantic_role;
        const topicSourceAnswer =
          result.answers?.topic_source;

        const topicScopedSummaryNeedsAdjudication =
          result.compiledPlan.operations.includes('rolling_summary') &&
          !result.compiledPlan.operations.includes('semantic_history') &&
          rollingSummarySignal >= 0.7 &&
          semanticHistorySignal >= 0.3 &&
          semanticRoleAnswer?.type === 'choice' &&
          semanticRoleAnswer.choice === 'find_topic' &&
          topicSourceAnswer?.type === 'choice' &&
          topicSourceAnswer.choice === 'current_prompt';

`;

  source = source.replace(anchor, block + anchor);

  source = source.replace(
    `          semanticChronologyNeedsAdjudication ||
          (result.compiledPlan.operations.includes('recent_exact') &&`,
    `          semanticChronologyNeedsAdjudication ||
          topicScopedSummaryNeedsAdjudication ||
          (result.compiledPlan.operations.includes('recent_exact') &&`
  );
}

source = source.replace(
  'If the topic/referent depends on recent_context, retain recent_exact when semantic_history or chronology still needs that referent.',
  'If the topic/referent depends on recent_context, retain recent_exact when semantic_history or chronology still needs that referent. For a request to synthesize how a specific named topic developed across the conversation, rolling_summary and semantic_history should normally compose: the rolling summary supplies broad continuity while semantic_history scopes evidence to that topic. Do not add chronology unless the user actually asks for temporal occurrence selection.'
);

fs.writeFileSync(path, source);
console.log('Applied topic-scoped synthesis adjudication patch');
