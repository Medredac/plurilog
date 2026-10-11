const {test}=require('node:test');
const assert=require('node:assert/strict');
const fs=require('node:fs');
const vm=require('node:vm');
const ts=require('typescript');
// Exercise the real message builder without loading the API route's cloud clients.
const source=fs.readFileSync('src/app/api/debate/route.ts','utf8');
const ast=ts.createSourceFile('route.ts',source,ts.ScriptTarget.Latest,true);
const names=new Set(['SHARED_PANEL_SYSTEM_PROMPT','buildPlurilogProductContext','buildPanelMessages']);
const selected=ast.statements.filter(n=>names.has(n.name?.text)||ts.isVariableStatement(n)&&n.declarationList.declarations.some(d=>names.has(d.name.text))).map(n=>n.getText(ast)).join('\n');
const context={exports:{},AGENTIC_MEMORY_EXPERIMENT:true,console:{log(){}},buildPdfDesignReferenceContext:()=>null,formatRoundForContext:r=>r.content};
vm.runInNewContext(ts.transpileModule(selected,{compilerOptions:{module:ts.ModuleKind.CommonJS,target:ts.ScriptTarget.ES2022}}).outputText,context);
function build({name='Claude',prompt='Explain this.',prior=[],memory,documents,runtime={},continuation=false}={}){
 return context.exports.buildPanelMessages(name,prompt,prior,memory,null,null,null,null,false,documents,null,runtime,null,null,null,continuation);
}
const peer=[{name:'Claude',response:'Here is the proposed document content, but I cannot create the file.'}];
test('later ChatGPT keeps the exact request, runtime capability, and unfinished-document exception',()=>{
 const m=build({name:'ChatGPT',prompt:'Create a Word document about oceans.',prior:peer,runtime:{documentCreationEnabled:true}});
 assert.match(m[1].content,/Create a Word document about oceans/);
 assert.match(m[0].content,/ChatGPT must still create it/);
 assert.match(m[0].content,/Another seat's explanation, plan, refusal or promise is not a completed deliverable/);
 assert.doesNotMatch(m[0].content,/The user has ALREADY received an answer/);
});
test('explicit per-model contributions are preserved while completed answers stay brief',()=>{
 const m=build({prompt:'Each model give a different solution.',prior:peer});
 assert.match(m[1].content,/Each model give a different solution/);
 assert.match(m[0].content,/explicitly requested contributions from each model/);
 assert.match(m[0].content,/If you agree and have nothing useful to add, keep it brief/);
});
test('first seat with historical replies remains a new-request seat',()=>{
 const m=build({prompt:'New question',memory:{recentRounds:[{content:'Old answer'}]}});
 assert.match(m[0].content,/First seat in a new user-request round/);
 assert.match(m[1].content,/NOT answers to the current user's new question/);
 assert.match(m[1].content,/New question$/);
});
test('both Continue positions retain the actual discussion frontier without reissuing the old question',()=>{
 for(const prior of [[],peer]){
  const m=build({prompt:'',prior,continuation:true,memory:{recentRounds:[{content:'Actual unresolved discussion'}]}});
  assert.match(m[0].content,/Continue round; no new user question/);
  assert.match(m[0].content,/Actual unresolved discussion/);
  assert.match(m[0].content,/do not reissue completed tasks/);
  assert.doesNotMatch(m[1].content,/The user originally asked/);
 }
});
test('completed artifacts remain authoritative and prevent duplicate creation',()=>{
 const m=build({prior:peer,documents:[{filename:'ocean.docx',content:'Finished document'}],runtime:{documentCreatedThisTurn:true}});
 assert.match(m[1].content,/already been completed by an earlier panel seat/);
 assert.match(m[1].content,/ocean.docx/);
 assert.match(m[0].content,/Do not recreate an already completed artifact/);
});
test('strong superior-access positioning and named-seat targeting remain',()=>{
 const m=build({prompt:'Claude, why Plurilog?',prior:peer});
 assert.match(m[0].content,/DIRECT, UNAMBIGUOUS ANSWER ON MODEL QUALITY VS FREE TIERS: YES/);
 assert.match(m[0].content,/SUPERIOR, PAID-GRADE AI MODEL ACCESS/);
 assert.match(m[0].content,/respecting named-seat targeting/);
 assert.match(m[0].content,/every capable image model remains eligible to produce its own result/);
});
