const {test}=require('node:test');
const assert=require('node:assert/strict');
const fs=require('node:fs'),path=require('node:path'),Module=require('node:module'),ts=require('typescript'),vm=require('node:vm');
function load(file){const filename=path.resolve(file),m=new Module(filename,module);m.paths=module.paths;m.require=n=>n==='./pdfBrochureFont.json'?JSON.parse(fs.readFileSync('src/utils/pdfBrochureFont.json','utf8')):n==='./documentLayouts'?load('src/utils/documentLayouts.ts'):require(n);m._compile(ts.transpileModule(fs.readFileSync(filename,'utf8'),{compilerOptions:{module:ts.ModuleKind.CommonJS,target:ts.ScriptTarget.ES2022,esModuleInterop:true}}).outputText,filename);return m.exports;}
const {applyDocumentLayout,DOCUMENT_LAYOUTS}=load('src/utils/documentLayouts.ts');
const {renderDocx}=load('src/utils/docxWriter.ts');
const {buildHtml}=load('src/utils/richPdfRenderer.ts');
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
const source=fs.readFileSync('src/utils/gptDocumentCreation.ts','utf8'),ast=ts.createSourceFile('a.ts',source,ts.ScriptTarget.Latest,true);
const f=ast.statements.find(n=>n.name?.text==='preserveDocxSemanticContent');const ctx={};vm.runInNewContext(ts.transpileModule(f.getText(ast),{compilerOptions:{target:ts.ScriptTarget.ES2022}}).outputText,ctx);
test('visual repairs cannot rewrite PDF text, table cells, nested cards or source provenance',()=>{
 const a=[{type:'paragraph',text:'Do not lose 98.40',source_message_id:'original'},{type:'table',headers:['Price'],rows:[['98.40']]},{type:'cards',cards:[{title:'Fact',text:'Exact evidence'}]}];
 const b=structuredClone(a);b[0].text='Different';b[1].rows=[['0']];b[2].cards[0].text='Invented';b[2].style={paddingPt:12};
 const result=ctx.preserveDocxSemanticContent(a,b);
 assert.equal(result[0].text,a[0].text);assert.equal(result[1].rows[0][0],'98.40');assert.equal(result[2].cards[0].text,'Exact evidence');assert.equal(result[0].source_message_id,'original');assert.equal(result[2].style.paddingPt,12);
 assert.equal(ctx.preserveDocxSemanticContent(a,b.slice(1)),null);
});
test('visual repairs cannot reorder or remove explicit fold panels',()=>{
 const a=[{type:'paragraph',text:'Front'},{type:'column_break'},{type:'paragraph',text:'Back'}];assert.equal(ctx.preserveDocxSemanticContent(a,[a[0],a[2]]),null);
});

test('all layouts embed original transparent logo and supplied image bytes in Word and PDF', async()=>{
 const sharp=require('sharp');
 const logo=await sharp(Buffer.from('<svg xmlns="http://www.w3.org/2000/svg" width="200" height="80"><rect x="5" y="5" width="60" height="60" fill="#008080"/><text x="75" y="45">LOGO</text></svg>')).png().toBuffer();
 const photo=await sharp({create:{width:600,height:300,channels:3,background:'#eebbaa'}}).png().toBuffer();
 for(const layoutTemplate of Object.keys(DOCUMENT_LAYOUTS)){
  const spec={filename:'images.docx',design:{layoutTemplate},blocks:[{type:'image',mode:'existing',filename:'logo.png',imageData:logo,imageContentType:'image/png',widthMm:40,preserveAspectRatio:true},{type:'paragraph',text:'Image placement marker'},{type:'image',mode:'existing',filename:'photo.png',imageData:photo,imageContentType:'image/png',widthMm:120,preserveAspectRatio:true}]};
  const word=renderDocx(spec).buffer,html=buildHtml(spec).html;
  assert.ok(word.includes(logo),layoutTemplate+' logo');assert.ok(word.includes(photo),layoutTemplate+' photo');
  assert.ok(html.includes(logo.toString('base64')),layoutTemplate);assert.ok(html.includes(photo.toString('base64')),layoutTemplate);
  assert.ok(html.indexOf(logo.toString('base64'))<html.indexOf('Image placement marker'));
  assert.ok(html.indexOf(photo.toString('base64'))>html.indexOf('Image placement marker'));
 }
});
test('long PDF tables retain rows beyond 100 and repeat semantic headers',()=>{
 const {html}=buildHtml({filename:'long.pdf',design:{layoutTemplate:'report'},blocks:[{type:'table',headers:['Row','Reference'],rows:Array.from({length:150},(_,i)=>[String(i+1),'UNIQUE-'+(i+1)])}]});
 assert.ok(html.includes('UNIQUE-150'));assert.ok(html.includes('<thead>'));assert.ok(html.includes('<tbody>'));
});
test('fixed image boxes preserve the full logo by default in both formats',async()=>{
 const logo=await require('sharp')({create:{width:400,height:100,channels:4,background:{r:0,g:100,b:100,alpha:0.5}}}).png().toBuffer();
 const input={filename:'logo.docx',design:{layoutTemplate:'flyer'},blocks:[{type:'image',mode:'existing',filename:'logo.png',imageData:logo,imageContentType:'image/png',widthMm:60,heightMm:40}]};
 const word=xml(renderDocx(input).buffer),pdf=buildHtml(input).html;
 const extent=word.match(/<wp:extent cx="(\d+)" cy="(\d+)"/);
 assert.ok(extent);assert.equal(Number(extent[1])/Number(extent[2]),4);assert.ok(pdf.includes('object-fit:contain'));
 const crop={...input,blocks:[{...input.blocks[0],preserveAspectRatio:false}]};assert.ok(buildHtml(crop).html.includes('object-fit:cover'));
});
test('serif and multilingual font names cannot terminate inline HTML style attributes',()=>{
 for(const fontFamily of ['serif','mono','jp-sans','jp-serif']){
  const {html}=buildHtml({filename:'font.pdf',title:'Title',design:{fontFamily},blocks:[{type:'heading',text:'Heading'}]});
  assert.match(html,/style="font-family:[^"]+;font-size:[^";]+;font-weight:700/);
 }
});
test('editorial brochure composes every page without duplicating headings or hiding overflow',()=>{
 const blocks=[{type:'heading',level:1,text:'Garden story'},{type:'paragraph',text:'EXACT INTRO'},{type:'page_break'},{type:'heading',level:1,text:'Details'},{type:'table',headers:['Reference'],rows:[['ORCHID-4729']]},{type:'paragraph',text:'FINAL CONTACT'}];
 const {html,fullText}=buildHtml({filename:'brochure.pdf',title:'Garden story',design:{layoutTemplate:'brochure-editorial',footerText:'$4,200'},blocks});
 assert.equal((html.match(/<section class="brochure-page/g)||[]).length,2);
 assert.equal((html.match(/>Garden story</g)||[]).length,1);
 for(const t of ['EXACT INTRO','ORCHID-4729','FINAL CONTACT','$4,200'])assert.ok(html.includes(t));
 assert.ok(fullText.includes('FINAL CONTACT'));assert.ok(!html.includes('overflow:hidden'));
 assert.ok(html.includes('pdf-heading-1'));assert.ok(!html.includes('@bottom-left'));
});
test('folded brochure applies designed panels without changing print order or content',()=>{
 const blocks=[];for(let i=0;i<6;i++){if(i)blocks.push({type:i===3?'page_break':'column_break'});blocks.push({type:'heading',level:1,text:'Panel '+i},{type:'paragraph',text:'Unchanged content '+i});}
 const {html}=buildHtml({filename:'fold.pdf',design:{layoutTemplate:'brochure-trifold'},blocks});
 assert.equal((html.match(/<section class="brochure-fold"/g)||[]).length,2);
 for(let i=0;i<6;i++)assert.ok(html.includes('Unchanged content '+i));
 assert.ok(html.indexOf('Panel 0')<html.indexOf('Panel 1'));
});
