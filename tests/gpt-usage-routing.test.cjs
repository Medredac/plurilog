const { test } = require('node:test');
const assert = require('node:assert/strict');
const fs = require('node:fs');
const vm = require('node:vm');
const ts = require('typescript');

const context = { exports: {} };
vm.runInNewContext(ts.transpileModule(
  fs.readFileSync('src/utils/openrouter.ts', 'utf8'),
  { compilerOptions: { module: ts.ModuleKind.CommonJS, target: ts.ScriptTarget.ES2022 } },
).outputText, context);
const { getChatgptFallbacksForUsage, getCouncilSeatFallbacks } = context.exports;
const normal = ['openai/gpt-5.6-luna', 'openai/gpt-6-luna', 'openai/gpt-5.6-sol'];
const alternate = [normal[1], normal[0], normal[2]];

test('GPT switches at 50 cents, switches back at each dollar, and repeats', () => {
  for (const cents of [0, 25, 49.999, 100, 149.999, 200, 1249.999]) {
    assert.deepEqual([...getChatgptFallbacksForUsage(cents)], normal, `${cents} cents`);
  }
  for (const cents of [50, 75, 99.999, 150, 199.999, 250, 1250]) {
    assert.deepEqual([...getChatgptFallbacksForUsage(cents)], alternate, `${cents} cents`);
  }
});

test('invalid usage keeps the existing default routing', () => {
  for (const cents of [-1, NaN, Infinity, -Infinity]) {
    assert.deepEqual([...getChatgptFallbacksForUsage(cents)], normal);
  }
});

test('routing one user cannot change another user or other seats', () => {
  const before = JSON.stringify(getCouncilSeatFallbacks());
  const routed = getChatgptFallbacksForUsage(50);
  routed.pop();
  assert.equal(JSON.stringify(getCouncilSeatFallbacks()), before);
  assert.deepEqual([...getChatgptFallbacksForUsage(0)], normal);
  assert.deepEqual([...getChatgptFallbacksForUsage(50)], alternate);
});
