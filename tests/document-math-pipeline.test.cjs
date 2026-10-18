require('./helpers/register-typescript.cjs');
const { test } = require('node:test');
const assert = require('node:assert/strict');
const fs = require('node:fs');
const path = require('node:path');
const Module = require('node:module');
const ts = require('typescript');
const math = require('../src/utils/documentMath.ts');
const fixture = require('./fixtures/fuel-cell-equations.json');

function internal(file, names, stubImports = false) {
  const filename = path.resolve(__dirname, '..', file), mod = new Module(filename, module);
  mod.filename = filename; mod.paths = Module._nodeModulePaths(path.dirname(filename));
  if (stubImports) mod.require = name => name === './documentMath' ? math : {};
  mod._compile(ts.transpileModule(fs.readFileSync(filename, 'utf8') + `\nexport { ${names.join(', ')} };`, {
    compilerOptions: { module: ts.ModuleKind.CommonJS, target: ts.ScriptTarget.ES2022, esModuleInterop: true },
  }).outputText, filename);
  return mod.exports;
}
const rich = internal('src/utils/richPdfRenderer.ts', ['buildHtml']);
const html = internal('src/utils/htmlPdfRenderer.ts', ['wrapHtmlDocument']);
const pipeline = internal('src/utils/gptDocumentCreation.ts', ['reviewRenderedPdfWithGpt', 'missingRenderedTableValues', 'repairMissingDocxTableValues'], true);

test('the full fuel-cell PDF layout renders every equation including table cells', () => {
  const result = rich.buildHtml(fixture);
  assert.equal((result.html.match(/data:image\/svg\+xml;base64/g) || []).length, math.documentEquations(fixture).length);
  assert.doesNotMatch(result.html, /\$\$|data-mjx-error/);
  assert.ok(result.fullText.includes('V_{\\mathrm{stack}}'));
});

test('HTML PDF sanitization retains multiline math, escapes text, and excludes executable markup', () => {
  const result = html.wrapHtmlDocument({ filename: 'test.pdf', css: '', html: String.raw`<!-- comment --><p>$$<br/>\frac{a}{b}<br/>$$</p><script>alert(1)</script><p>$H^+$</p>` });
  assert.equal((result.documentHtml.match(/data:image\/svg\+xml;base64/g) || []).length, 2);
  assert.doesNotMatch(result.documentHtml, /<script/);
});

test('actual PDF review rejects a model response that flattens formula source', async () => {
  const changed = JSON.parse(JSON.stringify(fixture));
  changed.blocks = changed.blocks.map(b => ({ ...b, text: b.text?.replace(/\$[^$]+\$/g, 'plain text') }));
  const result = await pipeline.reviewRenderedPdfWithGpt({ model: 'test', models: ['test'], args: fixture,
    pages: [{ pageNumber: 1, contentType: 'image/png', data: Buffer.from('fixture') }],
    openai: { chat: { completions: { create: async () => ({ choices: [{ message: { tool_calls: [{ function: {
      name: 'revise_pdf_layout', arguments: JSON.stringify(changed),
    } }] } }] }) } } },
  });
  assert.equal(result.applied, false); assert.equal(result.args, fixture);
});

test('rendered table checks do not mistake typeset LaTeX for missing text, but still catch missing prose', () => {
  const blocks = [{ type: 'table', headers: ['Quantity', 'Value'], rows: [['Voltage', '$V_{\\mathrm{cell}}$'], ['Required label', '80']] }];
  assert.deepEqual(pipeline.missingRenderedTableValues(blocks, 'Quantity Value Voltage V cell Required label 80'), []);
  assert.ok(pipeline.missingRenderedTableValues(blocks, 'Quantity Value Voltage V cell 80').includes('Required label'));
});

test('math in titles is rendered and mixed table cells retain their repair identity', () => {
  const output = rich.buildHtml({ filename: 'test.pdf', title: '$H_2$', blocks: [{ type: 'paragraph', text: 'Hydrogen' }] });
  assert.equal((output.html.match(/data:image\/svg\+xml;base64/g) || []).length, 1);
  const cell = 'Operating voltage $V_{cell}$';
  const spec = { format: 'docx', filename: 'test.docx', blocks: [{ type: 'table', rows: [[cell]] }] };
  const missing = pipeline.missingRenderedTableValues(spec.blocks, 'Other text');
  assert.deepEqual(missing, [cell]);
  const repaired = pipeline.repairMissingDocxTableValues(spec, missing);
  assert.equal(repaired.blocks[0].type, 'page_break');
  assert.equal(repaired.blocks[1].rows[0][0], cell);
});
