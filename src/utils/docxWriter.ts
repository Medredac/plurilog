import { Buffer } from 'node:buffer';

export type DocxBlockType =
  | 'heading'
  | 'paragraph'
  | 'bullets'
  | 'numbered'
  | 'table'
  | 'image'
  | 'page_break';

export type DocxImageMode = 'existing' | 'generate' | 'edit';
export type DocxImageSize = 'small' | 'medium' | 'large' | 'full';
export type DocxImageAlignment = 'left' | 'center' | 'right';
export type DocxImagePlacement = 'inline' | 'top-right';
export type DocxFontFamily = 'sans' | 'serif' | 'mono' | 'jp-sans' | 'jp-serif';

export interface DocxDesign {
  pageSize?: 'A4' | 'LETTER';
  orientation?: 'portrait' | 'landscape';
  marginMm?: number;
  textColor?: string;
  mutedColor?: string;
  accentColor?: string;
  fontFamily?: DocxFontFamily;
  headingFontFamily?: DocxFontFamily;
  bodySizePt?: number;
  lineHeight?: number;
  locale?: string;
  targetPageCount?: number;
}

export interface DocxBlock {
  type: DocxBlockType;
  text?: string;
  level?: number;
  items?: string[];
  headers?: string[];
  rows?: string[][];
  tableWidthPct?: number;
  columnWidthsPct?: number[];
  mode?: DocxImageMode;
  prompt?: string;
  need?: string;
  filename?: string;
  caption?: string;
  size?: DocxImageSize;
  alignment?: DocxImageAlignment;
  placement?: DocxImagePlacement;
  widthMm?: number;
  heightMm?: number;

  // Server-resolved image payload. These fields never come from the model tool call.
  imageData?: Buffer;
  imageContentType?: string;
  imageAltText?: string;
}

export interface StructuredDocxInput {
  filename: string;
  title?: string;
  design?: DocxDesign;
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
const MAX_IMAGES = 12;
const EMU_PER_INCH = 914400;

const IMAGE_WIDTH_INCHES: Record<DocxImageSize, number> = {
  small: 2.15,
  medium: 3.55,
  large: 4.95,
  full: 6.05,
};

const DEFAULT_DOCX_DESIGN: Required<Omit<DocxDesign, 'locale'>> & { locale: string } = {
  pageSize: 'A4',
  orientation: 'portrait',
  marginMm: 16,
  textColor: '#172033',
  mutedColor: '#667085',
  accentColor: '#1f5f74',
  fontFamily: 'sans',
  headingFontFamily: 'sans',
  bodySizePt: 10.5,
  lineHeight: 1.32,
  locale: 'en',
  targetPageCount: 0,
};

function clampNumber(value: unknown, fallback: number, min: number, max: number): number {
  return typeof value === 'number' && Number.isFinite(value)
    ? Math.max(min, Math.min(max, value))
    : fallback;
}

function normalizeHex(value: unknown, fallback: string): string {
  if (typeof value !== 'string') return fallback.replace('#', '').toUpperCase();
  const trimmed = value.trim();
  const match = trimmed.match(/^#?([0-9a-fA-F]{6})$/);
  return (match?.[1] || fallback.replace('#', '')).toUpperCase();
}

function docxFontName(value?: DocxFontFamily): string {
  switch (value) {
    case 'serif':
      return 'Georgia';
    case 'mono':
      return 'Courier New';
    case 'jp-sans':
      return 'Yu Gothic';
    case 'jp-serif':
      return 'Yu Mincho';
    default:
      return 'Aptos';
  }
}

function normalizeDocxDesign(input?: DocxDesign) {
  return {
    pageSize: input?.pageSize === 'LETTER' ? 'LETTER' as const : 'A4' as const,
    orientation: input?.orientation === 'landscape' ? 'landscape' as const : 'portrait' as const,
    marginMm: clampNumber(input?.marginMm, DEFAULT_DOCX_DESIGN.marginMm, 8, 30),
    textColor: normalizeHex(input?.textColor, DEFAULT_DOCX_DESIGN.textColor),
    mutedColor: normalizeHex(input?.mutedColor, DEFAULT_DOCX_DESIGN.mutedColor),
    accentColor: normalizeHex(input?.accentColor, DEFAULT_DOCX_DESIGN.accentColor),
    fontFamily: input?.fontFamily || DEFAULT_DOCX_DESIGN.fontFamily,
    headingFontFamily:
      input?.headingFontFamily || input?.fontFamily || DEFAULT_DOCX_DESIGN.headingFontFamily,
    bodySizePt: clampNumber(input?.bodySizePt, DEFAULT_DOCX_DESIGN.bodySizePt, 8.5, 14),
    lineHeight: clampNumber(input?.lineHeight, DEFAULT_DOCX_DESIGN.lineHeight, 1.05, 1.7),
    locale: cleanText(input?.locale, 20) || DEFAULT_DOCX_DESIGN.locale,
    targetPageCount:
      typeof input?.targetPageCount === 'number' && Number.isFinite(input.targetPageCount)
        ? Math.max(0, Math.min(30, Math.floor(input.targetPageCount)))
        : 0,
  };
}

function mmToTwips(mm: number): number {
  return Math.round(mm * 56.6929133858);
}

function ptToHalfPoints(pt: number): number {
  return Math.max(1, Math.round(pt * 2));
}

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

function textRuns(
  text: string,
  options?: {
    bold?: boolean;
    italic?: boolean;
    sizeHalfPoints?: number;
    color?: string;
    fontFamily?: DocxFontFamily;
  }
): string {
  const segments = text.replace(/\r\n/g, '\n').replace(/\r/g, '\n').split('\n');
  const rPrParts: string[] = [];
  if (options?.bold) rPrParts.push('<w:b/>');
  if (options?.italic) rPrParts.push('<w:i/>');
  if (options?.sizeHalfPoints) {
    rPrParts.push(`<w:sz w:val="${options.sizeHalfPoints}"/>`);
    rPrParts.push(`<w:szCs w:val="${options.sizeHalfPoints}"/>`);
  }
  if (options?.color) {
    rPrParts.push(`<w:color w:val="${escapeXml(options.color)}"/>`);
  }
  if (options?.fontFamily) {
    const font = escapeXml(docxFontName(options.fontFamily));
    rPrParts.push(
      `<w:rFonts w:ascii="${font}" w:hAnsi="${font}" w:eastAsia="${font}" w:cs="${font}"/>`
    );
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
    italic?: boolean;
    sizeHalfPoints?: number;
    spacingAfter?: number;
    spacingBefore?: number;
    keepNext?: boolean;
    keepLines?: boolean;
    lineHeight?: number;
    color?: string;
    fontFamily?: DocxFontFamily;
    alignment?: 'left' | 'center' | 'right';
    bottomBorderColor?: string;
  }
): string {
  const pPrParts: string[] = ['<w:widowControl/>'];
  const spacingAttrs = [
    `w:before="${options?.spacingBefore || 0}"`,
    `w:after="${options?.spacingAfter || 0}"`,
  ];
  if (options?.lineHeight) {
    spacingAttrs.push(`w:line="${Math.round(240 * options.lineHeight)}"`);
    spacingAttrs.push('w:lineRule="auto"');
  }
  pPrParts.push(`<w:spacing ${spacingAttrs.join(' ')}/>`);
  if (options?.keepNext) pPrParts.push('<w:keepNext/>');
  if (options?.keepLines) pPrParts.push('<w:keepLines/>');
  if (options?.alignment) pPrParts.push(`<w:jc w:val="${options.alignment}"/>`);
  if (options?.bottomBorderColor) {
    pPrParts.push(
      `<w:pBdr><w:bottom w:val="single" w:sz="12" w:space="6" w:color="${escapeXml(
        options.bottomBorderColor
      )}"/></w:pBdr>`
    );
  }
  const pPr = `<w:pPr>${pPrParts.join('')}</w:pPr>`;
  return `<w:p>${pPr}${textRuns(text, options)}</w:p>`;
}

function headingXml(
  text: string,
  level: number,
  design: ReturnType<typeof normalizeDocxDesign>
): string {
  const safeLevel = Math.max(1, Math.min(3, Math.floor(level || 1)));
  const body = design.bodySizePt;
  const sizesPt: Record<number, number> = {
    1: Math.max(15.5, body * 1.5),
    2: Math.max(13, body * 1.28),
    3: Math.max(11.5, body * 1.13),
  };
  return paragraphXml(text, {
    bold: true,
    sizeHalfPoints: ptToHalfPoints(sizesPt[safeLevel]),
    spacingBefore: safeLevel === 1 ? 220 : 150,
    spacingAfter: safeLevel === 1 ? 100 : 70,
    keepNext: true,
    keepLines: true,
    lineHeight: 1.05,
    color: safeLevel <= 2 ? design.accentColor : design.textColor,
    fontFamily: design.headingFontFamily,
  });
}

function pageContentWidthTwips(
  design: ReturnType<typeof normalizeDocxDesign>
): number {
  const pageWidthMm =
    design.orientation === 'landscape'
      ? design.pageSize === 'LETTER'
        ? 279.4
        : 297
      : design.pageSize === 'LETTER'
        ? 215.9
        : 210;
  return Math.max(2000, mmToTwips(pageWidthMm - design.marginMm * 2));
}

function normalizedColumnWidths(
  columnCount: number,
  requested: number[] | undefined
): number[] {
  if (
    Array.isArray(requested) &&
    requested.length === columnCount &&
    requested.every((value) => typeof value === 'number' && Number.isFinite(value) && value > 0)
  ) {
    const total = requested.reduce((sum, value) => sum + value, 0);
    return requested.map((value) => value / total);
  }

  if (columnCount === 2) return [0.24, 0.76];
  if (columnCount === 3) return [0.10, 0.08, 0.82];
  return Array.from({ length: columnCount }, () => 1 / columnCount);
}

function cellXml(
  text: string,
  design: ReturnType<typeof normalizeDocxDesign>,
  widthTwips: number,
  header = false
): string {
  const fill = header ? `<w:shd w:fill="${design.accentColor}"/>` : '';
  const color = header ? 'FFFFFF' : design.textColor;
  return `<w:tc><w:tcPr><w:tcW w:w="${widthTwips}" w:type="dxa"/>${fill}<w:tcMar><w:top w:w="80" w:type="dxa"/><w:left w:w="100" w:type="dxa"/><w:bottom w:w="80" w:type="dxa"/><w:right w:w="100" w:type="dxa"/></w:tcMar></w:tcPr>${paragraphXml(
    text,
    {
      bold: header,
      sizeHalfPoints: ptToHalfPoints(Math.max(9, design.bodySizePt - 0.5)),
      spacingAfter: 0,
      // Body table cells must be allowed to flow across a page boundary.
      // Keeping every wrapped line together can make an otherwise valid row
      // disappear when it no longer fits in the remaining page space.
      keepLines: header,
      lineHeight: 1.12,
      color,
      fontFamily: design.fontFamily,
    }
  )}</w:tc>`;
}

function tableXml(
  block: DocxBlock,
  design: ReturnType<typeof normalizeDocxDesign>
): string {
  const headers = block.headers || [];
  const rows = block.rows || [];
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

  const availableWidth = pageContentWidthTwips(design);
  const widthPct = clampNumber(block.tableWidthPct, 100, 35, 100);
  const tableWidth = Math.max(1800, Math.round(availableWidth * (widthPct / 100)));
  const proportions = normalizedColumnWidths(columnCount, block.columnWidthsPct);
  const widths = proportions.map((proportion) =>
    Math.max(300, Math.round(tableWidth * proportion))
  );
  const widthCorrection = tableWidth - widths.reduce((sum, value) => sum + value, 0);
  widths[widths.length - 1] += widthCorrection;

  const rowXml = (cells: string[], header: boolean) => {
    const padded = Array.from({ length: columnCount }, (_, i) => cells[i] || '');
    const rowProperties = header
      ? '<w:trPr><w:cantSplit/><w:tblHeader/></w:trPr>'
      : '<w:trPr></w:trPr>';
    return `<w:tr>${rowProperties}${padded
      .map((cell, index) => cellXml(cell, design, widths[index], header))
      .join('')}</w:tr>`;
  };

  const body: string[] = [];
  if (normalizedHeaders.length > 0) body.push(rowXml(normalizedHeaders, true));
  for (const row of normalizedRows) body.push(rowXml(row, false));

  return `<w:tbl>
    <w:tblPr>
      <w:tblW w:w="${tableWidth}" w:type="dxa"/>
      <w:tblLayout w:type="fixed"/>
      <w:tblCellMar><w:top w:w="40" w:type="dxa"/><w:left w:w="40" w:type="dxa"/><w:bottom w:w="40" w:type="dxa"/><w:right w:w="40" w:type="dxa"/></w:tblCellMar>
      <w:tblBorders>
        <w:top w:val="single" w:sz="4" w:space="0" w:color="D9E0E8"/>
        <w:left w:val="single" w:sz="4" w:space="0" w:color="D9E0E8"/>
        <w:bottom w:val="single" w:sz="4" w:space="0" w:color="D9E0E8"/>
        <w:right w:val="single" w:sz="4" w:space="0" w:color="D9E0E8"/>
        <w:insideH w:val="single" w:sz="3" w:space="0" w:color="E8ECF1"/>
        <w:insideV w:val="single" w:sz="3" w:space="0" w:color="E8ECF1"/>
      </w:tblBorders>
    </w:tblPr>
    <w:tblGrid>${widths.map((width) => `<w:gridCol w:w="${width}"/>`).join('')}</w:tblGrid>
    ${body.join('')}
  </w:tbl>`;
}

function imageExtensionForContentType(contentType: string): string {
  const normalized = (contentType || '').trim().toLowerCase();
  if (normalized === 'image/jpeg' || normalized === 'image/jpg') return 'jpg';
  if (normalized === 'image/png') return 'png';
  if (normalized === 'image/gif') return 'gif';
  if (normalized === 'image/webp') return 'webp';
  if (normalized === 'image/bmp') return 'bmp';
  return 'png';
}

function imageDimensions(data: Buffer, contentType: string): { width: number; height: number } {
  try {
    const normalized = (contentType || '').toLowerCase();
    if (normalized === 'image/png' && data.length >= 24 && data.readUInt32BE(0) === 0x89504e47) {
      return { width: data.readUInt32BE(16), height: data.readUInt32BE(20) };
    }

    if ((normalized === 'image/jpeg' || normalized === 'image/jpg') && data.length > 4 && data[0] === 0xff && data[1] === 0xd8) {
      let offset = 2;
      while (offset + 9 < data.length) {
        if (data[offset] !== 0xff) { offset++; continue; }
        const marker = data[offset + 1];
        offset += 2;
        if (marker === 0xd8 || marker === 0xd9) continue;
        if (offset + 2 > data.length) break;
        const length = data.readUInt16BE(offset);
        if (length < 2 || offset + length > data.length) break;
        if ([0xc0,0xc1,0xc2,0xc3,0xc5,0xc6,0xc7,0xc9,0xca,0xcb,0xcd,0xce,0xcf].includes(marker)) {
          return { width: data.readUInt16BE(offset + 5), height: data.readUInt16BE(offset + 3) };
        }
        offset += length;
      }
    }

    if (normalized === 'image/gif' && data.length >= 10) {
      return { width: data.readUInt16LE(6), height: data.readUInt16LE(8) };
    }

    if (normalized === 'image/webp' && data.length >= 30 && data.toString('ascii', 0, 4) === 'RIFF' && data.toString('ascii', 8, 12) === 'WEBP') {
      const kind = data.toString('ascii', 12, 16);
      if (kind === 'VP8X') {
        return { width: 1 + data.readUIntLE(24, 3), height: 1 + data.readUIntLE(27, 3) };
      }
      if (kind === 'VP8L' && data.length >= 25) {
        const b1 = data[21], b2 = data[22], b3 = data[23], b4 = data[24];
        return {
          width: 1 + (((b2 & 0x3f) << 8) | b1),
          height: 1 + (((b4 & 0x0f) << 10) | (b3 << 2) | ((b2 & 0xc0) >> 6)),
        };
      }
    }
  } catch {
    // Fall through to a safe landscape default.
  }
  return { width: 1600, height: 900 };
}

function imageParagraphXml(
  block: DocxBlock,
  imageIndex: number,
  design: ReturnType<typeof normalizeDocxDesign>
): string {
  if (!block.imageData || !Buffer.isBuffer(block.imageData)) return '';
  const contentType = block.imageContentType || 'image/png';
  const dims = imageDimensions(block.imageData, contentType);
  const size = block.size || 'large';
  const alignment = block.alignment || 'center';
  const widthInches =
    typeof block.widthMm === 'number' && Number.isFinite(block.widthMm)
      ? Math.max(10, Math.min(180, block.widthMm)) / 25.4
      : IMAGE_WIDTH_INCHES[size] || IMAGE_WIDTH_INCHES.large;
  const ratio = dims.width > 0 && dims.height > 0 ? dims.height / dims.width : 0.5625;
  const heightInches =
    typeof block.heightMm === 'number' && Number.isFinite(block.heightMm)
      ? Math.max(10, Math.min(240, block.heightMm)) / 25.4
      : Math.min(widthInches * ratio, 7.2);
  const cx = Math.max(1, Math.round(widthInches * EMU_PER_INCH));
  const cy = Math.max(1, Math.round(heightInches * EMU_PER_INCH));
  const relId = `rIdImage${imageIndex + 1}`;
  const docPrId = imageIndex + 1;
  const alt = escapeXml(
    cleanText(
      block.imageAltText || block.caption || block.prompt || block.need || 'Document image',
      500
    )
  );
  const jc = alignment === 'left' ? 'left' : alignment === 'right' ? 'right' : 'center';

  const pictureGraphic = `
      <wp:extent cx="${cx}" cy="${cy}"/>
      <wp:effectExtent l="0" t="0" r="0" b="0"/>
      <wp:docPr id="${docPrId}" name="Image ${docPrId}" descr="${alt}"/>
      <wp:cNvGraphicFramePr><a:graphicFrameLocks noChangeAspect="1"/></wp:cNvGraphicFramePr>
      <a:graphic><a:graphicData uri="http://schemas.openxmlformats.org/drawingml/2006/picture">
        <pic:pic>
          <pic:nvPicPr><pic:cNvPr id="0" name="Image ${docPrId}" descr="${alt}"/><pic:cNvPicPr/></pic:nvPicPr>
          <pic:blipFill><a:blip r:embed="${relId}"/><a:stretch><a:fillRect/></a:stretch></pic:blipFill>
          <pic:spPr><a:xfrm><a:off x="0" y="0"/><a:ext cx="${cx}" cy="${cy}"/></a:xfrm><a:prstGeom prst="rect"><a:avLst/></a:prstGeom></pic:spPr>
        </pic:pic>
      </a:graphicData></a:graphic>`;

  let image: string;
  if (block.placement === 'top-right') {
    image = `<w:p>
      <w:pPr><w:spacing w:before="0" w:after="0"/><w:keepLines/></w:pPr>
      <w:r><w:drawing><wp:anchor distT="0" distB="0" distL="114300" distR="0"
        simplePos="0" relativeHeight="251658240" behindDoc="0" locked="0"
        layoutInCell="1" allowOverlap="0">
        <wp:simplePos x="0" y="0"/>
        <wp:positionH relativeFrom="margin"><wp:align>right</wp:align></wp:positionH>
        <wp:positionV relativeFrom="margin"><wp:posOffset>0</wp:posOffset></wp:positionV>
        ${pictureGraphic}
        <wp:wrapSquare wrapText="left"/>
      </wp:anchor></w:drawing></w:r>
    </w:p>`;
  } else {
    image = `<w:p>
      <w:pPr><w:jc w:val="${jc}"/><w:spacing w:before="80" w:after="100"/><w:keepLines/></w:pPr>
      <w:r><w:drawing><wp:inline distT="0" distB="0" distL="0" distR="0">
        ${pictureGraphic}
      </wp:inline></w:drawing></w:r>
    </w:p>`;
  }

  if (!block.caption || block.placement === 'top-right') return image;
  return `${image}<w:p><w:pPr><w:jc w:val="${jc}"/><w:spacing w:after="120"/><w:keepLines/></w:pPr>${textRuns(
    cleanText(block.caption, 2000),
    {
      sizeHalfPoints: ptToHalfPoints(Math.max(8.5, design.bodySizePt - 1.5)),
      color: design.mutedColor,
      fontFamily: design.fontFamily,
      italic: true,
    }
  )}</w:p>`;
}

function pageBreakXml(): string {
  return '<w:p><w:r><w:br w:type="page"/></w:r></w:p>';
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
        ? block.headers.slice(0, MAX_TABLE_COLUMNS).map((item) => cleanText(item, 5000))
        : [];
      const rows = Array.isArray(block.rows)
        ? block.rows.slice(0, MAX_TABLE_ROWS).map((row) =>
            Array.isArray(row) ? row.slice(0, MAX_TABLE_COLUMNS).map((item) => cleanText(item, 5000)) : []
          )
        : [];
      if (headers.length === 0 && rows.length === 0) continue;
      normalized.push({
        type,
        headers,
        rows,
        tableWidthPct:
          typeof block.tableWidthPct === 'number'
            ? Math.max(35, Math.min(100, block.tableWidthPct))
            : undefined,
        columnWidthsPct: Array.isArray(block.columnWidthsPct)
          ? block.columnWidthsPct
              .slice(0, MAX_TABLE_COLUMNS)
              .filter((value): value is number =>
                typeof value === 'number' && Number.isFinite(value) && value > 0
              )
          : undefined,
      });
    } else if (type === 'image') {
      if (!Buffer.isBuffer(block.imageData) || block.imageData.length === 0) continue;
      const size: DocxImageSize = block.size === 'small' || block.size === 'medium' || block.size === 'full' ? block.size : 'large';
      const alignment: DocxImageAlignment = block.alignment === 'left' || block.alignment === 'right' ? block.alignment : 'center';
      const placement: DocxImagePlacement =
        block.placement === 'top-right' ? 'top-right' : 'inline';
      normalized.push({
        type,
        mode: block.mode === 'existing' || block.mode === 'edit' ? block.mode : 'generate',
        prompt: cleanText(block.prompt, 4000),
        need: cleanText(block.need, 2000),
        filename: cleanText(block.filename, 300),
        caption: cleanText(block.caption, 2000),
        size,
        alignment,
        placement,
        widthMm:
          typeof block.widthMm === 'number' && Number.isFinite(block.widthMm)
            ? Math.max(10, Math.min(180, block.widthMm))
            : undefined,
        heightMm:
          typeof block.heightMm === 'number' && Number.isFinite(block.heightMm)
            ? Math.max(10, Math.min(240, block.heightMm))
            : undefined,
        imageData: block.imageData,
        imageContentType: cleanText(block.imageContentType, 100) || 'image/png',
        imageAltText: cleanText(block.imageAltText, 500),
      });
    } else if (type === 'page_break') {
      normalized.push({ type });
    }
  }

  return normalized;
}

function buildDocumentXml(
  title: string,
  blocks: DocxBlock[],
  design: ReturnType<typeof normalizeDocxDesign>
): string {
  const body: string[] = [];
  let imageIndex = 0;
  const bodyHalfPoints = ptToHalfPoints(design.bodySizePt);

  if (title) {
    body.push(
      paragraphXml(title, {
        bold: true,
        sizeHalfPoints: ptToHalfPoints(Math.max(22, design.bodySizePt * 2.2)),
        spacingAfter: 220,
        keepNext: true,
        keepLines: true,
        lineHeight: 1.0,
        color: design.textColor,
        fontFamily: design.headingFontFamily,
        bottomBorderColor: design.accentColor,
      })
    );
  }

  for (const block of blocks) {
    switch (block.type) {
      case 'heading':
        body.push(headingXml(block.text || '', block.level || 1, design));
        break;
      case 'paragraph':
        body.push(
          paragraphXml(block.text || '', {
            sizeHalfPoints: bodyHalfPoints,
            spacingAfter: 110,
            lineHeight: design.lineHeight,
            color: design.textColor,
            fontFamily: design.fontFamily,
          })
        );
        break;
      case 'bullets':
        (block.items || []).forEach((item) => {
          body.push(
            paragraphXml(`• ${item}`, {
              sizeHalfPoints: bodyHalfPoints,
              spacingAfter: 55,
              keepLines: true,
              lineHeight: design.lineHeight,
              color: design.textColor,
              fontFamily: design.fontFamily,
            })
          );
        });
        break;
      case 'numbered':
        (block.items || []).forEach((item, index) => {
          body.push(
            paragraphXml(`${index + 1}. ${item}`, {
              sizeHalfPoints: bodyHalfPoints,
              spacingAfter: 55,
              keepLines: true,
              lineHeight: design.lineHeight,
              color: design.textColor,
              fontFamily: design.fontFamily,
            })
          );
        });
        break;
      case 'table':
        body.push(tableXml(block, design));
        body.push(paragraphXml('', { spacingAfter: 80 }));
        break;
      case 'image':
        body.push(imageParagraphXml(block, imageIndex, design));
        imageIndex++;
        break;
      case 'page_break':
        body.push(pageBreakXml());
        break;
    }
  }

  const isLandscape = design.orientation === 'landscape';
  const portraitSize =
    design.pageSize === 'LETTER'
      ? { width: 12240, height: 15840 }
      : { width: 11906, height: 16838 };
  const pageWidth = isLandscape ? portraitSize.height : portraitSize.width;
  const pageHeight = isLandscape ? portraitSize.width : portraitSize.height;
  const margin = mmToTwips(design.marginMm);

  return `<?xml version="1.0" encoding="UTF-8" standalone="yes"?>
<w:document
  xmlns:w="http://schemas.openxmlformats.org/wordprocessingml/2006/main"
  xmlns:r="http://schemas.openxmlformats.org/officeDocument/2006/relationships"
  xmlns:wp="http://schemas.openxmlformats.org/drawingml/2006/wordprocessingDrawing"
  xmlns:a="http://schemas.openxmlformats.org/drawingml/2006/main"
  xmlns:pic="http://schemas.openxmlformats.org/drawingml/2006/picture">
  <w:body>
    ${body.join('\n')}
    <w:sectPr>
      <w:pgSz w:w="${pageWidth}" w:h="${pageHeight}"${isLandscape ? ' w:orient="landscape"' : ''}/>
      <w:pgMar w:top="${margin}" w:right="${margin}" w:bottom="${margin}" w:left="${margin}" w:header="567" w:footer="567" w:gutter="0"/>
      <w:docGrid w:linePitch="360"/>
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
    } else if (block.type === 'image') {
      const imageLabel = block.caption || block.imageAltText || block.prompt || block.need || block.filename;
      if (imageLabel) parts.push(`[Image: ${imageLabel}]`);
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
  const design = normalizeDocxDesign(input.design);
  let blocks = normalizeBlocks(input.blocks);

  // The model may express the document title both through the dedicated title field
  // and as an early heading/paragraph block. Allow leading hero images before the
  // repeated text title, but do not scan deep into the document and accidentally
  // remove a legitimate later heading.
  if (title && blocks.length > 0) {
    const normalizeForComparison = (value: string) =>
      value.replace(/\s+/g, ' ').trim().toLocaleLowerCase();
    const titleKey = normalizeForComparison(title);
    const earlyTextIndex = blocks.findIndex((block, index) => {
      if (index > 2) return false;
      if (block.type === 'image') return false;
      return block.type === 'heading' || block.type === 'paragraph';
    });
    if (earlyTextIndex >= 0) {
      const candidate = blocks[earlyTextIndex];
      if (
        candidate.text &&
        normalizeForComparison(candidate.text) === titleKey
      ) {
        blocks = blocks.filter((_, index) => index !== earlyTextIndex);
      }
    }
  }

  if (!title && blocks.length === 0) {
    throw new Error('Word document content cannot be empty.');
  }

  const documentXml = buildDocumentXml(title, blocks, design);
  const fullText = documentFullText(title, blocks);
  const imageBlocks = blocks
    .filter(
      (block): block is DocxBlock & { imageData: Buffer; imageContentType: string } =>
        block.type === 'image' &&
        Buffer.isBuffer(block.imageData) &&
        block.imageData.length > 0
    )
    .slice(0, MAX_IMAGES);

  if (!fullText && imageBlocks.length === 0) {
    throw new Error('Word document content cannot be empty.');
  }

  const imageContentTypeDefaults = Array.from(
    new Map(
      imageBlocks.map((block) => [
        imageExtensionForContentType(block.imageContentType),
        block.imageContentType,
      ])
    ).entries()
  )
    .map(
      ([extension, contentType]) =>
        `  <Default Extension="${extension}" ContentType="${escapeXml(contentType)}"/>`
    )
    .join('\n');

  const contentTypes = `<?xml version="1.0" encoding="UTF-8" standalone="yes"?>
<Types xmlns="http://schemas.openxmlformats.org/package/2006/content-types">
  <Default Extension="rels" ContentType="application/vnd.openxmlformats-package.relationships+xml"/>
  <Default Extension="xml" ContentType="application/xml"/>
  ${imageContentTypeDefaults}
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

  const documentRelationships = `<?xml version="1.0" encoding="UTF-8" standalone="yes"?>
<Relationships xmlns="http://schemas.openxmlformats.org/package/2006/relationships">
${imageBlocks
  .map((block, index) => {
    const extension = imageExtensionForContentType(block.imageContentType);
    return `  <Relationship Id="rIdImage${index + 1}" Type="http://schemas.openxmlformats.org/officeDocument/2006/relationships/image" Target="media/image${index + 1}.${extension}"/>`;
  })
  .join('\n')}
</Relationships>`;

  const mediaFiles = imageBlocks.map((block, index) => ({
    name: `word/media/image${index + 1}.${imageExtensionForContentType(block.imageContentType)}`,
    data: block.imageData,
  }));

  const buffer = createZip([
    { name: '[Content_Types].xml', data: Buffer.from(contentTypes, 'utf8') },
    { name: '_rels/.rels', data: Buffer.from(rootRels, 'utf8') },
    { name: 'word/document.xml', data: Buffer.from(documentXml, 'utf8') },
    { name: 'word/_rels/document.xml.rels', data: Buffer.from(documentRelationships, 'utf8') },
    ...mediaFiles,
    { name: 'docProps/core.xml', data: Buffer.from(coreXml, 'utf8') },
    { name: 'docProps/app.xml', data: Buffer.from(appXml, 'utf8') },
  ]);

  return { buffer, filename, fullText };
}
