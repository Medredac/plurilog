import { Buffer } from 'node:buffer';
import { Sandbox } from '@vercel/sandbox';
import type { DocxBlock } from '@/utils/docxWriter';

export type PdfFontFamily =
  | 'sans'
  | 'serif'
  | 'mono'
  | 'jp-sans'
  | 'jp-serif';

export interface PdfDesign {
  pageSize?: 'A4' | 'LETTER';
  orientation?: 'portrait' | 'landscape';
  marginMm?: number;
  backgroundColor?: string;
  textColor?: string;
  mutedColor?: string;
  accentColor?: string;
  accentColor2?: string;
  accentColor3?: string;
  fontFamily?: PdfFontFamily;
  headingFontFamily?: PdfFontFamily;
  bodySizePt?: number;
  lineHeight?: number;
  locale?: string;
}

export interface PdfBlockStyle {
  backgroundColor?: string;
  textColor?: string;
  accentColor?: string;
  borderColor?: string;
  borderWidthPt?: number;
  radiusPt?: number;
  paddingPt?: number;
  marginTopPt?: number;
  marginBottomPt?: number;
  align?: 'left' | 'center' | 'right';
  fontSizePt?: number;
  fontWeight?: number;
}

export interface PdfBannerBlock {
  type: 'banner';
  eyebrow?: string;
  title: string;
  subtitle?: string;
  style?: PdfBlockStyle;
}

export interface PdfCalloutBlock {
  type: 'callout';
  eyebrow?: string;
  title?: string;
  text?: string;
  items?: string[];
  style?: PdfBlockStyle;
}

export interface PdfCardItem {
  eyebrow?: string;
  title: string;
  text?: string;
  accentColor?: string;
  backgroundColor?: string;
}

export interface PdfCardsBlock {
  type: 'cards';
  cardColumns?: number;
  cards: PdfCardItem[];
  style?: PdfBlockStyle;
}

export interface PdfColumnItem {
  eyebrow?: string;
  title?: string;
  text?: string;
  items?: string[];
  accentColor?: string;
}

export interface PdfColumnsBlock {
  type: 'columns';
  columns: PdfColumnItem[];
  style?: PdfBlockStyle;
}

export interface PdfFlowStep {
  label?: string;
  title: string;
  text?: string;
  accentColor?: string;
}

export interface PdfFlowBlock {
  type: 'flow';
  steps: PdfFlowStep[];
  style?: PdfBlockStyle;
}

export interface PdfDividerBlock {
  type: 'divider';
  style?: PdfBlockStyle;
}

export interface PdfSpacerBlock {
  type: 'spacer';
  sizePt?: number;
}

export type RichDocumentBlock =
  | DocxBlock
  | PdfBannerBlock
  | PdfCalloutBlock
  | PdfCardsBlock
  | PdfColumnsBlock
  | PdfFlowBlock
  | PdfDividerBlock
  | PdfSpacerBlock;

export interface RichPdfInput {
  filename: string;
  title?: string;
  design?: PdfDesign;
  blocks: RichDocumentBlock[];
}

export interface RenderRichPdfOptions {
  snapshotId?: string | null;
  signal?: AbortSignal;
  timeoutMs?: number;
}

export interface RenderRichPdfResult {
  buffer: Buffer;
  filename: string;
  fullText: string;
  totalPageCount: number | null;
  usedSnapshot: boolean;
  elapsedMs: number;
}

const DEFAULT_DESIGN: Required<Omit<PdfDesign, 'locale'>> & { locale: string } = {
  pageSize: 'A4',
  orientation: 'portrait',
  marginMm: 16,
  backgroundColor: '#ffffff',
  textColor: '#172033',
  mutedColor: '#667085',
  accentColor: '#1f5f74',
  accentColor2: '#3459a6',
  accentColor3: '#9a3d73',
  fontFamily: 'sans',
  headingFontFamily: 'sans',
  bodySizePt: 10.5,
  lineHeight: 1.45,
  locale: 'en',
};

function cleanText(value: unknown, maxLength = 30000): string {
  if (typeof value !== 'string') return '';
  return value.replace(/\u0000/g, '').trim().slice(0, maxLength);
}

function escapeHtml(value: string): string {
  return value
    .replace(/&/g, '&amp;')
    .replace(/</g, '&lt;')
    .replace(/>/g, '&gt;')
    .replace(/"/g, '&quot;')
    .replace(/'/g, '&#39;');
}

function safeColor(value: unknown, fallback: string): string {
  if (typeof value !== 'string') return fallback;
  const trimmed = value.trim();
  return /^#[0-9a-fA-F]{3,8}$/.test(trimmed) ? trimmed : fallback;
}

function clampNumber(value: unknown, fallback: number, min: number, max: number): number {
  return typeof value === 'number' && Number.isFinite(value)
    ? Math.max(min, Math.min(max, value))
    : fallback;
}

function fontStack(value: PdfFontFamily | undefined): string {
  switch (value) {
    case 'serif':
      return 'Georgia, "Times New Roman", serif';
    case 'mono':
      return '"Courier New", monospace';
    case 'jp-sans':
      return '"Noto Sans CJK JP", "Yu Gothic", "Hiragino Kaku Gothic ProN", Arial, sans-serif';
    case 'jp-serif':
      return '"Noto Serif CJK JP", "Yu Mincho", "Hiragino Mincho ProN", Georgia, serif';
    default:
      return 'Arial, Helvetica, sans-serif';
  }
}

function normalizeDesign(input?: PdfDesign): Required<Omit<PdfDesign, 'locale'>> & { locale: string } {
  return {
    pageSize: input?.pageSize === 'LETTER' ? 'LETTER' : 'A4',
    orientation: input?.orientation === 'landscape' ? 'landscape' : 'portrait',
    marginMm: clampNumber(input?.marginMm, DEFAULT_DESIGN.marginMm, 6, 35),
    backgroundColor: safeColor(input?.backgroundColor, DEFAULT_DESIGN.backgroundColor),
    textColor: safeColor(input?.textColor, DEFAULT_DESIGN.textColor),
    mutedColor: safeColor(input?.mutedColor, DEFAULT_DESIGN.mutedColor),
    accentColor: safeColor(input?.accentColor, DEFAULT_DESIGN.accentColor),
    accentColor2: safeColor(input?.accentColor2, DEFAULT_DESIGN.accentColor2),
    accentColor3: safeColor(input?.accentColor3, DEFAULT_DESIGN.accentColor3),
    fontFamily: input?.fontFamily || DEFAULT_DESIGN.fontFamily,
    headingFontFamily: input?.headingFontFamily || input?.fontFamily || DEFAULT_DESIGN.headingFontFamily,
    bodySizePt: clampNumber(input?.bodySizePt, DEFAULT_DESIGN.bodySizePt, 8, 15),
    lineHeight: clampNumber(input?.lineHeight, DEFAULT_DESIGN.lineHeight, 1.05, 1.9),
    locale: cleanText(input?.locale, 20) || DEFAULT_DESIGN.locale,
  };
}

function styleValues(style: PdfBlockStyle | undefined, design: ReturnType<typeof normalizeDesign>) {
  return {
    backgroundColor: safeColor(style?.backgroundColor, 'transparent'),
    textColor: safeColor(style?.textColor, design.textColor),
    accentColor: safeColor(style?.accentColor, design.accentColor),
    borderColor: safeColor(style?.borderColor, '#d9e0e8'),
    borderWidthPt: clampNumber(style?.borderWidthPt, 0, 0, 5),
    radiusPt: clampNumber(style?.radiusPt, 0, 0, 30),
    paddingPt: clampNumber(style?.paddingPt, 0, 0, 48),
    marginTopPt: clampNumber(style?.marginTopPt, 0, 0, 72),
    marginBottomPt: clampNumber(style?.marginBottomPt, 8, 0, 72),
    align: style?.align === 'center' || style?.align === 'right' ? style.align : 'left',
    fontSizePt: clampNumber(style?.fontSizePt, design.bodySizePt, 7, 42),
    fontWeight: clampNumber(style?.fontWeight, 400, 300, 800),
  };
}

function boxStyle(style: PdfBlockStyle | undefined, design: ReturnType<typeof normalizeDesign>): string {
  const s = styleValues(style, design);
  return [
    s.backgroundColor !== 'transparent' ? `background:${s.backgroundColor}` : '',
    s.textColor ? `color:${s.textColor}` : '',
    s.borderWidthPt > 0 ? `border:${s.borderWidthPt}pt solid ${s.borderColor}` : '',
    s.radiusPt > 0 ? `border-radius:${s.radiusPt}pt` : '',
    s.paddingPt > 0 ? `padding:${s.paddingPt}pt` : '',
    `margin-top:${s.marginTopPt}pt`,
    `margin-bottom:${s.marginBottomPt}pt`,
    `text-align:${s.align}`,
    `font-size:${s.fontSizePt}pt`,
    `font-weight:${s.fontWeight}`,
    'page-break-inside:avoid',
  ].filter(Boolean).join(';');
}

function paragraphsFromText(text: string): string {
  return cleanText(text)
    .split(/\n{2,}/)
    .map((part) => `<p style="margin:0 0 7pt 0;">${escapeHtml(part).replace(/\n/g, '<br/>')}</p>`)
    .join('');
}

function renderBulletItems(items: string[], ordered: boolean): string {
  const tag = ordered ? 'ol' : 'ul';
  const cleanItems = (items || []).map((v) => cleanText(v, 10000)).filter(Boolean).slice(0, 200);
  if (cleanItems.length === 0) return '';
  return `<${tag} style="margin:4pt 0 8pt 17pt;padding:0;">${cleanItems
    .map((item) => `<li style="margin:0 0 4pt 0;">${escapeHtml(item)}</li>`)
    .join('')}</${tag}>`;
}

function renderTable(block: DocxBlock, design: ReturnType<typeof normalizeDesign>): string {
  const headers = (block.headers || []).map((v) => cleanText(v, 5000));
  const rows = (block.rows || []).slice(0, 100).map((row) =>
    (row || []).map((v) => cleanText(v, 5000))
  );
  const columnCount = Math.max(headers.length, ...rows.map((r) => r.length), 1);
  const head = headers.length
    ? `<tr>${Array.from({ length: columnCount }, (_, i) =>
        `<th style="padding:7pt 8pt;background:${design.accentColor};color:#ffffff;border:0.5pt solid ${design.accentColor};text-align:left;font-size:${Math.max(8, design.bodySizePt - 0.5)}pt;">${escapeHtml(headers[i] || '')}</th>`
      ).join('')}</tr>`
    : '';
  const body = rows.map((row, rowIndex) =>
    `<tr>${Array.from({ length: columnCount }, (_, i) =>
      `<td style="padding:6pt 8pt;background:${rowIndex % 2 ? '#f7f9fb' : '#ffffff'};border:0.5pt solid #d9e0e8;vertical-align:top;font-size:${Math.max(8, design.bodySizePt - 0.5)}pt;">${escapeHtml(row[i] || '')}</td>`
    ).join('')}</tr>`
  ).join('');
  return `<table cellspacing="0" cellpadding="0" style="width:100%;border-collapse:collapse;margin:5pt 0 10pt 0;page-break-inside:avoid;">${head}${body}</table>`;
}

function renderImage(block: DocxBlock, design: ReturnType<typeof normalizeDesign>): string {
  if (!block.imageData || !Buffer.isBuffer(block.imageData) || block.imageData.length === 0) return '';
  const contentType = cleanText(block.imageContentType, 100) || 'image/png';
  const b64 = block.imageData.toString('base64');
  const width = block.size === 'small' ? '35%' : block.size === 'medium' ? '58%' : block.size === 'full' ? '100%' : '82%';
  const align = block.alignment === 'left' ? 'left' : block.alignment === 'right' ? 'right' : 'center';
  const margin = align === 'left' ? '8pt auto 10pt 0' : align === 'right' ? '8pt 0 10pt auto' : '8pt auto 10pt auto';
  const caption = cleanText(block.caption, 2000);
  return `<div style="text-align:${align};margin:0 0 10pt 0;page-break-inside:avoid;">
    <img src="data:${escapeHtml(contentType)};base64,${b64}" alt="${escapeHtml(cleanText(block.imageAltText || block.need || block.prompt || 'Document image', 500))}" style="display:block;width:${width};height:auto;margin:${margin};"/>
    ${caption ? `<div style="font-size:${Math.max(8, design.bodySizePt - 1.5)}pt;color:${design.mutedColor};margin-top:3pt;">${escapeHtml(caption)}</div>` : ''}
  </div>`;
}

function renderCards(block: PdfCardsBlock, design: ReturnType<typeof normalizeDesign>): string {
  const items = (block.cards || []).slice(0, 16);
  if (items.length === 0) return '';
  const cols = Math.max(1, Math.min(4, Math.floor(block.cardColumns || 2)));
  const rows: string[] = [];
  for (let start = 0; start < items.length; start += cols) {
    const chunk = items.slice(start, start + cols);
    const cells = Array.from({ length: cols }, (_, offset) => {
      const item = chunk[offset];
      if (!item) return '<td style="width:25%;padding:4pt;border:none;"></td>';
      const accent = safeColor(item.accentColor, [design.accentColor, design.accentColor2, design.accentColor3][(start + offset) % 3]);
      const bg = safeColor(item.backgroundColor, '#f6f8fb');
      return `<td style="width:${100 / cols}%;padding:4pt;vertical-align:top;border:none;">
        <div style="background:${bg};border:0.6pt solid #dce3ea;border-left:3pt solid ${accent};padding:9pt 10pt;page-break-inside:avoid;">
          ${item.eyebrow ? `<div style="font-size:7.5pt;font-weight:700;color:${accent};letter-spacing:0.7pt;text-transform:uppercase;margin-bottom:4pt;">${escapeHtml(cleanText(item.eyebrow, 200))}</div>` : ''}
          <div style="font-family:${fontStack(design.headingFontFamily)};font-size:${design.bodySizePt + 1.3}pt;font-weight:700;margin-bottom:4pt;color:${design.textColor};">${escapeHtml(cleanText(item.title, 500))}</div>
          ${item.text ? `<div style="font-size:${Math.max(8, design.bodySizePt - 0.4)}pt;color:${design.textColor};line-height:${design.lineHeight};">${escapeHtml(cleanText(item.text, 4000))}</div>` : ''}
        </div>
      </td>`;
    }).join('');
    rows.push(`<tr>${cells}</tr>`);
  }
  return `<table cellspacing="0" cellpadding="0" style="width:100%;border-collapse:collapse;margin:2pt -4pt 10pt -4pt;page-break-inside:avoid;">${rows.join('')}</table>`;
}

function renderColumns(block: PdfColumnsBlock, design: ReturnType<typeof normalizeDesign>): string {
  const cols = (block.columns || []).slice(0, 4);
  if (cols.length === 0) return '';
  return `<table cellspacing="0" cellpadding="0" style="width:100%;border-collapse:collapse;margin:4pt 0 10pt 0;page-break-inside:avoid;"><tr>${cols.map((col, index) => {
    const accent = safeColor(col.accentColor, [design.accentColor, design.accentColor2, design.accentColor3][index % 3]);
    return `<td style="width:${100 / cols.length}%;vertical-align:top;padding:${index === 0 ? '0 7pt 0 0' : index === cols.length - 1 ? '0 0 0 7pt' : '0 7pt'};border:none;">
      ${col.eyebrow ? `<div style="font-size:7.5pt;font-weight:700;color:${accent};text-transform:uppercase;letter-spacing:.6pt;margin-bottom:4pt;">${escapeHtml(cleanText(col.eyebrow, 200))}</div>` : ''}
      ${col.title ? `<div style="font-family:${fontStack(design.headingFontFamily)};font-size:${design.bodySizePt + 1.2}pt;font-weight:700;margin-bottom:4pt;color:${design.textColor};">${escapeHtml(cleanText(col.title, 500))}</div>` : ''}
      ${col.text ? `<div style="font-size:${Math.max(8, design.bodySizePt - 0.2)}pt;line-height:${design.lineHeight};">${escapeHtml(cleanText(col.text, 4000))}</div>` : ''}
      ${col.items?.length ? renderBulletItems(col.items, false) : ''}
    </td>`;
  }).join('')}</tr></table>`;
}

function renderFlow(block: PdfFlowBlock, design: ReturnType<typeof normalizeDesign>): string {
  const steps = (block.steps || []).slice(0, 7);
  if (steps.length === 0) return '';
  const cells: string[] = [];
  steps.forEach((step, index) => {
    const accent = safeColor(step.accentColor, [design.accentColor, design.accentColor2, design.accentColor3][index % 3]);
    cells.push(`<td style="vertical-align:middle;padding:0 4pt;border:none;">
      <div style="background:${accent};color:#ffffff;padding:8pt 7pt;text-align:center;page-break-inside:avoid;">
        ${step.label ? `<div style="font-size:7pt;opacity:.85;text-transform:uppercase;letter-spacing:.5pt;margin-bottom:3pt;">${escapeHtml(cleanText(step.label, 120))}</div>` : ''}
        <div style="font-size:${Math.max(8, design.bodySizePt - 0.2)}pt;font-weight:700;">${escapeHtml(cleanText(step.title, 300))}</div>
        ${step.text ? `<div style="font-size:${Math.max(7, design.bodySizePt - 2)}pt;margin-top:3pt;">${escapeHtml(cleanText(step.text, 1000))}</div>` : ''}
      </div>
    </td>`);
    if (index < steps.length - 1) {
      cells.push(`<td style="width:16pt;text-align:center;vertical-align:middle;border:none;color:${design.mutedColor};font-size:13pt;">&#8594;</td>`);
    }
  });
  return `<table cellspacing="0" cellpadding="0" style="width:100%;border-collapse:collapse;margin:5pt 0 11pt 0;page-break-inside:avoid;"><tr>${cells.join('')}</tr></table>`;
}

function renderBlock(block: RichDocumentBlock, design: ReturnType<typeof normalizeDesign>): string {
  switch (block.type) {
    case 'heading': {
      const level = Math.max(1, Math.min(3, Math.floor(block.level || 1)));
      const sizes = [0, design.bodySizePt + 10, design.bodySizePt + 5, design.bodySizePt + 2.5];
      return `<div style="font-family:${fontStack(design.headingFontFamily)};font-size:${sizes[level]}pt;font-weight:700;color:${design.textColor};margin:${level === 1 ? 12 : 9}pt 0 5pt 0;page-break-after:avoid;">${escapeHtml(cleanText(block.text))}</div>`;
    }
    case 'paragraph':
      return `<div style="margin:0 0 8pt 0;">${paragraphsFromText(block.text || '')}</div>`;
    case 'bullets':
      return renderBulletItems(block.items || [], false);
    case 'numbered':
      return renderBulletItems(block.items || [], true);
    case 'table':
      return renderTable(block, design);
    case 'image':
      return renderImage(block, design);
    case 'page_break':
      return '<div style="page-break-before:always;height:0;"></div>';
    case 'banner': {
      const s = styleValues(block.style, design);
      const bg = block.style?.backgroundColor
        ? safeColor(block.style.backgroundColor, design.accentColor)
        : design.accentColor;
      const fg = block.style?.textColor
        ? safeColor(block.style.textColor, '#ffffff')
        : '#ffffff';
      return `<div style="background:${bg};color:${fg};padding:${Math.max(14, s.paddingPt || 18)}pt;margin:${s.marginTopPt}pt 0 ${Math.max(10, s.marginBottomPt)}pt 0;page-break-inside:avoid;">
        ${block.eyebrow ? `<div style="font-size:7.5pt;font-weight:700;letter-spacing:1.4pt;text-transform:uppercase;margin-bottom:8pt;opacity:.9;">${escapeHtml(cleanText(block.eyebrow, 200))}</div>` : ''}
        <div style="font-family:${fontStack(design.headingFontFamily)};font-size:${Math.max(20, s.fontSizePt || design.bodySizePt + 14)}pt;font-weight:700;line-height:1.08;margin-bottom:${block.subtitle ? 7 : 0}pt;">${escapeHtml(cleanText(block.title, 1000))}</div>
        ${block.subtitle ? `<div style="font-size:${design.bodySizePt + 0.4}pt;line-height:1.35;opacity:.92;">${escapeHtml(cleanText(block.subtitle, 3000))}</div>` : ''}
      </div>`;
    }
    case 'callout': {
      const s = styleValues(block.style, design);
      const bg = block.style?.backgroundColor ? safeColor(block.style.backgroundColor, '#f3f7fa') : '#f3f7fa';
      const accent = safeColor(block.style?.accentColor, design.accentColor);
      return `<div style="background:${bg};border:0.6pt solid ${s.borderColor};border-left:3pt solid ${accent};padding:${Math.max(9, s.paddingPt || 10)}pt 11pt;margin:${s.marginTopPt}pt 0 ${Math.max(8, s.marginBottomPt)}pt 0;page-break-inside:avoid;">
        ${block.eyebrow ? `<div style="font-size:7.5pt;font-weight:700;color:${accent};letter-spacing:.7pt;text-transform:uppercase;margin-bottom:4pt;">${escapeHtml(cleanText(block.eyebrow, 200))}</div>` : ''}
        ${block.title ? `<div style="font-family:${fontStack(design.headingFontFamily)};font-size:${design.bodySizePt + 1.5}pt;font-weight:700;margin-bottom:4pt;">${escapeHtml(cleanText(block.title, 500))}</div>` : ''}
        ${block.text ? paragraphsFromText(block.text) : ''}
        ${block.items?.length ? renderBulletItems(block.items, false) : ''}
      </div>`;
    }
    case 'cards':
      return `<div style="${boxStyle(block.style, design)}">${renderCards(block, design)}</div>`;
    case 'columns':
      return `<div style="${boxStyle(block.style, design)}">${renderColumns(block, design)}</div>`;
    case 'flow':
      return `<div style="${boxStyle(block.style, design)}">${renderFlow(block, design)}</div>`;
    case 'divider': {
      const s = styleValues(block.style, design);
      return `<div style="height:0;border-top:${Math.max(.5, s.borderWidthPt || .7)}pt solid ${s.borderColor};margin:${Math.max(4, s.marginTopPt)}pt 0 ${Math.max(7, s.marginBottomPt)}pt 0;"></div>`;
    }
    case 'spacer':
      return `<div style="height:${clampNumber(block.sizePt, 10, 2, 72)}pt;"></div>`;
    default:
      return '';
  }
}

function fullTextForBlock(block: RichDocumentBlock): string[] {
  switch (block.type) {
    case 'heading':
    case 'paragraph':
      return block.text ? [block.text] : [];
    case 'bullets':
      return (block.items || []).map((item) => `• ${item}`);
    case 'numbered':
      return (block.items || []).map((item, index) => `${index + 1}. ${item}`);
    case 'table':
      return [
        ...(block.headers?.length ? [block.headers.join(' | ')] : []),
        ...(block.rows || []).map((row) => row.join(' | ')),
      ];
    case 'image': {
      const label = block.caption || block.imageAltText || block.need || block.prompt || block.filename;
      return label ? [`[Image: ${label}]`] : [];
    }
    case 'banner':
      return [block.eyebrow, block.title, block.subtitle].filter(Boolean) as string[];
    case 'callout':
      return [
        block.eyebrow,
        block.title,
        block.text,
        ...(block.items || []),
      ].filter(Boolean) as string[];
    case 'cards':
      return (block.cards || []).flatMap((item) => [item.eyebrow, item.title, item.text].filter(Boolean) as string[]);
    case 'columns':
      return (block.columns || []).flatMap((col) => [col.eyebrow, col.title, col.text, ...(col.items || [])].filter(Boolean) as string[]);
    case 'flow':
      return (block.steps || []).flatMap((step) => [step.label, step.title, step.text].filter(Boolean) as string[]);
    default:
      return [];
  }
}

function sanitizePdfFilename(value: string): string {
  const raw = cleanText(value, 160) || 'document.pdf';
  const base = (raw.split(/[\\/]/).pop() || 'document')
    .replace(/[\u0000-\u001f\u007f]/g, '')
    .replace(/[<>:"/\\|?*]/g, '-')
    .replace(/\s+/g, ' ')
    .trim()
    .replace(/^\.+/, '')
    .replace(/\.(docx|pdf)$/i, '')
    .slice(0, 130) || 'document';
  return `${base}.pdf`;
}

function parsePdfPageCount(raw: string): number | null {
  const match = raw.match(/^Pages:\s+(\d+)$/im);
  if (!match) return null;
  const parsed = Number(match[1]);
  return Number.isFinite(parsed) && parsed > 0 ? parsed : null;
}

function buildHtml(input: RichPdfInput): { html: string; fullText: string } {
  const design = normalizeDesign(input.design);
  const blocks = Array.isArray(input.blocks) ? input.blocks.slice(0, 200) : [];
  const title = cleanText(input.title, 1000);
  const fullText = [
    title,
    ...blocks.flatMap(fullTextForBlock),
  ].filter(Boolean).join('\n\n').trim();

  if (!fullText && !blocks.some((block) => block.type === 'image')) {
    throw new Error('PDF content cannot be empty.');
  }

  const pageSize =
    design.pageSize === 'LETTER'
      ? design.orientation === 'landscape' ? '11in 8.5in' : '8.5in 11in'
      : design.orientation === 'landscape' ? '297mm 210mm' : '210mm 297mm';

  const titleHtml = title
    ? `<div style="font-family:${fontStack(design.headingFontFamily)};font-size:${design.bodySizePt + 12}pt;font-weight:700;line-height:1.08;margin:0 0 11pt 0;color:${design.textColor};">${escapeHtml(title)}</div>`
    : '';

  const html = `<!doctype html>
<html lang="${escapeHtml(design.locale)}">
<head>
<meta charset="utf-8"/>
<style>
@page { size: ${pageSize}; margin: ${design.marginMm}mm; }
html, body { margin:0; padding:0; background:${design.backgroundColor}; }
body {
  color:${design.textColor};
  font-family:${fontStack(design.fontFamily)};
  font-size:${design.bodySizePt}pt;
  line-height:${design.lineHeight};
}
table { font-family:${fontStack(design.fontFamily)}; color:${design.textColor}; }
p { orphans:3; widows:3; }
</style>
</head>
<body>
${titleHtml}
${blocks.map((block) => renderBlock(block, design)).join('\n')}
</body>
</html>`;

  return { html, fullText };
}

export async function renderRichPdf(
  input: RichPdfInput,
  options: RenderRichPdfOptions = {}
): Promise<RenderRichPdfResult> {
  const startedAt = Date.now();
  const { html, fullText } = buildHtml(input);
  const filename = sanitizePdfFilename(input.filename);
  const snapshotId =
    options.snapshotId?.trim() ||
    process.env.DOCX_RENDERER_SNAPSHOT_ID?.trim();
  const usedSnapshot = Boolean(snapshotId);
  const timeoutMs = Math.max(15_000, Math.min(options.timeoutMs ?? 35_000, 60_000));

  if (options.signal?.aborted) {
    throw new DOMException('Rich PDF rendering aborted.', 'AbortError');
  }

  const sandbox = snapshotId
    ? await Sandbox.create({
        source: { type: 'snapshot', snapshotId },
        persistent: false,
        timeout: timeoutMs,
        networkPolicy: 'allow-all',
      })
    : await Sandbox.create({
        persistent: false,
        timeout: timeoutMs,
        networkPolicy: 'allow-all',
      });

  const abortHandler = () => {
    void sandbox.stop().catch(() => undefined);
  };
  options.signal?.addEventListener('abort', abortHandler, { once: true });

  try {
    const { libreOfficePath } = await installDocxRendererDependencies(sandbox);

    await sandbox.writeFiles([
      {
        path: '/vercel/sandbox/input.html',
        content: Buffer.from(html, 'utf8'),
      },
    ]);

    const convert = await sandbox.runCommand({
      cmd: libreOfficePath,
      args: [
        '--headless',
        '--convert-to',
        'pdf:writer_pdf_Export',
        '--outdir',
        '/vercel/sandbox',
        '/vercel/sandbox/input.html',
      ],
    });

    if (convert.exitCode !== 0) {
      const stderr = (await convert.stderr()).trim();
      const stdout = (await convert.stdout()).trim();
      throw new Error(
        `Rich HTML to PDF conversion failed (exit ${convert.exitCode}): ${(stderr || stdout || 'unknown error').slice(-4000)}`
      );
    }

    const pdfInfo = await sandbox.runCommand({
      cmd: 'pdfinfo',
      args: ['/vercel/sandbox/input.pdf'],
    });
    if (pdfInfo.exitCode !== 0) {
      const stderr = (await pdfInfo.stderr()).trim();
      throw new Error(`Generated rich PDF inspection failed: ${stderr || 'unknown error'}`);
    }

    const totalPageCount = parsePdfPageCount(await pdfInfo.stdout());
    const buffer = await sandbox.readFileToBuffer({
      path: '/vercel/sandbox/input.pdf',
    });
    if (!buffer || buffer.length === 0) {
      throw new Error('Rich PDF renderer produced an empty file.');
    }

    return {
      buffer,
      filename,
      fullText,
      totalPageCount,
      usedSnapshot,
      elapsedMs: Date.now() - startedAt,
    };
  } finally {
    options.signal?.removeEventListener('abort', abortHandler);
    await sandbox.stop().catch(() => undefined);
  }
}
