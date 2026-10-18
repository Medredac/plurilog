import { test } from 'node:test';
import assert from 'node:assert/strict';
import React from 'react';
import { renderToStaticMarkup } from 'react-dom/server';
import ReactMarkdown from 'react-markdown';
import { mathRemarkPlugins, mathRehypePlugins, normalizeMathMarkdown } from '../src/utils/markdownMath.ts';
const render = (s) => renderToStaticMarkup(React.createElement(ReactMarkdown, {
  remarkPlugins: mathRemarkPlugins, rehypePlugins: mathRehypePlugins,
  children: normalizeMathMarkdown(s),
}));
test('inline, display and nested scientific equations render with accessible MathML', () => {
 const html=render(String.raw`A vector $\mathbf{m} \in \mathbb{R}^D$.

$$
\frac{\partial a_j}{\partial m_i} \approx \frac{a_j(\mathbf{m}+\epsilon\mathbf{e}_i)-a_j(\mathbf{m})}{\epsilon}
$$

1. Sample:
   $$
   \Delta\mathbf{m}\sim\mathcal{N}(\mathbf{0},\sigma^2\mathbf{I})
   $$
2. Bound:
   $$
   b^*\ge\left\lceil\frac12\log_2\left(\frac{\mathrm{Var}(\mathbf{m})}{(\delta^*)^2}\right)\right\rceil
   $$`);
 assert.equal((html.match(/class="katex"/g)||[]).length,4);
 assert.match(html,/<math /); assert.doesNotMatch(html,/katex-error/); assert.match(html,/<ol>/);
});
test('physics, matrices, aligned equations and chemistry', () => {
 for (const formula of [String.raw`E=mc^2`,String.raw`\begin{pmatrix}1&2\\3&4\end{pmatrix}`,String.raw`\begin{aligned}F&=ma\\E&=mc^2\end{aligned}`,String.raw`\ce{2H2 + O2 -> 2H2O}`,String.raw`\pu{9.81 m s-2}`]) {
  const html=render('$$\n'+formula+'\n$$'); assert.match(html,/class="katex"/); assert.doesNotMatch(html,/katex-error|#cc0000|#CC0000/);
 }
});
test('backslash delimiters work; code and escaped dollars remain literal', () => {
 assert.equal((render(String.raw`\(x^2\) and \[y^2\]`).match(/class="katex"/g)||[]).length,2);
 const code='```python\nprice = "$20" # \\(x\\)\n```\n\n`$x$`';
 assert.equal(normalizeMathMarkdown(code),code); assert.doesNotMatch(render(code),/class="katex"/);
 assert.doesNotMatch(render(String.raw`Pay \$20 and \$30.`),/class="katex"/);
 assert.doesNotMatch(render('Pay $20 and $30.'),/class="katex"/);
 assert.match(render('$2 + 2$'),/class="katex"/);
 assert.match(render('$2 x$'),/class="katex"/);
});
test('tables, links and fenced code still render', () => {
 const html=render('| Quantity | Value |\n|---|---|\n| Mass | $m$ |\n\n[Docs](https://example.com)\n\n```js\nconst x = 1;\n```');
 assert.match(html,/<table>/);assert.match(html,/href="https:\/\/example.com"/);assert.match(html,/language-js/);assert.match(html,/class="katex"/);
});
test('partial streams and invalid commands do not crash or enable unsafe HTML', () => {
 const input=String.raw`Energy $E=mc^2$ and

$$
\frac{1}{\sqrt{x}}
$$`;
 for(let i=0;i<=input.length;i++) assert.doesNotThrow(()=>render(input.slice(0,i)));
 assert.match(render('$$\n\\notARealCommand{x}\n$$'),/notARealCommand/);
 assert.doesNotMatch(render(String.raw`$\href{javascript:alert(1)}{click}$`),/href="javascript:/);
 assert.doesNotMatch(render('<script>alert(1)</script>'),/<script>/);
});


test('backslash display equations preserve numbered list structure', () => {
 const html = render(String.raw`1. Equation:
   \[
   x^2+y^2=z^2
   \]
2. Next step`);
 assert.equal((html.match(/class="katex"/g)||[]).length, 1);
 assert.equal((html.match(/<li>/g)||[]).length, 2);
 assert.equal((html.match(/<ol/g)||[]).length, 1);
 assert.doesNotMatch(html, /\$\$/);
});
