const { test } = require('node:test');
const assert = require('node:assert/strict');
const fs = require('node:fs');
const ts = require('typescript');
const Module = require('node:module');
function load(file) {
 const mod = new Module(file, module); mod.paths = module.paths;
 mod._compile(ts.transpileModule(fs.readFileSync(file,'utf8'), { compilerOptions:{module:ts.ModuleKind.CommonJS,target:ts.ScriptTarget.ES2022}}).outputText,file);
 return mod.exports;
}
const {runAgentToolLoop} = load('src/utils/agentToolLoop.ts');
const revision = load('src/utils/documentRevisionState.ts');
const call = (id,name,args={}) => ({id,type:'function',function:{name,arguments:JSON.stringify(args)}});
const reply = (...calls) => ({content:null,tool_calls:calls});
const tool = (name, effect, execute) => ({definition:{type:'function',function:{name}}, effect, execute});
const options = (tools, model, initial) => ({tools,model,initial,messages:[{role:'user',content:'Complete the task'}],signal:new AbortController().signal,deadline:Date.now()+600000});
function results(messages) { return messages.filter(m=>m.role==='tool').map(m=>JSON.parse(m.content)); }
test('retrieved attachment -> invalid real document patch -> corrected patch -> visual inspection -> final', async()=>{
 let writes=0, inspected=0, turns=0; const attachments=[];
 const parent={format:'pdf',filename:'garden.pdf',title:'Garden',blocks:[{type:'paragraph',text:'ORCHID-4729 $4,200',style:{textColor:'#ffffff'}}]};
 const tools={
  retrieve:tool('retrieve','read',async()=>{attachments.push('existing.pdf');return {result:{ok:true,spec:parent}}}),
  revise:tool('revise','write',async a=>{const next=revision.applyDocumentJsonPatch(parent,a.patch);writes++;return {result:{ok:true,spec:next,filename:'light.pdf'}}}),
  inspect:tool('inspect','read',async()=>{inspected++;return {result:{ok:true},messages:[{role:'user',content:[{type:'image_url',image_url:{url:'data:image/png;base64,test'}}]}]}})
 };
 const result=await runAgentToolLoop(options(tools,async messages=>{
  turns++;
  if(turns===1)return reply(call('bad','revise',{patch:[{op:'replace',path:'/blocks/22/style/textColor',value:'#111111'}]}));
  if(turns===2){assert.match(results(messages).at(-1).error,/array index/);return reply(call('fixed','revise',{patch:[{op:'replace',path:'/blocks/0/style/textColor',value:'#111111'}]}));}
  if(turns===3){assert.equal(results(messages).at(-1).spec.blocks[0].text,'ORCHID-4729 $4,200');return reply(call('see','inspect'));}
  return {content:'Created light.pdf'};
 },reply(call('read','retrieve'))));
 assert.equal(result.content,'Created light.pdf');assert.equal(writes,1);assert.equal(inspected,1);assert.equal(attachments.length,1);
});
test('mixed tool batch preserves every correlated result and prior successful write after a later failure',async()=>{
 let generated=0, creates=0, turns=0;
 const tools={image:tool('image','write',async()=>{generated++;return{result:{ok:true,filename:'photo.png'}}}),pdf:tool('pdf','write',async()=>{creates++;if(creates===1)throw Error('Correct layout');return{result:{ok:true}}})};
 const result=await runAgentToolLoop(options(tools,async messages=>{
   turns++;const observations=results(messages);assert.equal(observations[0].filename,'photo.png');
   if(turns===1){assert.equal(observations[1].ok,false);return reply(call('image-again','image'),call('pdf-fixed','pdf',{layout:'corrected'}));}
   return{content:'Done'};
 },reply(call('image1','image'),call('pdf1','pdf'))));
 assert.equal(generated,1);assert.equal(creates,2);assert.equal(result.content,'Done');
});
test('malformed JSON and unavailable tool become recoverable observations',async()=>{
 let step=0,executed=0;
 await runAgentToolLoop(options({read:tool('read','read',async()=>{executed++;return{result:{ok:true}}})},async messages=>{
  step++;if(step===1){assert.equal(results(messages)[0].ok,false);return reply(call('unknown','missing'));}
  if(step===2){assert.match(results(messages).at(-1).error,/unavailable/);return reply(call('valid','read'));}
  return{content:'Done'};
 },{content:null,tool_calls:[{id:'bad',type:'function',function:{name:'read',arguments:'{"invalid'}}]}));assert.equal(executed,1);
});
test('reads can refresh and all tool results precede multimodal observations',async()=>{
 let n=0,step=0; const tools={read:tool('read','read',async()=>({result:{version:++n},messages:[{role:'user',content:'image data'}]}))};
 await runAgentToolLoop(options(tools,async messages=>{
  step++;const index=messages.findIndex(m=>m.role==='assistant');assert.equal(messages[index+1].role,'tool');assert.equal(messages[index+2].role,'tool');
  if(step===1)return reply(call('third','read'));return{content:'Done'};
 },reply(call('first','read'),call('second','read'))));assert.equal(n,3);
});
test('opaque provider reasoning details survive continuation',async()=>{
 const details=[{type:'reasoning.encrypted',data:'opaque-signature',index:0}];
 await runAgentToolLoop(options({read:tool('read','read',async()=>({result:{ok:true}}))},async messages=>{assert.deepEqual(messages.find(m=>m.role==='assistant').reasoning_details,details);return{content:'Done'};},{...reply(call('r','read')),reasoning_details:details}));
});
test('cancellation halts before subsequent actions',async()=>{
 const abort=new AbortController();let executed=0;
 const opts=options({write:tool('write','write',async()=>{executed++;abort.abort();return{result:{ok:true}}})},async()=>({content:'Done'}),reply(call('a','write'),call('b','write',{different:true})));opts.signal=abort.signal;
 await assert.rejects(runAgentToolLoop(opts));assert.equal(executed,1);
});
test('budget finalization never executes another action',async()=>{
 let executed=0;const opts=options({write:tool('write','write',async()=>{executed++;return{result:{ok:true}}})},async(messages,defs,finalizing)=>{assert.equal(finalizing,true);assert.deepEqual(defs,[]);return{content:'No action completed'};},reply(call('w','write')));opts.deadline=Date.now()+1000;
 const result=await runAgentToolLoop(opts);assert.equal(executed,0);assert.equal(result.content,'No action completed');
});
test('same failed arguments stop executing but model can choose another approach',async()=>{
 let executed=0,turns=0;
 await runAgentToolLoop(options({bad:tool('bad','write',async()=>{executed++;throw Error('invalid input')})},async messages=>{turns++;if(turns<3)return reply(call('retry'+turns,'bad'));assert.match(results(messages).at(-1).error,/failed twice/);return{content:'Need a different source'};},reply(call('first','bad'))));assert.equal(executed,2);
});
