import crypto from 'node:crypto';
import { Sandbox } from '@vercel/sandbox';

const STORAGE_BUCKET = 'message-images';
const URL_EXPIRY_SECONDS = 259200;
const MAX_PDF_BYTES = 25 * 1024 * 1024;
const MAX_EXTRACTED_IMAGES = 12;

export interface ExtractedPdfImage {
  index: number;
  data: Buffer;
  contentType: 'image/png';
  width: number;
  height: number;
  portraitCandidate: boolean;
}

export interface PersistedPdfEmbeddedImage {
  index: number;
  filename: string;
  storagePath: string;
  signedUrl: string;
  contentType: 'image/png';
  byteSize: number;
  width: number;
  height: number;
  portraitCandidate: boolean;
}

async function assertSucceeded(
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

function pngDimensions(data: Buffer): { width: number; height: number } | null {
  if (
    data.length < 24 ||
    data[0] !== 0x89 ||
    data.toString('ascii', 1, 4) !== 'PNG'
  ) {
    return null;
  }
  const width = data.readUInt32BE(16);
  const height = data.readUInt32BE(20);
  if (!width || !height) return null;
  return { width, height };
}

function safeBaseFilename(filename: string): string {
  return (
    (filename || 'document.pdf')
      .split(/[\\/]/)
      .pop()
      ?.replace(/\.pdf$/i, '')
      .replace(/[\u0000-\u001f\u007f]/g, '')
      .replace(/[<>:"/\\|?*]/g, '-')
      .replace(/\s+/g, ' ')
      .trim()
      .slice(0, 90) || 'document'
  );
}

async function ensurePdfImagesAvailable(
  sandbox: InstanceType<typeof Sandbox>
): Promise<void> {
  const probe = await sandbox.runCommand({
    cmd: 'sh',
    args: ['-lc', 'command -v pdfimages >/dev/null 2>&1'],
  });
  if (probe.exitCode === 0) return;

  const managerProbe = await sandbox.runCommand({
    cmd: 'sh',
    args: [
      '-lc',
      'if command -v dnf >/dev/null 2>&1; then echo dnf; elif command -v apt-get >/dev/null 2>&1; then echo apt-get; else echo none; fi',
    ],
  });
  await assertSucceeded(managerProbe, 'Package-manager detection');
  const manager = (await managerProbe.stdout()).trim();

  const install =
    manager === 'dnf'
      ? 'sudo dnf install -y poppler-utils'
      : manager === 'apt-get'
        ? 'sudo apt-get update -qq && sudo apt-get install -y --no-install-recommends poppler-utils'
        : '';

  if (!install) {
    throw new Error('PDF image extraction requires poppler-utils.');
  }

  const result = await sandbox.runCommand({
    cmd: 'sh',
    args: ['-lc', install],
  });
  await assertSucceeded(result, 'Poppler installation');
}

export async function extractPdfEmbeddedImages(
  pdfBytes: Buffer,
  options?: {
    signal?: AbortSignal;
    timeoutMs?: number;
    minDimension?: number;
    minArea?: number;
  }
): Promise<ExtractedPdfImage[]> {
  if (!Buffer.isBuffer(pdfBytes) || pdfBytes.length === 0) return [];
  if (pdfBytes.length > MAX_PDF_BYTES) {
    throw new Error(
      `PDF is too large for embedded-image extraction (${pdfBytes.length} bytes).`
    );
  }

  const snapshotId = process.env.DOCX_RENDERER_SNAPSHOT_ID?.trim();
  const timeoutMs = Math.max(
    10_000,
    Math.min(options?.timeoutMs ?? 25_000, 60_000)
  );

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
  options?.signal?.addEventListener('abort', abortHandler, { once: true });

  try {
    if (options?.signal?.aborted) {
      throw new DOMException('PDF image extraction aborted.', 'AbortError');
    }

    await ensurePdfImagesAvailable(sandbox);
    await sandbox.writeFiles([
      {
        path: '/vercel/sandbox/input.pdf',
        content: pdfBytes,
      },
    ]);

    const extraction = await sandbox.runCommand({
      cmd: 'pdfimages',
      args: [
        '-png',
        '/vercel/sandbox/input.pdf',
        '/vercel/sandbox/pdfimg',
      ],
    });
    await assertSucceeded(extraction, 'PDF embedded-image extraction');

    const listing = await sandbox.runCommand({
      cmd: 'sh',
      args: [
        '-lc',
        "find /vercel/sandbox -maxdepth 1 -type f -name 'pdfimg-*.png' -printf '%f\\n' | sort -V",
      ],
    });
    await assertSucceeded(listing, 'PDF embedded-image enumeration');

    const filenames = (await listing.stdout())
      .split(/\r?\n/)
      .map((name) => name.trim())
      .filter(Boolean);

    const seenHashes = new Set<string>();
    const extracted: ExtractedPdfImage[] = [];

    for (let index = 0; index < filenames.length; index += 1) {
      if (extracted.length >= MAX_EXTRACTED_IMAGES) break;
      if (options?.signal?.aborted) {
        throw new DOMException('PDF image extraction aborted.', 'AbortError');
      }

      const data = await sandbox.readFileToBuffer({
        path: `/vercel/sandbox/${filenames[index]}`,
      });
      if (!data || data.length === 0) continue;

      const dims = pngDimensions(data);
      if (!dims) continue;

      // Ignore tiny decorative glyphs/icons by default. Tests may lower the
      // threshold to verify that conversion preserved even a deliberately tiny fixture.
      const minDimension = Math.max(1, options?.minDimension ?? 80);
      const minArea = Math.max(1, options?.minArea ?? 10_000);
      if (
        dims.width < minDimension ||
        dims.height < minDimension ||
        dims.width * dims.height < minArea
      ) {
        continue;
      }

      const hash = crypto.createHash('sha256').update(data).digest('hex');
      if (seenHashes.has(hash)) continue;
      seenHashes.add(hash);

      const ratio = dims.width / dims.height;
      const portraitCandidate =
        dims.width >= 100 &&
        dims.height >= 100 &&
        ratio >= 0.55 &&
        ratio <= 1.05;

      extracted.push({
        index: extracted.length,
        data,
        contentType: 'image/png',
        width: dims.width,
        height: dims.height,
        portraitCandidate,
      });
    }

    extracted.sort((a, b) => {
      if (a.portraitCandidate !== b.portraitCandidate) {
        return a.portraitCandidate ? -1 : 1;
      }
      return b.width * b.height - a.width * a.height;
    });

    return extracted.map((image, index) => ({ ...image, index }));
  } finally {
    options?.signal?.removeEventListener('abort', abortHandler);
    await sandbox.stop().catch(() => undefined);
  }
}

export async function persistPdfEmbeddedImages(options: {
  supabase: any;
  parentFilename: string;
  parentFileBytes: Buffer;
  images: ExtractedPdfImage[];
}): Promise<PersistedPdfEmbeddedImage[]> {
  const { supabase, parentFilename, parentFileBytes, images } = options;
  if (
    !supabase ||
    !Buffer.isBuffer(parentFileBytes) ||
    parentFileBytes.length === 0 ||
    !Array.isArray(images) ||
    images.length === 0
  ) {
    return [];
  }

  const {
    data: { user },
    error: authError,
  } = await supabase.auth.getUser();

  if (authError || !user) {
    throw new Error(
      'Authenticated user session required for PDF embedded-image persistence.'
    );
  }

  const parentHash = crypto
    .createHash('sha256')
    .update(parentFileBytes)
    .digest('hex');
  const parentBase = safeBaseFilename(parentFilename);
  const persisted: PersistedPdfEmbeddedImage[] = [];

  for (const image of images.slice(0, MAX_EXTRACTED_IMAGES)) {
    const imageHash = crypto.createHash('sha256').update(image.data).digest('hex');
    const ordinal = String(image.index + 1).padStart(3, '0');
    const storagePath =
      `${user.id}/pdf-assets/${parentHash}/${ordinal}-${imageHash.slice(0, 16)}.png`;
    const roleLabel = image.portraitCandidate
      ? 'embedded portrait photo candidate'
      : 'embedded image';
    const filename =
      `${parentBase} — ${roleLabel} ${image.index + 1} — ${image.width}x${image.height}.png`;

    const { error: uploadError } = await supabase.storage
      .from(STORAGE_BUCKET)
      .upload(storagePath, image.data, {
        contentType: image.contentType,
        upsert: false,
      });

    if (
      uploadError &&
      !/already exists|duplicate/i.test(uploadError.message || '')
    ) {
      console.warn('[PDF Visual] Embedded image upload failed:', {
        filename,
        error: uploadError.message,
      });
      continue;
    }

    const { data: signedData, error: signError } = await supabase.storage
      .from(STORAGE_BUCKET)
      .createSignedUrl(storagePath, URL_EXPIRY_SECONDS);

    if (signError || !signedData?.signedUrl) {
      console.warn('[PDF Visual] Embedded image signing failed:', {
        filename,
        error: signError?.message || 'Unknown signing error',
      });
      continue;
    }

    persisted.push({
      index: image.index,
      filename,
      storagePath,
      signedUrl:
        `${signedData.signedUrl}#filename=${encodeURIComponent(filename)}`,
      contentType: image.contentType,
      byteSize: image.data.length,
      width: image.width,
      height: image.height,
      portraitCandidate: image.portraitCandidate,
    });
  }

  return persisted;
}
