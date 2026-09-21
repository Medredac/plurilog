import { Buffer } from 'node:buffer';

export type DocxBlockType = 'heading' | 'paragraph' | 'bullets' | 'numbered' | 'table';

export interface DocxBlock {
  type: DocxBlockType;
  text?: string;
  level?: number;
  items?: string[];
  headers?: string[];
  rows?: string[][];
}

export interface StructuredDocxInput {
  filename: string;
  title?: string;
  blocks: DocxBlock[];
}

export interface RenderedDocx {
  buffer: Buffer;
  filename: string;
  fullText: string;
}

const MAX_BLOCKS = 200;
const MAX_TEXT_LENGTH = 30000;
const MAX_LIST_ITEMS = 200;
const MAX_TABLE_ROWS = 200;
const MAX_TABLE_COLUMNS = 20;

function cleanText(value: unknown, maxLength = MAX_TEXT_LENGTH): string {
  if (typeof value !== 'string') return '';
  return value.replace(/\u0000/g, '').trim().slice(0, maxLength);
}

function escapeXml(value: string): string {
  return value
    .replace(/&/g, '&amp;')
    .replace(/</g, '&lt;')
    .replace(/>/g, '&gt;')
    .replace(/"/g, '&quot;')
    .replace(/'/g, '&apos;');
}

function sanitizeFilename(value: string): string {
  const raw = cleanText(value, 160) || 'document.docx';
  const withoutPath = raw.split(/[\\/]/).pop() || 'document.docx';
  const safeBase = withoutPath
    .replace(/[\u0000-\u001f\u007f]/g, '')
    .replace(/[<>:"/\\|?*]/g, '-')
    .replace(/\s+/g, ' ')
    .trim()
    .replace(/^\.+/, '')
    .slice(0, 140) || 'document';

  return safeBase.toLowerCase().endsWith('.docx')
    ? safeBase
    : `${safeBase}.docx`;
}

function textRuns(text: string, options?: { bold?: boolean; sizeHalfPoints?: number }): string {
  const segments = text.replace(/\r\n/g, '\n').replace(/\r/g, '\n').split('\n');
  const rPrParts: string[] = [];
  if (options?.bold) rPrParts.push('<w:b/>');
  if (options?.sizeHalfPoints) {
    rPrParts.push(`<w:sz w:val="${options.sizeHalfPoints}"/>`);
    rPrParts.push(`<w:szCs w:val="${options.sizeHalfPoints}"/>`);
  }
  const rPr = rPrParts.length > 0 ? `<w:rPr>${rPrParts.join('')}</w:rPr>` : '';

  return segments
    .map((segment, index) => {
      const run = `<w:r>${rPr}<w:t xml:space="preserve">${escapeXml(segment)}</w:t></w:r>`;
      return index === segments.length - 1 ? run : `${run}<w:r><w:br/></w:r>`;
    })
    .join('');
}

function paragraphXml(
  text: string,
  options?: {
    bold?: boolean;
    sizeHalfPoints?: number;
    spacingAfter?: number;
    spacingBefore?: number;
    keepNext?: boolean;
  }
): string {
  const pPrParts: string[] = [];
  if (options?.spacingBefore || options?.spacingAfter) {
    pPrParts.push(
      `<w:spacing w:before="${options?.spacingBefore || 0}" w:after="${options?.spacingAfter || 0}"/>`
    );
  }
  if (options?.keepNext) pPrParts.push('<w:keepNext/>');
  const pPr = pPrParts.length > 0 ? `<w:pPr>${pPrParts.join('')}</w:pPr>` : '';
  return `<w:p>${pPr}${textRuns(text, options)}</w:p>`;
}

function headingXml(text: string, level = 1): string {
  const safeLevel = Math.max(1, Math.min(3, Math.floor(level || 1)));
  const sizes: Record<number, number> = { 1: 32, 2: 28, 3: 24 };
  return paragraphXml(text, {
    bold: true,
    sizeHalfPoints: sizes[safeLevel],
    spacingBefore: safeLevel === 1 ? 240 : 180,
    spacingAfter: 100,
    keepNext: true,
  });
}

function cellXml(text: string, bold = false): string {
  return `<w:tc><w:tcPr><w:tcW w:w="2400" w:type="dxa"/></w:tcPr>${paragraphXml(
    text,
    { bold, sizeHalfPoints: 20, spacingAfter: 0 }
  )}</w:tc>`;
}

function tableXml(headers: string[], rows: string[][]): string {
  const normalizedHeaders = headers.slice(0, MAX_TABLE_COLUMNS).map((v) => cleanText(v, 5000));
  const normalizedRows = rows.slice(0, MAX_TABLE_ROWS).map((row) =>
    (Array.isArray(row) ? row : [])
      .slice(0, MAX_TABLE_COLUMNS)
      .map((v) => cleanText(v, 5000))
  );

  const columnCount = Math.max(
    normalizedHeaders.length,
    ...normalizedRows.map((row) => row.length),
    1
  );

  const rowXml = (cells: string[], bold: boolean) => {
    const padded = Array.from({ length: columnCount }, (_, i) => cells[i] || '');
    return `<w:tr>${padded.map((cell) => cellXml(cell, bold)).join('')}</w:tr>`;
  };

  const body: string[] = [];
  if (normalizedHeaders.length > 0) body.push(rowXml(normalizedHeaders, true));
  for (const row of normalizedRows) body.push(rowXml(row, false));

  return `<w:tbl>
    <w:tblPr>
      <w:tblW w:w="0" w:type="auto"/>
      <w:tblBorders>
        <w:top w:val="single" w:sz="4" w:space="0" w:color="B7B7B7"/>
        <w:left w:val="single" w:sz="4" w:space="0" w:color="B7B7B7"/>
        <w:bottom w:val="single" w:sz="4" w:space="0" w:color="B7B7B7"/>
        <w:right w:val="single" w:sz="4" w:space="0" w:color="B7B7B7"/>
        <w:insideH w:val="single" w:sz="4" w:space="0" w:color="D9D9D9"/>
        <w:insideV w:val="single" w:sz="4" w:space="0" w:color="D9D9D9"/>
      </w:tblBorders>
    </w:tblPr>
    ${body.join('')}
  </w:tbl>`;
}

function normalizeBlocks(blocks: unknown): DocxBlock[] {
  if (!Array.isArray(blocks)) return [];

  const normalized: DocxBlock[] = [];
  for (const raw of blocks.slice(0, MAX_BLOCKS)) {
    if (!raw || typeof raw !== 'object') continue;
    const block = raw as Record<string, unknown>;
    const type = block.type;

    if (type === 'heading') {
      const text = cleanText(block.text);
      if (!text) continue;
      normalized.push({
        type,
        text,
        level:
          typeof block.level === 'number'
            ? Math.max(1, Math.min(3, Math.floor(block.level)))
            : 1,
      });
    } else if (type === 'paragraph') {
      const text = cleanText(block.text);
      if (!text) continue;
      normalized.push({ type, text });
    } else if (type === 'bullets' || type === 'numbered') {
      const items = Array.isArray(block.items)
        ? block.items
            .slice(0, MAX_LIST_ITEMS)
            .map((item) => cleanText(item, 10000))
            .filter(Boolean)
        : [];
      if (items.length === 0) continue;
      normalized.push({ type, items });
    } else if (type === 'table') {
      const headers = Array.isArray(block.headers)
        ? block.headers
            .slice(0, MAX_TABLE_COLUMNS)
            .map((item) => cleanText(item, 5000))
        : [];
      const rows = Array.isArray(block.rows)
        ? block.rows.slice(0, MAX_TABLE_ROWS).map((row) =>
            Array.isArray(row)
              ? row
                  .slice(0, MAX_TABLE_COLUMNS)
                  .map((item) => cleanText(item, 5000))
              : []
          )
        : [];
      if (headers.length === 0 && rows.length === 0) continue;
      normalized.push({ type, headers, rows });
    }
  }

  return normalized;
}

function buildDocumentXml(title: string, blocks: DocxBlock[]): string {
  const body: string[] = [];

  if (title) {
    body.push(
      paragraphXml(title, {
        bold: true,
        sizeHalfPoints: 36,
        spacingAfter: 240,
        keepNext: true,
      })
    );
  }

  for (const block of blocks) {
    switch (block.type) {
      case 'heading':
        body.push(headingXml(block.text || '', block.level || 1));
        break;
      case 'paragraph':
        body.push(paragraphXml(block.text || '', { sizeHalfPoints: 22, spacingAfter: 120 }));
        break;
      case 'bullets':
        (block.items || []).forEach((item) => {
          body.push(paragraphXml(`• ${item}`, { sizeHalfPoints: 22, spacingAfter: 60 }));
        });
        break;
      case 'numbered':
        (block.items || []).forEach((item, index) => {
          body.push(paragraphXml(`${index + 1}. ${item}`, { sizeHalfPoints: 22, spacingAfter: 60 }));
        });
        break;
      case 'table':
        body.push(tableXml(block.headers || [], block.rows || []));
        body.push(paragraphXml('', { spacingAfter: 80 }));
        break;
    }
  }

  return `<?xml version="1.0" encoding="UTF-8" standalone="yes"?>
<w:document xmlns:w="http://schemas.openxmlformats.org/wordprocessingml/2006/main">
  <w:body>
    ${body.join('\n')}
    <w:sectPr>
      <w:pgSz w:w="11906" w:h="16838"/>
      <w:pgMar w:top="1440" w:right="1440" w:bottom="1440" w:left="1440" w:header="708" w:footer="708" w:gutter="0"/>
    </w:sectPr>
  </w:body>
</w:document>`;
}

function documentFullText(title: string, blocks: DocxBlock[]): string {
  const parts: string[] = [];
  if (title) parts.push(title);

  for (const block of blocks) {
    if (block.type === 'heading' || block.type === 'paragraph') {
      if (block.text) parts.push(block.text);
    } else if (block.type === 'bullets') {
      parts.push(...(block.items || []).map((item) => `• ${item}`));
    } else if (block.type === 'numbered') {
      parts.push(...(block.items || []).map((item, index) => `${index + 1}. ${item}`));
    } else if (block.type === 'table') {
      if (block.headers && block.headers.length > 0) parts.push(block.headers.join(' | '));
      for (const row of block.rows || []) parts.push(row.join(' | '));
    }
  }

  return parts.join('\n\n').trim();
}

const CRC_TABLE = (() => {
  const table = new Uint32Array(256);
  for (let n = 0; n < 256; n++) {
    let c = n;
    for (let k = 0; k < 8; k++) {
      c = c & 1 ? 0xedb88320 ^ (c >>> 1) : c >>> 1;
    }
    table[n] = c >>> 0;
  }
  return table;
})();

function crc32(buffer: Buffer): number {
  let crc = 0xffffffff;
  for (const byte of buffer) {
    crc = CRC_TABLE[(crc ^ byte) & 0xff] ^ (crc >>> 8);
  }
  return (crc ^ 0xffffffff) >>> 0;
}

function dosTimestamp(date = new Date()): { time: number; date: number } {
  const year = Math.max(1980, date.getFullYear());
  const time =
    ((date.getHours() & 0x1f) << 11) |
    ((date.getMinutes() & 0x3f) << 5) |
    ((Math.floor(date.getSeconds() / 2) & 0x1f) >>> 0);
  const dosDate =
    (((year - 1980) & 0x7f) << 9) |
    (((date.getMonth() + 1) & 0x0f) << 5) |
    (date.getDate() & 0x1f);
  return { time, date: dosDate };
}

function createZip(files: { name: string; data: Buffer }[]): Buffer {
  const locals: Buffer[] = [];
  const centrals: Buffer[] = [];
  let localOffset = 0;
  const stamp = dosTimestamp();

  for (const file of files) {
    const name = Buffer.from(file.name, 'utf8');
    const data = file.data;
    const crc = crc32(data);

    const local = Buffer.alloc(30);
    local.writeUInt32LE(0x04034b50, 0);
    local.writeUInt16LE(20, 4);
    local.writeUInt16LE(0x0800, 6);
    local.writeUInt16LE(0, 8);
    local.writeUInt16LE(stamp.time, 10);
    local.writeUInt16LE(stamp.date, 12);
    local.writeUInt32LE(crc, 14);
    local.writeUInt32LE(data.length, 18);
    local.writeUInt32LE(data.length, 22);
    local.writeUInt16LE(name.length, 26);
    local.writeUInt16LE(0, 28);

    locals.push(local, name, data);

    const central = Buffer.alloc(46);
    central.writeUInt32LE(0x02014b50, 0);
    central.writeUInt16LE(20, 4);
    central.writeUInt16LE(20, 6);
    central.writeUInt16LE(0x0800, 8);
    central.writeUInt16LE(0, 10);
    central.writeUInt16LE(stamp.time, 12);
    central.writeUInt16LE(stamp.date, 14);
    central.writeUInt32LE(crc, 16);
    central.writeUInt32LE(data.length, 20);
    central.writeUInt32LE(data.length, 24);
    central.writeUInt16LE(name.length, 28);
    central.writeUInt16LE(0, 30);
    central.writeUInt16LE(0, 32);
    central.writeUInt16LE(0, 34);
    central.writeUInt16LE(0, 36);
    central.writeUInt32LE(0, 38);
    central.writeUInt32LE(localOffset, 42);

    centrals.push(central, name);
    localOffset += local.length + name.length + data.length;
  }

  const centralDirectory = Buffer.concat(centrals);
  const end = Buffer.alloc(22);
  end.writeUInt32LE(0x06054b50, 0);
  end.writeUInt16LE(0, 4);
  end.writeUInt16LE(0, 6);
  end.writeUInt16LE(files.length, 8);
  end.writeUInt16LE(files.length, 10);
  end.writeUInt32LE(centralDirectory.length, 12);
  end.writeUInt32LE(localOffset, 16);
  end.writeUInt16LE(0, 20);

  return Buffer.concat([...locals, centralDirectory, end]);
}

export function renderDocx(input: StructuredDocxInput): RenderedDocx {
  const filename = sanitizeFilename(input.filename);
  const title = cleanText(input.title, 1000);
  const blocks = normalizeBlocks(input.blocks);

  if (!title && blocks.length === 0) {
    throw new Error('Word document content cannot be empty.');
  }

  const documentXml = buildDocumentXml(title, blocks);
  const fullText = documentFullText(title, blocks);

  if (!fullText) {
    throw new Error('Word document content cannot be empty.');
  }

  const contentTypes = `<?xml version="1.0" encoding="UTF-8" standalone="yes"?>
<Types xmlns="http://schemas.openxmlformats.org/package/2006/content-types">
  <Default Extension="rels" ContentType="application/vnd.openxmlformats-package.relationships+xml"/>
  <Default Extension="xml" ContentType="application/xml"/>
  <Override PartName="/word/document.xml" ContentType="application/vnd.openxmlformats-officedocument.wordprocessingml.document.main+xml"/>
  <Override PartName="/docProps/core.xml" ContentType="application/vnd.openxmlformats-package.core-properties+xml"/>
  <Override PartName="/docProps/app.xml" ContentType="application/vnd.openxmlformats-officedocument.extended-properties+xml"/>
</Types>`;

  const rootRels = `<?xml version="1.0" encoding="UTF-8" standalone="yes"?>
<Relationships xmlns="http://schemas.openxmlformats.org/package/2006/relationships">
  <Relationship Id="rId1" Type="http://schemas.openxmlformats.org/officeDocument/2006/relationships/officeDocument" Target="word/document.xml"/>
  <Relationship Id="rId2" Type="http://schemas.openxmlformats.org/package/2006/relationships/metadata/core-properties" Target="docProps/core.xml"/>
  <Relationship Id="rId3" Type="http://schemas.openxmlformats.org/officeDocument/2006/relationships/extended-properties" Target="docProps/app.xml"/>
</Relationships>`;

  const nowIso = new Date().toISOString();
  const coreXml = `<?xml version="1.0" encoding="UTF-8" standalone="yes"?>
<cp:coreProperties
  xmlns:cp="http://schemas.openxmlformats.org/package/2006/metadata/core-properties"
  xmlns:dc="http://purl.org/dc/elements/1.1/"
  xmlns:dcterms="http://purl.org/dc/terms/"
  xmlns:dcmitype="http://purl.org/dc/dcmitype/"
  xmlns:xsi="http://www.w3.org/2001/XMLSchema-instance">
  <dc:title>${escapeXml(title || filename.replace(/\.docx$/i, ''))}</dc:title>
  <dc:creator>Plurilog</dc:creator>
  <cp:lastModifiedBy>Plurilog</cp:lastModifiedBy>
  <dcterms:created xsi:type="dcterms:W3CDTF">${nowIso}</dcterms:created>
  <dcterms:modified xsi:type="dcterms:W3CDTF">${nowIso}</dcterms:modified>
</cp:coreProperties>`;

  const appXml = `<?xml version="1.0" encoding="UTF-8" standalone="yes"?>
<Properties xmlns="http://schemas.openxmlformats.org/officeDocument/2006/extended-properties"
  xmlns:vt="http://schemas.openxmlformats.org/officeDocument/2006/docPropsVTypes">
  <Application>Plurilog</Application>
</Properties>`;

  const buffer = createZip([
    { name: '[Content_Types].xml', data: Buffer.from(contentTypes, 'utf8') },
    { name: '_rels/.rels', data: Buffer.from(rootRels, 'utf8') },
    { name: 'word/document.xml', data: Buffer.from(documentXml, 'utf8') },
    { name: 'docProps/core.xml', data: Buffer.from(coreXml, 'utf8') },
    { name: 'docProps/app.xml', data: Buffer.from(appXml, 'utf8') },
  ]);

  return { buffer, filename, fullText };
}
