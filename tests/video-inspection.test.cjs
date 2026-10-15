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
const { normalizeYouTubeUrl, extractYouTubeUrls, VIDEO_INLINE_MAX_BYTES, VIDEO_MAX_BYTES, validateVideoSelection, validateVideoRange } = load('src/utils/videoInputs.ts');
const { createVideoInspectionSession, inspectVideoWithModel, readVideoResponse, validateVideoBytes } = load('src/utils/videoInspection.ts');
const yt = 'https://www.youtube.com/watch?v=jNQXAC9IVRw';
const movie = Buffer.from('0000ftypisomtest');
const base = { userId: 'owner', prompt: '', rounds: [], currentAttachments: [], signal: new AbortController().signal, readUpload: async () => movie, analyze: async () => ({ findings: 'A person stands near elephants.', model: request.model }) };
const request = { model: 'google/gemini-3.8-flash', messages: [{ role: 'user', content: 'What happened at 0:07?' }] };

test('normalizes watch/short/share/embed links without tracking or timestamp confusion', () => {
  for (const link of ['https://youtu.be/jNQXAC9IVRw?t=4', yt + '&t=7', 'https://m.youtube.com/shorts/jNQXAC9IVRw', 'https://www.youtube-nocookie.com/embed/jNQXAC9IVRw']) assert.equal(normalizeYouTubeUrl(link), yt);
  assert.deepEqual(extractYouTubeUrls(`See (${yt}). Also ${yt}`), [yt]);
});
test('rejects lookalike domains, credentials, arbitrary URLs and incomplete video IDs', () => {
  for (const link of ['https://youtube.com.evil.test/watch?v=jNQXAC9IVRw', 'https://evil@youtube.com/watch?v=jNQXAC9IVRw', 'http://127.0.0.1/video.mp4', 'https://youtube.com/watch', 'https://youtu.be/short']) assert.equal(normalizeYouTubeUrl(link), null);
});
test('a historical YouTube link is actually analyzed before success is returned', async () => {
  let source;
  const session = createVideoInspectionSession({ ...base, rounds: [{ userMessageId: 'old', userPrompt: yt, modelResponses: [] }], analyze: async video => { source = video; return base.analyze(); } });
  const result = (await session.inspect({ youtube_url: yt, question: 'What happens at 0:07?' })).result;
  assert.equal(source.url, yt); assert.equal(result.status, 'inspected');
  assert.match(result.findings, /elephants/);
});
test('an invented or unrelated link cannot be silently inspected', async () => {
  const session = createVideoInspectionSession({ ...base, analyze: async () => { throw new Error('SHOULD NOT CALL'); } });
  assert.equal((await session.inspect({ youtube_url: yt, question: 'Describe' })).result.ok, false);
});
test('first-turn upload sends actual video bytes to inspection', async () => {
  let source;
  const session = createVideoInspectionSession({ ...base, currentAttachments: [{ filename: 'clip.mp4', url: '/api/attachments/message-images/owner/clip.mp4' }], analyze: async video => { source = video; return base.analyze(); } });
  assert.equal((await session.inspect({ filename: 'clip.mp4', question: 'Transcribe' })).result.ok, true);
  assert.match(source.url, /^data:video\/mp4;base64,/);
});
test('historical uploads cannot be reopened or downloaded', async () => {
  let reads = 0;
  const session = createVideoInspectionSession({ ...base, readUpload: async () => { reads++; return movie; }, rounds: [{ userMessageId: 'old', userPrompt: 'Video', modelResponses: [], attachments: [{ sender: 'user', filename: 'old.mp4', storagePath: 'owner/old.mp4' }] }] });
  const result = (await session.inspect({ filename: 'old.mp4', question: 'What happens at 0:04?' })).result;
  assert.equal(result.ok, false); assert.match(result.error, /fresh upload/); assert.equal(reads, 0);
});
test('concurrent and repeated calls inspect a current upload once and return original findings', async () => {
  let reads = 0, analyses = 0;
  const session = createVideoInspectionSession({ ...base,
    currentAttachments: [{ filename: 'clip.mp4', url: '/api/attachments/message-images/owner/clip.mp4' }],
    readUpload: async () => { reads++; return movie; },
    analyze: async () => { analyses++; return base.analyze(); },
  });
  const results = await Promise.all(['Describe', 'At 0:04?', 'At 0:07?'].map(question => session.inspect({ filename: 'clip.mp4', question })));
  assert.equal(reads, 1); assert.equal(analyses, 1);
  assert.equal(results[0].result.status, 'inspected'); assert.equal(results[1].result.status, 'already_inspected');
  assert.equal(results[2].result.question, 'Describe');
});
test('failed inspections do not start a repeated download loop', async () => {
  let reads = 0;
  const session = createVideoInspectionSession({ ...base,
    currentAttachments: [{ filename: 'clip.mp4', url: '/api/attachments/message-images/owner/clip.mp4' }],
    inspectUpload: async () => { reads++; throw new Error('Provider unavailable'); },
  });
  for (let i = 0; i < 3; i++) assert.equal((await session.inspect({ filename: 'clip.mp4', question: 'Describe' })).result.ok, false);
  assert.equal(reads, 1);
});
test('foreign and traversal storage paths are rejected before any read', async () => {
  for (const storagePath of ['other/clip.mp4', 'owner/../other.mp4', 'owner/a%252fb.mp4']) {
    const session = createVideoInspectionSession({ ...base, readUpload: async () => { throw new Error('SHOULD NOT READ'); }, currentAttachments: [{ filename: 'clip.mp4', url: '/api/attachments/message-images/' + storagePath }] });
    const result = (await session.inspect({ filename: 'clip.mp4', question: 'Describe' })).result;
    assert.equal(result.ok, false); assert.match(result.error, /not available to this account/);
  }
});
test('failure to open a second video does not leave the previous video attached', async () => {
  const session = createVideoInspectionSession({ ...base, prompt: yt });
  await session.inspect({ youtube_url: yt, question: 'Describe' });
  assert.equal((await session.inspect({ filename: 'missing.mp4', question: 'Describe' })).result.ok, false);
});
test('oversize, corrupt and missing uploads produce explicit failures', async () => {
  assert.throws(() => validateVideoBytes(Buffer.alloc(VIDEO_INLINE_MAX_BYTES + 1), 'clip.mp4'), /12 MB/);
  assert.throws(() => validateVideoBytes(Buffer.from('not a video'), 'clip.mp4'), /not a supported/);
  await assert.rejects(readVideoResponse(new Response('missing', { status: 404 })), /unavailable/);
  await assert.rejects(readVideoResponse(new Response('x', { headers: { 'content-length': String(VIDEO_INLINE_MAX_BYTES + 1) } })), /12 MB/);
});
test('streamed oversized data is stopped even without a content-length header', async () => {
  const data = new ReadableStream({ start(c) { c.enqueue(new Uint8Array(VIDEO_INLINE_MAX_BYTES)); c.enqueue(new Uint8Array(1)); c.close(); } });
  await assert.rejects(readVideoResponse(new Response(data)), /12 MB/);
});
test('cancellation propagates instead of becoming a successful inspection', async () => {
  const controller = new AbortController(); controller.abort(new Error('cancelled'));
  const session = createVideoInspectionSession({ ...base, signal: controller.signal, prompt: yt });
  await assert.rejects(session.inspect({ youtube_url: yt, question: 'Describe' }), /cancelled/);
});
test('focused inspection uses AI Studio for YouTube without incompatible search or foreign tool signatures', async () => {
  let sent;
  const result = await inspectVideoWithModel(async body => {
    sent = body;
    return { model: request.model, choices: [{ message: { content: 'Two elephants.' } }], usage: { cost: 0.002 } };
  }, [request.model], { url: yt, label: yt, question: 'At 0:07?', youtube: true }, base.signal);
  assert.deepEqual(sent.provider, { only: ['google-ai-studio'] });
  assert.equal(sent.tools, undefined); assert.equal(sent.messages.length, 1);
  assert.equal(sent.messages[0].content[1].video_url.url, yt);
  assert.match(sent.messages[0].content[0].text, /0:07/);
  assert.equal(result.costUsd, 0.002); assert.equal(result.findings, 'Two elephants.');
});
test('provider failure and empty output are never reported as a successful inspection', async () => {
  for (const analyze of [async () => { throw new Error('Provider unavailable'); }, async () => ({ findings: '', model: request.model })]) {
    const session = createVideoInspectionSession({ ...base, prompt: yt, analyze });
    const result = (await session.inspect({ youtube_url: yt, question: 'Describe' })).result;
    assert.equal(result.ok, false); assert.equal(result.findings, undefined);
  }
});
test('follow-up inspection uses the new question and does not reuse old findings', async () => {
  const questions = [];
  const session = createVideoInspectionSession({ ...base, prompt: yt, analyze: async source => { questions.push(source.question); return base.analyze(); } });
  for (const question of ['At 0:07?', 'At 0:14?']) await session.inspect({ youtube_url: yt, question });
  assert.deepEqual(questions, ['At 0:07?', 'At 0:14?']);
});
test('MOV uploads use the provider-documented MIME type', async () => {
  let source;
  const session = createVideoInspectionSession({ ...base, currentAttachments: [{ filename: 'clip.mov', url: '/api/attachments/message-images/owner/clip.mov' }], analyze: async video => { source = video; return base.analyze(); } });
  await session.inspect({ filename: 'clip.mov', question: 'Describe' });
  assert.match(source.url, /^data:video\/mov;base64,/);
});

// Upload limits are independent of the size of the provider's temporary copy.
test('multiple videos share one 500 MB budget, including already attached files', () => {
  assert.equal(validateVideoSelection([{ name: 'a.mp4', size: 300 * 1024 * 1024 }, { name: 'b.mov', size: 200 * 1024 * 1024 }]), null);
  assert.match(validateVideoSelection([{ name: 'a.mp4', size: VIDEO_MAX_BYTES }, { name: 'b.webm', size: 1 }]), /500 MB/);
  assert.equal(validateVideoSelection([{ name: 'a.mp4', size: VIDEO_MAX_BYTES }, { name: 'notes.pdf', size: 1000 }]), null);
  assert.match(validateVideoSelection([{ name: 'empty.mp4', size: 0 }]), /empty/);
});
test('timestamp ranges reject invalid and inverted boundaries', () => {
  for (const range of [{startSeconds: -1}, {startSeconds: NaN}, {startSeconds: '7'}, {startSeconds: 8, endSeconds: 4}]) assert.throws(() => validateVideoRange(range));
  validateVideoRange({startSeconds: 0, endSeconds: 10});
});
test('large upload inspection preserves ownership and requested time window', async () => {
  const calls = [];
  const session = createVideoInspectionSession({ ...base,
    currentAttachments: [{filename: 'a.mp4', url: '/api/attachments/message-images/owner/a.mp4'}, {filename: 'b.mov', url: '/api/attachments/message-images/owner/b.mov'}],
    inspectUpload: async (...args) => { calls.push(args); return {findings: 'Verified content.', model: request.model}; },
    readUpload: async () => { throw new Error('Original must not be buffered'); },
  });
  for (const filename of ['a.mp4', 'b.mov']) assert.equal((await session.inspect({filename, question: 'At 2:00?', start_seconds: 115, end_seconds: 125})).result.ok, true);
  assert.equal(calls.length, 2);
  assert.deepEqual(calls[0].slice(0,4), ['owner/a.mp4', 'a.mp4', 'At 2:00?', {startSeconds: 115, endSeconds: 125}]);
});

test('video expiry fails closed and caps signed access to the remaining hour', () => {
  const { videoRemainingSeconds } = load('src/utils/videoInputs.ts');
  const now = Date.now();
  assert.equal(videoRemainingSeconds(new Date(now).toISOString(), now), 3600);
  assert.equal(videoRemainingSeconds(new Date(now - 3_600_000).toISOString(), now), 0);
  assert.equal(videoRemainingSeconds(new Date(now - 3_590_000).toISOString(), now), 10);
  assert.equal(videoRemainingSeconds(undefined, now), 0);
});

test('video progress is emitted only for a validated owned upload and recognizes cached findings', async () => {
  const stages = [];
  const session = createVideoInspectionSession({ ...base, currentAttachments: [{ filename: 'clip.mp4', url: '/api/attachments/message-images/owner/clip.mp4' }], onActivity: (stage, name) => stages.push([stage, name]) });
  await session.inspect({ filename: 'missing.mp4', question: 'Describe' });
  assert.deepEqual(stages, []);
  await session.inspect({ filename: 'clip.mp4', question: 'Describe' });
  await session.inspect({ filename: 'clip.mp4', question: 'Describe again' });
  assert.deepEqual(stages, [['inspecting', 'clip.mp4'], ['reading_saved', 'clip.mp4']]);
});
