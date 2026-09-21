import { Sandbox } from '@vercel/sandbox';

const MAX_DOCX_RENDER_BYTES = 25 * 1024 * 1024;
export const MAX_DOCX_RENDERED_PAGES = 12;
const DEFAULT_RENDER_DPI = 120;
const LIBREOFFICE_VERSION = '26.2.6';

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

async function runShell(
  sandbox: InstanceType<typeof Sandbox>,
  script: string,
  label: string
) {
  const result = await sandbox.runCommand({
    cmd: 'sh',
    args: ['-lc', script],
  });
  await assertCommandSucceeded(result, label);
  return result;
}

async function commandPath(
  sandbox: InstanceType<typeof Sandbox>,
  candidates: string
): Promise<string | null> {
  const result = await sandbox.runCommand({
    cmd: 'sh',
    args: ['-lc', `for c in ${candidates}; do command -v "$c" 2>/dev/null && exit 0; done; find /opt -type f -path '*/program/soffice' 2>/dev/null | head -n 1`],
  });
  if (result.exitCode !== 0) return null;
  const value = (await result.stdout()).trim().split(/\r?\n/)[0]?.trim();
  return value || null;
}

function parsePdfPageCount(raw: string): number | null {
  const match = raw.match(/^Pages:\s+(\d+)$/im);
  if (!match) return null;
  const parsed = Number(match[1]);
  return Number.isFinite(parsed) && parsed > 0 ? parsed : null;
}

/**
 * Installs LibreOffice + Poppler inside a fresh Vercel Sandbox.
 *
 * Vercel's current default Sandbox image is Amazon-Linux-style (dnf). Keep an
 * apt fallback because older/custom Sandbox snapshots may still be Debian based.
 * LibreOffice is installed from the official RPM bundle on dnf images because
 * it is not provided as the same distro package used by Debian/Ubuntu.
 */
export async function installDocxRendererDependencies(
  sandbox: InstanceType<typeof Sandbox>
): Promise<{ libreOfficePath: string }> {
  let libreOfficePath = await commandPath(sandbox, 'libreoffice soffice');
  const pdfInfoPath = await commandPath(sandbox, 'pdfinfo');
  const pdfToPpmPath = await commandPath(sandbox, 'pdftoppm');

  if (libreOfficePath && pdfInfoPath && pdfToPpmPath) {
    return { libreOfficePath };
  }

  const packageManagerProbe = await sandbox.runCommand({
    cmd: 'sh',
    args: ['-lc', 'if command -v dnf >/dev/null 2>&1; then echo dnf; elif command -v apt-get >/dev/null 2>&1; then echo apt-get; else echo none; fi'],
  });
  await assertCommandSucceeded(packageManagerProbe, 'Package manager detection');
  const packageManager = (await packageManagerProbe.stdout()).trim();

  if (packageManager === 'apt-get') {
    await runShell(
      sandbox,
      'sudo apt-get update -qq && sudo apt-get install -y --no-install-recommends libreoffice-writer poppler-utils',
      'DOCX renderer dependency installation'
    );
  } else if (packageManager === 'dnf') {
    await runShell(
      sandbox,
      'sudo dnf install -y poppler-utils curl tar gzip',
      'Poppler installation'
    );

    libreOfficePath = await commandPath(sandbox, 'libreoffice soffice');
    if (!libreOfficePath) {
      const architectureResult = await sandbox.runCommand({
        cmd: 'uname',
        args: ['-m'],
      });
      await assertCommandSucceeded(architectureResult, 'Sandbox architecture detection');
      const architecture = (await architectureResult.stdout()).trim();
      const rpmArch =
        architecture === 'aarch64' || architecture === 'arm64'
          ? 'aarch64'
          : architecture === 'x86_64' || architecture === 'amd64'
            ? 'x86-64'
            : null;

      if (!rpmArch) {
        throw new Error(`Unsupported Sandbox architecture for LibreOffice: ${architecture}`);
      }

      const archive =
        `LibreOffice_${LIBREOFFICE_VERSION}_Linux_${rpmArch}_rpm.tar.gz`;
      const url =
        `https://download.documentfoundation.org/libreoffice/stable/${LIBREOFFICE_VERSION}/rpm/${rpmArch}/${archive}`;

      await runShell(
        sandbox,
        [
          'set -eu',
          'cd /tmp',
          `curl -fL --retry 3 --connect-timeout 20 "${url}" -o libreoffice.tar.gz`,
          'rm -rf /tmp/libreoffice-rpm',
          'mkdir -p /tmp/libreoffice-rpm',
          'tar -xzf libreoffice.tar.gz -C /tmp/libreoffice-rpm --strip-components=1',
          'sudo dnf install -y /tmp/libreoffice-rpm/RPMS/*.rpm',
        ].join(' && '),
        'LibreOffice RPM installation'
      );
    }
  } else {
    throw new Error('Vercel Sandbox has neither dnf nor apt-get available.');
  }

  libreOfficePath = await commandPath(sandbox, 'libreoffice soffice');
  const finalPdfInfoPath = await commandPath(sandbox, 'pdfinfo');
  const finalPdfToPpmPath = await commandPath(sandbox, 'pdftoppm');

  if (!libreOfficePath || !finalPdfInfoPath || !finalPdfToPpmPath) {
    throw new Error('DOCX renderer dependencies were installed but required binaries are still missing.');
  }

  return { libreOfficePath };
}

/**
 * Renders a DOCX into bounded PNG page images inside Vercel Sandbox.
 *
 * The sandbox is intentionally isolated from the app runtime because LibreOffice
 * and Poppler are system-level binaries. When DOCX_RENDERER_SNAPSHOT_ID is set,
 * the prebuilt snapshot is used; otherwise Preview can install the dependencies
 * in a fresh sandbox so the pipeline remains testable.
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
    const { libreOfficePath } = snapshotId
      ? {
          libreOfficePath:
            (await commandPath(sandbox, 'libreoffice soffice')) ||
            '/opt/libreoffice26.2/program/soffice',
        }
      : await installDocxRendererDependencies(sandbox);

    await sandbox.writeFiles([
      {
        path: '/vercel/sandbox/input.docx',
        content: fileBytes,
      },
    ]);

    const convert = await sandbox.runCommand({
      cmd: libreOfficePath,
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
