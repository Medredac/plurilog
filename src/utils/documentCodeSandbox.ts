import crypto from 'node:crypto';
import { Sandbox } from '@vercel/sandbox';
import { DOCUMENT_INSPECTION_PYTHON } from './documentCodeInspection';
import { validateDocumentCodeArgs, type DocumentCodeArgs } from './documentCodeTools';

export const DOCUMENT_CODE_SNAPSHOT = 'snap_Wyuhhi2KcdJRmRGmEl65eQTZEaCT';
const ROOT = '/vercel/sandbox';
const PYTHON = '/vercel/document-env/bin/python';
const MAX_BYTES = 25 * 1024 * 1024;
export interface DocumentCodeDraft {
  id: string; args: DocumentCodeArgs; buffer: Buffer; fullText: string; report: Record<string, any>;
  pages: Array<{ pageNumber: number; data: Buffer; contentType: 'image/png' }>;
}
export async function buildDocumentInSandbox(args: DocumentCodeArgs, inputs: Array<{ filename: string; data: Buffer }>, signal: AbortSignal): Promise<DocumentCodeDraft> {
  validateDocumentCodeArgs(args);
  signal.throwIfAborted();
  if (inputs.reduce((sum, file) => sum + file.data.length, 0) > MAX_BYTES) throw new Error('Combined document inputs exceed 25 MB.');
  if (inputs.some(file => !args.inputs.includes(file.filename)) || args.inputs.some(name => !inputs.some(file => file.filename === name))) throw new Error('Input files do not match the requested available assets.');
  const sandbox = await Sandbox.create({ source: { type: 'snapshot', snapshotId: DOCUMENT_CODE_SNAPSHOT }, persistent: false, timeout: 180_000, networkPolicy: 'deny-all', signal });
  const run = async (cmd: string, argv: string[], timeoutMs = 45_000) => {
    const result = await sandbox.runCommand(cmd, argv, { signal, timeoutMs });
    if (result.exitCode !== 0) throw new Error((await result.stderr() || await result.stdout() || `Command failed: ${cmd}`).slice(-4000));
    return result;
  };
  const read = async (path: string, max = MAX_BYTES, allowEmpty = false) => {
    const stat = await run('stat', ['-Lc', '%s', path]);
    if (Number(await stat.stdout()) > max) throw new Error('Document output exceeds size limit.');
    const value = await sandbox.readFileToBuffer({ path }, { signal });
    if (!value || !allowEmpty && !value.length) throw new Error(`Document output missing: ${path.split('/').pop()}`);
    return value;
  };
  try {
    await run('mkdir', ['-p', ROOT + '/inputs', ROOT + '/rendered']);
    await sandbox.writeFiles([
      { path: ROOT + '/generate.py', content: Buffer.from(args.code) },
      ...inputs.map(file => ({ path: ROOT + '/inputs/' + file.filename, content: file.data })),
    ], { signal });
    // Absolute output path is fixed by the server. No application keys, tokens or URLs enter the VM.
    await run(PYTHON, ['-I', ROOT + '/generate.py'], 45_000);
    const hasDocx = (await run('test', ['-f', ROOT + '/output.docx']).catch(() => null)) !== null;
    if (args.format === 'docx' || hasDocx) {
      await run('libreoffice', ['-env:UserInstallation=file:///tmp/doc-preview-profile', '--headless', '--convert-to', 'pdf', '--outdir', ROOT, ROOT + '/output.docx'], 60_000);
    }
    const buffer = await read(ROOT + '/output.' + args.format);
    if (args.format === 'docx' && buffer.subarray(0, 2).toString() !== 'PK' || args.format === 'pdf' && buffer.subarray(0, 5).toString() !== '%PDF-') throw new Error('Output is not a valid document container.');
    await sandbox.writeFiles([{ path: ROOT + '/inspect.py', content: Buffer.from(DOCUMENT_INSPECTION_PYTHON) }], { signal });
    await run(PYTHON, ['-I', ROOT + '/inspect.py', args.format]);
    const report = JSON.parse((await read(ROOT + '/inspection.json', 2_000_000)).toString());
    const fullText = (await read(ROOT + '/full-text.txt', 2_000_000, true)).toString();
    await run('pdftoppm', ['-r', '100', '-scale-to', '1400', '-png', ROOT + '/output.pdf', ROOT + '/rendered/page'], 60_000);
    const listing = await run('find', [ROOT + '/rendered', '-maxdepth', '1', '-name', 'page-*.png', '-type', 'f']);
    const paths = (await listing.stdout()).trim().split('\n').filter(Boolean).sort((a, b) => Number(a.match(/page-(\d+)/)?.[1]) - Number(b.match(/page-(\d+)/)?.[1]));
    if (paths.length !== report.page_count || paths.length > 20) throw new Error('Not all document pages rendered successfully.');
    const pages: DocumentCodeDraft['pages'] = [];
    for (let i = 0; i < paths.length; i++) pages.push({ pageNumber: i + 1, data: await read(paths[i], 5_000_000), contentType: 'image/png' });
    return { id: crypto.randomUUID(), args: structuredClone(args), buffer, fullText, report, pages };
  } finally {
    // Never use the aborted request signal for cleanup.
    await sandbox.stop().catch(error => console.warn('[Document Code] Sandbox cleanup deferred to timeout', { message: String(error).slice(0, 120) }));
  }
}
