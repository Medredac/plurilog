const { test } = require('node:test');
const assert = require('node:assert/strict');
const fs = require('node:fs');
const ts = require('typescript');
const Module = require('node:module');
const path = require('node:path');
const OpenAI = require('openai');

const filename = path.resolve('src/utils/requestFileTransport.ts');
const compiled = ts.transpileModule(fs.readFileSync(filename, 'utf8'), {
  compilerOptions: { module: ts.ModuleKind.CommonJS, target: ts.ScriptTarget.ES2022 },
}).outputText;
const mod = new Module(filename, module);
mod.filename = filename;
mod.paths = module.paths;
mod._compile(compiled, filename);
const { createRequestFileTransport } = mod.exports;
const memoryPath = path.resolve('src/utils/discussionMemory.ts');
const memoryModule = new Module(memoryPath, module);
memoryModule.filename = memoryPath;
memoryModule.paths = module.paths;
const textPath = path.resolve('src/utils/textFileParser.ts');
const textModule = new Module(textPath, module);
textModule.filename = textPath;
textModule.paths = module.paths;
textModule._compile(ts.transpileModule(fs.readFileSync(textPath, 'utf8'), {
  compilerOptions: { module: ts.ModuleKind.CommonJS, target: ts.ScriptTarget.ES2022, esModuleInterop: true },
}).outputText, textPath);
memoryModule.require = (name) => name === '@/utils/supabase/service'
  ? { createServiceClient() { throw new Error('Test must use injected client'); } }
  : name === './textFileParser' ? textModule.exports
  : require(name);
memoryModule._compile(ts.transpileModule(fs.readFileSync(memoryPath, 'utf8'), {
  compilerOptions: { module: ts.ModuleKind.CommonJS, target: ts.ScriptTarget.ES2022, esModuleInterop: true },
}).outputText, memoryPath);
const { ingestDiscussionDocuments, ingestDiscussionArtifacts } = memoryModule.exports;
const brokerPath = path.resolve('src/utils/resourceBroker.ts');
const brokerModule = new Module(brokerPath, module);
brokerModule.filename = brokerPath;
brokerModule.paths = module.paths;
brokerModule.require = name => name === '@/utils/discussionMemory' ? memoryModule.exports : require(name);
brokerModule._compile(ts.transpileModule(fs.readFileSync(brokerPath, 'utf8'), {
  compilerOptions: { module: ts.ModuleKind.CommonJS, target: ts.ScriptTarget.ES2022, esModuleInterop: true },
}).outputText, brokerPath);
const origin = 'https://test-project.supabase.co';
const pdfUrl = `${origin}/storage/v1/object/sign/message-images/user/original.pdf?token=private`;
const imageUrl = `${origin}/storage/v1/object/sign/message-images/user/photo.png?token=private`;
const apiUrl = 'https://openrouter.ai/api/v1/chat/completions';
const pdf = Buffer.from('%PDF-1.7\nOriginal document: café, chart and photograph\n%%EOF');
const png = Buffer.from('89504e470d0a1a0a0102030405060708', 'hex');
const filePart = (url = pdfUrl) => ({ type: 'file', file: { filename: 'original.pdf', file_data: url } });
const imagePart = (url = imageUrl) => ({ type: 'image_url', image_url: { url, detail: 'high' } });
const body = (parts = [filePart()]) => ({ model: 'model-primary', models: ['model-primary', 'model-fallback'], stream: true, tools: [{ type: 'openrouter:web_search' }], messages: [{ role: 'user', content: [{ type: 'text', text: 'Inspect every page.' }, ...parts] }] });
const response = () => new Response('data: {"id":"test","choices":[{"delta":{"content":"OK"},"index":0}]}\n\ndata: [DONE]\n\n', { headers: { 'content-type': 'text/event-stream' } });
function harness(options = {}) {
  const downloads = [], requests = [], diagnostics = [];
  const transport = createRequestFileTransport({
    supabaseUrl: origin,
    onDiagnostic: (event) => diagnostics.push(event),
    fetchImpl: async (url, init) => {
      if (String(url) === apiUrl) { requests.push({ payload: JSON.parse(init.body), init }); return response(); }
      downloads.push({ url, init });
      const bytes = String(url).includes('.png') ? png : pdf;
      return new Response(bytes, { headers: { 'content-type': String(url).includes('.png') ? 'image/png' : 'application/pdf', 'content-length': String(bytes.length) } });
    },
    ...options,
  });
  const send = (payload = body(), signal) => transport.fetch(apiUrl, { method: 'POST', headers: { authorization: 'Bearer MODEL_SECRET' }, body: JSON.stringify(payload), signal });
  return { transport, downloads, requests, diagnostics, send };
}

test('three seats and eighteen continuations download once; PDF and image bytes are exact', async () => {
  const h = harness();
  const original = body([filePart(), imagePart()]);
  const snapshot = JSON.stringify(original);
  for (let i = 0; i < 21; i++) await h.send(original);
  assert.equal(h.downloads.length, 2);
  assert.equal(JSON.stringify(original), snapshot);
  for (const req of h.requests) {
    const parts = req.payload.messages[0].content;
    assert.deepEqual(Buffer.from(parts[1].file.file_data.split(',')[1], 'base64'), pdf);
    assert.deepEqual(Buffer.from(parts[2].image_url.url.split(',')[1], 'base64'), png);
    assert.equal(parts[2].image_url.detail, 'high');
    assert.deepEqual(req.payload.models, original.models);
    assert.deepEqual(req.payload.tools, original.tools);
    assert.deepEqual(parts[0], original.messages[0].content[0]);
  }
  assert.ok(h.downloads.every(d => !d.init.headers && d.init.redirect === 'error' && d.init.credentials === 'omit'));
  assert.ok(!JSON.stringify(h.diagnostics).includes('private'));
});

test('historical evidence and refreshed signatures reuse bytes; simultaneous requests coalesce', async () => {
  const h = harness();
  await Promise.all([h.send(), h.send(body([filePart(pdfUrl.replace('private', 'refreshed'))]))]);
  assert.equal(h.downloads.length, 1);
  assert.equal(h.requests.length, 2);
});

test('one seat timing out cannot cancel another seat reading the same historical file', async () => {
  const firstSeat = new AbortController();
  let releaseDownload, storageSignal, downloads = 0;
  const h = harness({ fetchImpl: async (url, init) => {
    if (url === apiUrl) return response();
    downloads++;
    storageSignal = init.signal;
    return new Promise((resolve, reject) => {
      releaseDownload = () => resolve(new Response(pdf));
      init.signal.addEventListener('abort', () => reject(init.signal.reason), { once: true });
    });
  } });
  const first = h.transport.read(pdfUrl, firstSeat.signal);
  const firstStopped = assert.rejects(first, /seat timed out/);
  const other = h.transport.read(pdfUrl.replace('private', 'refreshed'));
  const otherCompleted = other.then(result => ({ result }), error => ({ error }));
  firstSeat.abort(new Error('seat timed out'));
  await firstStopped;
  releaseDownload();
  const outcome = await otherCompleted;
  assert.equal(outcome.error, undefined);
  assert.deepEqual(outcome.result.bytes, pdf);
  assert.equal(storageSignal.aborted, false);
  assert.equal(downloads, 1);
  // End-of-turn memory indexing can still reuse the successfully fetched bytes.
  assert.deepEqual((await h.transport.read(pdfUrl)).bytes, pdf);
});

test('a cancelled cache waiter stops promptly without aborting the active reader', async () => {
  const waiter = new AbortController();
  let releaseDownload;
  const h = harness({ fetchImpl: async () => new Promise(resolve => {
    releaseDownload = () => resolve(new Response(pdf));
  }) });
  const active = h.transport.read(pdfUrl);
  const stopped = assert.rejects(h.transport.read(pdfUrl, waiter.signal), /waiter stopped/);
  waiter.abort(new Error('waiter stopped'));
  await stopped;
  releaseDownload();
  assert.deepEqual((await active).bytes, pdf);
});

test('already downloaded extraction bytes are reused without any additional storage GET', async () => {
  const h = harness();
  h.transport.remember(pdfUrl, pdf);
  await h.send();
  const read = await h.transport.read(pdfUrl);
  assert.equal(h.downloads.length, 0);
  assert.deepEqual(read.bytes, pdf);
});

test('separate turns/users do not share the private cache', async () => {
  const a = harness(), b = harness();
  await a.send(); await b.send();
  assert.equal(a.downloads.length, 1);
  assert.equal(b.downloads.length, 1);
});

test('foreign URLs, transformed URLs, unrelated buckets and existing data URLs are untouched', async () => {
  const h = harness();
  const urls = [pdfUrl.replace('test-project', 'other-project'), pdfUrl.replace('/message-images/', '/private/'), pdfUrl + '&width=100', 'data:application/pdf;base64,eA==', 'http://127.0.0.1/test.pdf'];
  const payload = body(urls.map(filePart));
  await h.send(payload);
  assert.equal(h.downloads.length, 0);
  assert.deepEqual(h.requests[0].payload, payload);
});

test('oversize downloads and payloads keep the full original URL without truncation', async () => {
  for (const options of [{ maxFileBytes: 8 }, { maxCacheBytes: 8 }, { maxBodyBytes: 8 }]) {
    const h = harness(options);
    await h.send();
    assert.deepEqual(h.requests[0].payload, body());
  }
});

test('concurrent different downloads respect the combined memory cap', async () => {
  const h = harness({ maxCacheBytes: pdf.length, maxFileBytes: pdf.length });
  await Promise.all([h.send(), h.send(body([filePart(pdfUrl.replace('original.pdf', 'other.pdf'))]))]);
  assert.equal(h.downloads.length, 1);
  assert.ok(h.diagnostics.every(e => e.retainedBytes <= pdf.length));
});

test('chunked responses cannot exceed the cap even without content-length', async () => {
  let calls = 0, delivered;
  const h = harness({ maxFileBytes: 8, fetchImpl: async (url, init) => {
    if (url === apiUrl) { delivered = JSON.parse(init.body); return response(); }
    calls++;
    return new Response(new ReadableStream({ start(c) { c.enqueue(pdf.subarray(0, 6)); c.enqueue(pdf.subarray(6)); c.close(); } }));
  } });
  await h.send(); await h.send();
  assert.equal(calls, 1);
  assert.deepEqual(delivered, body());
});

test('failed/expired downloads retain attachments and are not repeatedly fetched', async () => {
  let calls = 0, delivered;
  const h = harness({ fetchImpl: async (url, init) => {
    if (url === apiUrl) { delivered = JSON.parse(init.body); return response(); }
    calls++; return new Response('expired', { status: 403 });
  } });
  await h.send(); await h.send();
  assert.equal(calls, 1);
  assert.deepEqual(delivered, body());
});

test('wrong MIME types cannot be sent as a PDF', async () => {
  let delivered;
  const h = harness({ fetchImpl: async (url, init) => {
    if (url === apiUrl) { delivered = JSON.parse(init.body); return response(); }
    return new Response('<html>login</html>', { headers: { 'content-type': 'text/html' } });
  } });
  await h.send(); assert.deepEqual(delivered, body());
});

test('whole-request abort stops the shared storage fetch before inference without URL fallback', async () => {
  const controller = new AbortController();
  let inference = 0;
  const h = harness({ requestSignal: controller.signal, fetchImpl: async (url, init) => {
    if (url === apiUrl) { inference++; return response(); }
    return new Promise((resolve, reject) => { init.signal.addEventListener('abort', () => reject(init.signal.reason), { once: true }); controller.abort(); });
  } });
  await assert.rejects(h.send(body(), controller.signal));
  assert.equal(inference, 0);
});

test('SDK streaming calls use the real request signal and preserve stream output', async () => {
  const h = harness();
  const client = new OpenAI({ apiKey: 'test', baseURL: 'https://openrouter.ai/api/v1', fetch: h.transport.fetch, maxRetries: 0 });
  const stream = await client.chat.completions.create(body(), { signal: new AbortController().signal });
  let text = '';
  for await (const chunk of stream) text += chunk.choices[0].delta.content || '';
  assert.equal(text, 'OK');
  assert.equal(h.requests[0].payload.signal, undefined);
  assert.ok(h.requests[0].init.signal instanceof AbortSignal);
});

test('SDK abort propagates to a stalled model connection', async () => {
  const controller = new AbortController();
  let actualSignal;
  const h = harness({ fetchImpl: async (url, init) => {
    assert.equal(url, apiUrl);
    actualSignal = init.signal;
    return new Promise((resolve, reject) => { init.signal.addEventListener('abort', () => reject(init.signal.reason), { once: true }); controller.abort(); });
  } });
  const client = new OpenAI({ apiKey: 'test', baseURL: 'https://openrouter.ai/api/v1', fetch: h.transport.fetch, maxRetries: 0 });
  await assert.rejects(client.chat.completions.create(body([]), { signal: controller.signal }));
  assert.equal(actualSignal.aborted, true);
});

test('input-size rejection retries original URL once and keeps later calls compatible', async () => {
  const sent = []; let downloads = 0;
  const h = harness({ fetchImpl: async (url, init) => {
    if (url !== apiUrl) { downloads++; return new Response(pdf); }
    sent.push(JSON.parse(init.body));
    return sent.length === 1 ? new Response('payload too large', { status: 413 }) : response();
  } });
  await h.send(); await h.send();
  assert.equal(sent.length, 3);
  assert.match(sent[0].messages[0].content[1].file.file_data, /^data:/);
  assert.deepEqual(sent[1], body()); assert.deepEqual(sent[2], body());
  assert.equal(downloads, 1);
});

test('provider/server-tool errors and successful streams are never silently replayed', async () => {
  for (const status of [200, 400, 429, 500, 504]) {
    let modelCalls = 0;
    const h = harness({ fetchImpl: async (url) => {
      if (url !== apiUrl) return new Response(pdf);
      modelCalls++;
      return new Response('Server tool failed', { status, headers: { 'content-type': status === 200 ? 'text/event-stream' : 'application/json' } });
    } });
    await h.send(); assert.equal(modelCalls, 1);
  }
});

test('text-only, DOCX and image-generation requests preserve their previous behavior', async () => {
  const h = harness();
  for (const payload of [body([]), body([filePart(pdfUrl.replace('.pdf', '.docx'))]), { ...body([imagePart()]), modalities: ['image', 'text'] }]) {
    await h.send(payload);
    assert.deepEqual(h.requests.at(-1).payload, payload);
  }
  assert.equal(h.downloads.length, 0);
});

test('36.4 MB original is eligible and is fetched once across all seats', async () => {
  const large = Buffer.alloc(36_408_850, 65); pdf.copy(large);
  let downloads = 0, calls = 0;
  const h = harness({ fetchImpl: async (url, init) => {
    if (url !== apiUrl) { downloads++; return new Response(large, { headers: { 'content-length': String(large.length) } }); }
    calls++;
    const data = JSON.parse(init.body).messages[0].content[1].file.file_data;
    assert.deepEqual(Buffer.from(data.split(',')[1], 'base64'), large);
    return response();
  } });
  await h.send(); await h.send(); await h.send();
  assert.equal(downloads, 1); assert.equal(calls, 3);
});

test('route integration keeps signals outside model JSON and assets outside ordinary model attachments', () => {
  for (const file of ['src/app/api/debate/route.ts', 'src/app/api/index-turn-documents/route.ts']) {
    const source = fs.readFileSync(file, 'utf8');
    const ast = ts.createSourceFile(file, source, ts.ScriptTarget.Latest, true);
    let checked = 0;
    function visit(node) {
      if (ts.isCallExpression(node) && /openai\.chat\.completions\.create/.test(node.expression.getText(ast))) {
        const arg = node.arguments[0];
        if (arg && ts.isObjectLiteralExpression(arg)) {
          assert.ok(!arg.properties.some(p => p.name?.getText(ast) === 'signal'), `${file}: signal in request body`);
          checked++;
        }
      }
      ts.forEachChild(node, visit);
    }
    visit(ast); assert.ok(checked > 0);
  }
  const source = fs.readFileSync('src/app/api/debate/route.ts', 'utf8');
  const userAttachments = source.slice(source.indexOf('const userAttachments:'), source.indexOf('const effectiveAttachments:'));
  assert.ok(!userAttachments.includes('...pdfEmbeddedImageAttachments'));
  assert.ok(source.includes('[...(currentRoundAttachments || []), ...pdfEmbeddedImageAttachments]'));
  assert.ok(source.includes('[...(evidenceAttachments || []), ...pdfEmbeddedImageAttachments]'));
});

function storageAndDatabase(bytes) {
  const observed = { downloads: 0, hashes: [], sources: [] };
  const client = {
    storage: { from() { return { async download() { observed.downloads++; return { data: new Blob([bytes]), error: null }; } }; } },
    from(table) {
      const q = {
        select() { return q; },
        eq(field, value) { if (field === 'file_hash') observed.hashes.push(value); return q; },
        update() { return q; },
        upsert(value) { observed.sources.push({ table, value }); return q; },
        maybeSingle() { return Promise.resolve({ data: { id: table === 'discussion_artifact_sources' ? 'source-id' : 'canonical-id', storage_path: 'user/original.pdf', full_text: 'Canonical text' }, error: null }); },
        then(resolve, reject) { return Promise.resolve({ count: 1, error: null }).then(resolve, reject); },
      };
      return q;
    },
  };
  return { client, observed };
}

test('document indexing hashes exact cached PDF bytes, preserves provenance, and avoids another GET', async () => {
  const { client, observed } = storageAndDatabase(pdf);
  const result = await ingestDiscussionDocuments({
    serviceSupabase: client, openai: {}, discussionId: 'test-discussion',
    sourceUserMessageId: 'test-message',
    attachments: [{ url: pdfUrl, filename: 'original.pdf' }],
    fileAnnotations: [{ type: 'file', file: { hash: 'parser-hash-must-not-be-used', name: 'original.pdf', content: [{ type: 'text', text: 'Canonical text from the original PDF.' }] } }],
    readFileBytes: async () => pdf,
    deferEmbedding: true,
  });
  assert.deepEqual(result.errors, []);
  assert.equal(observed.downloads, 0);
  assert.deepEqual(observed.hashes, [require('node:crypto').createHash('sha256').update(pdf).digest('hex')]);
  assert.ok(observed.sources.some(s => s.value.storage_path === 'user/original.pdf'));
});

test('artifact registration keeps original image hash, source identity, and full-array attachment index', async () => {
  for (const cached of [true, false]) {
    const { client, observed } = storageAndDatabase(png);
    const result = await ingestDiscussionArtifacts({
      serviceSupabase: client, discussionId: 'test-discussion', sourceUserMessageId: 'test-message',
      attachments: [{ url: pdfUrl, filename: 'original.pdf' }, { url: imageUrl, filename: 'exact portrait.png' }],
      readFileBytes: async () => cached ? png : null,
    });
    assert.deepEqual(result.errors, []);
    assert.equal(observed.downloads, cached ? 0 : 1);
    assert.deepEqual(observed.hashes, [require('node:crypto').createHash('sha256').update(png).digest('hex')]);
    const source = observed.sources.find(s => s.table === 'discussion_artifact_sources').value;
    assert.equal(source.attachment_index, 1);
    assert.equal(source.source_message_id, 'test-message');
    assert.equal(source.filename, 'exact portrait.png');
    assert.equal(source.storage_path, 'user/photo.png');
  }
});

// Stateful fake storage/DB: exercise canonical records and their aliases across
// multiple ingestion calls, rather than assuming an existing canonical row.
function memoryStore() {
  const tables = new Map(), files = new Map();
  let id = 0;
  const rows = table => { if (!tables.has(table)) tables.set(table, []); return tables.get(table); };
  const client = {
    storage: { from: () => ({ download: async key => ({ data: files.has(key) ? new Blob([files.get(key)]) : null, error: null }) }) },
    from(table) {
      let operation = 'select', value, conflicts = [], single = false;
      const filters = [];
      const execute = () => {
        const source = rows(table);
        let selected = source.filter(row => filters.every(f => f(row)));
        if (operation === 'insert' || operation === 'upsert') {
          const existing = operation === 'upsert' && source.find(row => conflicts.every(key => row[key] === value[key]));
          const item = existing || { id: `id-${++id}`, created_at: '2026-10-09T00:00:00Z' };
          Object.assign(item, value);
          if (!existing) source.push(item);
          selected = [item];
        } else if (operation === 'update') selected.forEach(row => Object.assign(row, value));
        return { data: single ? selected[0] || null : selected, count: selected.length, error: null };
      };
      const q = {
        select() { return q; },
        eq(key, value) { filters.push(row => row[key] === value); return q; },
        in(key, values) { filters.push(row => values.includes(row[key])); return q; },
        insert(input) { operation = 'insert'; value = input; return q; },
        update(input) { operation = 'update'; value = input; return q; },
        upsert(input, options) { operation = 'upsert'; value = input; conflicts = options.onConflict.split(','); return q; },
        single() { single = true; return Promise.resolve(execute()); },
        maybeSingle() { single = true; return Promise.resolve(execute()); },
        then(resolve, reject) { return Promise.resolve(execute()).then(resolve, reject); },
      };
      return q;
    },
  };
  return { client, rows, files };
}

test('cached PDFs preserve canonical identity, reupload aliases and discussion isolation', async () => {
  const db = memoryStore();
  const h = harness();
  const uploads = [
    ['discussion-a', 'user/original.pdf', pdf],
    ['discussion-a', 'user/reuploaded.pdf', pdf],
    ['discussion-a', 'user/changed.pdf', Buffer.concat([pdf, Buffer.from('changed')])],
    ['discussion-b', 'user/original.pdf', pdf],
  ];
  for (const [discussionId, storagePath, bytes] of uploads) {
    const url = `${origin}/storage/v1/object/sign/message-images/${storagePath}?token=fresh`;
    h.transport.remember(url, bytes);
    const result = await ingestDiscussionDocuments({
      serviceSupabase: db.client, openai: {}, discussionId, deferEmbedding: true,
      attachments: [{ url, filename: 'same-name.pdf' }],
      fileAnnotations: [{ type: 'file', file: { hash: 'provider-specific-hash', name: 'same-name.pdf', content: [{ type: 'text', text: 'Text from this original document.' }] } }],
      readFileBytes: async url => (await h.transport.read(url))?.bytes || null,
    });
    assert.equal(result.stagedCount, 1);
    assert.deepEqual(result.errors, []);
  }
  const documents = db.rows('discussion_documents'), sources = db.rows('discussion_document_sources');
  assert.equal(documents.length, 3);
  assert.equal(sources.length, 4);
  assert.equal(sources[0].document_id, sources[1].document_id);
  assert.notEqual(sources[0].document_id, sources[2].document_id);
  assert.notEqual(sources[0].document_id, sources[3].document_id);
  assert.equal(h.downloads.length, 0);
});

test('saved image memory remains retrievable with aliases, original ordering and discussion scope', async () => {
  const db = memoryStore();
  db.rows('messages').push({ id: 'upload', sender: 'user', created_at: '2026-10-09T00:00:00Z' });
  const h = harness();
  const secondUrl = imageUrl.replace('photo.png', 'another-photo.png');
  h.transport.remember(imageUrl, png); h.transport.remember(secondUrl, png);
  for (const discussionId of ['discussion-a', 'discussion-b']) {
    const result = await ingestDiscussionArtifacts({
      serviceSupabase: db.client, discussionId, sourceUserMessageId: 'upload',
      attachments: [{ url: pdfUrl, filename: 'source.pdf' }, { url: imageUrl, filename: 'robot.png' }, { url: secondUrl, filename: 'copy.png' }],
      readFileBytes: async url => (await h.transport.read(url))?.bytes || null,
    });
    assert.equal(result.ingestedCount, 2);
    assert.deepEqual(result.errors, []);
  }
  const sources = await memoryModule.exports.fetchKnownImageSources(db.client, 'discussion-a');
  assert.equal(sources.length, 2);
  assert.deepEqual(sources.map(source => source.attachmentIndex), [1, 2]);
  assert.deepEqual(sources.map(source => source.filename), ['robot.png', 'copy.png']);
  assert.equal(sources[0].artifactId, sources[1].artifactId);
  assert.ok(sources.every(source => source.discussionId === 'discussion-a' && source.sourceMessageId === 'upload' && source.sender === 'user'));
  assert.equal(db.rows('discussion_artifacts').length, 2);
});

test('ambiguous same-name PDFs still fail safe; unavailable cache falls back to authoritative storage', async () => {
  const db = memoryStore();
  db.files.set('user/original.pdf', pdf);
  const options = {
    serviceSupabase: db.client, openai: {}, discussionId: 'discussion-a', deferEmbedding: true,
    attachments: [{ url: pdfUrl, filename: 'same.pdf' }],
    fileAnnotations: [{ type: 'file', file: { hash: 'untrusted-provider-hash', name: 'same.pdf', content: [{ type: 'text', text: 'A document with durable source identity.' }] } }],
    readFileBytes: async () => null,
  };
  const result = await ingestDiscussionDocuments(options);
  assert.equal(result.stagedCount, 1);
  assert.equal(db.rows('discussion_documents')[0].file_hash, require('node:crypto').createHash('sha256').update(pdf).digest('hex'));
  const ambiguous = await ingestDiscussionDocuments({ ...options, attachments: [...options.attachments, { url: pdfUrl.replace('original.pdf', 'other.pdf'), filename: 'same.pdf' }] });
  assert.equal(ambiguous.skippedCount, 1);
  assert.equal(db.rows('discussion_documents').length, 1);
});

function loadDocumentImageResolver(brokerResult) {
  const filename = path.resolve('src/utils/gptDocumentCreation.ts');
  const loaded = new Module(filename, module);
  loaded.filename = filename;
  loaded.paths = module.paths;
  loaded.require = name => name === './pdfPhotoRebuild' ? { MAX_REBUILT_PHOTOS: 32 } : name === '@/utils/resourceBroker'
    ? { resolveRequestedEvidence: () => brokerResult }
    : name.startsWith('@/') ? {} : require(name);
  loaded._compile(ts.transpileModule(fs.readFileSync(filename, 'utf8') +
    '\nexport { resolveDocumentBlocks, downloadImageBytes };', {
    compilerOptions: { module: ts.ModuleKind.CommonJS, target: ts.ScriptTarget.ES2022, esModuleInterop: true },
  }).outputText, filename);
  return loaded.exports;
}

test('document image reuse rejects a PDF broker result and downloads the original extracted image', async () => {
  const { resolveDocumentBlocks } = loadDocumentImageResolver({
    status: 'resolved', evidence: { kind: 'pdf', filename: 'original.pdf', storagePath: 'user/original.pdf' },
  });
  const downloads = [];
  const client = { storage: { from: () => ({ download: async storagePath => {
    downloads.push(storagePath);
    return { data: new Blob([storagePath.endsWith('.pdf') ? pdf : png], { type: storagePath.endsWith('.pdf') ? 'application/pdf' : 'image/png' }), error: null };
  } }) } };
  const original = { filename: 'original embedded robot.png', storagePath: 'user/robot.png', artifactId: 'robot-id', sender: 'user' };
  const result = await resolveDocumentBlocks([
    { type: 'image', mode: 'existing', need: 'the exact original robot image from original.pdf' },
  ], client, [original], {}, undefined);
  assert.deepEqual(downloads, ['user/robot.png']);
  assert.deepEqual(result.blocks[0].imageData, png);
  assert.equal(result.imageBindings[0].source.artifactId, 'robot-id');
});

test('a genuine image broker result keeps its chosen source', async () => {
  const { resolveDocumentBlocks } = loadDocumentImageResolver({
    status: 'resolved', evidence: { kind: 'image', filename: 'chosen.png', storagePath: 'user/chosen.png' },
  });
  const client = { storage: { from: () => ({ download: async key => {
    assert.equal(key, 'user/chosen.png');
    return { data: new Blob([png], { type: 'image/png' }), error: null };
  } }) } };
  const result = await resolveDocumentBlocks([{ type: 'image', mode: 'existing', need: 'chosen image' }], client, [], {}, undefined);
  assert.deepEqual(result.blocks[0].imageData, png);
});

test('mislabelled PDF bytes cannot be embedded in a Word image slot', async () => {
  const { downloadImageBytes } = loadDocumentImageResolver({});
  const client = { storage: { from: () => ({ download: async () => ({ data: new Blob([pdf], { type: 'image/png' }), error: null }) }) } };
  await assert.rejects(downloadImageBytes(client, { filename: 'mislabelled.png', storagePath: 'user/mislabelled.png' }), /is a PDF/);
});

const parentHash = 'a'.repeat(64);
const originalEmbedded = { sourceId: 'original-source', artifactId: 'original-image', filename: 'source — embedded image 1.png', storagePath: `user/pdf-assets/${parentHash}/001-original.png`, sender: 'user', sourceMessageId: 'original-upload', attachmentIndex: 1, createdAt: '2026-10-08T01:00:00Z' };
const unrelatedPage = { ...originalEmbedded, sourceId: 'page-source', artifactId: 'page-image', filename: 'summary — rendered page 1.png', storagePath: `user/docx-pages/${'b'.repeat(64)}/page-001.png`, sourceMessageId: 'later-request', createdAt: '2026-10-09T01:00:00Z' };
const embeddedContext = {
  knownDocuments: [{ id: 'parent-doc', filename: 'source.pdf', fileHash: parentHash, storagePath: 'user/original.pdf' }],
  knownImageSources: [originalEmbedded, unrelatedPage],
  currentUserPrompt: 'Reopen the original robot illustration from my uploaded PDF as image evidence, not a rendered document page.',
};
const embeddedRequest = { modality: 'visual', resource_type: 'image', filename: 'source.pdf', need: 'Reopen the original robot illustration embedded in the uploaded PDF source.pdf as the actual stored image evidence, not a rendered page or prior description.' };

test('original embedded-image evidence resolves its parent bytes, never a later rendered page', () => {
  const result = brokerModule.exports.resolveRequestedEvidence(embeddedRequest, embeddedContext);
  assert.equal(result.status, 'resolved');
  assert.equal(result.evidence.kind, 'image');
  assert.equal(result.evidence.storagePath, originalEmbedded.storagePath);
});

test('embedded-image lookup preserves DOCX parents and ignores other owners or document hashes', () => {
  const docxImage = { ...originalEmbedded, storagePath: `user/docx-assets/${parentHash}/001-original.png` };
  const result = brokerModule.exports.resolveRequestedEvidence({ ...embeddedRequest, filename: 'source.docx', need: 'Inspect the original embedded logo in source.docx.' }, {
    ...embeddedContext, knownDocuments: [{ ...embeddedContext.knownDocuments[0], filename: 'source.docx', storagePath: 'user/source.docx' }],
    knownImageSources: [unrelatedPage, { ...docxImage, storagePath: `other-owner/docx-assets/${parentHash}/001-original.png` }, docxImage],
  });
  assert.equal(result.evidence.storagePath, docxImage.storagePath);
});

test('missing extracted images or legacy hash metadata reopen the actual parent document', () => {
  for (const context of [
    { ...embeddedContext, knownImageSources: [unrelatedPage] },
    { ...embeddedContext, knownDocuments: [{ ...embeddedContext.knownDocuments[0], fileHash: null }] },
  ]) {
    const result = brokerModule.exports.resolveRequestedEvidence(embeddedRequest, context);
    assert.equal(result.status, 'resolved');
    assert.equal(result.evidence.kind, 'pdf');
    assert.equal(result.evidence.storagePath, 'user/original.pdf');
  }
});

test('multiple original embedded images are ambiguous until a specific asset is named', () => {
  const second = { ...originalEmbedded, artifactId: 'second-image', sourceId: 'second-source', filename: 'source — embedded image 2.png', storagePath: `user/pdf-assets/${parentHash}/002-second.png` };
  const context = { ...embeddedContext, knownImageSources: [originalEmbedded, second, unrelatedPage] };
  const result = brokerModule.exports.resolveRequestedEvidence(embeddedRequest, context);
  assert.equal(result.status, 'ambiguous');
  assert.deepEqual(result.candidates.map(item => item.filename), [originalEmbedded.filename, second.filename]);
  const explicit = brokerModule.exports.resolveRequestedEvidence({ ...embeddedRequest, filename: second.filename }, context);
  assert.equal(explicit.evidence.storagePath, second.storagePath);
});

test('duplicate parent filenames do not select an arbitrary document', () => {
  const result = brokerModule.exports.resolveRequestedEvidence(embeddedRequest, {
    ...embeddedContext, knownDocuments: [...embeddedContext.knownDocuments, { id: 'other-doc', filename: 'source.pdf', fileHash: 'c'.repeat(64), storagePath: 'user/other.pdf' }],
  });
  assert.equal(result.status, 'ambiguous');
  assert.equal(result.evidence, undefined);
});

test('explicit rendered-page and ordinary image requests keep their original filename lookup', () => {
  for (const currentUserPrompt of [
    `Inspect ${unrelatedPage.filename}.`,
    `Inspect ${unrelatedPage.filename}, not the original embedded image in source.pdf.`,
  ]) {
    const result = brokerModule.exports.resolveRequestedEvidence({ modality: 'visual', resource_type: 'image', filename: unrelatedPage.filename, need: currentUserPrompt }, {
      ...embeddedContext, currentUserPrompt,
    });
    assert.equal(result.evidence.storagePath, unrelatedPage.storagePath);
  }
});
