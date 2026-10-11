const { test } = require('node:test');
const assert = require('node:assert/strict');
const fs = require('node:fs');
const path = require('node:path');
const Module = require('node:module');
const ts = require('typescript');
const cache = new Map();
function load(file) {
  const filename = path.resolve(file);
  if (cache.has(filename)) return cache.get(filename).exports;
  const mod = new Module(filename, module); mod.filename = filename; mod.paths = module.paths;
  const originalRequire = mod.require.bind(mod);
  mod.require = name => name.startsWith('.') && fs.existsSync(path.resolve(path.dirname(filename), name + '.ts'))
    ? load(path.resolve(path.dirname(filename), name + '.ts')) : originalRequire(name);
  cache.set(filename, mod);
  mod._compile(ts.transpileModule(fs.readFileSync(filename, 'utf8'), { compilerOptions: { module: ts.ModuleKind.CommonJS, target: ts.ScriptTarget.ES2022, esModuleInterop: true } }).outputText, filename);
  return mod.exports;
}
const { normalizeYouTubeUrl, extractYouTubeUrls, VIDEO_MAX_BYTES } = load('src/utils/videoInputs.ts');
const { createVideoInspectionSession, readVideoResponse, validateVideoBytes } = load('src/utils/videoInspection.ts');
const yt = 'https://www.youtube.com/watch?v=jNQXAC9IVRw';
const movie = Buffer.from('0000ftypisomtest');
const base = { userId: 'owner', prompt: '', rounds: [], currentAttachments: [], signal: new AbortController().signal, readUpload: async () => movie };
const request = { model: 'google/gemini-3.8-flash', messages: [{ role: 'user', content: 'What happened at 0:07?' }] };

test('normalizes watch/short/share/embed links without tracking or timestamp confusion', () => {
  for (const link of ['https://youtu.be/jNQXAC9IVRw?t=4', yt + '&t=7', 'https://m.youtube.com/shorts/jNQXAC9IVRw', 'https://www.youtube-nocookie.com/embed/jNQXAC9IVRw']) assert.equal(normalizeYouTubeUrl(link), yt);
  assert.deepEqual(extractYouTubeUrls(`See (${yt}). Also ${yt}`), [yt]);
});
test('rejects lookalike domains, credentials, arbitrary URLs and incomplete video IDs', () => {
  for (const link of ['https://youtube.com.evil.test/watch?v=jNQXAC9IVRw', 'https://evil@youtube.com/watch?v=jNQXAC9IVRw', 'http://127.0.0.1/video.mp4', 'https://youtube.com/watch', 'https://youtu.be/short']) assert.equal(normalizeYouTubeUrl(link), null);
});
test('a retrieved historical link can be opened and pinned to AI Studio', async () => {
  const session = createVideoInspectionSession({ ...base, rounds: [{ userMessageId: 'old', userPrompt: yt, modelResponses: [] }] });
  assert.equal((await session.inspect({ youtube_url: yt, question: 'What happens at 0:07?' })).result.ok, true);
  const prepared = session.prepareRequest(request);
  assert.equal(prepared.messages.at(-1).content[1].video_url.url, yt);
  assert.deepEqual(prepared.provider, { only: ['google-ai-studio'] });
  assert.equal(request.messages.length, 1);
});
test('an invented or unrelated link cannot be silently inspected', async () => {
  const session = createVideoInspectionSession(base);
  assert.equal((await session.inspect({ youtube_url: yt, question: 'Describe' })).result.ok, false);
  assert.equal(session.prepareRequest(request).messages.length, 1);
});
test('video continuations omit incompatible native search but retain memory and video tools', async () => {
  const session = createVideoInspectionSession({ ...base, prompt: yt });
  const tools = [{ type: 'openrouter:web_search' }, { type: 'function', function: { name: 'search_conversation_memory' } }, { type: 'function', function: { name: 'inspect_video' } }];
  assert.deepEqual(session.prepareRequest({ ...request, tools }).tools, tools);
  await session.inspect({ youtube_url: yt, question: 'Describe' });
  assert.deepEqual(session.prepareRequest({ ...request, tools }).tools, tools.slice(1));
  assert.equal(tools.length, 3);
});
test('first-turn upload is encoded as actual video data, never sent as a hosted URL', async () => {
  const session = createVideoInspectionSession({ ...base, currentAttachments: [{ filename: 'clip.mp4', url: '/api/attachments/message-images/owner/clip.mp4' }] });
  assert.equal((await session.inspect({ filename: 'clip.mp4', question: 'Transcribe' })).result.ok, true);
  assert.match(session.prepareRequest(request).messages.at(-1).content[1].video_url.url, /^data:video\/mp4;base64,/);
});
test('stored historical upload can be reopened, bytes reused within a seat', async () => {
  let reads = 0;
  const session = createVideoInspectionSession({ ...base, readUpload: async () => { reads++; return movie; }, rounds: [{ userMessageId: 'old', userPrompt: 'Video', modelResponses: [], attachments: [{ sender: 'user', filename: 'old.mp4', storagePath: 'owner/old.mp4' }] }] });
  for (const question of ['Describe', 'What happens at 0:04?']) assert.equal((await session.inspect({ filename: 'old.mp4', question })).result.ok, true);
  assert.equal(reads, 1);
});
test('duplicate filenames require a grounded message identity', async () => {
  const rounds = ['one', 'two'].map(id => ({ userMessageId: id, userPrompt: '', modelResponses: [], attachments: [{ filename: 'clip.mp4', storagePath: `owner/${id}.mp4` }] }));
  const session = createVideoInspectionSession({ ...base, rounds });
  assert.equal((await session.inspect({ filename: 'clip.mp4', question: 'Describe' })).result.ok, false);
  assert.equal((await session.inspect({ filename: 'clip.mp4', source_user_message_id: 'one', question: 'Describe' })).result.ok, true);
});
test('foreign and traversal storage paths are rejected before any read', async () => {
  for (const storagePath of ['other/clip.mp4', 'owner/../other.mp4', 'owner/a%2fb.mp4']) {
    const session = createVideoInspectionSession({ ...base, readUpload: async () => { throw new Error('SHOULD NOT READ'); }, rounds: [{ userPrompt: '', modelResponses: [], attachments: [{ filename: 'clip.mp4', storagePath }] }] });
    const result = (await session.inspect({ filename: 'clip.mp4', question: 'Describe' })).result;
    assert.equal(result.ok, false); assert.match(result.error, /not available to this account/);
  }
});
test('failure to open a second video does not leave the previous video attached', async () => {
  const session = createVideoInspectionSession({ ...base, prompt: yt });
  await session.inspect({ youtube_url: yt, question: 'Describe' });
  assert.equal((await session.inspect({ filename: 'missing.mp4', question: 'Describe' })).result.ok, false);
  assert.equal(session.prepareRequest(request).messages.length, 1);
});
test('oversize, corrupt and missing uploads produce explicit failures', async () => {
  assert.throws(() => validateVideoBytes(Buffer.alloc(VIDEO_MAX_BYTES + 1), 'clip.mp4'), /25 MB/);
  assert.throws(() => validateVideoBytes(Buffer.from('not a video'), 'clip.mp4'), /not a supported/);
  await assert.rejects(readVideoResponse(new Response('missing', { status: 404 })), /unavailable/);
  await assert.rejects(readVideoResponse(new Response('x', { headers: { 'content-length': String(VIDEO_MAX_BYTES + 1) } })), /25 MB/);
});
test('streamed oversized data is stopped even without a content-length header', async () => {
  const data = new ReadableStream({ start(c) { c.enqueue(new Uint8Array(VIDEO_MAX_BYTES)); c.enqueue(new Uint8Array(1)); c.close(); } });
  await assert.rejects(readVideoResponse(new Response(data)), /25 MB/);
});
test('cancellation propagates instead of becoming a successful inspection', async () => {
  const controller = new AbortController(); controller.abort(new Error('cancelled'));
  const session = createVideoInspectionSession({ ...base, signal: controller.signal, prompt: yt });
  await assert.rejects(session.inspect({ youtube_url: yt, question: 'Describe' }), /cancelled/);
});
test('opaque reasoning blocks survive tool continuation and stay seat-local', async () => {
  const session = createVideoInspectionSession(base);
  const create = async () => (async function* () {
    yield { choices: [{ delta: { reasoning_details: [{ type: 'reasoning.encrypted', index: 0, data: 'abc' }], tool_calls: [{ index: 0, id: 'call-1' }] } }] };
    yield { choices: [{ delta: { reasoning_details: [{ type: 'reasoning.encrypted', index: 0, data: 'def' }] } }] };
  })();
  const stream = await session.createCompletion(create, request, {});
  for await (const _ of stream) {}
  const followup = { ...request, messages: [{ role: 'assistant', tool_calls: [{ id: 'call-1' }] }] };
  assert.equal(session.prepareRequest(followup).messages[0].reasoning_details[0].data, 'abcdef');
  assert.equal(createVideoInspectionSession(base).prepareRequest(followup).messages[0].reasoning_details, undefined);
});
test('video evidence survives later memory and artifact continuation request assembly', async () => {
  const session = createVideoInspectionSession({ ...base, prompt: yt });
  await session.inspect({ youtube_url: yt, question: 'Inspect 0:07' });
  for (const tool of ['search_conversation_memory', 'request_evidence']) {
    const body = session.prepareRequest({ ...request, messages: [...request.messages, { role: 'tool', name: tool, content: 'new evidence' }] });
    assert.equal(body.messages.at(-1).content[1].type, 'video_url');
    assert.equal(body.messages.at(-2).name, tool);
  }
});

test('provider rejection becomes an explicit video failure, never a successful inspection', async () => {
  const session = createVideoInspectionSession({ ...base, prompt: yt });
  await session.inspect({ youtube_url: yt, question: 'Inspect' });
  await assert.rejects(session.createCompletion(async () => { throw { status: 429 }; }, request, {}), error => error.videoInspectionFailure === true && /temporarily unavailable/.test(error.message));
});

test('MOV uploads use the provider-documented MIME type', async () => {
  const session = createVideoInspectionSession({ ...base, currentAttachments: [{ filename: 'clip.mov', url: '/api/attachments/message-images/owner/clip.mov' }] });
  await session.inspect({ filename: 'clip.mov', question: 'Inspect' });
  assert.match(session.prepareRequest(request).messages.at(-1).content[1].video_url.url, /^data:video\/mov;base64,/);
});

test('a provider failure during streaming is visible as a failed video inspection', async () => {
  const session = createVideoInspectionSession({ ...base, prompt: yt });
  await session.inspect({ youtube_url: yt, question: 'Inspect' });
  const stream = await session.createCompletion(async () => (async function* () {
    throw Object.assign(new Error('Unavailable'), { status: 503 });
  })(), request, {});
  await assert.rejects(async () => { for await (const _ of stream) {} }, error => error.videoInspectionFailure === true);
});
