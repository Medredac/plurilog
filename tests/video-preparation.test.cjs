const {test}=require('node:test');
const assert=require('node:assert/strict');
const fs=require('node:fs');
const vm=require('node:vm');
const ts=require('typescript');
function load(file,dependencies={}) {
 const exports={};
 const source=ts.transpileModule(fs.readFileSync(file,'utf8'),{compilerOptions:{module:ts.ModuleKind.CommonJS,target:ts.ScriptTarget.ES2022}}).outputText;
 vm.runInNewContext(source,{exports,Buffer,process:{env:{}},AbortSignal,fetch,console,require:name=>{if(name in dependencies)return dependencies[name];throw new Error('Unexpected dependency '+name);}});
 return exports;
}
const inputs=load('src/utils/videoInputs.ts');
function harness({failCommand,abortDuringCreate}={}) {
 const calls=[];let stops=0;const controller=new AbortController();
 const sandbox={
  runCommand:async options=>{calls.push(options);return{exitCode: options.cmd===failCommand?1:0,stdout:async()=>JSON.stringify({format:{duration:'200'},streams:[{codec_type:'video'}]})};},
  writeFiles:async()=>{}, update:async options=>calls.push(options),
  readFileToBuffer:async()=>Buffer.from('0000ftypisomtest'), stop:async()=>{stops++;},
 };
 const api=load('src/utils/videoPreparation.ts',{'./videoInputs':inputs,'@vercel/sandbox':{Sandbox:{create:async()=>{if(abortDuringCreate)controller.abort(new Error('cancel'));return sandbox;}}}});
 return {...api,calls,controller,stops:()=>stops};
}
test('section planning covers a whole video and clips follow-up windows accurately',()=>{
 const h=harness();
 assert.deepEqual(JSON.parse(JSON.stringify(h.videoWindows(200,{}))),[{start:0,end:90},{start:90,end:180},{start:180,end:200}]);
 assert.deepEqual(JSON.parse(JSON.stringify(h.videoWindows(200,{startSeconds:115,endSeconds:125}))),[{start:115,end:125}]);
 assert.throws(()=>h.videoWindows(200,{startSeconds:201}),/outside/);
 assert.throws(()=>h.videoWindows(Infinity,{}),/duration/);
 assert.throws(()=>h.videoWindows(1e50,{}),/three hours/);
});
test('large originals stay on isolated disk; analysis is bounded and timestamps preserved',async()=>{
 const h=harness();const analyzed=[];
 const result=await h.inspectPreparedVideo({signedUrl:'https://storage.example/private',filename:'clip.mp4',question:'At 2:00?',range:{startSeconds:115,endSeconds:125},signal:h.controller.signal,analyze:async source=>{analyzed.push(source);return{findings:'A blue square.',model:'gemini'};}});
 assert.equal(analyzed.length,1);assert.match(analyzed[0].question,/original seconds 115–125/);assert.match(result.findings,/115–125/);
 assert.ok(h.calls.find(c=>c.networkPolicy==='deny-all'));
 const decode=h.calls.find(c=>c.cmd==='ffmpeg');assert.ok(decode.args.includes('file,pipe'));assert.ok(decode.args.includes('115'));assert.ok(decode.args.includes('10'));
 assert.equal(h.stops(),1);
});
test('failed video processing always disposes the temporary original and copy',async()=>{
 const h=harness({failCommand:'ffmpeg'});
 await assert.rejects(h.inspectPreparedVideo({signedUrl:'https://storage.example/private',filename:'clip.mp4',question:'Describe',range:{},signal:h.controller.signal,analyze:async()=>{throw new Error('Must not run');}}),/Could not prepare/);
 assert.equal(h.stops(),1);
});
test('cancellation during sandbox creation still disposes it before work',async()=>{
 const h=harness({abortDuringCreate:true});
 await assert.rejects(h.inspectPreparedVideo({signedUrl:'https://storage.example/private',filename:'clip.mp4',question:'Describe',range:{},signal:h.controller.signal,analyze:async()=>({findings:'',model:''})}),/cancel/);
 assert.equal(h.calls.length,0);assert.equal(h.stops(),1);
});
test('the aggregate server budget uses authoritative storage sizes and rejects foreign paths first',async()=>{
 const read=[];const sizes={'owner/a.mp4':300*1024*1024,'owner/b.mp4':200*1024*1024,'owner/c.mp4':1};
 const api=load('src/utils/storedVideoInspection.ts',{
  './videoInputs':inputs, './videoInspection':{}, './videoPreparation':{},
  './durableAttachments':{extractAttachmentStoragePath:url=>url},
  './supabase/service':{createServiceClient:()=>({storage:{from:()=>({info:async path=>{read.push(path);return{data:{size:sizes[path]},error:null};}})}})},
 });
 await api.validateStoredVideoBudget([{url:'owner/a.mp4'},{url:'owner/b.mp4'}],'owner');
 await assert.rejects(api.validateStoredVideoBudget([{url:'owner/a.mp4'},{url:'owner/b.mp4'},{url:'owner/c.mp4'}],'owner'),/500 MB/);
 const before=read.length;await assert.rejects(api.validateStoredVideoBudget([{url:'other/a.mp4'}],'owner'),/not available/);assert.equal(read.length,before);
});
