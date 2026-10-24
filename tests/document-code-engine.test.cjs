require('./helpers/register-typescript.cjs');
const { test } = require('node:test');
const assert = require('node:assert/strict');
const { isDocumentCodePreviewEnabled, validateDocumentCodeArgs, createDocumentDraftRegistry } = require('../src/utils/documentCodeTools.ts');
const args = (format = 'docx') => ({ filename: 'essay.' + format, format, code: 'print(1)', requirements: ['Double-spaced body', 'Numbered pages'], inputs: [] });
const draft = (id = 'one', format = 'docx') => ({ id, args: args(format), pages: ['page1', 'page2'] });
const review = [{ requirement: 1, satisfied: true, observation: 'All body paragraphs have 2.0 line spacing.' }, { requirement: 2, satisfied: true, observation: 'Every rendered page includes its page number.' }];
test('only the explicit preview branch can use the replacement engine', () => {
  assert.equal(isDocumentCodePreviewEnabled({ VERCEL_ENV: 'production', VERCEL_GIT_COMMIT_REF: 'preview/document-code-engine' }), false);
  assert.equal(isDocumentCodePreviewEnabled({ VERCEL_ENV: 'preview', VERCEL_GIT_COMMIT_REF: 'main' }), false);
  assert.equal(isDocumentCodePreviewEnabled({}), false);
  assert.equal(isDocumentCodePreviewEnabled({ VERCEL_ENV: 'preview', VERCEL_GIT_COMMIT_REF: 'preview/document-code-engine' }), true);
});
test('reject unsafe paths, wrong formats and unbounded inputs before execution', () => {
  for (const filename of ['../essay.docx', '/tmp/a.docx', '.secret.docx', 'bad\\a.docx']) assert.throws(() => validateDocumentCodeArgs({ ...args(), filename }));
  assert.throws(() => validateDocumentCodeArgs({ ...args(), filename: 'essay.pdf' }));
  assert.throws(() => validateDocumentCodeArgs({ ...args(), inputs: ['../secret'] }));
  assert.throws(() => validateDocumentCodeArgs({ ...args(), code: 'x'.repeat(180001) }));
  assert.doesNotThrow(() => validateDocumentCodeArgs(args()));
});
test('execution failures do not consume a document correction quota or destroy the last draft', () => {
  const registry = createDocumentDraftRegistry(); registry.begin(args()); registry.add(draft());
  for (let i = 0; i < 8; i++) registry.begin(args());
  assert.equal(registry.get('one').id, 'one');
  registry.add(draft('corrected'));
  assert.throws(() => registry.get('one'), /superseded/);
  assert.throws(() => registry.checkPublish('corrected', review, []), /every rendered page/);
});
test('distinct files of the same format keep their own drafts and reviews', () => {
  const registry = createDocumentDraftRegistry(); registry.add(draft()); registry.view('one', [1, 2]);
  registry.add({ ...draft('two'), args: { ...args(), filename: 'report.docx' } });
  assert.throws(() => registry.checkPublish('one', [{ ...review[0], satisfied: false }, review[1]], ['Text overlaps']), /Unmet document requirements/);
  assert.doesNotThrow(() => registry.checkPublish('one', review, []));
  assert.throws(() => registry.checkPublish('two', review, []), /every rendered page/);
});
test('publish requires actual page retrieval and a complete requirement review', () => {
  const registry = createDocumentDraftRegistry(); registry.begin(args()); registry.add(draft());
  assert.throws(() => registry.checkPublish('one', review, []), /every rendered page/);
  registry.view('one', [1]); assert.throws(() => registry.checkPublish('one', review, []));
  assert.throws(() => registry.view('one', [3]));
  registry.view('one', [2]);
  assert.throws(() => registry.checkPublish('one', [review[0], review[0]], []), /observation/);
  assert.throws(() => registry.checkPublish('one', [{ ...review[0], satisfied: false }, review[1]], []), /Unmet document requirements/);
  assert.throws(() => registry.checkPublish('one', [{ ...review[0], satisfied: false }, review[1]], ['Text overlaps']), /Unmet document requirements/);
  assert.doesNotThrow(() => registry.checkPublish('one', review, []));
  assert.equal(registry.hasUnpublished(), true); registry.published('one'); assert.equal(registry.hasUnpublished(), false);
});
