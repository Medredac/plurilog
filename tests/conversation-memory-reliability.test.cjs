const { test } = require('node:test');
const assert = require('node:assert/strict');
const fs = require('node:fs');
const path = require('node:path');
const Module = require('node:module');
const ts = require('typescript');
function load(file) {
  const filename = path.resolve(file);
  const mod = new Module(filename, module);
  mod.filename = filename; mod.paths = module.paths;
  mod._compile(ts.transpileModule(fs.readFileSync(filename, 'utf8'), {
    compilerOptions: { module: ts.ModuleKind.CommonJS, target: ts.ScriptTarget.ES2022, esModuleInterop: true },
  }).outputText, filename);
  return mod.exports;
}
const { resolveAgenticConversationTool: resolve } = load('src/utils/agenticConversationMemory.ts');
const { completedRoundText, indexCompletedConversationRound: indexRound } = load('src/utils/completedConversationRound.ts');
const round = (i, content = 'Unrelated gardening advice.') => ({
  userMessageId: `source-${i}`, userPrompt: content,
  modelResponses: [{ name: 'ChatGPT', content: 'An unrelated response.' }],
});
function fixture(rounds, classify = candidates => candidates.filter(c => /LANTERN|portable illumination/.test(c.excerpt)).map(c => c.id)) {
  const calls = [];
  return {
    calls,
    options: {
      toolName: 'find_conversation_event', toolArgs: { mode: 'topic', query: 'LANTERN', occurrence: 'first' },
      discussionId: 'discussion-a', allRounds: rounds, ledger: [], requestedBySeatId: 'chatgpt',
      createEvidenceId: () => 'evidence-1',
      serviceSupabase: { rpc() { throw new Error('Chronology must not depend on top-ranked indexed results'); } },
      openai: {
        embeddings: { create() { throw new Error('No query embedding needed for ordered scan'); } },
        chat: { completions: { async create(request) {
          const { candidates } = JSON.parse(request.messages[1].content); calls.push(candidates);
          return { choices: [{ message: { content: JSON.stringify({ relevant_ids: classify(candidates) }) } }] };
        } } },
      },
    },
  };
}
test('first mention includes the weakly matched original omitted by a top-30 search', async () => {
  const rounds = Array.from({ length: 40 }, (_, i) => round(i, i === 0 ? 'We need portable illumination.' : i >= 5 ? 'LANTERN '.repeat(40) : 'Other topic'));
  const f = fixture(rounds); const out = await resolve(f.options);
  assert.equal(out.result.evidence.source_user_message_id, 'source-0');
  assert.equal(out.result.coverage.completeThroughOccurrence, true);
  assert.equal(f.calls.length, 1);
});
test('scans past the old top-30 cutoff and handles reversed classifier ordering', async () => {
  const rounds = Array.from({ length: 45 }, (_, i) => round(i, i >= 35 ? 'LANTERN' : 'Other topic'));
  const f = fixture(rounds, c => c.filter(x => x.excerpt.includes('LANTERN')).map(x => x.id).reverse());
  assert.equal((await resolve(f.options)).result.evidence.source_user_message_id, 'source-35');
  assert.equal(f.calls.length, 3);
});
test('last mention follows reverse chronology, including an unindexed Continue round', async () => {
  const rounds = [round(0, 'LANTERN'), round(1), round(2, 'Continue')];
  rounds[2].modelResponses = [{ name: 'Gemini', content: 'The LANTERN is rechargeable.' }];
  const f = fixture(rounds); f.options.toolArgs.occurrence = 'last';
  assert.equal((await resolve(f.options)).result.evidence.source_user_message_id, 'source-2');
});
test('speaker filtering does not attribute model ideas to the user or another model', async () => {
  const rounds = [round(0), round(1, 'LANTERN')];
  rounds[0].modelResponses = [{ name: 'Gemini', content: 'LANTERN' }];
  for (const [speaker, expected] of [['user', 'source-1'], ['gemini', 'source-0'], ['claude', null]]) {
    const f = fixture(rounds); f.options.toolArgs.speaker = speaker;
    assert.equal((await resolve(f.options)).result.evidence?.source_user_message_id || null, expected);
  }
});
test('a topic beyond the first 1000 characters and across excerpt boundaries is considered', async () => {
  for (const prefix of [1500, 2980, 7500]) {
    const f = fixture([round(0, 'a'.repeat(prefix) + ' portable illumination'), round(1, 'LANTERN')]);
    assert.equal((await resolve(f.options)).result.evidence.source_user_message_id, 'source-0');
  }
});
test('a single unrelated candidate is classified rather than automatically accepted', async () => {
  const f = fixture([round(0)]); const out = await resolve(f.options);
  assert.equal(out.result.evidence, null); assert.equal(out.result.ok, true);
  assert.equal(out.result.coverage.completeHistory, true); assert.equal(f.calls.length, 1);
});
test('classifier errors or invalid IDs fail closed instead of choosing a later occurrence', async () => {
  for (const classify of [() => { throw new Error('Provider unavailable'); }, () => ['0'], () => [99]]) {
    const out = await resolve(fixture([round(0, 'LANTERN')], classify).options);
    assert.equal(out.result.ok, false); assert.equal(out.result.evidence, null);
    assert.equal(out.result.error, 'chronology_qualification_failed');
  }
});
test('large history stops at a bounded cost and explicitly reports incomplete coverage', async () => {
  const f = fixture([round(0, 'a'.repeat(140000)), round(1, 'LANTERN')]);
  const out = await resolve(f.options);
  assert.equal(out.result.ok, false); assert.equal(out.result.error, 'chronology_scan_limit');
  assert.equal(out.result.evidence, null); assert.ok(out.result.coverage.checkedCharacters <= 120000);
  assert.ok(f.calls.length <= 8);
});
test('many short rounds also have a bounded number of classifier calls', async () => {
  const f = fixture(Array.from({ length: 200 }, (_, i) => round(i)));
  const out = await resolve(f.options);
  assert.equal(out.result.error, 'chronology_scan_limit'); assert.equal(f.calls.length, 8);
});
test('aborted lookups do not call a provider', async () => {
  const f = fixture([round(0, 'LANTERN')]); f.options.signal = AbortSignal.abort();
  assert.equal((await resolve(f.options)).result.error, 'request_aborted'); assert.equal(f.calls.length, 0);
});
test('explicit exclusions and deterministic speaker-boundary lookup remain respected', async () => {
  const f = fixture([round(0, 'LANTERN'), round(1, 'LANTERN')]);
  f.options.excludedSourceUserMessageIds = ['source-0'];
  assert.equal((await resolve(f.options)).result.evidence.source_user_message_id, 'source-1');
  f.options.toolArgs = { mode: 'speaker_boundary', occurrence: 'first', speaker: 'user' };
  f.calls.length = 0;
  assert.equal((await resolve(f.options)).result.evidence.source_user_message_id, 'source-1');
  assert.equal(f.calls.length, 0);
});
function indexingFixture() {
  const writes = [], embedded = [], filters = [];
  const f = {
    writes, embedded, filters, anchor: { id: 'continue-1', sender: 'user', content: 'Continue' },
    options: {
      discussionId: 'discussion-a', sourceUserMessageId: 'continue-1', isContinueRound: true, prompt: '',
      responses: [{ name: 'Gemini', response: 'The LANTERN battery lasts eight hours.' }],
      openai: { embeddings: { async create(request) { embedded.push(request.input); return { data: [{ embedding: Array(1536).fill(0.1) }] }; } } },
      supabase: { from(table) {
        if (table === 'messages') return {
          select() { return this; }, eq(key, value) { filters.push([key, value]); return this; },
          async single() { return { data: f.anchor, error: null }; },
        };
        assert.equal(table, 'discussion_memory_chunks');
        return { async upsert(value, options) { writes.push({ value, options }); return { error: null }; } };
      } },
    },
  };
  return f;
}
test('Continue embeds actual panel contributions under its own saved marker', async () => {
  const f = indexingFixture(); await indexRound(f.options);
  assert.equal(f.writes[0].value.source_user_message_id, 'continue-1');
  assert.equal(f.writes[0].value.discussion_id, 'discussion-a');
  assert.match(f.embedded[0], /no new user statement/); assert.match(f.embedded[0], /Gemini said/);
  assert.match(f.embedded[0], /LANTERN/); assert.doesNotMatch(f.embedded[0], /User said/);
  assert.deepEqual(f.filters, [['id', 'continue-1'], ['discussion_id', 'discussion-a']]);
});
test('successive Continue rounds have separate anchors and repeat indexing is idempotent', async () => {
  const f = indexingFixture(); await indexRound(f.options); await indexRound(f.options);
  f.options.sourceUserMessageId = 'continue-2'; f.anchor.id = 'continue-2'; await indexRound(f.options);
  assert.deepEqual(f.writes.map(w => w.value.source_user_message_id), ['continue-1', 'continue-1', 'continue-2']);
  assert.ok(f.writes.every(w => w.options.onConflict === 'discussion_id,source_user_message_id'));
});
test('normal prompt indexing preserves original speaker labels and content', async () => {
  const f = indexingFixture(); f.options.isContinueRound = false; f.options.prompt = 'Discuss battery life.';
  f.anchor.content = f.options.prompt; await indexRound(f.options);
  assert.equal(f.embedded[0], 'User said:\n"""\nDiscuss battery life.\n"""\n\nGemini said:\n"""\nThe LANTERN battery lasts eight hours.\n"""');
});
test('missing anchors, empty responses and aborted rounds cannot write memory', async () => {
  for (const patch of [{ sourceUserMessageId: null }, { responses: [] }, { responses: [{ name: 'Gemini', response: ' ' }] }, { signal: AbortSignal.abort() }]) {
    const f = indexingFixture(); Object.assign(f.options, patch); await indexRound(f.options);
    assert.equal(f.writes.length, 0); assert.equal(f.embedded.length, 0);
  }
  assert.equal(completedRoundText({ prompt: '', isContinueRound: false, responses: [{ name: 'Gemini', response: 'Text' }] }), null);
});
test('invalid, foreign or non-user anchors are rejected before embedding', async () => {
  for (const anchor of [null, { sender: 'Gemini', content: 'Continue' }, { sender: 'user', content: 'An older prompt' }]) {
    const f = indexingFixture(); f.anchor = anchor;
    await assert.rejects(indexRound(f.options), /anchor/); assert.equal(f.embedded.length, 0);
  }
});
test('invalid embeddings and database failures cannot report successful indexing', async () => {
  const f = indexingFixture(); f.options.openai.embeddings.create = async () => ({ data: [{ embedding: [1] }] });
  await assert.rejects(indexRound(f.options), /embedding/); assert.equal(f.writes.length, 0);
});
test('client sends the Continue marker separately and proactive chronology includes recent history', () => {
  const client = fs.readFileSync('src/app/dashboard/page.tsx', 'utf8');
  const route = fs.readFileSync('src/app/api/debate/route.ts', 'utf8');
  assert.match(client, /continueSourceUserMessageId: isContinueRound\s*\? continueMarker\?\.persistedMessageId/);
  assert.match(route, /sourceUserMessageId: isContinueRound\s*\? continueSourceUserMessageId\s*: sourceUserMessageId/);
  assert.match(route, /excludedSourceUserMessageIds: toolName === 'search_conversation_memory'/);
});
test('Continue memory is discoverable through the unchanged semantic search tool', async () => {
  const indexed = indexingFixture(); await indexRound(indexed.options);
  const f = fixture([{ userMessageId: 'continue-1', userPrompt: 'Continue', modelResponses: [{ name: 'Gemini', content: indexed.options.responses[0].response }] }]);
  f.options.toolName = 'search_conversation_memory'; f.options.toolArgs = { query: 'LANTERN battery life' };
  f.options.openai.embeddings.create = async () => ({ data: [{ embedding: Array(1536).fill(0.1) }] });
  f.options.serviceSupabase.rpc = async (name, args) => {
    assert.equal(name, 'search_discussion_memory_hybrid'); assert.equal(args.p_discussion_id, 'discussion-a');
    return { data: [{ ...indexed.writes[0].value, semantic_similarity: 0.9, hybrid_score: 1 }], error: null };
  };
  const out = await resolve(f.options);
  assert.equal(out.result.candidates[0].source_user_message_id, 'continue-1');
  assert.match(out.result.candidates[0].snippet, /Gemini said/);
});
test('aborting during an embedding prevents the memory write', async () => {
  const f = indexingFixture(), controller = new AbortController();
  f.options.signal = controller.signal;
  f.options.openai.embeddings.create = async () => { controller.abort(); return { data: [{ embedding: Array(1536).fill(0.1) }] }; };
  await indexRound(f.options); assert.equal(f.writes.length, 0);
});
test('database write failures propagate for existing route error reporting', async () => {
  const f = indexingFixture(), originalFrom = f.options.supabase.from;
  f.options.supabase.from = table => table === 'discussion_memory_chunks'
    ? { upsert: async () => ({ error: new Error('write failed') }) } : originalFrom(table);
  await assert.rejects(indexRound(f.options), /write failed/);
});
