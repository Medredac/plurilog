import remarkGfm from 'remark-gfm';
import remarkMath from 'remark-math';
import rehypeKatex from 'rehype-katex';
import 'katex/contrib/mhchem';
import type { PluggableList } from 'unified';

export const mathRemarkPlugins: PluggableList = [remarkGfm, remarkMath];
export const mathRehypePlugins: PluggableList = [[rehypeKatex, {
  trust: false,
  strict: 'ignore',
  maxExpand: 1000,
  maxSize: 20,
}]];

/** Normalize common model delimiters, leaving code and escaped dollars alone. */
export function normalizeMathMarkdown(source: string): string {
  // Include unfinished fences: partial streamed code must remain literal too.
  const protectedCode = /(^[ \t]*(`{3,}|~{3,})[^\n]*\n[\s\S]*?(?:^[ \t]*\2[ \t]*(?=\n|$)|$(?![\s\S]))|(`+)[^\n]*?\3)/gm;
  const protectCurrency = (text: string) => text.replace(
    /(?<![\\$])\$(?=\d)/g,
    (dollar: string, offset: number) => {
      // A numeric dollar opener is currency unless a complete math expression
      // follows. Never pair it across paragraphs or with an escaped dollar.
      const tail = text.slice(offset + 1);
      const closing = /(?<!\\)\$/.exec(tail);
      if (closing) {
        const body = tail.slice(0, closing.index);
        const withoutCommands = body
          .replace(/\\(?:text|mathrm|operatorname)\{[^{}]*\}/g, '')
          .replace(/\\[A-Za-z]+/g, '');
        const words = withoutCommands.match(/[A-Za-z]+/g) || [];
        const looksLikeMath = body.trim().length > 0 && body === body.trimEnd() &&
          !/[\n\r]|\*\*/.test(body) &&
          words.every(word => word.length === 1 || ['sin', 'cos', 'tan', 'log', 'ln', 'exp', 'lim', 'max', 'min'].includes(word)) &&
          !/[+\-−–*/=<>^|,:;]$/.test(body) &&
          /^[\d\sA-Za-z\\{}()[\].,+\-*/=<>!^_|:;%'~−–±×÷≤≥∞]+$/.test(body);
        if (looksLikeMath) return dollar;
      }
      return '\\$';
    },
  );
  const normalize = (text: string) => {
    // Explicit equations and display math are unambiguous: protect them before
    // inspecting currency in prose, including numeric equations such as \(2 x\).
    const explicit = /(\$\$[\s\S]*?\$\$|\\\[[\s\S]*?\\\]|\\\([^\n]*?\\\))/g;
    let cursor = 0;
    let safe = '';
    for (const match of text.matchAll(explicit)) {
      safe += protectCurrency(text.slice(cursor, match.index)) + match[0];
      cursor = match.index! + match[0].length;
    }
    safe += protectCurrency(text.slice(cursor));
    return safe
      .replace(/\\\[([\s\S]*?)\\\]/g,
        (_match: string, body: string, offset: number, input: string) => {
          const lineStart = input.lastIndexOf('\n', offset - 1) + 1;
          const prefix = input.slice(lineStart, offset);
          const indent = /^[ \t]*$/.test(prefix) ? prefix : '';
          const lines = body.trim().split('\n').map((line) => indent + line.trim());
          return `$$\n${lines.join('\n')}\n${indent}$$`;
        })
      .replace(/\\\(([^\n]*?)\\\)/g, (_, body: string) => `$${body.trim()}$`);
  };
  let result = '';
  let offset = 0;
  for (const match of source.matchAll(protectedCode)) {
    result += normalize(source.slice(offset, match.index)) + match[0];
    offset = match.index! + match[0].length;
  }
  return result + normalize(source.slice(offset));
}
