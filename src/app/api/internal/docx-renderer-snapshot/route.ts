import { NextResponse } from 'next/server';
import { Sandbox } from '@vercel/sandbox';

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
    const update = await sandbox.runCommand({
      cmd: 'apt-get',
      args: ['update', '-qq'],
      sudo: true,
    });
    if (update.exitCode !== 0) {
      throw new Error(`apt-get update failed: ${await update.stderr()}`);
    }

    const install = await sandbox.runCommand({
      cmd: 'apt-get',
      args: ['install', '-y', '--no-install-recommends', 'libreoffice-writer', 'poppler-utils'],
      sudo: true,
    });
    if (install.exitCode !== 0) {
      throw new Error(`LibreOffice install failed: ${(await install.stderr()).slice(-4000)}`);
    }

    const version = await sandbox.runCommand({
      cmd: 'libreoffice',
      args: ['--version'],
    });
    if (version.exitCode !== 0) {
      throw new Error(`LibreOffice version check failed: ${await version.stderr()}`);
    }

    const snapshot = await sandbox.snapshot({ expiration: 0 });
    snapshotted = true;

    return NextResponse.json({
      ok: true,
      snapshotId: snapshot.snapshotId,
      libreOfficeVersion: (await version.stdout()).trim(),
      elapsedMs: Date.now() - startedAt,
    });
  } finally {
    if (!snapshotted) {
      await sandbox.stop().catch(() => undefined);
    }
  }
}
