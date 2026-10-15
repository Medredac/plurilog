const {test}=require('node:test');
const assert=require('node:assert/strict');
const fs=require('node:fs'),path=require('node:path'),Module=require('node:module'),ts=require('typescript'),vm=require('node:vm');
function load(file){const filename=path.resolve(file),m=new Module(filename,module);m.paths=module.paths;m.require=n=>n==='./docxWriter'?load('src/utils/docxWriter.ts'):n==='./documentTemplateTreatments'?load('src/utils/documentTemplateTreatments.ts'):n==='./pdfEssayFont.json'?JSON.parse(fs.readFileSync('src/utils/pdfEssayFont.json','utf8')):n==='./pdfBrochureFont.json'?JSON.parse(fs.readFileSync('src/utils/pdfBrochureFont.json','utf8')):n==='./documentLayouts'?load('src/utils/documentLayouts.ts'):require(n);m._compile(ts.transpileModule(fs.readFileSync(filename,'utf8'),{compilerOptions:{module:ts.ModuleKind.CommonJS,target:ts.ScriptTarget.ES2022,esModuleInterop:true}}).outputText,filename);return m.exports;}
const {applyDocumentLayout,DOCUMENT_LAYOUTS}=load('src/utils/documentLayouts.ts');
const {renderDocx}=load('src/utils/docxWriter.ts');
const {buildHtml}=load('src/utils/richPdfRenderer.ts');
test('Garden editorial composition stays side by side for portrait and landscape photos',()=>{
 for(const [width,height,wide] of [[1600,900,false],[900,1600,false]]){
  const bytes=Buffer.alloc(24);bytes.writeUInt32BE(0x89504e47,0);bytes.writeUInt32BE(width,16);bytes.writeUInt32BE(height,20);
  const result=buildHtml({filename:'photo.pdf',design:{layoutTemplate:'brochure-editorial',templateVersion:2},blocks:[{type:'heading',text:'Title'},{type:'image',size:'full',imageData:bytes,imageContentType:'image/png',preserveAspectRatio:true}]});
  const section=result.html.slice(result.html.indexOf('<section class="brochure-page'));
  assert.equal(section.slice(0,100).includes('wide-hero'),wide);
  assert.ok(result.html.includes('height:160mm !important; object-fit:contain'));
 }
});
const xml=b=>b.toString('utf8'); // The production writer creates uncompressed ZIP entries.
test('presets never override explicit styles and legacy custom documents keep their settings',()=>{
 assert.deepEqual(applyDocumentLayout(),{});assert.deepEqual(applyDocumentLayout({fontFamily:'mono'}),{fontFamily:'mono'});
 const d=applyDocumentLayout({layoutTemplate:'essay',fontFamily:'sans',showPageNumbers:false,marginMm:18});
 assert.equal(d.fontFamily,'sans');assert.equal(d.marginMm,18);assert.equal(d.showPageNumbers,false);assert.equal(d.lineHeight,1.6);
 assert.deepEqual(applyDocumentLayout({layoutTemplate:'__proto__'}),{layoutTemplate:'__proto__'});
});
test('every preset renders both formats with unchanged authored content',()=>{
 for(const layoutTemplate of Object.keys(DOCUMENT_LAYOUTS)){
  const input={filename:'test.docx',title:'Résumé Prüfung',design:{layoutTemplate},blocks:[{type:'paragraph',text:'ORCHID 4729 — coût €98.40; 北京'},{type:'table',headers:['Item','Value'],rows:[['Original','17.25']]}]};
  const word=renderDocx(input),pdf=buildHtml(input);
  for(const t of ['ORCHID 4729','17.25','Résumé Prüfung']){assert.ok(word.fullText.includes(t),layoutTemplate);assert.ok(pdf.fullText.includes(t),layoutTemplate);}
 }
});
test('Word packages headers, footers, page fields and correctly escaped text',()=>{
 const result=xml(renderDocx({filename:'report.docx',design:{layoutTemplate:'report',headerText:'R&D <2026>',footerText:'Private'},blocks:[{type:'paragraph',text:'Body'}]}).buffer);
 for(const part of ['word/header1.xml','word/footer1.xml','rIdHeader','rIdFooter','w:instr="PAGE"','R&amp;D &lt;2026&gt;'])assert.ok(result.includes(part),part);
});
test('pamphlet panel boundaries survive in both formats and sheets stay separate',()=>{
 const blocks=[];for(let i=0;i<6;i++){if(i)blocks.push({type:i===3?'page_break':'column_break'});blocks.push({type:'heading',text:`Panel ${i+1}`},{type:'paragraph',text:`Exact text ${i+1}`});}
 const input={filename:'pamphlet.docx',design:{layoutTemplate:'pamphlet'},blocks};
 const word=xml(renderDocx(input).buffer),pdf=buildHtml(input).html;
 assert.ok(word.includes('<w:cols w:num="3"'));assert.equal((word.match(/w:type="column"/g)||[]).length,4);
 assert.equal((pdf.match(/role="presentation"/g)||[]).length,2);
 for(let i=1;i<6;i++)assert.ok(pdf.indexOf(`Panel ${i}`)<pdf.indexOf(`Panel ${i+1}`));
 assert.ok(pdf.includes('break-before:page'));
});

test('every template keeps supplied image bytes and document facts', async()=>{
 const image=await require('sharp')({create:{width:300,height:100,channels:4,background:{r:30,g:110,b:80,alpha:0.7}}}).png().toBuffer();
 for(const layoutTemplate of Object.keys(DOCUMENT_LAYOUTS)){
  const spec={filename:'test.docx',title:'Community Garden',design:{layoutTemplate},blocks:[{type:'image',filename:'logo.png',mode:'existing',imageData:image,imageContentType:'image/png',widthMm:40,preserveAspectRatio:true},{type:'paragraph',text:'ORCHID-4729 | $4,200 | garden@example.org'}]};
  const word=renderDocx(spec),pdf=buildHtml(spec);
  assert.ok(word.buffer.includes(image),layoutTemplate);
  assert.ok(pdf.html.includes(image.toString('base64')),layoutTemplate);
  assert.ok(word.fullText.includes('ORCHID-4729'));assert.ok(pdf.fullText.includes('$4,200'));
 }
});
test('visual templates do not add publication checks or rewrite the document',()=>{
 const blocks=[{type:'heading',text:'Long section'},{type:'paragraph',text:'Retain this sentence. '.repeat(200)},{type:'image',size:'large'},{type:'image',size:'large'}];
 assert.doesNotThrow(()=>buildHtml({filename:'long.pdf',design:{layoutTemplate:'brochure-editorial'},blocks}));
 assert.equal(blocks[1].text.length,'Retain this sentence. '.repeat(200).length);
});
