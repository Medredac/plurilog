const fs = require('fs');

const path = 'src/utils/jevMemoryPilot.ts';
let source = fs.readFileSync(path, 'utf8');

const marker = 'const topicScopedSynthesisNeedsSemantic =';

if (!source.includes(marker)) {
  const anchor = `  const summaryNeeded =
    (summarySignal >= 0.6 && historicalSignal >= 0.55) ||
    (summarySignal >= 0.75 && historicalSignal >= 0.35);`;

  if (!source.includes(anchor)) {
    throw new Error('topic-scoped synthesis insertion point not found');
  }

  const block = `  const topicScopedSynthesisNeedsSemantic =
    summarySignal >= 0.75 &&
    historicalSignal >= 0.25 &&
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

if (source.includes(oldSemanticConstraint)) {
  source = source.replace(
    oldSemanticConstraint,
    newSemanticConstraint
  );
}

fs.writeFileSync(path, source);
console.log('Applied topic-scoped synthesis plan patch');
