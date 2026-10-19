const test = require('node:test');
const assert = require('node:assert/strict');
const ts = require('typescript');
const fs = require('node:fs');
const vm = require('node:vm');
function load(file, env = {}) {
  const exports = {};
  vm.runInNewContext(ts.transpileModule(fs.readFileSync(file, 'utf8'), { compilerOptions: { module: ts.ModuleKind.CommonJS } }).outputText, { exports, process: { env } });
  return exports;
}
const pricing = load('src/lib/plusPricing.ts');
const access = load('src/lib/paidEntry.ts');
const cutoff = '2026-11-01T00:00:00.000Z';
test('weekly comparison uses 52 charges, with distinct intro and regular savings', () => {
  assert.equal(pricing.monthlySavingsPercent(9), 58);
  assert.equal(pricing.monthlySavingsPercent(19), 12);
  assert.match(pricing.monthlySavingsText(9), /for 3 months/);
  assert.doesNotMatch(pricing.monthlySavingsText(19), /3 months/);
});
test('grandfather all accounts created before activation including exhausted free users', () => {
  assert.equal(access.requiresPaidEntry('2026-10-31T23:59:59Z', 'free', cutoff), false);
  assert.equal(access.requiresPaidEntry('2026-01-01', 'paid', cutoff), false);
});
test('new accounts need a plan even if starter credits exist; paying users retain access', () => {
  assert.equal(access.requiresPaidEntry(cutoff, 'free', cutoff), true);
  assert.equal(access.requiresPaidEntry('2026-11-02', 'paid', cutoff), false);
  assert.equal(access.requiresPaidEntry('2026-11-02', 'free', cutoff), true);
});
test('production rollout is off until a cutoff is explicitly configured', () => {
  assert.equal(access.requiresPaidEntry('2099-01-01', 'free'), false);
  assert.equal(access.requiresPaidEntry(undefined, 'free', cutoff), false);
  assert.equal(access.requiresPaidEntry('2026-11-02', 'free', 'invalid'), false);
});
test('demo billing cannot be enabled by production environment or another preview branch', () => {
  const env = { VERCEL_ENV: 'preview', VERCEL_GIT_COMMIT_REF: 'preview/weekly-paid-entry' };
  assert.equal(load('src/lib/paidEntry.ts', env).isBillingPreview(), true);
  assert.equal(load('src/lib/paidEntry.ts', { ...env, VERCEL_ENV: 'production' }).isBillingPreview(), false);
  assert.equal(load('src/lib/paidEntry.ts', { ...env, VERCEL_GIT_COMMIT_REF: 'main' }).isBillingPreview(), false);
});
