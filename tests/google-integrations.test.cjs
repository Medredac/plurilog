const test = require('node:test');
const assert = require('node:assert/strict');
const fs = require('node:fs');
const path = require('node:path');
const Module = require('node:module');
const ts = require('typescript');
function load(file, mocks = {}) {
  const filename = path.resolve(file); const mod = new Module(filename, module);
  mod.filename = filename; mod.paths = module.paths;
  mod.require = name => name === 'server-only' ? {} : Object.hasOwn(mocks, name) ? mocks[name] : require(name);
  mod._compile(ts.transpileModule(fs.readFileSync(filename, 'utf8'), { compilerOptions: { module: ts.ModuleKind.CommonJS, target: ts.ScriptTarget.ES2022, esModuleInterop: true } }).outputText, filename);
  return mod.exports;
}
const catalog = load('src/lib/integrations/catalog.ts');
class NoValidTokenError extends Error {}
class UserAuthorizationRequiredError extends Error {}
let grantRequests = [];
let grantError;
const connection = load('src/lib/integrations/googleConnection.ts', {
  './catalog': catalog,
  '@vercel/connect': {
    NoValidTokenError, UserAuthorizationRequiredError,
    getToken: async (...args) => { grantRequests.push(args); if (grantError) throw grantError; return 'PRIVATE-TOKEN'; },
    startAuthorization: async () => ({ url: 'https://vercel.com/authorize/example', verifier: 'PRIVATE-VERIFIER' }),
    revokeToken: async () => {},
  },
});
const google = load('src/lib/integrations/googleTools.ts', { './googleConnection': connection, './catalog': catalog, '@/utils/supabase/service': { createServiceClient() { throw new Error('Unexpected storage access'); } } });
const json = body => Response.json(body);
const doc = { documentId: 'doc1', title: 'Example', revisionId: 'revision1', tabs: [{ tabProperties: { tabId: 'tab1', title: 'Main' }, documentTab: { body: { content: [{ paragraph: { elements: [{ textRun: { content: 'Keep this. Change this.\n' } }] } }] } } }] };
function session(fetcher, extra = {}) { return google.createGoogleToolSession({ userId: 'alice', seatId: 'chatgpt', attachments: [], token: async () => 'PRIVATE-TOKEN', fetcher, ...extra }); }

test('connection subject is isolated by user and app, never a shared app credential', async () => {
  Object.assign(process.env, { VERCEL_ENV: 'preview', GOOGLE_APPS_ENABLED: 'true', GOOGLE_GMAIL_CONNECTOR: 'oauth/test-gmail', GOOGLE_DRIVE_CONNECTOR: 'oauth/test-drive' });
  grantRequests = [];
  await connection.googleToken('alice', 'gmail'); await connection.googleToken('bob', 'gmail'); await connection.googleToken('alice', 'google-drive');
  assert.deepEqual(grantRequests.map(call => call[1].subject.id), ['plurilog-preview:gmail:alice', 'plurilog-preview:gmail:bob', 'plurilog-preview:google-drive:alice']);
  assert.ok(grantRequests.every(call => call[1].subject.type === 'user' && call[2].forceRefresh));
  assert.deepEqual(grantRequests[2][1].scopes, ['https://www.googleapis.com/auth/drive.file']);
});
test('production fails closed and revoked consent is not shown as connected', async () => {
  process.env.VERCEL_ENV = 'production';
  assert.equal((await connection.connectionStatus('alice', 'gmail')).status, 'setup_required');
  process.env.VERCEL_ENV = 'preview'; grantError = new UserAuthorizationRequiredError('secret details');
  assert.deepEqual(await connection.connectionStatus('alice', 'gmail'), { id: 'gmail', status: 'connection_required', connected: false });
  grantError = undefined;
});
test('authorization response exposes only the destination, never verifier or tokens', async () => {
  process.env.GOOGLE_APPS_ORIGIN = 'https://preview.example.com';
  assert.equal(await connection.beginGoogleConnection('alice', 'gmail'), 'https://vercel.com/authorize/example');
});
test('Claude and Gemini cannot execute integration tools', async () => {
  let calls = 0;
  for (const seatId of ['claude', 'gemini']) {
    const result = await session(async () => { calls++; return json({}); }, { seatId }).run('gmail_search', { query: 'Joe' });
    assert.equal(result.status, 'forbidden');
  }
  assert.equal(calls, 0);
  assert.ok(!google.GOOGLE_TOOLS.some(tool => /send|delete|trash/.test(tool.function.name)));
});
test('draft encoding handles Unicode and rejects recipient/subject header injection', () => {
  const raw = google.draftMime('joe@example.com', 'Bonjour café ☕', 'Hello\nJoe');
  const mime = Buffer.from(raw, 'base64url').toString();
  assert.match(mime, /To: joe@example.com/); assert.match(mime, /Content-Transfer-Encoding: base64/);
  assert.throws(() => google.draftMime('joe@example.com\r\nBcc: evil@example.com', 'Subject', 'Body'));
  assert.throws(() => google.draftMime('joe@example.com', 'Subject\nBcc: evil@example.com', 'Body'));
  assert.throws(() => google.draftMime('joe@example.com', 'Subject', 'Body', '<id>\r\nBcc: evil@example.com'));
});
test('a repeated draft call in one turn creates only one actual draft', async () => {
  const calls = [];
  const tools = session(async (url, options) => { calls.push({ url, options }); return json({ id: 'draft1' }); });
  const args = { to: 'joe@example.com', subject: 'Hello', body: 'Draft text' };
  const [a, b] = await Promise.all([tools.run('gmail_save_draft', args), tools.run('gmail_save_draft', args)]);
  assert.equal(a.status, 'saved'); assert.deepEqual(a, b); assert.equal(calls.length, 1);
  assert.equal(calls[0].url, 'https://gmail.googleapis.com/gmail/v1/users/me/drafts');
  assert.equal(a.sent, false); assert.ok(!JSON.stringify(a).includes('PRIVATE-TOKEN'));
});
test('reply recipient must match a message read in the same turn', async () => {
  let writes = 0;
  const tools = session(async (url, options) => {
    if (options.method === 'POST') { writes++; return json({ id: 'draft' }); }
    return json({ messages: [{ id: 'msg1', threadId: 'thread1', payload: { headers: [{ name: 'From', value: 'Joe <joe@example.com>' }, { name: 'Subject', value: 'Original subject' }, { name: 'Message-ID', value: '<original@example.com>' }], mimeType: 'text/plain', body: { data: Buffer.from('hello').toString('base64url') } } }] });
  });
  const args = { to: 'joe@example.com', subject: 'Re: Original subject', body: 'Thanks', reply_to_message_id: 'msg1' };
  assert.equal((await tools.run('gmail_save_draft', args)).status, 'error');
  await tools.run('gmail_read_thread', { thread_id: 'thread1' });
  assert.equal((await tools.run('gmail_save_draft', { ...args, to: 'evil@example.com' })).status, 'error');
  assert.equal((await tools.run('gmail_save_draft', { ...args, body: 'Thanks Joe' })).status, 'saved');
  assert.equal(writes, 1);
});
test('unknown write outcomes stop subsequent mutations and redact provider details', async () => {
  let calls = 0;
  const tools = session(async () => { calls++; throw new Error('PRIVATE-TOKEN provider-secret'); });
  const result = await tools.run('gmail_save_draft', { to: 'joe@example.com', subject: 'Hello', body: 'Draft' });
  assert.equal(result.code, 'outcome_unknown'); assert.ok(!JSON.stringify(result).includes('PRIVATE-TOKEN'));
  assert.equal((await tools.run('docs_create', { title: 'Another', text: 'Text' })).code, 'write_limit_or_uncertain_outcome');
  assert.equal(calls, 1);
});
test('Google Doc edits require a read, correct tab/revision, and preserve surrounding text', async () => {
  const calls = [];
  const tools = session(async (url, options) => { calls.push({ url, options }); return json(options.method === 'GET' ? doc : {}); });
  const args = { document_id: 'doc1', revision_id: 'revision1', tab_id: 'tab1', operation: 'replace', find: 'Change this.', text: 'Updated.' };
  assert.equal((await tools.run('docs_edit', args)).code, 'read_document_before_editing');
  await tools.run('docs_read', { document_id: 'doc1' });
  assert.equal((await tools.run('docs_edit', { ...args, revision_id: 'wrong' })).status, 'error');
  assert.equal((await tools.run('docs_edit', { ...args, text: 'Changed.' })).status, 'updated');
  const update = JSON.parse(calls[1].options.body);
  assert.deepEqual(update.writeControl, { requiredRevisionId: 'revision1' });
  assert.deepEqual(update.requests[0].replaceAllText.tabsCriteria, { tabIds: ['tab1'] });
  assert.equal(update.requests[0].replaceAllText.containsText.text, 'Change this.');
});
test('a partly created doc reports its real URL rather than falsely claiming full success', async () => {
  let calls = 0;
  const result = await session(async () => ++calls === 1 ? json({ documentId: 'doc1' }) : new Response('', { status: 503 })).run('docs_create', { title: 'Title', text: 'Text' });
  assert.equal(result.status, 'partially_created'); assert.equal(result.document_id, 'doc1'); assert.equal(calls, 2);
});
test('image access rejects other users, external URLs, traversal, and unsupported formats', () => {
  process.env.NEXT_PUBLIC_SUPABASE_URL = 'https://test.supabase.co';
  assert.equal(google.imageStoragePath('https://test.supabase.co/storage/v1/object/sign/message-images/alice/image.png?token=x', 'alice'), 'alice/image.png');
  for (const url of ['https://evil.test/alice/image.png', 'https://test.supabase.co/storage/v1/object/sign/message-images/bob/image.png', '/api/attachments/message-images/alice/%2e%2e/bob/image.png', '/api/attachments/message-images/alice/image.svg']) assert.throws(() => google.imageStoragePath(url, 'alice'));
});
test('connection endpoints reject signed-out requests before touching providers', async () => {
  for (const action of ['connect', 'disconnect', 'picker']) {
    const route = load(`src/app/api/integrations/${action}/route.ts`, { '@/lib/integrations/catalog': catalog, '@/lib/integrations/googleConnection': connection, '@/lib/integrations/http': { integrationUser: async () => null, sameOrigin: () => true, PRIVATE_HEADERS: { 'Cache-Control': 'private, no-store' } } });
    assert.equal((await route.POST(new Request('https://preview.example.com/api', { method: 'POST' }))).status, 401);
  }
});
test('connection endpoints reject cross-origin requests before provider actions', async () => {
  const route = load('src/app/api/integrations/connect/route.ts', { '@/lib/integrations/catalog': catalog, '@/lib/integrations/googleConnection': connection, '@/lib/integrations/http': { integrationUser: async () => ({ id: 'alice' }), sameOrigin: () => false, PRIVATE_HEADERS: {} } });
  assert.equal((await route.POST(new Request('https://preview.example.com/api', { method: 'POST' }))).status, 403);
});
