const {test} = require('node:test');
const assert = require('node:assert/strict');
const fs = require('node:fs');
const vm = require('node:vm');
const ts = require('typescript');
function compile(file) {return ts.transpileModule(fs.readFileSync(file,'utf8'),{compilerOptions:{module:ts.ModuleKind.CommonJS,target:ts.ScriptTarget.ES2022}}).outputText;}
function uploader(behavior) {
  let options; const terminations=[];
  class Upload {constructor(file,opts){options=opts;} start(){behavior(options);} async abort(terminate){terminations.push(terminate);}}
  const exports={};
  vm.runInNewContext(compile('src/utils/videoUpload.ts'),{exports,URL,DOMException,process:{env:{NEXT_PUBLIC_SUPABASE_URL:'https://example.supabase.co'}},require:name=>name==='tus-js-client'?{Upload}:{videoMime:()=> 'video/mp4'}});
  return {upload:exports.uploadVideoResumable,terminations};
}
const client={auth:{getSession:async()=>({data:{session:{access_token:'fixture'}}})}};
test('cancelling an in-flight upload terminates its server-side partial upload',async()=>{
 const c=new AbortController(); const h=uploader(()=>c.abort(new Error('cancelled')));
 await assert.rejects(h.upload(client,'owner/clip.mp4',{name:'clip.mp4'},c.signal,()=>{}),/cancelled/);
 assert.deepEqual(h.terminations,[true]);
});
test('exhausted upload failure terminates partial data and preserves the failure',async()=>{
 const h=uploader(opts=>opts.onError(new Error('network failure')));
 await assert.rejects(h.upload(client,'owner/clip.mp4',{name:'clip.mp4'},new AbortController().signal,()=>{}),/network failure/);
 assert.deepEqual(h.terminations,[true]);
});
function worker({paths=[],rpcError=null,removeError=null}={}) {
 let handler;let rpcCalls=0;const removed=[];
 const client={rpc:async()=>{rpcCalls++;return{data:paths,error:rpcError};},storage:{from:bucket=>({remove:async items=>{assert.equal(bucket,'message-images');removed.push(...items);return{data:items,error:removeError};}})}};
 vm.runInNewContext(compile('supabase/functions/expire-video-uploads/index.ts'),{exports:{},Request,Response,Deno:{env:{get:()=> 'fixture'},serve:fn=>{handler=fn;}},require:()=>({createClient:()=>client})});
 return {call:token=>handler(new Request('https://example.test',{method:'POST',headers:token?{'x-video-cleanup-token':token}:{}})),removed,rpcCalls:()=>rpcCalls};
}
test('scheduled cleanup rejects missing or invalid authentication before deletion',async()=>{
 const h=worker();assert.equal((await h.call()).status,401);assert.equal(h.rpcCalls(),0);
 const bad=worker({rpcError:{code:'42501'}});assert.equal((await bad.call('wrong')).status,401);assert.equal(bad.removed.length,0);
});
test('scheduled cleanup rejects documents and out-of-scope paths, even from its RPC',async()=>{
 for(const path of ['owner/clip.mp4','3669ab83-6bb1-43c3-94c6-55e41e14979c/video-ephemeral-v1/notes.pdf','3669ab83-6bb1-43c3-94c6-55e41e14979c/photo.png']){
 const h=worker({paths:[path]});assert.equal((await h.call('valid')).status,500);assert.equal(h.removed.length,0);
 }
});
test('scheduled cleanup uses Storage removal and reports failure for automatic retry',async()=>{
 const path='3669ab83-6bb1-43c3-94c6-55e41e14979c/video-ephemeral-v1/clip.mp4';
 const h=worker({paths:[path]}); assert.equal((await h.call('valid')).status,200);assert.deepEqual(h.removed,[path]);
 const failed=worker({paths:[path],removeError:{message:'temporary failure'}});assert.equal((await failed.call('valid')).status,503);
});
