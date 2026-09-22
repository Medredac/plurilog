import mammoth from 'mammoth';
import TurndownService from 'turndown';
// @ts-ignore
import { gfm } from 'turndown-plugin-gfm';

export interface EmbeddedDocxImage {
  index: number;
  contentType: string;
  extension: string;
  data: Buffer;
  altText?: string;
}

export interface ParseDocxResult {
  fullText: string;
  markdown: string;
  headingsCount: number;
  tablesCount: number;
  paragraphsCount: number;
  embeddedImages: EmbeddedDocxImage[];
  warnings?: string[];
}

/**
 * Preprocesses HTML table markup from mammoth to ensure all tables
 * (even those without explicit <th> or <thead>) convert cleanly to GFM Markdown tables.
 */
function normalizeHtmlTables(html: string): string {
  return html.replace(/<table>([\s\S]*?)<\/table>/gi, (match, inner) => {
    // 1. Unwrap <p> tags inside table cells (td and th) to prevent multiline block breaks within table cells
    let cleaned = inner.replace(/<(td|th)(\s*[^>]*)?>([\s\S]*?)<\/\1>/gi, (_match: string, tag: string, attrs: string, content: string) => {
      const unwrapped = (content || '').replace(/<\/?p[^>]*>/gi, ' ').replace(/\s+/g, ' ').trim();
      const attrStr = attrs || '';
      return `<${tag}${attrStr}>${unwrapped}</${tag}>`;
    });

    // 2. If table doesn't have <thead> or <th>, prepend a synthetic empty structural header row
    // so every original Word row is preserved as a data row in <tbody> without inventing labels.
    if (!cleaned.includes('<thead>') && !cleaned.includes('<th>')) {
      const firstRowMatch = cleaned.match(/<tr>([\s\S]*?)<\/tr>/i);
      if (firstRowMatch) {
        const firstRowCells = firstRowMatch[1].match(/<td(\s*[^>]*)?>/gi) || [];
        const colCount = Math.max(firstRowCells.length, 1);
        const emptyThs = '<th></th>'.repeat(colCount);
        const structuralHeader = `<thead><tr>${emptyThs}</tr></thead>`;
        return `<table>${structuralHeader}<tbody>${cleaned}</tbody></table>`;
      }
    }

    return `<table>${cleaned}</table>`;
  });
}

/**
 * Parses a DOCX buffer into clean, structured, deterministic Markdown.
 * Preserves paragraphs, headings (H1-H6), bullet/numbered lists, and tables.
 * Ignores embedded images for DOCX V1.
 */
export async function parseDocx(
  buffer: Buffer | ArrayBuffer | Uint8Array
): Promise<ParseDocxResult> {
  if (!buffer || (Buffer.isBuffer(buffer) && buffer.length === 0)) {
    return {
      fullText: '',
      markdown: '',
      headingsCount: 0,
      tablesCount: 0,
      paragraphsCount: 0,
      embeddedImages: [],
    };
  }

  const nodeBuffer = Buffer.isBuffer(buffer) ? buffer : Buffer.from(buffer as any);

  if (nodeBuffer.length === 0) {
    return {
      fullText: '',
      markdown: '',
      headingsCount: 0,
      tablesCount: 0,
      paragraphsCount: 0,
      embeddedImages: [],
    };
  }

  // Convert DOCX to structured HTML while extracting embedded raster images.
  // The images are returned separately for Plurilog's visual-artifact pipeline;
  // the semantic Markdown remains text-only so binary/image content is never
  // stuffed into document memory.
  const embeddedImages: EmbeddedDocxImage[] = [];
  const extensionForContentType = (contentType: string): string => {
    const normalized = (contentType || '').toLowerCase();
    if (normalized === 'image/jpeg' || normalized === 'image/jpg') return 'jpg';
    if (normalized === 'image/png') return 'png';
    if (normalized === 'image/webp') return 'webp';
    if (normalized === 'image/gif') return 'gif';
    if (normalized === 'image/svg+xml') return 'svg';
    if (normalized === 'image/bmp') return 'bmp';
    if (normalized === 'image/tiff') return 'tiff';
    return 'bin';
  };

  const mammothResult = await mammoth.convertToHtml(
    { buffer: nodeBuffer },
    {
      convertImage: mammoth.images.imgElement(async (image: any) => {
        try {
          const base64 = await image.read('base64');
          const contentType =
            typeof image.contentType === 'string' && image.contentType.trim()
              ? image.contentType.trim().toLowerCase()
              : 'application/octet-stream';
          const extension = extensionForContentType(contentType);
          embeddedImages.push({
            index: embeddedImages.length,
            contentType,
            extension,
            data: Buffer.from(base64, 'base64'),
            ...(typeof image.altText === 'string' && image.altText.trim()
              ? { altText: image.altText.trim() }
              : {}),
          });
        } catch (imageErr) {
          console.warn('[DOCX Parser] Failed to extract embedded image:', imageErr);
        }

        // Mammoth still needs an imgElement result, but Plurilog delivers images
        // through its canonical visual-evidence system instead of data URIs in text.
        return { src: '' };
      }),
    }
  );

  let rawHtml = mammothResult.value || '';
  // Remove placeholder image tags from semantic text; the extracted image bytes
  // are preserved independently in embeddedImages.
  rawHtml = rawHtml.replace(/<img[^>]*>/gi, '');

  const headingsCount = (rawHtml.match(/<h[1-6][^>]*>/gi) || []).length;
  const tablesCount = (rawHtml.match(/<table[^>]*>/gi) || []).length;
  const paragraphsCount = (rawHtml.match(/<p[^>]*>/gi) || []).length;

  const normalizedHtml = normalizeHtmlTables(rawHtml);

  // Convert HTML to GFM Markdown with Turndown
  const turndownService = new TurndownService({
    headingStyle: 'atx',
    bulletListMarker: '-',
    codeBlockStyle: 'fenced',
    emDelimiter: '_',
  });

  turndownService.use(gfm);

  const fullText = turndownService.turndown(normalizedHtml).trim();

  return {
    fullText,
    markdown: fullText,
    headingsCount,
    tablesCount,
    paragraphsCount,
    embeddedImages,
    warnings: mammothResult.messages?.map((m: any) => m.message),
  };
}
