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
const crypto = load('src/lib/integrations/googleCrypto.ts');
const records = { preview_google_connections: [], preview_google_oauth_states: [], preview_google_action_receipts: [] };
function database() {
  return { from(table) {
    let operation = 'select', value, single = false; const filters = [];
    const builder = {
      select() { return builder; }, insert(input) { operation = 'insert'; value = input; return builder; },
      upsert(input) { operation = 'upsert'; value = input; return builder; }, update(input) { operation = 'update'; value = input; return builder; },
      delete() { operation = 'delete'; return builder; }, eq(key, input) { filters.push(row => row[key] === input); return builder; },
      gt(key, input) { filters.push(row => row[key] > input); return builder; }, maybeSingle() { single = true; return builder; },
      then(resolve, reject) {
        try {
          let rows = records[table].filter(row => filters.every(filter => filter(row)));
          if (operation === 'insert') {
            const duplicate = records[table].some(row => table === 'preview_google_action_receipts' ? row.user_id === value.user_id && row.run_id === value.run_id && row.fingerprint === value.fingerprint : row.state_hash === value.state_hash);
            if (duplicate) return Promise.resolve({ data: null, error: { code: '23505' } }).then(resolve, reject);
            records[table].push({ ...value }); rows = [value];
          }
          if (operation === 'upsert') { records[table] = records[table].filter(row => row.user_id !== value.user_id || row.app !== value.app); records[table].push({ ...value }); rows = [value]; }
          if (operation === 'delete') records[table] = records[table].filter(row => !rows.includes(row));
          if (operation === 'update') rows.forEach(row => Object.assign(row, value));
          return Promise.resolve({ data: single ? rows[0] || null : rows, error: null }).then(resolve, reject);
        } catch (error) { return Promise.reject(error).then(resolve, reject); }
      },
    }; return builder;
  } };
}
const service = { createServiceClient: database };
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
const receipts = load('src/lib/integrations/googleReceipts.ts', { './googleCrypto': crypto, '@/utils/supabase/service': service });
const google = load('src/lib/integrations/googleTools.ts', { './googleConnection': connection, './catalog': catalog, './googleReceipts': receipts, '@/utils/supabase/service': { createServiceClient() { throw new Error('Unexpected storage access'); } } });
Object.assign(process.env, { VERCEL_ENV: 'preview', VERCEL_GIT_COMMIT_REF: 'feat/google-apps-preview', GOOGLE_APPS_ENABLED: 'true', GOOGLE_GMAIL_CONNECTOR: 'oauth/test-gmail', GOOGLE_DRIVE_CONNECTOR: 'oauth/test-drive', GOOGLE_APPS_ENCRYPTION_KEY: 'a'.repeat(64), GOOGLE_APPS_ORIGIN: 'https://preview.example.com' });
const json = body => Response.json(body);
const doc = { documentId: 'doc1', title: 'Example', revisionId: 'revision1', tabs: [{ tabProperties: { tabId: 'tab1', title: 'Main' }, documentTab: { body: { content: [{ paragraph: { elements: [{ textRun: { content: 'Keep this. Change this.\n' } }] } }] } } }] };
function session(fetcher, extra = {}) { return google.createGoogleToolSession({ userId: 'alice', seatId: 'chatgpt', attachments: [], token: async () => 'PRIVATE-TOKEN', fetcher, ...extra }); }

test('encrypted Google records are bound to user, app, and purpose', () => {
  const encrypted = crypto.encryptGoogle({ refreshToken: 'PRIVATE-TOKEN' }, 'tokens:alice:gmail');
  assert.ok(!encrypted.includes('PRIVATE-TOKEN'));
  assert.deepEqual(crypto.decryptGoogle(encrypted, 'tokens:alice:gmail'), { refreshToken: 'PRIVATE-TOKEN' });
  assert.throws(() => crypto.decryptGoogle(encrypted, 'tokens:bob:gmail'));
  assert.throws(() => crypto.decryptGoogle(encrypted, 'tokens:alice:google-drive'));
  assert.throws(() => crypto.decryptGoogle('invalid', 'tokens:alice:gmail'));
});
test('connection subject is isolated by user and app, never a shared app credential', async () => {
  Object.assign(process.env, { VERCEL_ENV: 'preview', VERCEL_GIT_COMMIT_REF: 'feat/google-apps-preview', GOOGLE_APPS_ENABLED: 'true', GOOGLE_GMAIL_CONNECTOR: 'oauth/test-gmail', GOOGLE_DRIVE_CONNECTOR: 'oauth/test-drive' });
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
test('durable action receipts suppress the same mutation across separate requests', async () => {
  let writes = 0;
  const fetcher = async () => { writes++; return json({ id: 'durable-draft' }); };
  const args = { to: 'joe@example.com', subject: 'Durable draft', body: 'Body' };
  const options = { runId: '11111111-1111-4111-8111-111111111111' };
  const first = await session(fetcher, options).run('gmail_save_draft', args);
  const second = await session(fetcher, options).run('gmail_save_draft', args);
  assert.deepEqual(first, second); assert.equal(writes, 1);
  assert.ok(!JSON.stringify(records.preview_google_action_receipts).includes('Durable draft'));
});
test('Claude and Gemini cannot execute integration tools', async () => {
  let calls = 0;
  for (const seatId of ['claude', 'gemini']) {
    const result = await session(async () => { calls++; return json({}); }, { seatId }).run('gmail_search', { query: 'Joe' });
    assert.equal(result.status, 'forbidden');
  }
  assert.equal(calls, 0);
  assert.ok(!google.GOOGLE_TOOLS.some(tool => /delete/.test(tool.function.name)));
  assert.ok(google.GOOGLE_TOOLS.some(tool => tool.function.name === 'gmail_send_draft'));
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

test('one tool session retrieves one credential per provider while separate sessions revalidate', async () => {
  let calls = 0;
  const options = { token: async () => { calls++; return 'PRIVATE-TOKEN'; }, fetcher: async () => json({ messages: [] }) };
  const first = google.createGoogleToolSession({ userId: 'alice', seatId: 'chatgpt', attachments: [], ...options });
  await first.run('gmail_search', { query: 'one' });
  await first.run('gmail_search', { query: 'two' });
  assert.equal(calls, 1);
  const second = google.createGoogleToolSession({ userId: 'alice', seatId: 'chatgpt', attachments: [], ...options });
  await second.run('gmail_search', { query: 'three' });
  assert.equal(calls, 2);
});
test('other preview branches fail closed', async () => {
  process.env.VERCEL_GIT_COMMIT_REF = 'another-preview';
  assert.equal((await connection.connectionStatus('alice', 'gmail')).status, 'setup_required');
  process.env.VERCEL_GIT_COMMIT_REF = 'feat/google-apps-preview';
});

test('Gmail counts all pages without fetching email content or trusting estimates', async () => {
  const urls = [];
  const result = await session(async url => {
    urls.push(String(url));
    return json(urls.length === 1 ? { messages: [{ id: 'a' }, { id: 'b' }], nextPageToken: 'next', resultSizeEstimate: 999 } : { messages: [{ id: 'b' }, { id: 'c' }] });
  }).run('gmail_count', { query: 'from:wagepoint' });
  assert.equal(result.count, 3);
  assert.equal(result.exact, true);
  assert.equal(urls.length, 2);
  assert.ok(urls[1].includes('pageToken=next'));
  assert.ok(urls.every(url => !url.includes('format=')));
});

test('Gmail count marks capped pagination as a lower bound', async () => {
  let calls = 0;
  const result = await session(async () => json({ messages: [{ id: String(++calls) }], nextPageToken: 'more' })).run('gmail_count', { query: 'from:wagepoint' });
  assert.equal(calls, 20);
  assert.equal(result.count, 20);
  assert.equal(result.exact, false);
});

const draftMessage = () => ({ id: 'm1', threadId: 'thread1', payload: { mimeType: 'text/plain', headers: [{ name: 'To', value: 'joe@example.com' }, { name: 'Subject', value: 'Hello' }], body: { data: Buffer.from('Hello Joe').toString('base64url') } } });
async function readDraft(s) { return s.run('gmail_read_draft', { draft_id: 'draft1' }); }

test('send requires current explicit intent and a freshly read, unchanged draft', async () => {
  let sends = 0;
  let changed = false;
  const fetcher = async (url, init) => {
    if (url.endsWith('drafts/send')) { sends++; assert.deepEqual(JSON.parse(init.body), { id: 'draft1' }); return json({ id: 'sent1', threadId: 'thread1' }); }
    const message = draftMessage();
    if (changed) message.payload.body.data = Buffer.from('Changed').toString('base64url');
    return json({ message });
  };
  const noIntent = session(fetcher, { userPrompt: 'Draft an email' });
  let read = await readDraft(noIntent);
  assert.equal((await noIntent.run('gmail_send_draft', { draft_id: 'draft1', revision: read.revision })).code, 'explicit_send_request_required');
  const send = session(fetcher, { userPrompt: 'Send it' });
  assert.equal((await send.run('gmail_send_draft', { draft_id: 'draft1', revision: 'guess' })).code, 'read_draft_before_action');
  read = await readDraft(send);
  changed = true;
  assert.equal((await send.run('gmail_send_draft', { draft_id: 'draft1', revision: read.revision })).code, 'draft_changed_read_again');
  assert.equal(sends, 0);
  changed = false;
  const sent = await send.run('gmail_send_draft', { draft_id: 'draft1', revision: read.revision });
  assert.equal(sent.status, 'sent');
  assert.equal(sends, 1);
});

test('send deduplicates across turns and does not retry an uncertain delivery', async () => {
  records.preview_google_action_receipts = [];
  let sends = 0;
  const fetcher = async url => {
    if (url.endsWith('drafts/send')) { sends++; throw new Error('Network lost after delivery'); }
    return json({ message: draftMessage() });
  };
  for (const runId of ['first', 'second']) {
    const s = session(fetcher, { userPrompt: 'Send the draft', runId });
    const read = await readDraft(s);
    const result = await s.run('gmail_send_draft', { draft_id: 'draft1', revision: read.revision });
    assert.equal(result.code, 'outcome_unknown');
  }
  assert.equal(sends, 1);
});

test('mailbox mutations require observed targets and use recoverable Trash endpoints', async () => {
  const requests = [];
  const s = session(async (url, init) => {
    requests.push({ url, init });
    if (url.includes('messages?')) return json({ messages: [{ id: 'm1' }] });
    if (url.includes('format=metadata')) return json(draftMessage());
    return json({});
  });
  assert.equal((await s.run('gmail_modify_messages', { message_ids: ['invented'], action: 'trash' })).code, 'search_or_read_messages_first');
  await s.run('gmail_search', { query: 'from:joe@example.com' });
  const result = await s.run('gmail_modify_messages', { message_ids: ['m1'], action: 'trash' });
  assert.equal(result.status, 'updated');
  assert.ok(requests.some(r => r.url.endsWith('messages/m1/trash') && r.init.method === 'POST'));
  assert.ok(requests.every(r => r.init.method !== 'DELETE'));
});

test('draft update uses PUT and refuses rich content instead of deleting formatting or attachments', async () => {
  let rich = false;
  let updates = 0;
  const s = session(async (url, init) => {
    if (init.method === 'PUT') { updates++; return json({ id: 'draft1' }); }
    const message = draftMessage(); if (rich) message.payload.mimeType = 'text/html';
    return json({ message });
  });
  let read = await readDraft(s);
  const args = { draft_id: 'draft1', revision: read.revision, to: 'joe@example.com', subject: 'New subject', body: 'New content' };
  assert.equal((await s.run('gmail_update_draft', args)).status, 'updated');
  rich = true; read = await readDraft(s);
  assert.equal((await s.run('gmail_update_draft', { ...args, revision: read.revision })).code, 'edit_rich_draft_in_gmail');
  assert.equal(updates, 1);
});

test('finish_app_task only suppresses redundant peers after successful work', async () => {
  let completed = 0;
  const s = session(async () => json({ messages: [] }), { onTaskComplete: () => completed++ });
  assert.equal((await s.run('finish_app_task', {})).code, 'app_task_not_complete');
  await s.run('gmail_count', { query: 'from:joe@example.com' });
  assert.equal((await s.run('finish_app_task', {})).status, 'complete');
  assert.equal(completed, 1);
  const failing = session(async () => new Response('', { status: 403 }), { onTaskComplete: () => completed++ });
  await failing.run('gmail_count', { query: 'from:joe@example.com' });
  assert.equal((await failing.run('finish_app_task', {})).code, 'app_task_not_complete');
  assert.equal(completed, 1);
});

test('Cc/Bcc are validated against header injection and survive plain-text draft editing', async () => {
  assert.throws(() => google.draftMime('joe@example.com', 'Hi', 'Hello', undefined, 'a@example.com\r\nBcc: evil@example.com'));
  let raw;
  const s = session(async (_url, init) => {
    if (init.method === 'PUT') { raw = JSON.parse(init.body).message.raw; return json({ id: 'draft1' }); }
    const message = draftMessage();
    message.payload.headers.push({ name: 'Cc', value: 'copy@example.com' }, { name: 'Bcc', value: 'blind@example.com' });
    return json({ message });
  });
  const read = await readDraft(s);
  await s.run('gmail_update_draft', { draft_id: 'draft1', revision: read.revision, to: 'joe@example.com', subject: 'Updated', body: 'Hello' });
  const mime = Buffer.from(raw, 'base64url').toString();
  assert.match(mime, /Cc: copy@example.com/);
  assert.match(mime, /Bcc: blind@example.com/);
});

test('partial Trash failures report completed count without repeating earlier messages', async () => {
  let trashCalls = 0;
  const s = session(async (url) => {
    if (url.includes('messages?')) return json({ messages: [{ id: 'm1' }, { id: 'm2' }] });
    if (url.includes('format=metadata')) return json({ ...draftMessage(), id: url.includes('/m2?') ? 'm2' : 'm1' });
    if (url.endsWith('/trash') && ++trashCalls === 2) return new Response('', { status: 500 });
    return json({});
  });
  await s.run('gmail_search', { query: 'from:joe@example.com' });
  const result = await s.run('gmail_modify_messages', { message_ids: ['m1', 'm2'], action: 'trash' });
  assert.equal(result.status, 'partial_or_failed');
  assert.equal(result.completed_count, 1);
  assert.equal((await s.run('finish_app_task', {})).code, 'app_task_not_complete');
  assert.equal(trashCalls, 2);
});
