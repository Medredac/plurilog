import { Sandbox } from '@vercel/sandbox';

const MAX_DOCX_RENDER_BYTES = 25 * 1024 * 1024;
export const MAX_DOCX_RENDERED_PAGES = 12;
const DEFAULT_RENDER_DPI = 120;

export interface RenderedDocxPage {
  pageNumber: number;
  data: Buffer;
  contentType: 'image/png';
}

export interface RenderDocxPagesResult {
  pages: RenderedDocxPage[];
  totalPageCount: number | null;
  truncated: boolean;
  usedSnapshot: boolean;
  elapsedMs: number;
}

async function assertCommandSucceeded(
  result: Awaited<ReturnType<InstanceType<typeof Sandbox>['runCommand']>>,
  label: string
) {
  if (result.exitCode === 0) return;
  const stderr = (await result.stderr()).trim();
  const stdout = (await result.stdout()).trim();
  throw new Error(
    `${label} failed (exit ${result.exitCode}): ${(stderr || stdout || 'unknown error').slice(-4000)}`
  );
}

function parsePdfPageCount(raw: string): number | null {
  const match = raw.match(/^Pages:\s+(\d+)$/im);
  if (!match) return null;
  const parsed = Number(match[1]);
  return Number.isFinite(parsed) && parsed > 0 ? parsed : null;
}

/**
 * Renders a DOCX into bounded PNG page images inside Vercel Sandbox.
 *
 * The sandbox is intentionally isolated from the app runtime because LibreOffice
 * and Poppler are system-level binaries. When DOCX_RENDERER_SNAPSHOT_ID is set,
 * the prebuilt snapshot is used; otherwise Preview can fall back to installing
 * the packages in a fresh sandbox so the pipeline remains testable.
 */
export async function renderDocxPages(
  fileBytes: Buffer
): Promise<RenderDocxPagesResult> {
  if (!Buffer.isBuffer(fileBytes) || fileBytes.length === 0) {
    throw new Error('DOCX renderer requires non-empty file bytes.');
  }
  if (fileBytes.length > MAX_DOCX_RENDER_BYTES) {
    throw new Error(
      `DOCX is too large for visual rendering (${fileBytes.length} bytes; max ${MAX_DOCX_RENDER_BYTES}).`
    );
  }

  const startedAt = Date.now();
  const snapshotId = process.env.DOCX_RENDERER_SNAPSHOT_ID?.trim();
  const usedSnapshot = Boolean(snapshotId);

  const sandbox = snapshotId
    ? await Sandbox.create({
        source: { type: 'snapshot', snapshotId },
        persistent: false,
        timeout: 5 * 60 * 1000,
        networkPolicy: 'allow-all',
      })
    : await Sandbox.create({
        persistent: false,
        timeout: 5 * 60 * 1000,
        networkPolicy: 'allow-all',
      });

  try {
    if (!snapshotId) {
      const update = await sandbox.runCommand({
        cmd: 'apt-get',
        args: ['update', '-qq'],
        sudo: true,
      });
      await assertCommandSucceeded(update, 'apt-get update');

      const install = await sandbox.runCommand({
        cmd: 'apt-get',
        args: [
          'install',
          '-y',
          '--no-install-recommends',
          'libreoffice-writer',
          'poppler-utils',
        ],
        sudo: true,
      });
      await assertCommandSucceeded(install, 'DOCX renderer dependency installation');
    }

    await sandbox.writeFiles([
      {
        path: '/vercel/sandbox/input.docx',
        content: fileBytes,
      },
    ]);

    const convert = await sandbox.runCommand({
      cmd: 'libreoffice',
      args: [
        '--headless',
        '--convert-to',
        'pdf',
        '--outdir',
        '/vercel/sandbox',
        '/vercel/sandbox/input.docx',
      ],
    });
    await assertCommandSucceeded(convert, 'DOCX to PDF conversion');

    const pdfInfo = await sandbox.runCommand({
      cmd: 'pdfinfo',
      args: ['/vercel/sandbox/input.pdf'],
    });
    await assertCommandSucceeded(pdfInfo, 'PDF page inspection');
    const totalPageCount = parsePdfPageCount(await pdfInfo.stdout());

    const render = await sandbox.runCommand({
      cmd: 'pdftoppm',
      args: [
        '-png',
        '-r',
        String(DEFAULT_RENDER_DPI),
        '-f',
        '1',
        '-l',
        String(MAX_DOCX_RENDERED_PAGES),
        '/vercel/sandbox/input.pdf',
        '/vercel/sandbox/page',
      ],
    });
    await assertCommandSucceeded(render, 'PDF page rendering');

    const list = await sandbox.runCommand({
      cmd: 'sh',
      args: [
        '-lc',
        "find /vercel/sandbox -maxdepth 1 -type f -name 'page-*.png' -printf '%f\\n' | sort -V",
      ],
    });
    await assertCommandSucceeded(list, 'Rendered page enumeration');

    const filenames = (await list.stdout())
      .split(/\r?\n/)
      .map((name) => name.trim())
      .filter(Boolean)
      .slice(0, MAX_DOCX_RENDERED_PAGES);

    if (filenames.length === 0) {
      throw new Error('DOCX renderer produced no page images.');
    }

    const pages: RenderedDocxPage[] = [];
    for (let index = 0; index < filenames.length; index += 1) {
      const data = await sandbox.readFileToBuffer({
        path: `/vercel/sandbox/${filenames[index]}`,
      });
      if (!data || data.length === 0) {
        throw new Error(`Rendered DOCX page ${index + 1} could not be read.`);
      }
      pages.push({
        pageNumber: index + 1,
        data,
        contentType: 'image/png',
      });
    }

    return {
      pages,
      totalPageCount,
      truncated:
        typeof totalPageCount === 'number'
          ? totalPageCount > pages.length
          : pages.length >= MAX_DOCX_RENDERED_PAGES,
      usedSnapshot,
      elapsedMs: Date.now() - startedAt,
    };
  } finally {
    await sandbox.stop().catch(() => undefined);
  }
}
