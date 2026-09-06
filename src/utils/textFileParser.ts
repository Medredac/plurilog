import TurndownService from 'turndown';
// @ts-ignore
import { gfm } from 'turndown-plugin-gfm';

export const SUPPORTED_TEXT_EXTENSIONS = [
  '.txt',
  '.md',
  '.markdown',
  '.csv',
  '.tsv',
  '.json',
  '.html',
  '.htm',
  '.xml',
  '.yaml',
  '.yml',
] as const;

export type SupportedTextExtension = (typeof SUPPORTED_TEXT_EXTENSIONS)[number];

export interface ParseTextFileResult {
  fullText: string;
  markdown: string;
  headingsCount: number;
  tablesCount: number;
  paragraphsCount: number;
  warnings?: string[];
}

/**
 * Checks if a given filename has a supported text file extension.
 */
export function isTextFileName(filename?: string | null): boolean {
  if (!filename || typeof filename !== 'string') return false;
  const lower = filename.trim().toLowerCase();
  return SUPPORTED_TEXT_EXTENSIONS.some((ext) => lower.endsWith(ext));
}

/**
 * Checks if a URL or storage path points to a supported text file.
 */
export function isTextFileUrl(url?: string | null, storagePath?: string | null): boolean {
  if (!url && !storagePath) return false;
  const pathToCheck = (storagePath || url || '').split('?')[0].split('#')[0].toLowerCase();
  return SUPPORTED_TEXT_EXTENSIONS.some((ext) => pathToCheck.endsWith(ext));
}

/**
 * Extracts the canonical supported text extension from a filename or path.
 */
export function getTextFileExtension(filename?: string | null): SupportedTextExtension | null {
  if (!filename || typeof filename !== 'string') return null;
  const lower = filename.trim().toLowerCase().split('?')[0].split('#')[0];
  for (const ext of SUPPORTED_TEXT_EXTENSIONS) {
    if (lower.endsWith(ext)) return ext;
  }
  return null;
}

/**
 * Returns a clean, uppercase UI badge label for a text file.
 */
export function getTextFileDisplayBadge(filename?: string | null): string {
  const ext = getTextFileExtension(filename);
  if (!ext) return 'TXT';
  switch (ext) {
    case '.txt':
      return 'TXT';
    case '.md':
    case '.markdown':
      return 'MD';
    case '.csv':
      return 'CSV';
    case '.tsv':
      return 'TSV';
    case '.json':
      return 'JSON';
    case '.html':
    case '.htm':
      return 'HTML';
    case '.xml':
      return 'XML';
    case '.yaml':
    case '.yml':
      return 'YAML';
    default:
      return 'TXT';
  }
}

/**
 * Checks whether a buffer contains binary data or invalid non-printable control bytes.
 */
export function isBinaryBuffer(buffer: Buffer | Uint8Array): boolean {
  const checkLen = Math.min(buffer.length, 8192);
  let controlCharsCount = 0;

  for (let i = 0; i < checkLen; i++) {
    const byte = buffer[i];
    if (byte === 0x00) {
      return true; // Null byte indicates binary
    }
    // Allow tab (9), line feed (10), carriage return (13)
    if (byte < 0x09 || (byte > 0x0a && byte < 0x0d) || (byte > 0x0d && byte < 0x20)) {
      controlCharsCount++;
    }
  }

  // If more than 2% of the sampled characters are control characters, treat as binary
  if (checkLen > 0 && controlCharsCount / checkLen > 0.02) {
    return true;
  }

  return false;
}

/**
 * RFC 4180 compliant delimiter-separated parser supporting quoted fields,
 * escaped quotes, and embedded line breaks.
 */
export function parseDelimitedText(text: string, delimiter: string = ','): string[][] {
  const rows: string[][] = [];
  let currentRow: string[] = [];
  let currentCell = '';
  let inQuotes = false;
  let i = 0;

  while (i < text.length) {
    const char = text[i];
    const nextChar = text[i + 1];

    if (inQuotes) {
      if (char === '"') {
        if (nextChar === '"') {
          // Escaped quote: "" -> "
          currentCell += '"';
          i += 2;
          continue;
        } else {
          // Closing quote
          inQuotes = false;
          i++;
          continue;
        }
      } else {
        currentCell += char;
        i++;
        continue;
      }
    } else {
      if (char === '"') {
        inQuotes = true;
        i++;
        continue;
      } else if (char === delimiter) {
        currentRow.push(currentCell);
        currentCell = '';
        i++;
        continue;
      } else if (char === '\r') {
        if (nextChar === '\n') {
          i++;
        }
        currentRow.push(currentCell);
        currentCell = '';
        rows.push(currentRow);
        currentRow = [];
        i++;
        continue;
      } else if (char === '\n') {
        currentRow.push(currentCell);
        currentCell = '';
        rows.push(currentRow);
        currentRow = [];
        i++;
        continue;
      } else {
        currentCell += char;
        i++;
        continue;
      }
    }
  }

  if (currentCell !== '' || currentRow.length > 0) {
    currentRow.push(currentCell);
    rows.push(currentRow);
  }

  // Remove trailing completely empty row if caused by ending newline
  if (
    rows.length > 1 &&
    rows[rows.length - 1].length === 1 &&
    rows[rows.length - 1][0] === ''
  ) {
    rows.pop();
  }

  return rows;
}

/**
 * Formats parsed 2D row array into standard GFM table Markdown with deterministic
 * generated column headers ("Column 1", "Column 2", ...) and emits every source row
 * (including row 1) as a data row.
 */
export function formatRowsToGfmTable(rows: string[][]): string {
  if (rows.length === 0) return '';
  const maxCols = Math.max(...rows.map((r) => r.length), 1);
  const normalizedRows = rows.map((r) => {
    const padded = [...r];
    while (padded.length < maxCols) padded.push('');
    return padded;
  });

  const escapeCell = (cell: string) => {
    return cell
      .replace(/\|/g, '\\|')
      .replace(/\r?\n/g, ' ')
      .trim();
  };

  const headerColumns = Array.from({ length: maxCols }, (_, idx) => `Column ${idx + 1}`);
  const headerLine = `| ${headerColumns.join(' | ')} |`;
  const separatorLine = `| ${headerColumns.map(() => '---').join(' | ')} |`;

  const dataLines = normalizedRows.map(
    (row) => `| ${row.map((c) => escapeCell(c)).join(' | ')} |`
  );

  return [headerLine, separatorLine, ...dataLines].join('\n');
}

/**
 * Preprocesses HTML table markup to ensure clean conversion to GFM Markdown.
 */
function normalizeHtmlTables(html: string): string {
  return html.replace(/<table([\s\S]*?)<\/table>/gi, (_match, inner) => {
    let cleaned = inner.replace(/<(td|th)(\s*[^>]*)?>([\s\S]*?)<\/\1>/gi, (_m: string, tag: string, attrs: string, content: string) => {
      const unwrapped = (content || '').replace(/<\/?p[^>]*>/gi, ' ').replace(/\s+/g, ' ').trim();
      const attrStr = attrs || '';
      return `<${tag}${attrStr}>${unwrapped}</${tag}>`;
    });

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
 * Parses any supported Text Files V1 buffer into clean, structured Markdown.
 */
export async function parseTextFile(
  buffer: Buffer | ArrayBuffer | Uint8Array,
  filename?: string | null
): Promise<ParseTextFileResult> {
  if (!buffer || (Buffer.isBuffer(buffer) && buffer.length === 0)) {
    return {
      fullText: '',
      markdown: '',
      headingsCount: 0,
      tablesCount: 0,
      paragraphsCount: 0,
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
    };
  }

  // Reject binary files immediately
  if (isBinaryBuffer(nodeBuffer)) {
    throw new Error(`Cannot parse binary file as text: ${filename || 'unknown'}`);
  }

  // Decode strict UTF-8
  let rawText: string;
  try {
    const decoder = new TextDecoder('utf-8', { fatal: true });
    rawText = decoder.decode(nodeBuffer);
  } catch (_decErr) {
    throw new Error(`Invalid UTF-8 encoding in text file: ${filename || 'unknown'}`);
  }

  // Strip leading UTF-8 BOM if present
  rawText = rawText.replace(/^\uFEFF/, '');
  // Normalize CRLF / CR to standard LF
  rawText = rawText.replace(/\r\n/g, '\n').replace(/\r/g, '\n');

  const ext = getTextFileExtension(filename) || '.txt';
  const warnings: string[] = [];

  switch (ext) {
    case '.txt': {
      const trimmed = rawText.trim();
      const paragraphs = trimmed ? trimmed.split(/\n\s*\n/).filter(Boolean) : [];
      return {
        fullText: trimmed,
        markdown: trimmed,
        headingsCount: 0,
        tablesCount: 0,
        paragraphsCount: paragraphs.length,
      };
    }

    case '.md':
    case '.markdown': {
      const trimmed = rawText.trim();
      const headingsCount = (trimmed.match(/^#{1,6}\s+/gm) || []).length;
      const tablesCount = (trimmed.match(/\n\|[^-:\n]+\|\n\|[-:\s|]+\|/g) || []).length;
      const paragraphs = trimmed ? trimmed.split(/\n\s*\n/).filter(Boolean) : [];
      return {
        fullText: trimmed,
        markdown: trimmed,
        headingsCount,
        tablesCount,
        paragraphsCount: paragraphs.length,
      };
    }

    case '.csv': {
      const rows = parseDelimitedText(rawText, ',');
      const tableMd = formatRowsToGfmTable(rows);
      return {
        fullText: tableMd,
        markdown: tableMd,
        headingsCount: 0,
        tablesCount: rows.length > 0 ? 1 : 0,
        paragraphsCount: rows.length,
      };
    }

    case '.tsv': {
      const rows = parseDelimitedText(rawText, '\t');
      const tableMd = formatRowsToGfmTable(rows);
      return {
        fullText: tableMd,
        markdown: tableMd,
        headingsCount: 0,
        tablesCount: rows.length > 0 ? 1 : 0,
        paragraphsCount: rows.length,
      };
    }

    case '.json': {
      let formatted = '';
      try {
        const parsedJson = JSON.parse(rawText);
        formatted = JSON.stringify(parsedJson, null, 2);
      } catch (_jsonErr) {
        warnings.push('Malformed JSON syntax; preserved original text content');
        formatted = rawText;
      }
      return {
        fullText: formatted,
        markdown: formatted,
        headingsCount: 0,
        tablesCount: 0,
        paragraphsCount: formatted.trim() ? formatted.trim().split(/\n\s*\n/).filter(Boolean).length : 0,
        warnings: warnings.length > 0 ? warnings : undefined,
      };
    }

    case '.html':
    case '.htm': {
      const normalizedHtml = normalizeHtmlTables(rawText);

      const turndownService = new TurndownService({
        headingStyle: 'atx',
        bulletListMarker: '-',
        codeBlockStyle: 'fenced',
        emDelimiter: '_',
      });
      turndownService.use(gfm);
      // Remove head, script, style, noscript, svg via Turndown DOM removal mechanism
      turndownService.remove([
        'head',
        'title',
        'meta',
        'link',
        'script',
        'style',
        'noscript',
        'svg',
      ] as any);

      const markdown = turndownService.turndown(normalizedHtml).trim();
      const headingsCount = (markdown.match(/^#{1,6}\s+/gm) || []).length;
      const tablesCount = (markdown.match(/\n\|[^-:\n]+\|\n\|[-:\s|]+\|/g) || []).length;
      const paragraphs = markdown ? markdown.split(/\n\s*\n/).filter(Boolean) : [];

      return {
        fullText: markdown,
        markdown,
        headingsCount,
        tablesCount,
        paragraphsCount: paragraphs.length,
      };
    }

    case '.xml':
    case '.yaml':
    case '.yml': {
      const trimmed = rawText.trim();
      const paragraphs = trimmed ? trimmed.split(/\n\s*\n/).filter(Boolean) : [];
      return {
        fullText: trimmed,
        markdown: trimmed,
        headingsCount: 0,
        tablesCount: 0,
        paragraphsCount: paragraphs.length,
      };
    }

    default: {
      const trimmed = rawText.trim();
      return {
        fullText: trimmed,
        markdown: trimmed,
        headingsCount: 0,
        tablesCount: 0,
        paragraphsCount: trimmed ? trimmed.split(/\n\s*\n/).filter(Boolean).length : 0,
      };
    }
  }
}
