// Run explicitly with Vercel SDK authentication. Never run during an app build or request.
import { Sandbox } from '@vercel/sandbox';
const sandbox = await Sandbox.create({ source: { type: 'snapshot', snapshotId: 'snap_cbknPjnQC7hkIHA7dWhDjWYKopFw' }, persistent: false, timeout: 600_000, networkPolicy: 'allow-all' });
try {
  for (const args of [
    ['python3 -m venv /vercel/document-env && /vercel/document-env/bin/pip install python-docx==1.2.0 reportlab==4.4.10 pypdf==6.1.3 Pillow==11.3.0 lxml==6.1.3 typing_extensions==4.16.0 charset-normalizer==3.5.2', false],
    ['apt-get update -qq && apt-get install -y -qq fonts-liberation fonts-crosextra-carlito fonts-crosextra-caladea && fc-cache -f', true],
  ]) {
    const result = await sandbox.runCommand({ cmd: 'bash', args: ['-lc', args[0]], sudo: args[1], timeoutMs: 180_000 });
    if (result.exitCode) throw Error(await result.stderr());
  }
  await sandbox.updateNetworkPolicy('deny-all');
  const snapshot = await sandbox.snapshot({ expiration: 0 });
  console.log('Document runtime snapshot:', snapshot.snapshotId);
} finally { await sandbox.stop().catch(() => {}); }
