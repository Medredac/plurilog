import { Buffer } from 'node:buffer';
import { Sandbox } from '@vercel/sandbox';

export interface HtmlPdfInput {
  filename: string;
  html: string;
  css: string;
  locale?: string;
  targetPageCount?: number | null;
}

export interface RenderedHtmlPdfPage {
  pageNumber: number;
  data: Buffer;
  contentType: 'image/png';
}

export interface HtmlPdfRenderResult {
  buffer: Buffer;
  filename: string;
  fullText: string;
  totalPageCount: number | null;
  reviewPages: RenderedHtmlPdfPage[];
  usedSnapshot: boolean;
  elapsedMs: number;
}

export interface HtmlPdfRenderOptions {
  snapshotId?: string | null;
  signal?: AbortSignal;
  timeoutMs?: number;
}

export interface HtmlPdfRenderSession {
  render: (input: HtmlPdfInput) => Promise<HtmlPdfRenderResult>;
  close: () => Promise<void>;
}

const MAX_HTML_CHARS = 300_000;
const MAX_CSS_CHARS = 180_000;
const MAX_REVIEW_PAGES = 6;
const REVIEW_DPI = 96;

function cleanText(value: unknown, maxLength: number): string {
  if (typeof value !== 'string') return '';
  return value.replace(/\u0000/g, '').slice(0, maxLength);
}

function sanitizePdfFilename(value: string): string {
  const raw = cleanText(value, 160).trim() || 'document.pdf';
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

async function assertCommandSucceeded(
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

async function commandPath(
  sandbox: InstanceType<typeof Sandbox>,
  command: string
): Promise<string | null> {
  const result = await sandbox.runCommand({
    cmd: 'sh',
    args: ['-lc', `command -v ${command} 2>/dev/null || true`],
  });
  const value = (await result.stdout()).trim();
  return value || null;
}

async function installWeasyPrintDependencies(
  sandbox: InstanceType<typeof Sandbox>
): Promise<{ weasyPrintPath: string }> {
  const existing = await commandPath(sandbox, 'weasyprint');
  const pdfInfo = await commandPath(sandbox, 'pdfinfo');
  const pdfToPpm = await commandPath(sandbox, 'pdftoppm');

  if (existing && pdfInfo && pdfToPpm) {
    const version = await sandbox.runCommand({ cmd: existing, args: ['--version'] });
    if (version.exitCode === 0) {
      return { weasyPrintPath: existing };
    }
  }

  const probe = await sandbox.runCommand({
    cmd: 'sh',
    args: [
      '-lc',
      'if command -v apt-get >/dev/null 2>&1; then echo apt-get; elif command -v dnf >/dev/null 2>&1; then echo dnf; else echo none; fi',
    ],
  });
  await assertCommandSucceeded(probe, 'WeasyPrint package manager detection');
  const packageManager = (await probe.stdout()).trim();

  if (packageManager === 'apt-get') {
    const install = await sandbox.runCommand({
      cmd: 'sh',
      args: [
        '-lc',
        [
          'set -eu',
          'sudo apt-get update -qq',
          'sudo apt-get install -y --no-install-recommends python3-venv python3-pip poppler-utils fonts-noto-cjk fonts-liberation libpango-1.0-0 libpangoft2-1.0-0',
          'python3 -m venv /tmp/plurilog-weasy',
          '/tmp/plurilog-weasy/bin/pip install -q --disable-pip-version-check weasyprint==70.0',
        ].join(' && '),
      ],
    });
    await assertCommandSucceeded(install, 'WeasyPrint dependency installation');
  } else if (packageManager === 'dnf') {
    const install = await sandbox.runCommand({
      cmd: 'sh',
      args: [
        '-lc',
        [
          'set -eu',
          'sudo dnf install -y python3-pip python3-devel poppler-utils pango liberation-sans-fonts liberation-serif-fonts',
          'python3 -m venv /tmp/plurilog-weasy || python3 -m pip install --user virtualenv && python3 -m virtualenv /tmp/plurilog-weasy',
          '/tmp/plurilog-weasy/bin/pip install -q --disable-pip-version-check weasyprint==70.0',
        ].join(' && '),
      ],
    });
    await assertCommandSucceeded(install, 'WeasyPrint dependency installation');
  } else {
    throw new Error('PDF renderer sandbox has neither apt-get nor dnf available.');
  }

  const weasyPrintPath =
    (await commandPath(sandbox, '/tmp/plurilog-weasy/bin/weasyprint')) ||
    '/tmp/plurilog-weasy/bin/weasyprint';
  const version = await sandbox.runCommand({ cmd: weasyPrintPath, args: ['--version'] });
  await assertCommandSucceeded(version, 'WeasyPrint verification');

  if (!(await commandPath(sandbox, 'pdfinfo')) || !(await commandPath(sandbox, 'pdftoppm'))) {
    throw new Error('WeasyPrint renderer is missing Poppler utilities.');
  }

  return { weasyPrintPath };
}

function stripDangerousAttributes(html: string): string {
  return html
    .replace(/\s+on[a-z0-9_-]+\s*=\s*("[^"]*"|'[^']*'|[^\s>]+)/gi, '')
    .replace(/\s+srcdoc\s*=\s*("[^"]*"|'[^']*'|[^\s>]+)/gi, '')
    .replace(/\s+formaction\s*=\s*("[^"]*"|'[^']*'|[^\s>]+)/gi, '');
}

function sanitizeResourceAttributes(html: string): string {
  return html.replace(
    /\s+(src|href|xlink:href)\s*=\s*(["'])(.*?)\2/gi,
    (match, name: string, quote: string, rawValue: string) => {
      const value = rawValue.trim();
      if (
        value.startsWith('asset:') ||
        value.startsWith('#') ||
        value.startsWith('data:image/')
      ) {
        return ` ${name}=${quote}${value}${quote}`;
      }
      return '';
    }
  );
}

export function sanitizePdfHtml(raw: string): string {
  let html = cleanText(raw, MAX_HTML_CHARS);
  html = html
    .replace(/<script\b[^>]*>[\s\S]*?<\/script\s*>/gi, '')
    .replace(/<iframe\b[^>]*>[\s\S]*?<\/iframe\s*>/gi, '')
    .replace(/<object\b[^>]*>[\s\S]*?<\/object\s*>/gi, '')
    .replace(/<embed\b[^>]*\/?\s*>/gi, '')
    .replace(/<link\b[^>]*\/?\s*>/gi, '')
    .replace(/<base\b[^>]*\/?\s*>/gi, '')
    .replace(/<meta\b[^>]*\/?\s*>/gi, '')
    .replace(/<style\b[^>]*>[\s\S]*?<\/style\s*>/gi, '')
    .replace(/<!doctype[^>]*>/gi, '')
    .replace(/<\/?(?:html|head|body)\b[^>]*>/gi, '');

  html = stripDangerousAttributes(html);
  html = sanitizeResourceAttributes(html);

  // WeasyPrint does not execute JS, but explicitly remove scriptable URL schemes
  // and legacy CSS/HTML execution hooks anyway.
  html = html
    .replace(/javascript\s*:/gi, '')
    .replace(/vbscript\s*:/gi, '')
    .replace(/expression\s*\(/gi, '');

  return html.trim();
}

export function sanitizePdfCss(raw: string): string {
  let css = cleanText(raw, MAX_CSS_CHARS);
  css = css
    .replace(/@import[\s\S]*?;/gi, '')
    .replace(/expression\s*\([^)]*\)/gi, '')
    .replace(/behavior\s*:[^;}]*/gi, '')
    .replace(/-moz-binding\s*:[^;}]*/gi, '')
    .replace(/url\(\s*(['"]?)(?!asset:|data:image\/|#)[^)]*\)/gi, 'none');

  return css.trim();
}

export function extractPdfAssetIds(html: string, css: string): string[] {
  const ids = new Set<string>();
  const combined = `${html}\n${css}`;
  const regex = /asset:([a-zA-Z0-9_-]{1,80})/g;
  let match: RegExpExecArray | null;
  while ((match = regex.exec(combined))) ids.add(match[1]);
  return Array.from(ids);
}

export function injectPdfAssets(
  html: string,
  css: string,
  assets: Map<string, { data: Buffer; contentType: string }>
): { html: string; css: string } {
  const replace = (value: string) =>
    value.replace(/asset:([a-zA-Z0-9_-]{1,80})/g, (_match, id: string) => {
      const asset = assets.get(id);
      if (!asset) {
        throw new Error(`PDF HTML references unresolved image asset "${id}".`);
      }
      return `data:${asset.contentType};base64,${asset.data.toString('base64')}`;
    });

  return { html: replace(html), css: replace(css) };
}

function htmlToPlainText(html: string): string {
  return html
    .replace(/<(br|hr)\b[^>]*>/gi, '\n')
    .replace(/<\/(p|div|section|article|header|footer|aside|main|h[1-6]|li|tr)>/gi, '\n')
    .replace(/<li\b[^>]*>/gi, '• ')
    .replace(/<[^>]+>/g, ' ')
    .replace(/&nbsp;/gi, ' ')
    .replace(/&amp;/gi, '&')
    .replace(/&lt;/gi, '<')
    .replace(/&gt;/gi, '>')
    .replace(/&quot;/gi, '"')
    .replace(/&#39;/gi, "'")
    .replace(/[ \t]+/g, ' ')
    .replace(/\n\s*\n\s*\n+/g, '\n\n')
    .trim();
}

function wrapHtmlDocument(input: HtmlPdfInput): {
  documentHtml: string;
  fullText: string;
} {
  const locale = cleanText(input.locale || 'en', 32).trim() || 'en';
  const safeHtml = sanitizePdfHtml(input.html);
  const safeCss = sanitizePdfCss(input.css);
  const fullText = htmlToPlainText(safeHtml);

  if (!safeHtml || !fullText) {
    throw new Error('PDF HTML body cannot be empty.');
  }

  const baseCss = `
* { box-sizing: border-box; }
html, body { margin: 0; padding: 0; }
body {
  color: #151b2b;
  background: #fff;
  font-family: Arial, Helvetica, sans-serif;
  font-size: 10.5pt;
  line-height: 1.45;
  text-rendering: geometricPrecision;
}
img, svg, table, figure, blockquote { break-inside: avoid; }
thead { display: table-header-group; }
p { orphans: 3; widows: 3; }
h1, h2, h3, h4 { break-after: avoid; }
`;

  return {
    fullText,
    documentHtml: `<!doctype html>
<html lang="${locale.replace(/[^a-zA-Z0-9_-]/g, '')}">
<head>
<meta charset="utf-8"/>
<style>
${baseCss}
${safeCss}
</style>
</head>
<body>
${safeHtml}
</body>
</html>`,
  };
}

async function inspectPdfPageCount(
  sandbox: InstanceType<typeof Sandbox>,
  path: string
): Promise<number | null> {
  const pdfInfo = await sandbox.runCommand({ cmd: 'pdfinfo', args: [path] });
  await assertCommandSucceeded(pdfInfo, 'Generated PDF inspection');
  return parsePdfPageCount(await pdfInfo.stdout());
}

export async function createHtmlPdfRenderSession(
  options: HtmlPdfRenderOptions = {}
): Promise<HtmlPdfRenderSession> {
  const snapshotId =
    options.snapshotId?.trim() ||
    process.env.PDF_WEASYPRINT_SNAPSHOT_ID?.trim();
  const usedSnapshot = Boolean(snapshotId);
  const timeoutMs = Math.max(25_000, Math.min(options.timeoutMs ?? 90_000, 120_000));

  if (options.signal?.aborted) {
    throw new DOMException('HTML PDF rendering aborted.', 'AbortError');
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
    const { weasyPrintPath } = await installWeasyPrintDependencies(sandbox);
    let renderIndex = 0;

    return {
      render: async (input: HtmlPdfInput): Promise<HtmlPdfRenderResult> => {
        const startedAt = Date.now();
        if (options.signal?.aborted) {
          throw new DOMException('HTML PDF rendering aborted.', 'AbortError');
        }

        const renderId = ++renderIndex;
        const filename = sanitizePdfFilename(input.filename);
        const { documentHtml, fullText } = wrapHtmlDocument(input);
        const htmlPath = `/vercel/sandbox/pdf-${renderId}.html`;
        const outputPath = `/vercel/sandbox/pdf-${renderId}.pdf`;

        await sandbox.writeFiles([
          {
            path: htmlPath,
            content: Buffer.from(documentHtml, 'utf8'),
          },
        ]);

        const render = await sandbox.runCommand({
          cmd: weasyPrintPath,
          args: [htmlPath, outputPath],
        });
        await assertCommandSucceeded(render, 'WeasyPrint PDF generation');

        const totalPageCount = await inspectPdfPageCount(sandbox, outputPath);
        const buffer = await sandbox.readFileToBuffer({ path: outputPath });
        if (!buffer?.length) {
          throw new Error('WeasyPrint produced an empty PDF.');
        }

        const prefix = `/vercel/sandbox/pdf-${renderId}-page`;
        const review = await sandbox.runCommand({
          cmd: 'pdftoppm',
          args: [
            '-png',
            '-r',
            String(REVIEW_DPI),
            '-f',
            '1',
            '-l',
            String(Math.min(totalPageCount || MAX_REVIEW_PAGES, MAX_REVIEW_PAGES)),
            outputPath,
            prefix,
          ],
        });
        await assertCommandSucceeded(review, 'PDF review page rendering');

        const list = await sandbox.runCommand({
          cmd: 'sh',
          args: [
            '-lc',
            `find /vercel/sandbox -maxdepth 1 -type f -name 'pdf-${renderId}-page-*.png' -printf '%f\\n' | sort -V`,
          ],
        });
        await assertCommandSucceeded(list, 'PDF review page enumeration');

        const filenames = (await list.stdout())
          .split(/\r?\n/)
          .map((name) => name.trim())
          .filter(Boolean)
          .slice(0, MAX_REVIEW_PAGES);

        const reviewPages: RenderedHtmlPdfPage[] = [];
        for (let index = 0; index < filenames.length; index += 1) {
          const data = await sandbox.readFileToBuffer({
            path: `/vercel/sandbox/${filenames[index]}`,
          });
          if (data?.length) {
            reviewPages.push({
              pageNumber: index + 1,
              data,
              contentType: 'image/png',
            });
          }
        }

        console.log('[HTML PDF Renderer]', {
          filename,
          renderId,
          targetPageCount: input.targetPageCount || null,
          pageCount: totalPageCount,
          reviewPageCount: reviewPages.length,
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
