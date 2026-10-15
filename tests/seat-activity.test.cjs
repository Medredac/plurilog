const { test } = require('node:test');
const assert = require('node:assert/strict');
const fs = require('node:fs');
const Module = require('node:module');
const ts = require('typescript');
const m = new Module(__filename, module);
m._compile(ts.transpileModule(fs.readFileSync('src/utils/seatActivity.ts', 'utf8'), { compilerOptions: { module: ts.ModuleKind.CommonJS, target: ts.ScriptTarget.ES2022 } }).outputText, __filename);
const { buildAgenticSeatActivity: activity, activityFilename, videoActivity, documentActivityLabel } = m.exports;

test('document and conversation searches expose real query and source details', () => {
  assert.deepEqual(activity('get_full_conversation', {mode:'transcript'}), {activity:'reading_context',label:'Reading the full conversation…'});
  assert.equal(activity('search_document_evidence', { filename: '/private/Business plan.pdf', query: 'cancellation terms' }).label, 'Searching “Business plan.pdf”: “cancellation terms”…');
  assert.match(activity('search_conversation_memory', { speaker: 'user', query: 'pricing' }).label, /your earlier messages: “pricing”/);
  assert.equal(activity('not_a_real_tool', {}), null);
});
test('video labels distinguish observed segment inspection from merely opening the tool', () => {
  assert.equal(activity('inspect_video', { filename: 'demo.mp4', start_seconds: 75, end_seconds: 130 }).label, 'Opening “demo.mp4”…');
  assert.equal(videoActivity({ filename: 'demo.mp4', start_seconds: 75, end_seconds: 130 }).label, 'Examining “demo.mp4” · 01:15–02:10…');
  assert.equal(videoActivity({ youtube_url: 'https://youtube.com/watch?v=abc&secret=x', start_seconds: 75 }).label, 'Examining YouTube video…');
  assert.ok(!videoActivity({ filename: 'demo.mp4', start_seconds: NaN }).label.includes('NaN'));
});
test('display names omit paths, signed query strings and control characters', () => {
  assert.equal(activityFilename('/private/folder/report.pdf?token=secret'), 'report.pdf');
  assert.equal(activityFilename('C:\\private\\report.pdf'), 'report.pdf');
  assert.equal(activityFilename('report\n\u202E.pdf'), 'report .pdf');
  assert.ok(activityFilename('x'.repeat(300)).length <= 80);
});
test('document pipeline labels preserve distinct real stages', () => {
  assert.equal(documentActivityLabel('editing_pdf', 'Plan', 'pdf'), 'Editing “Plan” (PDF)…');
  assert.equal(documentActivityLabel('checking_documents', 'Plan', 'docx'), 'Checking layout of “Plan” (Word)…');
  assert.equal(documentActivityLabel('saving_file', 'Plan', 'pdf'), 'Saving “Plan” (PDF)…');
});
