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
  headerText?: string;
  footerText?: string;
  showPageNumbers?: boolean;
  targetPageCount?: number;
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

export interface RenderedPdfReviewPage {
  pageNumber: number;
  data: Buffer;
  contentType: 'image/png';
}

export interface RenderRichPdfResult {
  buffer: Buffer;
  filename: string;
  fullText: string;
  totalPageCount: number | null;
  reviewPages: RenderedPdfReviewPage[];
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
  headerText: '',
  footerText: '',
  showPageNumbers: false,
  targetPageCount: 0,
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
    headerText: cleanText(input?.headerText, 180),
    footerText: cleanText(input?.footerText, 180),
    showPageNumbers: Boolean(input?.showPageNumbers),
    targetPageCount:
      typeof input?.targetPageCount === 'number' && Number.isFinite(input.targetPageCount)
        ? Math.max(0, Math.min(30, Math.floor(input.targetPageCount)))
        : 0,
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
  return `<div class="pdf-card-grid" style="grid-template-columns:repeat(${cols},minmax(0,1fr));">${items.map((item, index) => {
    const accent = safeColor(
      item.accentColor,
      design.accentColor
    );
    const bg = safeColor(item.backgroundColor, '#f6f8fb');
    return `<div class="pdf-card" style="--card-accent:${accent};background:${bg};">
      ${item.eyebrow ? `<div class="pdf-eyebrow" style="color:${accent};">${escapeHtml(cleanText(item.eyebrow, 200))}</div>` : ''}
      <div class="pdf-card-title" style="font-family:${fontStack(design.headingFontFamily)};">${escapeHtml(cleanText(item.title, 500))}</div>
      ${item.text ? `<div class="pdf-card-text">${escapeHtml(cleanText(item.text, 4000))}</div>` : ''}
    </div>`;
  }).join('')}</div>`;
}

function renderColumns(block: PdfColumnsBlock, design: ReturnType<typeof normalizeDesign>): string {
  const cols = (block.columns || []).slice(0, 4);
  if (cols.length === 0) return '';
  return `<div class="pdf-columns" style="grid-template-columns:repeat(${cols.length},minmax(0,1fr));">${cols.map((col, index) => {
    const accent = safeColor(
      col.accentColor,
      design.accentColor
    );
    return `<div class="pdf-column">
      ${col.eyebrow ? `<div class="pdf-eyebrow" style="color:${accent};">${escapeHtml(cleanText(col.eyebrow, 200))}</div>` : ''}
      ${col.title ? `<div class="pdf-column-title" style="font-family:${fontStack(design.headingFontFamily)};">${escapeHtml(cleanText(col.title, 500))}</div>` : ''}
      ${col.text ? `<div class="pdf-column-text">${escapeHtml(cleanText(col.text, 4000))}</div>` : ''}
      ${col.items?.length ? renderBulletItems(col.items, false) : ''}
    </div>`;
  }).join('')}</div>`;
}

function renderFlow(block: PdfFlowBlock, design: ReturnType<typeof normalizeDesign>): string {
  const steps = (block.steps || []).slice(0, 7);
  if (steps.length === 0) return '';
  return `<div class="pdf-flow">${steps.map((step, index) => {
    const accent = safeColor(
      step.accentColor,
      design.accentColor
    );
    return `<div class="pdf-flow-unit">
      <div class="pdf-flow-step" style="background:${accent};">
        ${step.label ? `<div class="pdf-flow-label">${escapeHtml(cleanText(step.label, 120))}</div>` : ''}
        <div class="pdf-flow-title">${escapeHtml(cleanText(step.title, 300))}</div>
        ${step.text ? `<div class="pdf-flow-text">${escapeHtml(cleanText(step.text, 1000))}</div>` : ''}
      </div>
      ${index < steps.length - 1 ? `<div class="pdf-flow-arrow" style="color:${design.mutedColor};">&#8594;</div>` : ''}
    </div>`;
  }).join('')}</div>`;
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

  const headerCss = design.headerText
    ? `@top-left {
        content: ${JSON.stringify(design.headerText)};
        color: ${design.mutedColor};
        font-family: ${fontStack(design.fontFamily)};
        font-size: 7.5pt;
      }`
    : '';

  const footerCss = design.footerText
    ? `@bottom-left {
        content: ${JSON.stringify(design.footerText)};
        color: ${design.mutedColor};
        font-family: ${fontStack(design.fontFamily)};
        font-size: 7.5pt;
      }`
    : '';

  const pageNumberCss = design.showPageNumbers
    ? `@bottom-right {
        content: "Page " counter(page) " / " counter(pages);
        color: ${design.mutedColor};
        font-family: ${fontStack(design.fontFamily)};
        font-size: 7.5pt;
      }`
    : '';

  const titleHtml = title
    ? `<div class="pdf-document-title" style="font-family:${fontStack(design.headingFontFamily)};color:${design.textColor};">${escapeHtml(title)}</div>`
    : '';

  const html = `<!doctype html>
<html lang="${escapeHtml(design.locale)}">
<head>
<meta charset="utf-8"/>
<style>
@page {
  size: ${pageSize};
  margin: ${design.marginMm}mm;
  background: ${design.backgroundColor};
  ${headerCss}
  ${footerCss}
  ${pageNumberCss}
}
* {
  box-sizing: border-box;
  -webkit-print-color-adjust: exact !important;
  print-color-adjust: exact !important;
}
html, body {
  margin: 0;
  padding: 0;
}
html {
  background: ${design.backgroundColor};
}
body {
  color: ${design.textColor};
  background: ${design.backgroundColor};
  font-family: ${fontStack(design.fontFamily)};
  font-size: ${design.bodySizePt}pt;
  line-height: ${design.lineHeight};
  text-rendering: geometricPrecision;
  font-kerning: normal;
}
.pdf-document-title {
  font-size: ${design.bodySizePt + 12}pt;
  font-weight: 750;
  line-height: 1.08;
  margin: 0 0 11pt 0;
  letter-spacing: -0.25pt;
  break-after: avoid;
}
.pdf-eyebrow {
  font-size: 7.1pt;
  font-weight: 750;
  letter-spacing: 0.8pt;
  text-transform: uppercase;
  margin-bottom: 4pt;
}
.pdf-card-grid {
  display: grid;
  gap: 9pt;
  margin: 4pt 0 11pt 0;
  break-inside: avoid;
}
.pdf-card {
  position: relative;
  min-width: 0;
  padding: 10pt 11pt 10pt 12pt;
  border: 0.6pt solid #dce3ea;
  border-radius: 7pt;
  break-inside: avoid;
  box-shadow: 0 1.5pt 4pt rgba(23,32,51,.06);
}
.pdf-card::before {
  content: "";
  position: absolute;
  left: 0;
  top: 0;
  bottom: 0;
  width: 3pt;
  border-radius: 7pt 0 0 7pt;
  background: var(--card-accent);
}
.pdf-card-title {
  color: ${design.textColor};
  font-size: ${design.bodySizePt + 1.2}pt;
  line-height: 1.2;
  font-weight: 750;
  margin-bottom: 4pt;
}
.pdf-card-text {
  color: ${design.textColor};
  font-size: ${Math.max(8, design.bodySizePt - 0.35)}pt;
  line-height: ${Math.max(1.28, design.lineHeight - 0.08)};
}
.pdf-columns {
  display: grid;
  gap: 13pt;
  margin: 5pt 0 11pt 0;
  align-items: start;
}
.pdf-column {
  min-width: 0;
  break-inside: avoid;
}
.pdf-column-title {
  color: ${design.textColor};
  font-size: ${design.bodySizePt + 1.15}pt;
  line-height: 1.2;
  font-weight: 750;
  margin-bottom: 4pt;
}
.pdf-column-text {
  font-size: ${Math.max(8, design.bodySizePt - 0.2)}pt;
  line-height: ${design.lineHeight};
}
.pdf-flow {
  display: flex;
  align-items: stretch;
  gap: 0;
  margin: 5pt 0 12pt 0;
  break-inside: avoid;
  width: 100%;
}
.pdf-flow-unit {
  display: flex;
  align-items: center;
  min-width: 0;
  flex: 1 1 0;
}
.pdf-flow-step {
  min-width: 0;
  width: 100%;
  color: #fff;
  padding: 8pt 7pt;
  border-radius: 5pt;
  text-align: center;
  break-inside: avoid;
}
.pdf-flow-label {
  font-size: 6.7pt;
  line-height: 1.15;
  opacity: .84;
  text-transform: uppercase;
  letter-spacing: .55pt;
  margin-bottom: 3pt;
}
.pdf-flow-title {
  font-size: ${Math.max(8, design.bodySizePt - 0.25)}pt;
  line-height: 1.15;
  font-weight: 750;
}
.pdf-flow-text {
  font-size: ${Math.max(7, design.bodySizePt - 2)}pt;
  line-height: 1.25;
  margin-top: 3pt;
  opacity: .92;
}
.pdf-flow-arrow {
  flex: 0 0 22pt;
  width: 22pt;
  text-align: center;
  font-size: 15pt;
  font-weight: 700;
}
table {
  font-family: ${fontStack(design.fontFamily)};
  color: ${design.textColor};
}
thead {
  display: table-header-group;
}
tr, img, blockquote {
  break-inside: avoid;
}
p {
  orphans: 3;
  widows: 3;
}
h1, h2, h3 {
  break-after: avoid;
}
</style>
</head>
<body>
${titleHtml}
${blocks.map((block) => renderBlock(block, design)).join('\n')}
</body>
</html>`;

  return { html, fullText };
}

async function assertSandboxCommand(
  result: Awaited<ReturnType<InstanceType<typeof Sandbox>['runCommand']>>,
  label: string
): Promise<void> {
  if (result.exitCode === 0) return;
  const stderr = (await result.stderr()).trim();
  const stdout = (await result.stdout()).trim();
  throw new Error(
    `${label} failed (exit ${result.exitCode}): ${(stderr || stdout || 'unknown error').slice(-4000)}`
  );
}

async function sandboxCommandPath(
  sandbox: InstanceType<typeof Sandbox>,
  candidates: string
): Promise<string | null> {
  const result = await sandbox.runCommand({
    cmd: 'sh',
    args: ['-lc', `for c in ${candidates}; do command -v "$c" 2>/dev/null && exit 0; done; exit 1`],
  });
  if (result.exitCode !== 0) return null;
  const value = (await result.stdout()).trim().split(/\r?\n/)[0]?.trim();
  return value || null;
}

async function workingChromePath(
  sandbox: InstanceType<typeof Sandbox>
): Promise<string | null> {
  const result = await sandbox.runCommand({
    cmd: 'sh',
    args: [
      '-lc',
      [
        'for c in google-chrome-stable google-chrome chromium chromium-browser; do',
        '  p=$(command -v "$c" 2>/dev/null || true);',
        '  [ -n "$p" ] || continue;',
        '  if "$p" --version >/dev/null 2>&1; then echo "$p"; exit 0; fi;',
        'done;',
        'exit 1',
      ].join(' '),
    ],
  });
  if (result.exitCode !== 0) return null;
  const value = (await result.stdout()).trim().split(/\r?\n/)[0]?.trim();
  return value || null;
}

async function installChromiumPdfDependencies(
  sandbox: InstanceType<typeof Sandbox>
): Promise<{ chromePath: string }> {
  let chromePath = await workingChromePath(sandbox);
  const pdfInfoPath = await sandboxCommandPath(sandbox, 'pdfinfo');

  if (chromePath && pdfInfoPath) {
    return { chromePath };
  }

  const probe = await sandbox.runCommand({
    cmd: 'sh',
    args: [
      '-lc',
      'if command -v dnf >/dev/null 2>&1; then echo dnf; elif command -v apt-get >/dev/null 2>&1; then echo apt-get; else echo none; fi',
    ],
  });
  await assertSandboxCommand(probe, 'PDF renderer package manager detection');
  const packageManager = (await probe.stdout()).trim();

  if (packageManager === 'dnf') {
    const baseInstall = await sandbox.runCommand({
      cmd: 'sh',
      args: ['-lc', 'sudo dnf install -y poppler-utils curl liberation-sans-fonts liberation-serif-fonts'],
    });
    await assertSandboxCommand(baseInstall, 'PDF renderer base dependency installation');

    // Best-effort multilingual fonts. These packages are present on current AL2023,
    // but a custom/older snapshot should not fail the whole renderer if one is absent.
    await sandbox.runCommand({
      cmd: 'sh',
      args: [
        '-lc',
        'sudo dnf install -y google-noto-sans-cjk-jp-fonts google-noto-serif-cjk-jp-fonts google-noto-emoji-color-fonts >/dev/null 2>&1 || true',
      ],
    });

    chromePath = await workingChromePath(sandbox);

    if (!chromePath) {
      const archResult = await sandbox.runCommand({ cmd: 'uname', args: ['-m'] });
      await assertSandboxCommand(archResult, 'PDF renderer architecture detection');
      const arch = (await archResult.stdout()).trim();
      if (arch !== 'x86_64' && arch !== 'amd64') {
        throw new Error(`Chrome PDF renderer currently requires x86_64 Sandbox; received ${arch}.`);
      }

      const chromeInstall = await sandbox.runCommand({
        cmd: 'sh',
        args: [
          '-lc',
          'sudo dnf install -y https://dl.google.com/linux/direct/google-chrome-stable_current_x86_64.rpm',
        ],
      });
      await assertSandboxCommand(chromeInstall, 'Google Chrome installation');
    }
  } else if (packageManager === 'apt-get') {
    const archResult = await sandbox.runCommand({ cmd: 'uname', args: ['-m'] });
    await assertSandboxCommand(archResult, 'PDF renderer architecture detection');
    const arch = (await archResult.stdout()).trim();
    if (arch !== 'x86_64' && arch !== 'amd64') {
      throw new Error(`Google Chrome PDF renderer currently requires x86_64 Sandbox; received ${arch}.`);
    }

    const install = await sandbox.runCommand({
      cmd: 'sh',
      args: [
        '-lc',
        [
          'set -eu',
          'sudo apt-get update -qq',
          'sudo apt-get install -y --no-install-recommends ca-certificates curl poppler-utils fonts-noto-cjk fonts-liberation',
          'curl -fL --retry 3 --connect-timeout 20 https://dl.google.com/linux/direct/google-chrome-stable_current_amd64.deb -o /tmp/google-chrome.deb',
          'sudo apt-get install -y /tmp/google-chrome.deb',
        ].join(' && '),
      ],
    });
    await assertSandboxCommand(install, 'Google Chrome PDF renderer dependency installation');
  } else {
    throw new Error('PDF renderer sandbox has neither dnf nor apt-get available.');
  }

  chromePath = await workingChromePath(sandbox);
  const finalPdfInfoPath = await sandboxCommandPath(sandbox, 'pdfinfo');

  if (!chromePath || !finalPdfInfoPath) {
    throw new Error('PDF renderer dependencies installed but Chrome/pdfinfo are unavailable.');
  }

  return { chromePath };
}

async function inspectPdfPageCount(
  sandbox: InstanceType<typeof Sandbox>,
  path: string
): Promise<number | null> {
  const pdfInfo = await sandbox.runCommand({
    cmd: 'pdfinfo',
    args: [path],
  });
  await assertSandboxCommand(pdfInfo, 'Generated PDF inspection');
  return parsePdfPageCount(await pdfInfo.stdout());
}

export interface RichPdfRenderSession {
  render: (input: RichPdfInput) => Promise<RenderRichPdfResult>;
  close: () => Promise<void>;
}

export async function createRichPdfRenderSession(
  options: RenderRichPdfOptions = {}
): Promise<RichPdfRenderSession> {
  const snapshotId =
    options.snapshotId?.trim() ||
    process.env.PDF_RENDERER_SNAPSHOT_ID?.trim() ||
    process.env.DOCX_RENDERER_SNAPSHOT_ID?.trim();
  const usedSnapshot = Boolean(snapshotId);
  const timeoutMs = Math.max(25_000, Math.min(options.timeoutMs ?? 90_000, 120_000));

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
    const { chromePath } = await installChromiumPdfDependencies(sandbox);
    let renderIndex = 0;

    return {
      render: async (input: RichPdfInput): Promise<RenderRichPdfResult> => {
        const startedAt = Date.now();
        const { html, fullText } = buildHtml(input);
        const design = normalizeDesign(input.design);
        const filename = sanitizePdfFilename(input.filename);
        const renderId = ++renderIndex;

        const targetPageCount = design.targetPageCount || 0;
        const scales =
          targetPageCount > 0
            ? [1, 0.96, 0.92, 0.88, 0.84]
            : [1];

        let selectedPath = '';
        let totalPageCount: number | null = null;
        let selectedScale = 1;

        for (const scale of scales) {
          if (options.signal?.aborted) {
            throw new DOMException('Rich PDF rendering aborted.', 'AbortError');
          }

          const scaledHtml =
            scale === 1
              ? html
              : html.replace(
                  '</style>',
                  `body { zoom: ${scale}; }\n</style>`
                );
          const scaleId = String(scale).replace('.', '_');
          const htmlPath = `/vercel/sandbox/input-${renderId}-${scaleId}.html`;
          const outputPath = `/vercel/sandbox/output-${renderId}-${scaleId}.pdf`;

          await sandbox.writeFiles([
            {
              path: htmlPath,
              content: Buffer.from(scaledHtml, 'utf8'),
            },
          ]);

          const render = await sandbox.runCommand({
            cmd: chromePath,
            args: [
              '--headless',
              '--no-sandbox',
              '--disable-gpu',
              '--disable-dev-shm-usage',
              '--disable-background-networking',
              '--disable-default-apps',
              '--no-first-run',
              '--no-default-browser-check',
              '--print-to-pdf-no-header',
              '--no-pdf-header-footer',
              `--print-to-pdf=${outputPath}`,
              `file://${htmlPath}`,
            ],
          });
          await assertSandboxCommand(render, 'Chromium PDF generation');

          const pages = await inspectPdfPageCount(sandbox, outputPath);
          selectedPath = outputPath;
          totalPageCount = pages;
          selectedScale = scale;

          if (!targetPageCount || pages === null || pages <= targetPageCount) {
            break;
          }
        }

        if (!selectedPath) {
          throw new Error('Chromium PDF renderer did not produce an output file.');
        }

        const buffer = await sandbox.readFileToBuffer({ path: selectedPath });
        if (!buffer || buffer.length === 0) {
          throw new Error('Chromium PDF renderer produced an empty file.');
        }

        const reviewPrefix = `/vercel/sandbox/review-${renderId}-page`;
        const reviewRender = await sandbox.runCommand({
          cmd: 'pdftoppm',
          args: [
            '-png',
            '-r',
            '96',
            '-f',
            '1',
            '-l',
            String(Math.min(totalPageCount || 6, 6)),
            selectedPath,
            reviewPrefix,
          ],
        });
        await assertSandboxCommand(reviewRender, 'PDF visual review rendering');

        const reviewList = await sandbox.runCommand({
          cmd: 'sh',
          args: [
            '-lc',
            `find /vercel/sandbox -maxdepth 1 -type f -name 'review-${renderId}-page-*.png' -printf '%f\\n' | sort -V`,
          ],
        });
        await assertSandboxCommand(reviewList, 'PDF visual review page enumeration');

        const reviewFilenames = (await reviewList.stdout())
          .split(/\r?\n/)
          .map((name) => name.trim())
          .filter(Boolean)
          .slice(0, 6);

        const reviewPages: RenderedPdfReviewPage[] = [];
        for (let index = 0; index < reviewFilenames.length; index += 1) {
          const pageData = await sandbox.readFileToBuffer({
            path: `/vercel/sandbox/${reviewFilenames[index]}`,
          });
          if (pageData?.length) {
            reviewPages.push({
              pageNumber: index + 1,
              data: pageData,
              contentType: 'image/png',
            });
          }
        }

        console.log('[Rich PDF Renderer]', {
          filename,
          renderId,
          targetPageCount: targetPageCount || null,
          pageCount: totalPageCount,
          scale: selectedScale,
          chromePath,
          usedSnapshot,
          byteSize: buffer.length,
          elapsedMs: Date.now() - startedAt,
        });

        return {
          buffer,
          filename,
          fullText,
          totalPageCount,
          reviewPages,
          usedSnapshot,
          elapsedMs: Date.now() - startedAt,
        };
      },
      close: async () => {
        options.signal?.removeEventListener('abort', abortHandler);
        await sandbox.stop().catch(() => undefined);
      },
    };
  } catch (error) {
    options.signal?.removeEventListener('abort', abortHandler);
    await sandbox.stop().catch(() => undefined);
    throw error;
  }
}

export async function renderRichPdf(
  input: RichPdfInput,
  options: RenderRichPdfOptions = {}
): Promise<RenderRichPdfResult> {
  const session = await createRichPdfRenderSession(options);
  try {
    return await session.render(input);
  } finally {
    await session.close();
  }
}
