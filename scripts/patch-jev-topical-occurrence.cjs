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

if (!source.includes(oldTopical)) {
  throw new Error('Topical occurrence compiler target not found');
}
if (!source.includes(oldConstraints)) {
  throw new Error('Constraint canonicalization target not found');
}

source = source.replace(oldTopical, newTopical);
source = source.replace(oldConstraints, newConstraints);
fs.writeFileSync(path, source);

console.log('Applied preview topical-occurrence memory patch');
