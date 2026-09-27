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
console.log(
  topicalAlreadyPatched && constraintsAlreadyPatched
    ? 'Preview topical-occurrence memory patch already applied'
    : 'Applied preview topical-occurrence memory patch'
);
