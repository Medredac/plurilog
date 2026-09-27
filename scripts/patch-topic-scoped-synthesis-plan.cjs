const fs = require('fs');

const path = 'src/utils/jevMemoryPilot.ts';
let source = fs.readFileSync(path, 'utf8');

const marker = 'const topicScopedSynthesisNeedsSemantic =';

if (!source.includes(marker)) {
  const anchor = `  const visualNeeded = visualSignal >= 0.65;`;
  if (!source.includes(anchor)) {
    throw new Error('topic-scoped synthesis insertion point not found');
  }

  const block = `  const topicScopedSynthesisNeedsSemantic =
    conversationMemoryAllowed &&
    summaryNeeded &&
    semanticRole === 'find_topic' &&
    topicSource === 'current_prompt' &&
    topicSourceConfidence >= 0.65 &&
    semanticSignal >= 0.3 &&
    !temporalSupported &&
    !speakerSupported;

  if (topicScopedSynthesisNeedsSemantic) {
    semanticNeeded = true;
  }

`;

  source = source.replace(anchor, block + anchor);
}

const oldSemanticConstraint = `      semanticRole:
        semanticNeeded && semanticRoleSupported
          ? semanticRole
          : topicalOccurrenceNeedsSemantic
            ? 'find_topic'
            : null,`;

const newSemanticConstraint = `      semanticRole:
        semanticNeeded && semanticRoleSupported
          ? semanticRole
          : topicalOccurrenceNeedsSemantic ||
              topicScopedSynthesisNeedsSemantic
            ? 'find_topic'
            : null,`;

if (
  source.includes(oldSemanticConstraint) &&
  !source.includes('topicScopedSynthesisNeedsSemantic\n            ? \'find_topic\'')
) {
  source = source.replace(
    oldSemanticConstraint,
    newSemanticConstraint
  );
}

fs.writeFileSync(path, source);
console.log('Applied topic-scoped synthesis plan patch');
