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

test('abort during storage fetch stops before inference and does not trigger URL fallback', async () => {
  const controller = new AbortController();
  let inference = 0;
  const h = harness({ fetchImpl: async (url, init) => {
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
