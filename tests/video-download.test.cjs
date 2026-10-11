const { test } = require('node:test');
const assert = require('node:assert/strict');
const fs = require('node:fs');
const vm = require('node:vm');
const ts = require('typescript');
const source = ts.transpileModule(fs.readFileSync('src/app/api/attachments/[...path]/route.ts', 'utf8'), { compilerOptions: { module: ts.ModuleKind.CommonJS, target: ts.ScriptTarget.ES2022 } }).outputText;

function route(userId) {
  const signed = [];
  const exports = {};
  vm.runInNewContext(source, { exports, Response, require(name) {
    if (name.endsWith('supabase/server')) return { createClient: async () => ({ auth: { getUser: async () => ({ data: { user: userId ? { id: userId } : null } }) } }) };
    if (name.endsWith('supabase/service')) return { createServiceClient: () => ({ storage: { from: bucket => ({ createSignedUrl: async (path, ttl) => { signed.push({ bucket, path, ttl }); return { data: { signedUrl: 'https://storage.example/signed-video' } }; }, download() { throw new Error('Video must not be buffered in a function response'); } }) } }) };
    if (name.endsWith('durableAttachments')) return { ATTACHMENT_STORAGE_BUCKET: 'message-images' };
    if (name.endsWith('videoInputs')) return { videoMime: path => /\.(mp4|mov|webm)$/i.test(path) ? 'video/mp4' : null };
    throw new Error(name);
  } });
  return { get: path => exports.GET({ nextUrl: new URL('https://preview.example/api/attachments') }, { params: Promise.resolve({ path }) }), signed };
}

test('retained video opens via a short-lived private storage redirect, without function response-size limit', async () => {
  const handler = route('owner');
  const response = await handler.get(['message-images', 'owner', 'clip.mp4']);
  assert.equal(response.status, 307);
  assert.equal(response.headers.get('location'), 'https://storage.example/signed-video');
  assert.match(response.headers.get('cache-control'), /private, no-store/);
  assert.equal(handler.signed.length, 1);
  assert.equal(handler.signed[0].ttl, 300);
});

test('video playback requires login and ownership before signing', async () => {
  for (const [user, path, status] of [[null, ['message-images', 'owner', 'clip.mp4'], 401], ['other', ['message-images', 'owner', 'clip.mp4'], 404], ['owner', ['message-images', 'owner', '..', 'clip.mp4'], 404]]) {
    const handler = route(user);
    assert.equal((await handler.get(path)).status, status);
    assert.equal(handler.signed.length, 0);
  }
});
