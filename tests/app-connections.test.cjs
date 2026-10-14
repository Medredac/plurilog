const test = require('node:test');
const assert = require('node:assert/strict');
const fs = require('node:fs');
const path = require('node:path');
const Module = require('node:module');
const ts = require('typescript');
function load(file, mocks = {}) {
  const filename = path.resolve(file);
  const mod = new Module(filename, module);
  mod.filename = filename;
  mod.paths = module.paths;
  mod.require = name => Object.hasOwn(mocks, name) ? mocks[name] : require(name);
  mod._compile(ts.transpileModule(fs.readFileSync(filename, 'utf8'), {
    compilerOptions: { module: ts.ModuleKind.CommonJS, target: ts.ScriptTarget.ES2022, esModuleInterop: true },
  }).outputText, filename);
  return mod.exports;
}
const catalog = load('src/lib/integrations/catalog.ts');
const tools = load('src/lib/integrations/connectionTools.ts', { './catalog': catalog });

test('only exact local app destinations turn into privileged-looking connection buttons', () => {
  assert.equal(catalog.appFromConnectionHref('/dashboard?connectApp=gmail'), 'gmail');
  assert.equal(catalog.appFromConnectionHref('/dashboard?connectApp=google-drive'), 'google-drive');
  for (const href of [undefined, 'https://evil.test/dashboard?connectApp=gmail', '//evil.test/dashboard?connectApp=gmail', '/dashboard?connectApp=gmail&redirect=https://evil.test', 'javascript:alert(1)', '/api/integrations/connect?app=gmail']) {
    assert.equal(catalog.appFromConnectionHref(href), null);
  }
});

test('model arguments cannot create arbitrary app destinations or claim successful Google access', () => {
  assert.equal(tools.connectionToolResult({ app: '../../evil' }).status, 'invalid_app');
  for (const app of ['gmail', 'google-drive']) {
    const result = tools.connectionToolResult({ app, connected: true, token: 'ignored' });
    assert.equal(result.connected, undefined);
    assert.equal(result.status, 'open_connection_screen');
    assert.equal(catalog.appFromConnectionHref(result.connection_url), app);
    assert.equal(JSON.stringify(result).includes('ignored'), false);
  }
});

test('signed-out availability requests are rejected', async () => {
  const route = load('src/app/api/integrations/route.ts', {
    '@/lib/integrations/catalog': catalog,
    '@/lib/integrations/http': { integrationUser: async () => null, PRIVATE_HEADERS: { 'Cache-Control': 'private, no-store' } },
    '@/lib/integrations/googleConnection': { connectionStatus: async () => { throw new Error('Must not access provider'); } },
  });
  const response = await route.GET();
  assert.equal(response.status, 401);
});

test('Google sign-in does not masquerade as an app connection; status stays private and uncached', async () => {
  const route = load('src/app/api/integrations/route.ts', {
    '@/lib/integrations/catalog': catalog,
    '@/lib/integrations/http': { integrationUser: async () => ({ id: 'alice', app_metadata: { provider: 'google' } }), PRIVATE_HEADERS: { 'Cache-Control': 'private, no-store' } },
    '@/lib/integrations/googleConnection': { connectionStatus: async (_user, app) => ({ id: app, connected: false, status: 'setup_required' }) },
  });
  const response = await route.GET();
  assert.equal(response.headers.get('Cache-Control'), 'private, no-store');
  const body = await response.json();
  assert.ok(body.apps.every(app => app.connected === false && app.status === 'setup_required'));
  assert.equal(JSON.stringify(body).includes('alice'), false);
});
