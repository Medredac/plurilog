import { NextResponse } from 'next/server';
import { Sandbox } from '@vercel/sandbox';
import { installDocxRendererDependencies } from '@/utils/docxPageRenderer';

export const runtime = 'nodejs';
export const maxDuration = 300;

export async function GET() {
  if (process.env.VERCEL_ENV !== 'preview') {
    return NextResponse.json({ error: 'not found' }, { status: 404 });
  }

  const startedAt = Date.now();
  const sandbox = await Sandbox.create({
    persistent: false,
    timeout: 5 * 60 * 1000,
    networkPolicy: 'allow-all',
  });
  let snapshotted = false;

  try {
    const { libreOfficePath } = await installDocxRendererDependencies(sandbox);

    const version = await sandbox.runCommand({
      cmd: libreOfficePath,
      args: ['--version'],
    });
    if (version.exitCode !== 0) {
      throw new Error(`LibreOffice version check failed: ${await version.stderr()}`);
    }

    const popplerVersion = await sandbox.runCommand({
      cmd: 'pdftoppm',
      args: ['-v'],
    });
    if (popplerVersion.exitCode !== 0) {
      throw new Error(`Poppler version check failed: ${await popplerVersion.stderr()}`);
    }

    const snapshot = await sandbox.snapshot({ expiration: 0 });
    snapshotted = true;

    return NextResponse.json({
      ok: true,
      snapshotId: snapshot.snapshotId,
      libreOfficeVersion: (await version.stdout()).trim(),
      popplerVersion:
        (await popplerVersion.stderr()).trim() ||
        (await popplerVersion.stdout()).trim(),
      elapsedMs: Date.now() - startedAt,
    });
  } finally {
    if (!snapshotted) {
      await sandbox.stop().catch(() => undefined);
    }
  }
}
