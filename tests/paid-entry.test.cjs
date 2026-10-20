const test = require('node:test');
const assert = require('node:assert/strict');
const ts = require('typescript');
const fs = require('node:fs');
const vm = require('node:vm');
function load(file, env = {}) {
  const exports = {};
  vm.runInNewContext(ts.transpileModule(fs.readFileSync(file, 'utf8'), { compilerOptions: { module: ts.ModuleKind.CommonJS } }).outputText, { exports, process: { env }, require: id => id === '@/lib/plans' ? load('src/lib/plans.ts', env) : require(id) });
  return exports;
}
const pricing = load('src/lib/plusPricing.ts');
const access = load('src/lib/paidEntry.ts');
const cutoff = '2026-11-01T00:00:00.000Z';
test('monthly badge compares regular annual cost with 52 weekly charges', () => {
  assert.equal(pricing.monthlySavingsPercent(9), 58);
  assert.equal(pricing.monthlySavingsPercent(19), 12);
  assert.equal(pricing.monthlySavingsText(), 'Save 12%');
});
test('positive balances allow access regardless of plan or signup date', () => {
  for (const value of [1, 100, '100.0000', 900, 0.01]) assert.equal(access.hasUsableBalance(value), true);
});
test('zero, negative and invalid balances cannot authorize spending', () => {
  for (const value of [0, -1, '0.0000', null, undefined, NaN, Infinity, 'invalid']) assert.equal(access.hasUsableBalance(value), false);
});
test('preview branch detection cannot be enabled by production environment or another preview branch', () => {
  const env = { VERCEL_ENV: 'preview', VERCEL_GIT_COMMIT_REF: 'preview/weekly-paid-entry' };
  assert.equal(load('src/lib/paidEntry.ts', env).isBillingPreview(), true);
  assert.equal(load('src/lib/paidEntry.ts', { ...env, VERCEL_ENV: 'production' }).isBillingPreview(), false);
  assert.equal(load('src/lib/paidEntry.ts', { ...env, VERCEL_GIT_COMMIT_REF: 'main' }).isBillingPreview(), false);
});
