import { parseFragment, serialize, type DefaultTreeAdapterTypes as Html } from 'parse5';
import type { Node as MathTreeNode } from 'mathjax-full/js/core/Tree/Node.js';
import type { LiteElement } from 'mathjax-full/js/adaptors/lite/Element.js';
import { mathjax } from 'mathjax-full/js/mathjax.js';
import { TeX } from 'mathjax-full/js/input/tex.js';
import { SVG } from 'mathjax-full/js/output/svg.js';
import { liteAdaptor } from 'mathjax-full/js/adaptors/liteAdaptor.js';
import { RegisterHTMLHandler } from 'mathjax-full/js/handlers/html.js';
import { SerializedMmlVisitor } from 'mathjax-full/js/core/MmlTree/SerializedMmlVisitor.js';
import 'mathjax-full/js/input/tex/ams/AmsConfiguration.js';
import 'mathjax-full/js/input/tex/mhchem/MhchemConfiguration.js';
import { mml2omml } from 'mathml2omml';

const adaptor = liteAdaptor();
RegisterHTMLHandler(adaptor);

export type DocumentTextPart = { source: string; tex?: string; display?: boolean };

// Only explicit math is converted. Never guess that an identifier or dollar amount is an equation.
export function splitDocumentMath(text: string): DocumentTextPart[] {
  const pattern = /(```[\s\S]*?```|`[^`\n]*`)|(?<!\\)(\$\$([\s\S]+?)\$\$|\\\[([\s\S]+?)\\\]|\\\(([^\n]+?)\\\)|\$(?!\s)([^$\n]+?)(?<!\s)\$)/g;
  const parts: DocumentTextPart[] = [];
  let offset = 0;
  for (const match of text.matchAll(pattern)) {
    if (match.index! > offset) parts.push({ source: text.slice(offset, match.index) });
    const tex = match[3] ?? match[4] ?? match[5] ?? match[6];
    // A pair of currency signs in prose is not math.
    const currency = match[6] && /^\d[\d,.]*\s+[A-Za-z]/.test(tex) && /\s/.test(tex.trim());
    parts.push(match[1] || currency ? { source: match[0] } : {
      source: match[0], tex, display: Boolean(match[3] || match[4]),
    });
    offset = match.index! + match[0].length;
  }
  if (offset < text.length) parts.push({ source: text.slice(offset) });
  return parts;
}

function convert(tex: string, display: boolean) {
  if (tex.length > 12000) throw new Error('Equation exceeds document size limit');
  // A fresh input context prevents definitions leaking between documents or equations.
  const output = new SVG({ fontCache: 'none' });
  const document = mathjax.document('', {
    InputJax: new TeX({ packages: ['base', 'ams', 'mhchem'], maxBuffer: 16000, maxMacros: 1000 }),
    OutputJax: output,
  });
  const node = document.convert(tex, { display });
  const svg = adaptor.outerHTML(node);
  if (svg.includes('data-mjx-error') || svg.includes('data-mml-node="merror"')) {
    throw new Error('Unsupported equation');
  }
  return { output, node };
}

export function equationToWord(tex: string, display = false): string {
  const { output } = convert(tex, display);
  const root = output.math.root;
  // mhchem emits a separate script with a phantom base after the atom it belongs to.
  // Attach it to that atom before OMML conversion, avoiding visible placeholders in Word.
  const hasPhantom = (node: MathTreeNode): boolean => node.kind === 'mphantom' || node.childNodes.some(hasPhantom);
  const attachScripts = (node: MathTreeNode) => {
    for (let i = 1; i < node.childNodes.length; i++) {
      const child = node.childNodes[i];
      if (['msub', 'msup', 'msubsup'].includes(child.kind) && hasPhantom(child.childNodes[0])) {
        const previous = node.childNodes[i - 1];
        child.replaceChild(previous, child.childNodes[0]);
        node.childNodes.splice(i - 1, 1);
        i--;
      }
    }
    node.childNodes.forEach(attachScripts);
  };
  attachScripts(root);
  const mathml = new SerializedMmlVisitor().visitTree(root)
    // mhchem uses invisible phantom letters to position charges. They must stay invisible in Word.
    .replace(/<mphantom\b[^>]*>[\s\S]*?<\/mphantom>/g, '<mrow></mrow>')
    .replace(/<mpadded\b[^>]*>/g, '<mrow>').replace(/<\/mpadded>/g, '</mrow>');
  return mml2omml(mathml).replace(/<m:sty m:val="undefined"\s*\/>/g, '');
}

function escapeHtml(text: string): string {
  return text.replace(/&/g, '&amp;').replace(/</g, '&lt;').replace(/>/g, '&gt;').replace(/"/g, '&quot;');
}

export function equationToPdf(tex: string, display = false): string {
  const { node } = convert(tex, display);
  const svgNode = adaptor.firstChild(node)! as LiteElement;
  const svg = adaptor.outerHTML(svgNode);
  // Self-contained path-based SVGs need no browser scripts or external math fonts.
  const src = `data:image/svg+xml;base64,${Buffer.from(svg).toString('base64')}`;
  const width = adaptor.getAttribute(svgNode, 'width');
  const height = adaptor.getAttribute(svgNode, 'height');
  const image = `<img alt="${escapeHtml(tex)}" src="${src}" style="width:${width};height:${height};max-width:100%;vertical-align:middle;"/>`;
  return display ? `<span style="display:block;text-align:center;margin:8pt 0;">${image}</span>` : image;
}

/** Render text/BR runs together so multiline LaTeX survives HTML line breaks. */
export function renderDocumentMathHtml(html: string): string {
  if (!/\$|\\[([]/.test(html)) return html;
  const root = parseFragment(html);
  let count = 0;
  const visit = (parent: Html.ParentNode) => {
    if (['pre', 'code', 'script', 'style', 'svg', 'math', 'textarea', 'template'].includes(parent.nodeName)) return;
    for (let i = 0; i < parent.childNodes.length;) {
      const node = parent.childNodes[i];
      if (node.nodeName === '#text' || node.nodeName === 'br') {
        let end = i;
        let text = '';
        while (end < parent.childNodes.length) {
          const child = parent.childNodes[end];
          if ('value' in child) text += child.value;
          else if (child.nodeName === 'br') text += '\n';
          else break;
          end++;
        }
        const parts = splitDocumentMath(text);
        if (!parts.some(part => part.tex)) { i = end; continue; }
        const rendered = parts.map(part => {
          if (!part.tex) return escapeHtml(part.source).replace(/\n/g, '<br/>');
          if (++count > 200) throw new Error('Document exceeds the limit of 200 equations. Split it into smaller files.');
          return equationToPdf(part.tex, part.display);
        }).join('');
        const replacement = parseFragment(rendered).childNodes;
        replacement.forEach(child => { child.parentNode = parent; });
        parent.childNodes.splice(i, end - i, ...replacement);
        i += replacement.length;
      } else {
        if ('childNodes' in node) visit(node);
        i++;
      }
    }
  };
  visit(root);
  return serialize(root);
}

/** Only document content fields participate; filenames, styles and image bytes do not. */
export function documentEquations(spec: unknown): string[] {
  const equations: string[] = [];
  const fields = new Set(['blocks', 'text', 'title', 'subtitle', 'caption', 'eyebrow', 'items', 'headers', 'rows', 'cards', 'columns', 'steps', 'label']);
  const visit = (value: unknown) => {
    if (typeof value === 'string') {
      equations.push(...splitDocumentMath(value).filter(p => p.tex).map(p => p.tex!.trim()));
    } else if (Array.isArray(value)) value.forEach(visit);
    else if (value && typeof value === 'object') {
      for (const [key, child] of Object.entries(value)) if (fields.has(key)) visit(child);
    }
  };
  visit(spec);
  return equations;
}

export function preservesDocumentEquations(original: unknown, revised: unknown): boolean {
  const remaining = documentEquations(revised);
  return documentEquations(original).every(tex => {
    const index = remaining.indexOf(tex);
    if (index < 0) return false;
    remaining.splice(index, 1);
    return true;
  });
}
