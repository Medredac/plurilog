require('./helpers/register-typescript.cjs');
const { test } = require('node:test');
const assert = require('node:assert/strict');
const Module = require('node:module');
let createOptions, stopped = 0, failGeneration = false, writes = [];
const sandbox = {
  async writeFiles(files) { writes.push(...files); },
  async stop() { stopped++; },
  async runCommand(cmd, argv) {
    let out = '', error = '', exitCode = 0;
    if (cmd === 'test') exitCode = 1;
    if (cmd === 'stat') out = '10';
    if (cmd === 'find') out = '/vercel/sandbox/rendered/page-1.png';
    if (cmd.includes('/python') && argv.includes('/vercel/sandbox/generate.py') && failGeneration) { exitCode = 1; error = 'Invalid Python'; }
    return { exitCode, stdout: async () => out, stderr: async () => error };
  },
  async readFileToBuffer({ path }) {
    if (path.endsWith('output.pdf')) return Buffer.from('%PDF-example');
    if (path.endsWith('inspection.json')) return Buffer.from('{"page_count":1}');
    if (path.endsWith('full-text.txt')) return Buffer.from('Complete text');
    return Buffer.from('page image');
  },
};
const originalLoad = Module._load;
Module._load = function(name, ...rest) { if (name === '@vercel/sandbox') return { Sandbox: { create: async options => { createOptions = options; return sandbox; } } }; return originalLoad.call(this, name, ...rest); };
const { buildDocumentInSandbox } = require('../src/utils/documentCodeSandbox.ts');
Module._load = originalLoad;
const args = { filename: 'brief.pdf', format: 'pdf', code: 'author code', requirements: ['Readable brief'], inputs: [] };
test('sandbox is isolated, credential-free, bounded and stopped after successful rendering', async () => {
  const draft = await buildDocumentInSandbox(args, [], new AbortController().signal);
  assert.equal(createOptions.networkPolicy, 'deny-all'); assert.equal(createOptions.persistent, false);
  assert.equal(createOptions.env, undefined); assert.equal(createOptions.timeout, 180000);
  assert.equal(draft.pages.length, 1); assert.equal(draft.fullText, 'Complete text'); assert.equal(stopped, 1);
  assert.ok(writes.some(file => file.path.endsWith('/inspect.py')));
});
test('execution errors stop the sandbox and do not produce a publishable draft', async () => {
  failGeneration = true; const before = stopped;
  await assert.rejects(buildDocumentInSandbox(args, [], new AbortController().signal), /Invalid Python/);
  assert.equal(stopped, before + 1);
});
test('abort or unauthorized input fails before sandbox creation', async () => {
  const before = stopped;
  await assert.rejects(buildDocumentInSandbox({ ...args, inputs: ['source.docx'] }, [], new AbortController().signal), /do not match/);
  const controller = new AbortController(); controller.abort();
  await assert.rejects(buildDocumentInSandbox(args, [], controller.signal));
  assert.equal(stopped, before);
});
