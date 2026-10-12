const {test}=require('node:test');
const assert=require('node:assert/strict');
const fs=require('node:fs');const Module=require('node:module');const ts=require('typescript');
function load(Sandbox) {
 const m=new Module(__filename,module);m.paths=module.paths;m.require=n=>n==='@vercel/sandbox'?{Sandbox}:require(n);
 m._compile(ts.transpileModule(fs.readFileSync('src/utils/fileWorkspace.ts','utf8'),{compilerOptions:{module:ts.ModuleKind.CommonJS,target:ts.ScriptTarget.ES2022,esModuleInterop:true}}).outputText,__filename);return m.exports;
}
function fixture(calls,failSetup=false,fullText='Preserved text') {
 const events=[];let stopped=0;let n=0;
 const sandbox={mkDir:async()=>{},writeFiles:async()=>{},stop:async()=>{stopped++},updateNetworkPolicy:async p=>events.push(p),
 readFileToBuffer:async()=>Buffer.from('fixture'),runCommand:async ({args})=>{
  events.push(args.join(' '));let out='';let exitCode=0;
  if(args.includes('pip')&&failSetup)exitCode=1;
  if(args.includes('-c'))out=JSON.stringify({size:7});
  if(args.some(a=>a.endsWith('validate.py')))out=JSON.stringify({pageCount:1,fullText});
  return {exitCode,stdout:async()=>out,stderr:async()=>exitCode?'setup failed':''};
 }};
 const api=load({create:async options=>{events.push(options);return sandbox}});
 const openai={chat:{completions:{create:async req=>{
  const item=calls[n++] || ['run_python',{code:'print(1)'}];
  return {usage:{cost:0.001},choices:[{message:{role:'assistant',tool_calls:[{id:`t${n}`,type:'function',function:{name:item[0],arguments:JSON.stringify(item[1])}}]}}]};
 }}}};
 return {api,openai,events,stopped:()=>stopped};
}
test('workspace blocks path traversal and unsupported formats',()=>{
 const {workspaceFilename}=load({});
 for(const bad of ['../../private.pdf','/tmp/file.pdf','x..pdf','doc.exe','x.pdf/secret',''])assert.throws(()=>workspaceFilename(bad));
 assert.equal(workspaceFilename('report-final.docx'),'report-final.docx');
});
test('worker cannot finish without final render; successful result stays in memory, sandbox closes',async()=>{
 const f=fixture([['finish_file',{filename:'result.docx',summary:'done'}],['inspect_document',{filename:'result.docx'}],['finish_file',{filename:'result.docx',summary:'done'}]]);
 const result=await f.api.runFileWorkspace({openai:f.openai,model:'test',format:'docx',task:'create'});
 assert.equal(result.calls,3);assert.equal(result.pageCount,1);assert.equal(f.stopped(),1);
 assert.ok(f.events.indexOf('deny-all')<f.events.findIndex(e=>typeof e==='string'&&e.includes('validate.py')));
 assert.equal(f.events[0].persistent,false);assert.equal(f.events[0].timeout,480000);
});
test('any execution invalidates previously inspected draft, requiring another inspection',async()=>{
 const f=fixture([['inspect_document',{filename:'result.pdf'}],['run_python',{code:'change()'}],['finish_file',{filename:'result.pdf',summary:'done'}],['inspect_document',{filename:'result.pdf'}],['finish_file',{filename:'result.pdf',summary:'done'}]]);
 const result=await f.api.runFileWorkspace({openai:f.openai,model:'test',format:'pdf',task:'create'});
 assert.equal(result.calls,5);assert.equal(f.stopped(),1);
});
test('failed dependency setup still stops sandbox',async()=>{
 const f=fixture([],true);await assert.rejects(f.api.runFileWorkspace({openai:f.openai,model:'test',format:'pdf',task:'create'}),/setup failed/);assert.equal(f.stopped(),1);
});
test('attempt limit terminates, charges incurred model calls and releases sandbox',async()=>{
 const f=fixture([]);let total=0;
 await assert.rejects(f.api.runFileWorkspace({openai:f.openai,model:'test',format:'pdf',task:'create',onCost:c=>total+=c}),/attempt limit/);
 assert.equal(f.stopped(),1);assert.ok(Math.abs(total-0.01)<1e-8);
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
