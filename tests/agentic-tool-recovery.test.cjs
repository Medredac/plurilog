const {test}=require('node:test'),assert=require('node:assert/strict'),fs=require('node:fs'),Module=require('node:module'),ts=require('typescript');
function load(file){const m=new Module(__filename);m._compile(ts.transpileModule(fs.readFileSync(file,'utf8'),{compilerOptions:{module:ts.ModuleKind.CommonJS,target:ts.ScriptTarget.ES2022,esModuleInterop:true}}).outputText,__filename);return m.exports;}
const {canReplanToolFailure:can,toolFailureFeedback:feedback}=load('src/utils/agenticToolRecovery.ts');
const {applyDocumentJsonPatch:patch}=load('src/utils/documentRevisionState.ts');
const state=()=>({attempts:0,deadline:100000,feedback:[]});
const input=()=>({state:state(),now:0,aborted:false,hasToolCall:true,outcomeKnownUncommitted:true});
test('production 22-block failure can be corrected without modifying original document',()=>{
 const source={format:'pdf',filename:'pamphlet.pdf',blocks:Array.from({length:22},(_,i)=>({type:'paragraph',text:`original ${i}`,style:{textColor:'#FFFFFF'}}))};
 const before=JSON.stringify(source);let error;
 try {patch(source,[{op:'replace',path:'/blocks/22/style/textColor',value:'#111111'}]);}catch(e){error=e;}
 assert.ok(error);assert.equal(can(input()),true);
 assert.ok(feedback(error,[{name:'revise_file'}],false).includes('/blocks/22/style/textColor'));
 const result=patch(source,[{op:'replace',path:'/blocks/21/style/textColor',value:'#111111'}]);
 assert.equal(result.blocks[21].style.textColor,'#111111');assert.equal(JSON.stringify(source),before);
});
test('all seats and tool types use same recovery policy, not a document-specific matcher',()=>{
 for(const name of ['request_evidence','generate_image','edit_image','inspect_video','read_full_conversation','create_file','revise_file']){
  assert.equal(can(input()),true);assert.ok(feedback(Error('tool failed'),[{name}],false).includes(name));
 }
});
test('completed or uncertain effects are never automatically replayed',()=>assert.equal(can({...input(),outcomeKnownUncommitted:false}),false));
test('cancellation, exhausted time and bounded attempts stop replanning',()=>{
 assert.equal(can({...input(),aborted:true}),false);
 assert.equal(can({...input(),now:80000}),false);
 assert.equal(can({...input(),state:{...state(),attempts:3}}),false);
 assert.equal(can({...input(),hasToolCall:false}),false);
});
test('lookup failure is not treated as omitted input; finalization cannot claim success',()=>{
 assert.ok(feedback(Error('not found'),[],false).includes('does not mean the user omitted'));
 assert.ok(feedback(Error('failed'),[],true).includes('Do not claim success'));
});
