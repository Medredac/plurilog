const { test } = require('node:test');
const assert = require('node:assert/strict');
const fs = require('node:fs');
const path = require('node:path');
const os = require('node:os');
const crypto = require('node:crypto');
const { execFileSync } = require('node:child_process');
const Module = require('node:module');
const ts = require('typescript');
const sharp = require('sharp');
function load(file, overrides = {}, extra = '') {
  const filename = path.resolve(file), mod = new Module(filename, module);
  mod.filename = filename; mod.paths = module.paths;
  mod.require = name => overrides[name] || require(name);
  mod._compile(ts.transpileModule(fs.readFileSync(filename, 'utf8') + extra, {
    compilerOptions: { module: ts.ModuleKind.CommonJS, target: ts.ScriptTarget.ES2022, esModuleInterop: true },
  }).outputText, filename);
  return mod.exports;
}
const photos = load('src/utils/pdfPhotoRebuild.ts');
const writer = load('src/utils/docxWriter.ts');
const parser = load('src/utils/docxParser.ts');
const revision = load('src/utils/documentRevisionState.ts');
const imageBlocks = n => Array.from({length:n}, (_,i) => ({type:'image',mode:'existing',need:`Photo ${i+1}`,caption:`Photo ${i+1} — verified caption ${i+1}`}));
const numbers = n => Array.from({length:n},(_,i)=>i+1);
test('complete 20-photo collection is accepted; missing, duplicated, reordered, replaced or mismatched photos are refused', () => {
  const blocks = imageBlocks(20);
  photos.validatePhotoRebuildBlocks(blocks,numbers(20));
  for (const invalid of [blocks.slice(0,12), [...blocks,blocks[0]], [...blocks].reverse(), blocks.map((b,i)=>i===19?{...b,mode:'generate'}:b), blocks.map((b,i)=>i===19?{...b,caption:'Photo 1 — wrong'}:b)]) {
    assert.throws(()=>photos.validatePhotoRebuildBlocks(invalid,numbers(20)),/complete source-PDF rebuild/);
  }
  assert.throws(()=>photos.validatePhotoRebuildBlocks(imageBlocks(33),numbers(33)),/at most 32/);
});
test('source resolution requires one exact PDF, not an ambiguous name or a Word file', () => {
  const source = {id:'1',filename:'Original.pdf',storagePath:'owner/source.pdf'};
  assert.equal(photos.selectPhotoRebuildSource(' original.PDF ',[source,source]),source);
  assert.throws(()=>photos.selectPhotoRebuildSource('Original.pdf',[source,{...source,id:'2',storagePath:'owner/other.pdf'}]));
  assert.throws(()=>photos.selectPhotoRebuildSource('Original.docx',[{...source,filename:'Original.docx'}]));
});
test('foreign source and unowned discussion are rejected before reading storage or starting extraction', async () => {
  let reads=0;
  const serviceClient={storage:{from:()=>{reads++;throw Error('unexpected read');}}};
  const supabase={auth:{getUser:async()=>({data:{user:{id:'owner'}}})},from:()=>({select(){return this;},eq(){return this;},maybeSingle:async()=>({data:null})})};
  await assert.rejects(photos.preparePdfPhotoRebuild({supabase,serviceClient,discussionId:'d',source:{storagePath:'other/source.pdf'},blocks:[]}),/ownership/);
  await assert.rejects(photos.preparePdfPhotoRebuild({supabase,serviceClient,discussionId:'d',source:{storagePath:'owner/source.pdf'},blocks:[]}),/ownership/);
  assert.equal(reads,0);
});
test('Word round trip preserves 20 image byte payloads, ordering and captions; 33 images fail instead of truncating', async () => {
  const blocks=await Promise.all(imageBlocks(20).map(async(b,i)=>({...b,imageContentType:'image/png',imageData:await sharp({create:{width:100,height:120,channels:3,background:{r:i*10,g:50,b:90}}}).png().toBuffer()})));
  const output=writer.renderDocx({filename:'test.docx',title:'Photos',blocks});
  const parsed=await parser.parseDocx(output.buffer);
  assert.equal(parsed.embeddedImages.length,20);
  parsed.embeddedImages.forEach((p,i)=>assert.deepEqual(p.data,blocks[i].imageData));
  blocks.forEach(b=>assert.ok(parsed.fullText.includes(b.caption)));
  assert.throws(()=>writer.renderDocx({filename:'too-many.docx',blocks:Array.from({length:33},()=>blocks[0])}),/refusing to omit/);
  const safe=revision.sanitizeDocumentSpecForState({format:'docx',blocks});
  assert.ok(!JSON.stringify(safe).includes('imageData'));
  assert.equal(safe.blocks.length,20);
});
const python=process.env.PHOTO_TEST_PYTHON || 'python3';
let hasFitz=true; try {execFileSync(python,['-c','import fitz'],{stdio:'ignore'});} catch {hasFitz=false;}
const fixtureScript=String.raw`
import fitz, sys, os
from PIL import Image
root=sys.argv[1]
doc=fitz.open()
for pair in range(10):
 p=doc.new_page(width=600,height=500)
 for col in range(2):
  n=pair*2+col+1
  ext='png' if n>18 else 'jpg'
  mode='RGBA' if n>18 else 'RGB'
  im=Image.new(mode,(100,120),(n*10,50,90,127) if n>18 else (n*10,50,90))
  name=os.path.join(root,'original-%d.%s'%(n,ext)); im.save(name)
  x=30+col*280
  p.insert_text((x,35),'Photo %d - original caption'%n)
  p.insert_image(fitz.Rect(x,60,x+200,300),filename=name)
doc.save(os.path.join(root,'source.pdf'))
`;
test('real extractor maps 20 originals across two-column pages and preserves JPEG bytes and alpha', {skip:!hasFitz}, async () => {
  const dir=fs.mkdtempSync(path.join(os.tmpdir(),'plurilog-photos-'));
  try {
    fs.writeFileSync(path.join(dir,'fixture.py'),fixtureScript);
    fs.writeFileSync(path.join(dir,'extract.py'),photos.PDF_PHOTO_EXTRACT_SCRIPT);
    execFileSync(python,[path.join(dir,'fixture.py'),dir]);
    const manifest=JSON.parse(execFileSync(python,[path.join(dir,'extract.py'),path.join(dir,'source.pdf'),path.join(dir,'out')],{encoding:'utf8'}));
    assert.deepEqual(manifest.map(p=>p.number),numbers(20));
    assert.deepEqual(manifest.map(p=>p.page),numbers(20).map(n=>Math.ceil(n/2)));
    for(const p of manifest){
      const data=fs.readFileSync(path.join(dir,'out',p.name));
      assert.equal(crypto.createHash('sha256').update(data).digest('hex'),p.sha256);
      if(p.number<=18) assert.deepEqual(data,fs.readFileSync(path.join(dir,`original-${p.number}.jpg`)));
      else {const meta=await sharp(data).metadata();assert.equal(meta.hasAlpha,true);assert.equal((await sharp(data).raw().toBuffer())[3],127);}
    }
    // Missing numbered labels must refuse the complete collection, not silently drop a photo.
    execFileSync(python,['-c',"import fitz,sys; d=fitz.open(sys.argv[1]); p=d[-1]; p.add_redact_annot(p.search_for('Photo 20')[0]); p.apply_redactions(images=0); d.save(sys.argv[2])",path.join(dir,'source.pdf'),path.join(dir,'missing.pdf')]);
    assert.throws(()=>execFileSync(python,[path.join(dir,'extract.py'),path.join(dir,'missing.pdf'),path.join(dir,'bad')],{stdio:'pipe'}),/verified caption binding/);
  } finally {fs.rmSync(dir,{recursive:true,force:true});}
});

test('documentary image fit preserves full frame in PDF and aspect ratio in Word', async () => {
  const {renderImageElement} = load('src/utils/richPdfRenderer.ts', {}, '\nexport {renderImageElement};');
  const data=await sharp({create:{width:100,height:200,channels:3,background:'red'}}).png().toBuffer();
  const block={type:'image',imageData:data,imageContentType:'image/png',widthMm:76,heightMm:48,preserveAspectRatio:true};
  assert.match(renderImageElement(block),/object-fit:contain/);
  assert.match(renderImageElement({...block,preserveAspectRatio:false}),/object-fit:cover/);
  const out=writer.renderDocx({filename:'aspect.docx',blocks:[block]});
  const match=out.buffer.toString('utf8').match(/<wp:extent cx="(\d+)" cy="(\d+)"/);
  assert.ok(match);
  assert.equal(Number(match[2])/Number(match[1]),2);
});
