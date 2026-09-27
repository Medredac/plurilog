const fs = require('fs');

const path = 'src/utils/jevMemoryPilot.ts';
let source = fs.readFileSync(path, 'utf8');

const oldBlock = `  const structuredTopicalOccurrenceIntent =
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

const newBlock = `  const recentContextTopicalOccurrenceIntent =
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

const alreadyPatched = source.includes(
  'const recentContextTopicalOccurrenceIntent ='
);

if (!source.includes(oldBlock) && !alreadyPatched) {
  throw new Error('Recent-context topical occurrence compiler target not found');
}

if (!alreadyPatched) {
  source = source.replace(oldBlock, newBlock);
  fs.writeFileSync(path, source);
}

console.log(
  alreadyPatched
    ? 'Recent-context topical occurrence compiler patch already applied'
    : 'Applied recent-context topical occurrence compiler patch'
);
