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
  const normalize = (text: string) => text
    .replace(/\\\[([\s\S]*?)\\\]/g, (_, body: string) => `$$\n${body.trim()}\n$$`)
    .replace(/\\\(([^\n]*?)\\\)/g, (_, body: string) => `$${body.trim()}$`)
    // Ordinary prices such as "$20 and $30" must not become an equation.
    .replace(/(?<![\\$])\$(\d[\d,.]*)(?=\s+[A-Za-z]|[.,!?;:]?(?:\n|$))/g,
      (match: string, _amount: string, offset: number, input: string) => {
        const close = input.indexOf('$', offset + match.length);
        // A closing delimiter immediately after a symbol is likely math ($2 x$).
        if (close >= 0 && !/\s/.test(input[close - 1])) return match;
        return '\\' + match;
      });
  let result = '';
  let offset = 0;
  for (const match of source.matchAll(protectedCode)) {
    result += normalize(source.slice(offset, match.index)) + match[0];
    offset = match.index! + match[0].length;
  }
  return result + normalize(source.slice(offset));
}
