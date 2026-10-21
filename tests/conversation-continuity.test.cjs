require('./helpers/register-typescript.cjs');
const { test } = require('node:test');
const assert = require('node:assert/strict');
const fs = require('node:fs');
const path = require('node:path');
const Module = require('node:module');
const ts = require('typescript');
const evidence = require('../src/utils/agenticConversationMemory.ts');
const { relevantConversationExcerpt, validateConversationSourceAnchors } = require('../src/utils/conversationEvidence.ts');

function loadWorkingContext() {
  const filename = path.resolve('src/utils/workingConversationContext.ts');
  const mod = new Module(filename, module);
  mod.filename = filename; mod.paths = module.paths;
  const originalRequire = mod.require.bind(mod);
  mod.require = name => name === '@/utils/discussionMemory'
    ? { estimateTokens: text => Math.ceil(text.length / 4) }
    : originalRequire(name);
  mod._compile(ts.transpileModule(fs.readFileSync(filename, 'utf8'), {
    compilerOptions: { module: ts.ModuleKind.CommonJS, target: ts.ScriptTarget.ES2022, esModuleInterop: true },
  }).outputText, filename);
  return mod.exports;
}
const working = loadWorkingContext();
const round = (id, text) => ({ userMessageId: id, userPrompt: text, modelResponses: [] });
const anchor = (id, query = 'Original project specification') => ({ source_user_message_id: id, query });
const entry = (id, kind = 'semantic') => ({
  evidenceId: id, kind, sourceUserMessageId: 'source-1', roundIndex: 0, speaker: 'user',
  compactText: 'The original brief concerns a character.',
  expandedText: 'The original brief concerns a character. Her binding was accidental, not a planned ritual.',
  query: 'character origin', requestedBySeatId: 'chatgpt', createdAt: null,
});
const resolve = (ledger, toolName = 'expand_conversation_evidence', ids = ledger.map(e => e.evidenceId)) => evidence.resolveAgenticConversationTool({
  toolName, toolArgs: { evidence_ids: ids }, ledger, allRounds: [], discussionId: 'discussion',
  requestedBySeatId: 'chatgpt', createEvidenceId: () => 'unused',
  openai: {}, serviceSupabase: {},
});

test('targeted excerpts cover distant facts instead of only the repeated entity at the beginning', () => {
  const source = 'Liora '.repeat(150) + 'ordinary detail '.repeat(80)
    + 'The binding was accidental rather than a planned ritual. '
    + 'another detail '.repeat(100) + 'Her deliberately flawed steel concealed advanced metallurgy. '
    + 'other detail '.repeat(100);
  for (const limit of [1200, 3000, 6000]) {
    const excerpt = relevantConversationExcerpt(source, 'Liora accidental binding flawed steel metallurgy', limit);
    assert.match(excerpt, /binding was accidental/);
    assert.match(excerpt, /flawed steel concealed/);
    assert.ok(excerpt.length <= limit);
    for (const passage of excerpt.split('\n[…]\n')) assert.ok(source.includes(passage.replace(/^…|…$/g, '')));
  }
});
test('short text and no-query recent context retain their existing behavior', () => {
  assert.equal(relevantConversationExcerpt('Exact short text.', 'unmatched', 1200), 'Exact short text.');
  assert.equal(relevantConversationExcerpt('a'.repeat(1500), '', 1200), 'a'.repeat(1199) + '…');
});
test('both expansion tools hand the opened conversation passage to following seats', async () => {
  for (const tool of ['expand_conversation_evidence', 'expand_grounded_evidence']) {
    const ledger = [entry('mem_1')];
    assert.doesNotMatch(evidence.formatSharedAgenticEvidenceForPrompt(ledger), /binding was accidental/);
    const opened = await resolve(ledger, tool);
    assert.match(opened.result.evidence[0].content, /binding was accidental/);
    assert.match(evidence.formatSharedAgenticEvidenceForPrompt(ledger), /binding was accidental/);
    // Continue persistence retains the expansion flag after JSON serialization.
    assert.match(evidence.formatSharedAgenticEvidenceForPrompt(JSON.parse(JSON.stringify(ledger))), /binding was accidental/);
  }
});
test('web and image/PDF/Word evidence retain their existing compact rendering and metadata', async () => {
  for (const kind of ['web', 'artifact']) {
    for (const artifactKind of ['image', 'pdf', 'docx', 'document_text']) {
      const item = { ...entry('asset', kind), artifactKind, filename: 'source.' + artifactKind, webUrl: 'https://example.com/source' };
      const ledger = [item]; const before = evidence.formatSharedAgenticEvidenceForPrompt(ledger);
      const opened = await resolve(ledger, 'expand_grounded_evidence');
      assert.equal(opened.result.evidence[0].content, item.expandedText);
      assert.equal(evidence.formatSharedAgenticEvidenceForPrompt(ledger), before);
      assert.equal(item.expandedForSharing, undefined);
    }
  }
});
test('many opened sources have a fixed sharing budget and retain honest excerpt markers', async () => {
  const ledger = Array.from({ length: 12 }, (_, i) => ({ ...entry(`mem_${i}`), compactText: 'c'.repeat(1200), expandedText: `${i}:` + 'x'.repeat(5997) }));
  for (let i = 0; i < 12; i += 3) await resolve(ledger, 'expand_conversation_evidence', ledger.slice(i, i + 3).map(e => e.evidenceId));
  const shared = evidence.formatSharedAgenticEvidenceForPrompt(ledger);
  assert.equal((shared.match(/opened_passage=true/g) || []).length, 2);
  assert.equal((shared.match(/excerpt_only=true/g) || []).length, 10);
  assert.ok(shared.length < 30000);
});
test('only local user source IDs can become anchors; Continue and foreign IDs are rejected', () => {
  const rounds = [round('old', 'The original requirement.'), round('continue', 'Continue'), round('new', 'Correction.'), round('empty', '')];
  assert.deepEqual(validateConversationSourceAnchors([anchor('foreign'), anchor('continue'), anchor('empty'), anchor('old'), anchor('old'), anchor('new')], rounds), [anchor('old'), anchor('new')]);
});
test('foundation is loaded before the first seat, without extra model calls or mutating attachments', () => {
  const rounds = [round('old', 'The original requirement is offline operation.'), round('middle', 'Next topic'), round('recent', 'Make it faster'), round('latest', 'Can it be smaller?')];
  rounds[0].attachments = [{ filename: 'diagram.png', url: 'https://example.com/diagram.png' }];
  const before = structuredClone(rounds); const ledger = [];
  evidence.seedConversationSourceAnchors({ anchors: [anchor('old'), anchor('latest')], allRounds: rounds, ledger, createEvidenceId: () => 'mem_1' });
  assert.equal(ledger.length, 1);
  assert.equal(ledger[0].speaker, 'user');
  assert.match(evidence.formatSharedAgenticEvidenceForPrompt(ledger), /offline operation/);
  assert.deepEqual(rounds, before);
});

const body = anchors => ({ ongoing_task: ['Develop the project'], standing_instructions: [], durable_decisions: [], active_threads: ['Project'], open_questions: [], retrieval_cues: [], source_anchors: anchors });
function workingFixture(initial, generated, rounds) {
  const requests = [], writes = [];
  let stored = initial;
  return { requests, writes, options: { discussionId: 'discussion', allRounds: rounds,
    supabase: { from(table) {
      assert.equal(table, 'discussions');
      return { select() { return this; }, update(value) { writes.push(value); stored = value.summary; return this; }, eq() { return this; }, async single() { return { data: { summary: stored }, error: null }; } };
    } },
    openai: { chat: { completions: { async create(request) { requests.push(request); return { choices: [{ message: { content: JSON.stringify(generated) } }], usage: { prompt_tokens: 100, completion_tokens: 50, cost: 0.0001 } }; } } } },
  } };
}
test('old working context upgrades once in the existing summary, then does not call again until due', async () => {
  const rounds = [round('first', 'Foundation'), round('second', 'Continue')];
  const initial = JSON.stringify({ _memory_type: 'working_context_v8', working_context: { ...body([]), _meta: { version: 8, processed_rounds_count: 2, last_processed_user_message_id: 'second' } } });
  const f = workingFixture(initial, body([anchor('first'), anchor('foreign')]), rounds);
  const result = await working.getOrRefreshConversationWorkingContext(f.options);
  assert.equal(result.refreshReason, 'upgrade_source_anchors');
  assert.deepEqual(result.context.source_anchors, [anchor('first')]);
  assert.match(f.requests[0].messages[1].content, /source_user_message_id=first/);
  const second = await working.getOrRefreshConversationWorkingContext(f.options);
  assert.equal(second.refreshReason, 'none');
  assert.equal(f.requests.length, 1); assert.equal(f.writes.length, 1);
});
test('incremental refresh can replace a superseded source and remove all anchors on topic change', async () => {
  const initial = JSON.stringify({ _memory_type: 'working_context_v8', working_context: { ...body([anchor('first')]), _meta: { version: 8, continuity_version: 1, processed_rounds_count: 2, last_processed_user_message_id: 'second' } } });
  for (const anchors of [[anchor('revision')], []]) {
    const rounds = [round('first', 'Original'), round('second', 'More'), round('revision', 'Replace the old requirement.'), round('next', 'Use the revision')];
    const f = workingFixture(initial, body(anchors), rounds);
    const result = await working.getOrRefreshConversationWorkingContext(f.options);
    assert.equal(result.refreshReason, 'incremental');
    assert.deepEqual(result.context.source_anchors, anchors);
    assert.equal(f.requests.length, 1);
  }
});
test('failed memory refresh retains the prior valid state instead of erasing it', async () => {
  const initial = JSON.stringify({ _memory_type: 'working_context_v8', working_context: { ...body([anchor('first')]), _meta: { version: 8, processed_rounds_count: 2 } } });
  const f = workingFixture(initial, { broken: true }, [round('first', 'Foundation'), round('second', 'More')]);
  const result = await working.getOrRefreshConversationWorkingContext(f.options);
  assert.deepEqual(result.context.source_anchors, [anchor('first')]);
  assert.equal(result.refreshed, false); assert.equal(f.writes.length, 0);
});
