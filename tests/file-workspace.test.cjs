const {test}=require('node:test');
const assert=require('node:assert/strict');
const fs=require('node:fs');const Module=require('node:module');const ts=require('typescript');
function load(Sandbox) {
 const m=new Module(__filename,module);m.paths=module.paths;m.require=n=>n==='@vercel/sandbox'?{Sandbox}:require(n);
 m._compile(ts.transpileModule(fs.readFileSync('src/utils/fileWorkspace.ts','utf8'),{compilerOptions:{module:ts.ModuleKind.CommonJS,target:ts.ScriptTarget.ES2022,esModuleInterop:true}}).outputText,__filename);return m.exports;
}
function fixture(calls,failSetup=false,fullText='Preserved text',validation=()=>({})) {
 const events=[];let stopped=0;let n=0;let version=0;let code='';
 const sandbox={mkDir:async()=>{},writeFiles:async files=>{const task=files.find(f=>f.path.endsWith('/task.py'));if(task)code=task.content.toString()},stop:async()=>{stopped++},updateNetworkPolicy:async p=>events.push(p),
 readFileToBuffer:async()=>Buffer.from('fixture'+version),runCommand:async ({args})=>{
  events.push(args.join(' '));let out='';let exitCode=0;
  if(args.some(a=>a.endsWith('/task.py')) && code==='change()')version++;
  if(args.includes('pip')&&failSetup)exitCode=1;
  if(args.includes('-c'))out=JSON.stringify({size:7});
  if(args.some(a=>a.endsWith('validate.py')))out=JSON.stringify({pageCount:1,fullText,...validation(version,args)});
  return {exitCode,stdout:async()=>out,stderr:async()=>exitCode?'setup failed':''};
 }};
 const api=load({create:async options=>{events.push(options);return sandbox}});
 const openai={chat:{completions:{create:async req=>{
  if(req.response_format)return {usage:{cost:0.002},choices:[{message:{content:JSON.stringify({approved:true,issues:[]})}}]};
  const item=calls[n++] || ['run_python',{code:'print(1)'}];
  return {usage:{cost:0.001},choices:[{message:{role:'assistant',tool_calls:[{id:`t${n}`,type:'function',function:{name:item[0],arguments:JSON.stringify(item[1])}}]}}]};
 }}}};
 return {api,openai,events,stopped:()=>stopped};
}
test('workspace blocks path traversal and unsupported formats',()=>{
 const {workspaceFilename}=load({});
 for(const bad of ['../../private.pdf','/tmp/file.pdf','x..pdf','doc.exe','x.pdf/secret','/vercel/sandbox/workspace/../secret.pdf','/vercel/sandbox/workspace/sub/file.pdf',''])assert.throws(()=>workspaceFilename(bad));
 assert.equal(workspaceFilename('report-final.docx'),'report-final.docx');
 assert.equal(workspaceFilename('/vercel/sandbox/workspace/report-final.docx'),'report-final.docx');
});
test('worker cannot finish without final render; successful result stays in memory, sandbox closes',async()=>{
 const f=fixture([['finish_file',{filename:'result.docx',summary:'done'}],['inspect_document',{filename:'result.docx'}],['finish_file',{filename:'result.docx',summary:'done'}]]);
 const result=await f.api.runFileWorkspace({openai:f.openai,model:'test',format:'docx',task:'create'});
 assert.equal(result.calls,4);assert.equal(result.pageCount,1);assert.equal(f.stopped(),1);
 assert.ok(f.events.indexOf('deny-all')<f.events.findIndex(e=>typeof e==='string'&&e.includes('validate.py')));
 assert.equal(f.events[0].persistent,false);assert.equal(f.events[0].timeout,480000);
});
test('changed bytes invalidate the reviewed draft and require another inspection',async()=>{
 const f=fixture([['inspect_document',{filename:'result.pdf'}],['run_python',{code:'change()'}],['finish_file',{filename:'result.pdf',summary:'done'}],['inspect_document',{filename:'result.pdf'}],['finish_file',{filename:'result.pdf',summary:'done'}]]);
 const result=await f.api.runFileWorkspace({openai:f.openai,model:'test',format:'pdf',task:'create'});
 assert.equal(result.calls,6);assert.equal(f.stopped(),1);
});
test('failed dependency setup still stops sandbox',async()=>{
 const f=fixture([],true);await assert.rejects(f.api.runFileWorkspace({openai:f.openai,model:'test',format:'pdf',task:'create'}),/setup failed/);assert.equal(f.stopped(),1);
});
test('cost threshold stops additional usage and releases the sandbox',async()=>{
 const f=fixture([]);let total=0;
 const original=f.openai.chat.completions.create;
 f.openai.chat.completions.create=async req=>{const result=await original(req);result.usage.cost=0.125;return result};
 await assert.rejects(f.api.runFileWorkspace({openai:f.openai,model:'test',format:'pdf',task:'create',onCost:c=>total+=c}),/continuation threshold/);
 assert.equal(f.stopped(),1);assert.equal(total,0.25);
});
test('a valid task can complete beyond ten steps',async()=>{
 const calls=Array.from({length:12},()=>['run_python',{code:'print(1)'}]);
 calls.push(['inspect_document',{filename:'result.pdf'}],['finish_file',{filename:'result.pdf',summary:'done'}]);
 const f=fixture(calls);
 const result=await f.api.runFileWorkspace({openai:f.openai,model:'test',format:'pdf',task:'create'});
 assert.equal(result.calls,15);assert.equal(f.stopped(),1);
});
test('already cancelled tasks never create a sandbox',async()=>{
 const f=fixture([]);await assert.rejects(f.api.runFileWorkspace({openai:f.openai,model:'test',format:'pdf',task:'create',signal:AbortSignal.abort()}));assert.equal(f.events.length,0);
});
test('multiple tool calls cannot inspect and publish without a model review between them',async()=>{
 const f=fixture([]);f.openai.chat.completions.create=async()=>({usage:{cost:0.001},choices:[{message:{tool_calls:[{},{}]}}]});
 await assert.rejects(f.api.runFileWorkspace({openai:f.openai,model:'test',format:'pdf',task:'create'}),/sequential/);assert.equal(f.stopped(),1);
});
test('missing accounting stops further model usage',async()=>{
 const f=fixture([]);f.openai.chat.completions.create=async()=>({usage:{},choices:[{message:{content:'done'}}]});
 await assert.rejects(f.api.runFileWorkspace({openai:f.openai,model:'test',format:'pdf',task:'create'}),/accounting unavailable/);assert.equal(f.stopped(),1);
});

test('long document text is retained without truncating validation JSON',async()=>{
 const fullText='Long document text. '.repeat(4000);
 const f=fixture([['inspect_document',{filename:'result.pdf'}],['finish_file',{filename:'result.pdf',summary:'done'}]],false,fullText);
 const result=await f.api.runFileWorkspace({openai:f.openai,model:'test',format:'pdf',task:'create'});
 assert.equal(result.fullText,fullText);
});
test('invalid numeric accounting stops further model usage',async()=>{
 for(const cost of [NaN,Infinity,-1]) {
  const f=fixture([]);f.openai.chat.completions.create=async()=>({usage:{cost},choices:[{message:{content:'done'}}]});
  await assert.rejects(f.api.runFileWorkspace({openai:f.openai,model:'test',format:'pdf',task:'create'}),/accounting unavailable/);
  assert.equal(f.stopped(),1);
 }
});

test('read-only code checks preserve the final byte-verified review',async()=>{
 const f=fixture([['inspect_document',{filename:'result.pdf'}],['run_python',{code:'print(1)'}],['finish_file',{filename:'result.pdf',summary:'done'}]]);
 const result=await f.api.runFileWorkspace({openai:f.openai,model:'test',format:'pdf',task:'create'});
 assert.equal(result.calls,4);assert.equal(f.stopped(),1);
});

test('imports authorized image bytes after network lockdown and caches repeated imports',async()=>{
 const sharp=require('sharp');
 const png=await sharp({create:{width:2,height:2,channels:4,background:'#00ff0080'}}).png().toBuffer();
 const request={mode:'existing',asset_id:'image-1'};
 const f=fixture([['import_image',request],['import_image',request],['inspect_document',{filename:'result.pdf'}],['finish_file',{filename:'result.pdf',summary:'done'}]]);
 let resolves=0;
 const result=await f.api.runFileWorkspace({openai:f.openai,model:'test',format:'pdf',task:'insert logo',images:{catalog:[{id:'image-1',filename:'original.png',current:true}],resolve:async()=>{assert.ok(f.events.includes('deny-all'));resolves++;return {data:png,contentType:'image/png',filename:'original.png'}}}});
 assert.equal(result.calls,5);assert.equal(resolves,1);assert.equal(f.stopped(),1);
});

test('edits must inspect the actual source before generated code can run',async()=>{
 const f=fixture([['run_python',{code:'change()'}],['inspect_document',{filename:'input.pdf'}],['inspect_document',{filename:'result.pdf'}],['finish_file',{filename:'result.pdf'}]]);
 const worker=f.openai.chat.completions.create;
 let reviewRequests=0;
 f.openai.chat.completions.create=async req=>{
  if(!req.response_format || req.max_tokens===1600)return worker(req);
  reviewRequests++;assert.equal(req.messages.length,2);
  assert.match(req.messages[1].content[0].text,/sourceText/);
  return {usage:{cost:0.002},choices:[{message:{content:JSON.stringify({approved:true,issues:[]})}}]};
 };
 const result=await f.api.runFileWorkspace({openai:f.openai,model:'test',format:'pdf',task:'Add logo and preserve content',source:{buffer:Buffer.from('source'),format:'pdf'}});
 assert.equal(result.calls,6);assert.equal(reviewRequests,1);assert.equal(result.sourcePageCount,1);
 assert.equal(f.events.some(e=>typeof e==='string' && e.endsWith('/task.py')),false);
});

test('independent preservation rejection returns repair feedback before publishing one final file',async()=>{
 const f=fixture([['inspect_document',{filename:'input.pdf'}],['inspect_document',{filename:'result.pdf'}],['finish_file',{filename:'result.pdf'}],['run_python',{code:'change()'}],['inspect_document',{filename:'result.pdf'}],['finish_file',{filename:'result.pdf'}]]);
 const worker=f.openai.chat.completions.create;let reviews=0;let sawFeedback=false;
 f.openai.chat.completions.create=async req=>{
  if(req.max_tokens===1600)return worker(req);
  if(!req.response_format){sawFeedback ||= req.messages.some(m=>m.role==='tool' && m.content.includes('Restore the omitted pricing paragraph'));return worker(req)}
  reviews++;
  return {usage:{cost:0.002},choices:[{message:{content:JSON.stringify({approved:reviews>1,issues:reviews>1?[]:['Restore the omitted pricing paragraph']})}}]};
 };
 let cost=0;
 const result=await f.api.runFileWorkspace({openai:f.openai,model:'test',format:'pdf',task:'Reformat only',source:{buffer:Buffer.from('source'),format:'pdf'},onCost:c=>cost+=c});
 assert.equal(reviews,2);assert.equal(result.calls,9);assert.equal(sawFeedback,true);assert.equal(result.costUsd,cost);assert.equal(f.stopped(),1);
});

test('missing preservation-review accounting stops without another model call',async()=>{
 const f=fixture([['inspect_document',{filename:'input.pdf'}],['inspect_document',{filename:'result.pdf'}],['finish_file',{filename:'result.pdf'}]]);
 const worker=f.openai.chat.completions.create;let reviews=0;
 f.openai.chat.completions.create=async req=>{
  if(!req.response_format || req.max_tokens===1600)return worker(req);
  reviews++;return {usage:{},choices:[{message:{content:'{"approved":true,"issues":[]}'}}]};
 };
 await assert.rejects(f.api.runFileWorkspace({openai:f.openai,model:'test',format:'pdf',task:'edit',source:{buffer:Buffer.from('source'),format:'pdf'}}),/accounting unavailable/);
 assert.equal(reviews,1);assert.equal(f.stopped(),1);
});


test('prose completion cannot terminate or publish an unfinished workspace',async()=>{
 const f=fixture([['inspect_document',{filename:'result.pdf'}],['finish_file',{filename:'result.pdf'}]]);
 const worker=f.openai.chat.completions.create;let first=true;let recovery=false;
 f.openai.chat.completions.create=async req=>{
  if(!req.response_format){assert.equal(req.tool_choice,'required');if(first){first=false;return {usage:{cost:0.001},choices:[{message:{role:'assistant',content:'Created the file'}}]};}recovery ||= req.messages.some(m=>m.content?.includes?.('No file has been published'));}
  return worker(req);
 };
 const result=await f.api.runFileWorkspace({openai:f.openai,model:'test',format:'pdf',task:'create'});
 assert.equal(recovery,true);assert.equal(result.calls,4);assert.equal(f.stopped(),1);
});

test('new document visual defects trigger repair before publication',async()=>{
 const f=fixture([['inspect_document',{filename:'result.pdf'}],['finish_file',{filename:'result.pdf'}],['run_python',{code:'change()'}],['inspect_document',{filename:'result.pdf'}],['finish_file',{filename:'result.pdf'}]]);
 const worker=f.openai.chat.completions.create;let reviews=0;let feedback=false;
 f.openai.chat.completions.create=async req=>{
  if(!req.response_format){feedback ||= req.messages.some(m=>m.role==='tool' && m.content.includes('dark logo'));return worker(req);}
  reviews++;return {usage:{cost:0.002},choices:[{message:{content:JSON.stringify({approved:reviews>1,issues:reviews>1?[]:['Place dark logo on a light backing plate']})}}]};
 };
 const result=await f.api.runFileWorkspace({openai:f.openai,model:'test',format:'pdf',task:'create'});
 assert.equal(reviews,2);assert.equal(feedback,true);assert.equal(result.calls,7);
});


test('PDF conversion rejects screenshots with hidden text and accepts native Word content after repair',async()=>{
 const fullText='Original source text. '.repeat(100);
 const f=fixture([['inspect_document',{filename:'input.pdf'}],['inspect_document',{filename:'result.docx'}],['run_python',{code:'change()'}],['inspect_document',{filename:'result.docx'}],['finish_file',{filename:'result.docx'}]],false,fullText,version=>({editableText:version?fullText:'',hiddenTextChars:version?0:fullText.length}));
 const worker=f.openai.chat.completions.create;let feedback=false;
 f.openai.chat.completions.create=async req=>{feedback ||= req.messages.some(m=>m.role==='tool' && m.content.includes('lacks visible editable body text'));return worker(req);};
 const result=await f.api.runFileWorkspace({openai:f.openai,model:'test',format:'docx',task:'make it Word',source:{buffer:Buffer.from('source'),format:'pdf'}});
 assert.equal(feedback,true);assert.equal(result.calls,7);assert.equal(f.stopped(),1);
});


test('source format and requested output format remain independent for conversions',()=>{
 const {workspaceOutputFormat}=load({});
 assert.equal(workspaceOutputFormat('pdf',{output_format:'docx'}),'docx');
 assert.equal(workspaceOutputFormat('pdf',{filename:'converted.docx'}),'docx');
 assert.equal(workspaceOutputFormat('docx',{output_format:'pdf',filename:'old.docx'}),'pdf');
 assert.equal(workspaceOutputFormat('pdf',{}),'pdf');
});

test('source edit dispatch passes original PDF bytes with DOCX output to the worker',async()=>{
 const api=load({});let received;
 const m=new Module(__filename,module);m.paths=module.paths;
 m.require=name=>name==='./fileWorkspace'?{FILE_WORKSPACE_ENABLED:true,workspaceOutputFormat:api.workspaceOutputFormat,runFileWorkspace:async options=>{received=options;throw new Error('verified handoff')}}:name==='@/utils/supabase/service'?{createServiceClient:()=>({})}:name.startsWith('@/')?{}:require(name);
 m._compile(ts.transpileModule(fs.readFileSync('src/utils/sourceDocumentEditor.ts','utf8'),{compilerOptions:{module:ts.ModuleKind.CommonJS,target:ts.ScriptTarget.ES2022,esModuleInterop:true}}).outputText,__filename);
 const bytes=Buffer.from('original PDF bytes');
 const supabase={storage:{from:()=>({download:async()=>({data:new Blob([bytes]),error:null})})}};
 await assert.rejects(m.exports.executeSourcePreservingDocumentEdit({supabase,openai:{},discussionId:'discussion',sourceFilename:'source.pdf',sourceStoragePath:'user/source.pdf',args:{workspace_task:'make it Word',output_format:'docx',edits:[]}}),/verified handoff/);
 assert.equal(received.format,'docx');assert.equal(received.source.format,'pdf');assert.deepEqual(received.source.buffer,bytes);
});


test('source-edit tool schema exposes conversion target format',()=>{
 const source=ts.createSourceFile('route.ts',fs.readFileSync('src/app/api/debate/route.ts','utf8'),ts.ScriptTarget.Latest,true);
 let declaration;
 const visit=node=>{if(ts.isVariableDeclaration(node) && node.name.getText(source)==='GPT_SOURCE_DOCUMENT_EDIT_TOOL')declaration=node;ts.forEachChild(node,visit);};visit(source);
 assert.ok(declaration);assert.match(declaration.initializer.getText(source),/output_format:/);
});

test('creation-route worker can retrieve a real source and must inspect it before editing',async()=>{
 const fullText='Original content '.repeat(30);
 const f=fixture([['import_document',{filename:'latest.pdf'}],['run_python',{code:'change()'}],['inspect_document',{filename:'input.pdf'}],['inspect_document',{filename:'result.docx'}],['finish_file',{filename:'result.docx'}]],false,fullText,()=>({editableText:fullText,hiddenTextChars:0}));
 let imports=0;const bytes=Buffer.from('original PDF');
 const result=await f.api.runFileWorkspace({openai:f.openai,model:'test',format:'docx',task:'Convert latest PDF',documents:{catalog:[{filename:'latest.pdf'}],resolve:async filename=>{assert.equal(filename,'latest.pdf');imports++;return {buffer:bytes,format:'pdf'};}}});
 assert.equal(imports,1);assert.equal(result.sourcePageCount,1);assert.equal(result.calls,7);
 assert.equal(f.events.some(e=>typeof e==='string' && e.endsWith('/task.py')),false);
});
