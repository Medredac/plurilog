const { test } = require('node:test');
const assert = require('node:assert/strict');
const fs = require('node:fs');
const path = require('node:path');
const os = require('node:os');
const { execFileSync } = require('node:child_process');
const Module = require('node:module');
const ts = require('typescript');
const sharp = require('sharp');
function load(file, overrides = {}) {
  const filename = path.resolve(file);
  const mod = new Module(filename, module);
  mod.filename = filename;
  mod.paths = module.paths;
  mod.require = name => overrides[name] || require(name);
  mod._compile(ts.transpileModule(fs.readFileSync(filename, 'utf8'), {
    compilerOptions: { module: ts.ModuleKind.CommonJS, target: ts.ScriptTarget.ES2022, esModuleInterop: true },
  }).outputText, filename);
  return mod.exports;
}
const revision = load('src/utils/documentRevisionState.ts');
const transparency = load('src/utils/pdfImageTransparency.ts');
const parent = {
  format: 'docx', filename: 'original.docx', title: 'Preview transfer check',
  blocks: [{ type: 'heading', text: 'Preview transfer check' },
    { type: 'paragraph', text: 'ORCHID-4729 LANTERN-8631' },
    { type: 'table', headers: ['Item', 'Count'], rows: [['Amber', '7'], ['Teal', '11'], ['Violet', '5']] },
    { type: 'image', storagePath: 'user/robot.png' }],
};
const prompt = 'Change only the title to Verified transfer check. Preserve the table, both codes, all other text, and the exact robot image.';
const patch = [{ op: 'replace', path: '/title', value: 'Verified transfer check' }, { op: 'replace', path: '/blocks/0/text', value: 'Verified transfer check' }];
const renamed = () => revision.applyDocumentJsonPatch(parent, patch);
test('requested title revision passes while preserving canonical body, table and image binding', () => {
  revision.assertNarrowRevisionPatchSafety(patch, prompt);
  const next = renamed();
  assert.deepEqual(revision.missingPreservedDocumentContent(parent, next, prompt), []);
  assert.deepEqual(next.blocks.slice(1), parent.blocks.slice(1));
  assert.equal(parent.title, 'Preview transfer check');
});
test('title rename remains protected when not requested or blanked', () => {
  assert.equal(revision.missingPreservedDocumentContent(parent, renamed(), 'Make margins narrower').length, 2);
  assert.equal(revision.missingPreservedDocumentContent(parent, renamed(), 'Change the title to Something else').length, 2);
  assert.equal(revision.missingPreservedDocumentContent(parent, renamed(), "Don't change the title to Verified transfer check").length, 2);
  const next = renamed(); next.title = ''; next.blocks[0].text = '';
  assert.equal(revision.missingPreservedDocumentContent(parent, next, prompt).length, 2);
});
test('rename cannot silently lose body, table cells, another heading or the title heading', () => {
  const next = renamed(); next.blocks[1].text = 'Wrong'; next.blocks[2].rows[1][1] = '99';
  assert.deepEqual(revision.missingPreservedDocumentContent(parent, next, prompt), ['ORCHID-4729 LANTERN-8631', '11']);
  const withoutHeading = renamed(); withoutHeading.blocks.splice(0, 1);
  assert.deepEqual(revision.missingPreservedDocumentContent(parent, withoutHeading, prompt), [parent.title]);
  const withBodyTitle = structuredClone(parent); withBodyTitle.blocks.push({ type: 'paragraph', text: parent.title });
  assert.deepEqual(revision.missingPreservedDocumentContent(withBodyTitle, renamed(), prompt), [parent.title]);
});
test('existing narrow revision structural guard remains enforced', () => {
  for (const operation of [{ op: 'remove', path: '/blocks/1' }, { op: 'replace', path: '/blocks', value: [] }]) {
    assert.throws(() => revision.assertNarrowRevisionPatchSafety([operation], prompt));
  }
});
test('image metadata distinguishes soft masks, hard masks and actual standalone images', () => {
  const entries = transparency.parsePdfImageList('page num type width height color comp bpc enc interp object ID\n 1 0 image 240 252 rgb 3 8 image no 4 0\n 1 1 smask 240 252 gray 1 8 image yes 4 0\n 2 2 image 80 80 rgb 3 8 jpeg no 6 0\n 2 3 mask 80 80 gray 1 1 image no 6 0');
  assert.deepEqual(entries.map(e => e.type), ['image', 'smask', 'image', 'mask']);
  assert.equal(entries[1].interpolate, true);
});
test('mask compositing preserves RGB pixels and exact soft alpha, including grayscale input', async () => {
  for (const channels of [1, 3]) {
    const source = Buffer.from(channels === 3 ? [255, 0, 0, 0, 200, 10, 10, 20, 30] : [255, 100, 0]);
    const base = await sharp(source, { raw: { width: 3, height: 1, channels } }).png().toBuffer();
    const mask = await sharp(Buffer.from([0, 127, 255]), { raw: { width: 3, height: 1, channels: 1 } }).png().toBuffer();
    const actual = await sharp(await transparency.applyPdfImageMask(base, mask, false)).raw().toBuffer({ resolveWithObject: true });
    assert.equal(actual.info.channels, 4);
    assert.deepEqual([actual.data[3], actual.data[7], actual.data[11]], [0, 127, 255]);
    assert.deepEqual([...actual.data.subarray(8, 11)], channels === 3 ? [10, 20, 30] : [0, 0, 0]);
  }
});
test('different-sized masks are resized to the original image without changing image dimensions', async () => {
  const base = await sharp({ create: { width: 4, height: 2, channels: 3, background: '#ff0000' } }).png().toBuffer();
  const mask = await sharp(Buffer.from([0, 255]), { raw: { width: 2, height: 1, channels: 1 } }).png().toBuffer();
  for (const interpolate of [false, true]) {
    const result = await sharp(await transparency.applyPdfImageMask(base, mask, interpolate)).metadata();
    assert.equal(result.width, 4); assert.equal(result.height, 2); assert.equal(result.hasAlpha, true);
  }
});

// Run the real extraction orchestration against Poppler locally, without cloud
// credentials. CI can provide PDFIMAGES_BIN; pure image/guard tests always run.
const pdfimages = process.env.PDFIMAGES_BIN || 'pdfimages';
let hasPoppler = true;
try { execFileSync(pdfimages, ['-v'], { stdio: 'ignore' }); } catch { hasPoppler = false; }
function syntheticPdf() {
  const objects = [
    '<< /Type /Catalog /Pages 2 0 R >>',
    '<< /Type /Pages /Kids [3 0 R] /Count 1 >>',
    '<< /Type /Page /Parent 2 0 R /MediaBox [0 0 100 100] /Resources << /XObject << /I 4 0 R /J 7 0 R >> >> /Contents 6 0 R >>',
    Buffer.concat([Buffer.from('<< /Type /XObject /Subtype /Image /Width 3 /Height 1 /ColorSpace /DeviceRGB /BitsPerComponent 8 /SMask 5 0 R /Length 9 >>\nstream\n'), Buffer.from([255,0,0,0,200,10,10,20,30]), Buffer.from('\nendstream')]),
    Buffer.concat([Buffer.from('<< /Type /XObject /Subtype /Image /Width 3 /Height 1 /ColorSpace /DeviceGray /BitsPerComponent 8 /Length 3 >>\nstream\n'), Buffer.from([0,127,255]), Buffer.from('\nendstream')]),
    '<< /Length 55 >>\nstream\nq 60 0 0 20 0 0 cm /I Do Q\nq 60 0 0 20 0 40 cm /J Do Q\nendstream',
    Buffer.concat([Buffer.from('<< /Type /XObject /Subtype /Image /Width 2 /Height 1 /ColorSpace /DeviceRGB /BitsPerComponent 8 /Length 6 >>\nstream\n'), Buffer.from([200,100,50,20,40,60]), Buffer.from('\nendstream')]),
  ];
  let out = Buffer.from('%PDF-1.4\n'); const offsets = [0];
  objects.forEach((obj, i) => { offsets.push(out.length); out = Buffer.concat([out, Buffer.from(`${i+1} 0 obj\n`), Buffer.isBuffer(obj) ? obj : Buffer.from(obj), Buffer.from('\nendobj\n')]); });
  const xref = out.length;
  return Buffer.concat([out, Buffer.from(`xref\n0 ${objects.length+1}\n0000000000 65535 f \n${offsets.slice(1).map(n => String(n).padStart(10,'0')+' 00000 n \n').join('')}trailer\n<< /Size ${objects.length+1} /Root 1 0 R >>\nstartxref\n${xref}\n%%EOF`)]);
}
test('real PDF extraction returns transparent picture plus opaque picture, never the mask', { skip: !hasPoppler }, async () => {
  const dir = fs.mkdtempSync(path.join(os.tmpdir(), 'plurilog-pdf-'));
  let stopped = false;
  const sandbox = {
    writeFiles: async files => files.forEach(f => fs.writeFileSync(path.join(dir, path.basename(f.path)), f.content)),
    runCommand: async ({cmd, args}) => {
      let stdout = '';
      if (cmd === 'pdfimages') stdout = execFileSync(pdfimages, args.map(a => a.replace('/vercel/sandbox', dir)), { encoding: 'utf8' });
      else if (args.join(' ').includes('find ')) stdout = fs.readdirSync(dir).filter(n => /^pdfimg-.*\.png$/.test(n)).sort().join('\n');
      return { exitCode: 0, stdout: async () => stdout, stderr: async () => '' };
    },
    readFileToBuffer: async ({path: filename}) => fs.readFileSync(path.join(dir, path.basename(filename))),
    stop: async () => { stopped = true; },
  };
  try {
    const { extractPdfEmbeddedImages } = load('src/utils/pdfEmbeddedImages.ts', {
      '@vercel/sandbox': { Sandbox: { create: async () => sandbox } }, './pdfImageTransparency': transparency,
    });
    const images = await extractPdfEmbeddedImages(syntheticPdf(), { minDimension: 1, minArea: 1 });
    assert.equal(images.length, 2);
    const transparent = images.find(i => i.width === 3);
    const rgba = await sharp(transparent.data).raw().toBuffer();
    assert.deepEqual([...rgba], [255,0,0,0,0,200,10,127,10,20,30,255]);
    const opaque = images.find(i => i.width === 2);
    assert.deepEqual(opaque.data, fs.readFileSync(path.join(dir, 'pdfimg-002.png')));
    assert.equal(stopped, true);
  } finally { fs.rmSync(dir, { recursive: true, force: true }); }
});
