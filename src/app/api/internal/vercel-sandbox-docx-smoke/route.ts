import { NextResponse } from 'next/server';
import { Sandbox } from '@vercel/sandbox';

export const runtime = 'nodejs';
export const maxDuration = 300;

const FIXTURE_BASE64 =
  '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';

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

  try {
    const update = await sandbox.runCommand({
      cmd: 'apt-get',
      args: ['update', '-qq'],
      sudo: true,
    });
    if (update.exitCode !== 0) {
      return NextResponse.json(
        { stage: 'apt-update', stderr: await update.stderr() },
        { status: 500 }
      );
    }

    const install = await sandbox.runCommand({
      cmd: 'apt-get',
      args: ['install', '-y', '--no-install-recommends', 'libreoffice-writer'],
      sudo: true,
    });
    if (install.exitCode !== 0) {
      return NextResponse.json(
        { stage: 'apt-install', stderr: (await install.stderr()).slice(-4000) },
        { status: 500 }
      );
    }

    await sandbox.writeFiles([
      {
        path: '/vercel/sandbox/input.docx',
        content: Buffer.from(FIXTURE_BASE64, 'base64'),
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

    if (convert.exitCode !== 0) {
      return NextResponse.json(
        {
          stage: 'convert',
          stdout: await convert.stdout(),
          stderr: await convert.stderr(),
        },
        { status: 500 }
      );
    }

    const pdf = await sandbox.readFileToBuffer({ path: '/vercel/sandbox/input.pdf' });
    if (!pdf) {
      return NextResponse.json(
        { stage: 'read-pdf', stdout: await convert.stdout(), stderr: await convert.stderr() },
        { status: 500 }
      );
    }

    return NextResponse.json({
      ok: true,
      elapsedMs: Date.now() - startedAt,
      byteSize: pdf.length,
      pdfMagic: pdf.subarray(0, 5).toString('ascii'),
      convertStdout: await convert.stdout(),
    });
  } finally {
    await sandbox.stop().catch(() => undefined);
  }
}
