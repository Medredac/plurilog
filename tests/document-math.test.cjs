require('./helpers/register-typescript.cjs');
const { test } = require('node:test');
const assert = require('node:assert/strict');
const { equationToWord, renderDocumentMathHtml, splitDocumentMath } = require('../src/utils/documentMath.ts');
const { renderDocx } = require('../src/utils/docxWriter.ts');
const fs = require('node:fs');
const os = require('node:os');
const path = require('node:path');
const { execFileSync } = require('node:child_process');

test('fuel cell notation becomes native Word math in paragraphs and table cells', () => {
  const output = renderDocx({ filename: 'fuel-cell.docx', blocks: [
    { type: 'paragraph', text: String.raw`Reaction: $\ce{H2 -> 2H+ + 2e-}$. Voltage: $$E^\circ=-\frac{\Delta G^\circ}{nF}$$` },
    { type: 'table', headers: ['Quantity', 'Formula'], rows: [['Power', String.raw`$P=V_{\mathrm{stack}} I$`]] },
  ] });
  const dir = fs.mkdtempSync(path.join(os.tmpdir(), 'document-math-'));
  try {
    const file = path.join(dir, 'sample.docx'); fs.writeFileSync(file, output.buffer);
    const xml = execFileSync('unzip', ['-p', file, 'word/document.xml'], { encoding: 'utf8' });
    assert.equal((xml.match(/<m:oMath /g) || []).length, 3);
    assert.match(xml, /<m:f>/); assert.match(xml, /<m:sSub>/); assert.match(xml, /<m:sSup>/);
    assert.doesNotMatch(xml, /\\ce|\\frac|>A<|m:val="undefined"/);
  } finally { fs.rmSync(dir, { recursive: true, force: true }); }
});
test('PDF renders equations in paragraphs and tables as self-contained vector images', () => {
  const html = renderDocumentMathHtml(String.raw`<p>$\ce{H2 -> 2H+ + 2e-}$</p><table><tr><td>\(V_{stack}=\frac{1}{2}\)</td></tr></table>`);
  assert.equal((html.match(/data:image\/svg\+xml;base64,/g) || []).length, 2);
  for (const match of html.matchAll(/base64,([^" ]+)/g)) {
    const svg = Buffer.from(match[1], 'base64').toString();
    assert.match(svg, /<path/); assert.doesNotMatch(svg, /data-mjx-error|merror|<script/);
  }
});
test('matrices render; currency, code, attributes and invalid math remain intact', () => {
  assert.match(equationToWord(String.raw`\begin{pmatrix}1&2\\3&4\end{pmatrix}`), /<m:m>/);
  const source = String.raw`<p>USD 20; $20 and $30. <code>$x_1$</code></p><a href="/price/$x$">Link</a><p>$\notARealCommand{x}$</p>`;
  const output = renderDocumentMathHtml(source);
  assert.match(output, /\$20 and \$30/); assert.match(output, /<code>\$x_1\$<\/code>/);
  assert.match(output, /href="\/price\/\$x\$"/); assert.match(output, /notARealCommand/);
  assert.equal(splitDocumentMath('$$\na^2+b^2=c^2\n$$')[0].tex.trim(), 'a^2+b^2=c^2');
});
