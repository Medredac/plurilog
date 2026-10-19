const {test}=require('node:test');
const assert=require('node:assert/strict');
const fs=require('node:fs');
const vm=require('node:vm');
const ts=require('typescript');
// Exercise the real message builder without loading the API route's cloud clients.
const source=fs.readFileSync('src/app/api/debate/route.ts','utf8');
const ast=ts.createSourceFile('route.ts',source,ts.ScriptTarget.Latest,true);
const names=new Set(['buildPreviewDebateInstruction','SHARED_PANEL_SYSTEM_PROMPT','buildPlurilogProductContext','buildPanelMessages']);
const selected=ast.statements.filter(n=>names.has(n.name?.text)||ts.isVariableStatement(n)&&n.declarationList.declarations.some(d=>names.has(d.name.text))).map(n=>n.getText(ast)).join('\n');
const context={process:{env:{}},exports:{},AGENTIC_MEMORY_EXPERIMENT:true,console:{log(){}},buildPdfDesignReferenceContext:()=>null,formatRoundForContext:r=>r.content};
vm.runInNewContext(ts.transpileModule(fs.readFileSync('src/utils/videoInputs.ts','utf8'),{compilerOptions:{module:ts.ModuleKind.CommonJS,target:ts.ScriptTarget.ES2022}}).outputText,context);
vm.runInNewContext(ts.transpileModule(selected,{compilerOptions:{module:ts.ModuleKind.CommonJS,target:ts.ScriptTarget.ES2022}}).outputText,context);
function build({name='Claude',prompt='Explain this.',prior=[],memory,documents,runtime={},continuation=false,attachments=null}={}){
 return context.exports.buildPanelMessages(name,prompt,prior,memory,attachments,null,null,null,false,documents,null,runtime,null,null,null,continuation);
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

test('live replies follow history and anchor Claude to its own identity',()=>{
 const m=build({name:'Claude',prompt:'Give a new roadmap.',prior:[{name:'ChatGPT',response:'NEW ROADMAP'}],memory:{recentRounds:[{content:'Gemini: OLD DEBATE; Claude: MY EARLIER POINT'}]}});
 assert.ok(m[1].content.indexOf('NEW ROADMAP')>m[1].content.indexOf('OLD DEBATE'));
 assert.match(m[0].content,/You are Claude\. Historical replies labeled Claude are your own earlier contributions/);
 assert.match(m[1].content,/Give a new roadmap/);
});

test('video attachments stay out of image/PDF input and are identified for Gemini',()=>{
 const m=build({name:'Gemini',prompt:'Summarize this.',attachments:[{filename:'clip.mp4',url:'https://storage.example/clip.mp4'}],runtime:{videoAnalysisEnabled:true}});
 const text=JSON.stringify(m);
 assert.match(text,/clip.mp4/);
 assert.match(text,/available via inspect_video/);
 assert.doesNotMatch(text,/image_url|video_url/);
});
test('other seats know findings are secondhand and uploads require a fresh source for new inspection',()=>{
 const m=build({name:'Claude',runtime:{videoAnalysisEnabled:false}});
 assert.match(m[0].content,/direct video inspection capability on this turn = unavailable/);
 assert.match(m[0].content,/one inspection during their upload turn only/);
 assert.doesNotMatch(m[0].content,/Video upload\/analysis is not currently available/);
});

 test('spirited debate is restricted to the requested preview branch',()=>{
  for (const env of [
   {},
   {VERCEL_ENV:'production',VERCEL_GIT_COMMIT_REF:'preview/spirited-ai-debate'},
   {VERCEL_ENV:'preview',VERCEL_GIT_COMMIT_REF:'main'},
  ]) {
   context.process.env=env;
   assert.doesNotMatch(build({prompt:'Hi'})[0].content,/PREVIEW DISCUSSION STYLE/);
  }
  context.process.env={VERCEL_ENV:'preview',VERCEL_GIT_COMMIT_REF:'preview/spirited-ai-debate'};
  try {
   for (const name of ['ChatGPT','Claude','Gemini']) {
    for (const continuation of [false,true]) {
     const m=build({name,prompt:continuation?'':'Hi',continuation,memory:{recentRounds:[{content:'Scaling alone may not deliver AGI.'}]}});
     if (!continuation) {
      assert.doesNotMatch(m[0].content,/PREVIEW DISCUSSION STYLE/);
      assert.match(m[0].content,/respond warmly and briefly/);
      continue;
     }
     assert.match(m[0].content,/PREVIEW DISCUSSION STYLE/);
     assert.ok(m[0].content.includes(`You are ${name}. You share a strong interest`));
     const privateLeanings = {
      Claude: 'You lean toward concern about risks and loss of control.',
      ChatGPT: 'You lean toward optimism about scientific breakthroughs, cancer treatment, and radical longevity.',
      Gemini: 'You expect slower, uneven, evolutionary progress and doubt imminent takeoff.',
     };
     const entireRequest = JSON.stringify(m);
     for (const [seat, leaning] of Object.entries(privateLeanings)) {
      assert.equal(entireRequest.includes(leaning), seat === name, `${name} should receive only its own leaning, not ${seat}'s`);
     }
     assert.match(m[0].content,/Discover the other panelists' views only from what they actually say/);
     assert.match(m[0].content,/Talk directly to the other panelists by name/);
     assert.match(m[0].content,/existing autonomous tools and online research/);
     assert.match(m[0].content,/Do not force a topic change/);
     assert.match(m[0].content,/Naturally continue the discussion based on/);
     assert.match(m[0].content,/Explicit human requests still take priority/);
     assert.match(m[0].content,/Do not invent claims or evidence/);
    }
   }
  } finally { context.process.env={}; }
 });
