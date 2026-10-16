const {test}=require('node:test');
const assert=require('node:assert/strict');
const fs=require('node:fs');
const ts=require('typescript');
const Module=require('node:module');
function compile(source,name='test-module') {const m=new Module(name,module);m.paths=module.paths;m._compile(ts.transpileModule(source,{compilerOptions:{module:ts.ModuleKind.CommonJS,target:ts.ScriptTarget.ES2022}}).outputText,name);return m.exports;}
const route=fs.readFileSync('src/app/api/debate/route.ts','utf8');
const ast=ts.createSourceFile('route.ts',route,ts.ScriptTarget.Latest,true);
const names=['GPT_FILE_TOOLS','GPT_REVISE_FILE_TOOL','GPT_SOURCE_DOCUMENT_EDIT_TOOL','GEMINI_IMAGE_TOOLS','GEMINI_IMAGE_EDIT_TOOLS','REQUEST_EVIDENCE_TOOL','WEB_RESEARCH_TOOL'];
const definitions=compile(ast.statements.filter(s=>ts.isVariableStatement(s)&&s.declarationList.declarations.some(d=>names.includes(d.name.getText(ast)))).map(s=>s.getText(ast)).join('\n'));
const revision=compile(fs.readFileSync('src/utils/documentRevisionState.ts','utf8'));
const {runAgentToolLoop}=compile(fs.readFileSync('src/utils/agentToolLoop.ts','utf8'));
// Execute the actual production adapter block with isolated storage/provider dependencies.
const begin=route.indexOf('              let revisionParent: DocumentStateSnapshot | null = null;');
const end=route.indexOf('              const loop = await runAgentToolLoop',begin);
assert.ok(begin>0&&end>begin);
const block=route.slice(begin,end);
function chain(data={}) {const c={};for(const k of ['from','update','upsert','eq','select','maybeSingle'])c[k]=()=>c;c.then=(resolve)=>resolve({data,error:null});return c;}
async function fixture(seatId='chatgpt') {
 const outputs=[],calls=[],attachments=[{filename:'logo.png',url:'https://storage/message-images/u/logo.png'}];
 const parent={id:'state-1',discussionId:'discussion',filename:'garden.pdf',storagePath:'u/garden.pdf',format:'pdf',pageCount:1,spec:{format:'pdf',filename:'garden.pdf',title:'Garden',blocks:[{type:'paragraph',text:'ORCHID-4729 $4,200',style:{textColor:'#ffffff'}}]},fullText:'ORCHID-4729 $4,200',imageSources:[{filename:'logo.png',storagePath:'u/logo.png'}],sourceDocumentIds:[],imageBindings:[],generationKind:'create'};
 const service={...chain(),storage:{from:()=>({createSignedUrl:async path=>({data:{signedUrl:'https://storage/message-images/'+path},error:null})})},rpc:async()=>({data:[{remaining_cents:100}],error:null})};
 const ctx={...definitions,...revision,
  createServiceClient:()=>service,supabase:service,openai:{chat:{completions:{create:async()=>({usage:{cost:0.01},choices:[{message:{content:'Research summary',annotations:[{type:'url_citation',url_citation:{url:'https://example.org/source',title:'Source'}}]}}]})}}},addWebCitations:()=>{},turnId:'turn',discussionId:'discussion',sourceUserMessageId:'user-message',messageId:'assistant-message',seat:{seatId},
  accumulatedToolCalls:[{}],discussionMemory:{knownDocuments:[{filename:'garden.pdf',storagePath:'u/garden.pdf'}],recentRounds:[],allRounds:[]},retrievedDocuments:[],visualContextState:null,prompt:'Make it light. Preserve all content.',
  currentRoundAttachments:attachments,pdfEmbeddedImageAttachments:[{filename:'embedded.png',url:'https://storage/message-images/u/embedded.png'}],
  fetchKnownImageSources:async()=>[],fetchMessageVisualEvidence:async()=>[],prepareGeminiVisionAttachments:async a=>a,
  extractStoragePathFromSignedUrl:url=>url?.split('/message-images/')[1]||null,isImageUrl:url=>/\.(png|jpg)$/.test(url),
  listDocumentStateSnapshots:async()=>[parent],findDocumentStateSnapshot:async()=>outputs.length?{...parent,storagePath:outputs.at(-1).storagePath,filename:outputs.at(-1).filename,format:outputs.at(-1).format,spec:calls.at(-1).args}:parent,
  isAgenticMemoryEnabledForSeat:true,isFullConversationEnabledForSeat:true,isAgenticDocumentEvidenceEnabledForSeat:true,
  isDocumentCreationEnabledForSeat:true,isImageGenerationEnabledForSeat:seatId!=='claude',isImageEditingEnabledForSeat:seatId!=='claude',videoSession:seatId==='gemini'?{}:null,
  AGENTIC_CONVERSATION_MEMORY_TOOLS:[{function:{name:'search_conversation'}}],FULL_CONVERSATION_TOOL:{function:{name:'read_full_conversation'}},VIDEO_INSPECTION_TOOL:{function:{name:'inspect_video'}},AGENTIC_DOCUMENT_EVIDENCE_TOOLS:[{function:{name:'search_document'}}],
  resolveSeatConversationTool:async o=>({result:{ok:true,tool:o.toolName}}),resolveAgenticDocumentEvidenceTool:async o=>({result:{ok:true,tool:o.toolName}}),
  registerAgenticArtifactEvidence:()=>({}),sharedAgenticEvidenceLedger:[],createAgenticEvidenceId:()=> 'evidence',seatAbortController:new AbortController(),
  resolveRequestedEvidence:()=>({status:'not_found',message:'No match'}),
  materializeBrokerEvidenceForSeat:async o=>({modelSafeBrokerResult:{status:'resolved',filename:o.brokerResult.evidence.filename},materializedEvidenceAttachments:[{filename:o.brokerResult.evidence.filename,url:'https://storage/message-images/'+o.brokerResult.evidence.storagePath}]}),
  fullConversationSession:{getSource:()=>null},latestDocxSourceFromContext:()=>null,
  executeGptDocumentCreation:async o=>{calls.push(o);const r={filename:o.args.filename,format:o.args.format,fullText:'ORCHID-4729 $4,200',signedUrl:'https://storage/message-images/u/out'+outputs.length+'.'+o.args.format,durableUrl:'/api/attachments/message-images/u/out'+outputs.length+'.'+o.args.format,storagePath:'u/out'+outputs.length+'.'+o.args.format,renderedPageAttachments:[{filename:'page.png',url:'https://storage/message-images/u/page.png'}],pageCount:1,visualReviewCostUsd:0};outputs.push(r);return r;},
  executeSourcePreservingDocumentEdit:async()=>{throw Error('not exercised');},isNarrowDocumentRevisionFollowUpQuery:()=>true,
  buildAgenticSeatActivity:()=>null,activityFilename:x=>x,documentActivityLabel:()=> 'Creating document',sendEvent:()=>{},primaryModel:'test',models:['test'],
  isPersistentVisualContextWritesEnabled:()=>false,ingestDiscussionArtifacts:async()=>({ingestedSourceIds:[]}),
  generateChatGPTImage:async()=>({b64Json:'image',mediaType:'image/png',costUsd:0}),generateGeminiImage:async()=>({b64Json:'image',mediaType:'image/png',costUsd:0}),
  editChatGPTImage:async()=>({b64Json:'image',mediaType:'image/png',costUsd:0}),editGeminiImage:async()=>({b64Json:'image',mediaType:'image/png',costUsd:0}),
  persistGeneratedImage:async()=>({filename:'generated.png',signedUrl:'https://storage/message-images/u/generated.png',storagePath:'u/generated.png'}),
  buildDurableAttachmentUrl:p=>'/api/attachments/message-images/'+p,updateDiscussionVisualContextCAS:async()=>null,
 };
 const source=`export async function build(ctx:any){ const {${Object.keys(ctx).join(',')}}=ctx; let agentModelCostUsd=0,agentWebSearchRequests=0,documentCreatedThisTurn=false, incurredDocumentFollowUpCostUsd=0, incurredDocumentAssetCostUsd=0, incurredImageCostUsd=0, hadGeneratedImageInTurn=false,sameTurnEditReferentLock=null;const currentTurnDocuments:any[]=[],producedAttachments:string[]=[],sameRoundEditedSourceIds:string[]=[],sameRoundGeneratedSourceIds:string[]=[];${block}\nreturn {toolRegistry,producedAttachments,currentTurnDocuments};}`;
 const adapter=await compile(source).build(ctx);return {...adapter,outputs,calls,attachments,parent};
}
const call=(id,name,args={})=>({id,type:'function',function:{name,arguments:JSON.stringify(args)}});
test('actual route adapters recover the light-theme failure and preserve source images',async()=>{
 const f=await fixture();let step=0;
 const replies=[call('bad','revise_file',{patch:[{op:'replace',path:'/blocks/22/style/textColor',value:'#111111'}]}),call('fixed','revise_file',{filename:'light.pdf',patch:[{op:'replace',path:'/blocks/0/style/textColor',value:'#111111'}]}),call('check','inspect_asset',{filename:'light.pdf'})];
 const result=await runAgentToolLoop({messages:[],tools:f.toolRegistry,signal:new AbortController().signal,deadline:Date.now()+600000,
  initial:{content:null,tool_calls:[call('read','inspect_asset',{filename:'garden.pdf'})]},model:async messages=>{
    if(step===1){const error=JSON.parse(messages.filter(m=>m.role==='tool').at(-1).content);assert.equal(error.ok,false);assert.equal(error.canonical_document.filename,'garden.pdf');}
    const next=replies[step++];return next?{content:null,tool_calls:[next]}:{content:'Saved light.pdf'};
  }});
 assert.equal(result.content,'Saved light.pdf');assert.equal(f.outputs.length,1);assert.equal(f.calls[0].args.blocks[0].text,'ORCHID-4729 $4,200');
 assert.ok(f.calls[0].availableImages.some(a=>a.filename==='logo.png'));assert.ok(f.calls[0].availableImages.some(a=>a.filename==='embedded.png'));assert.equal(f.producedAttachments.length,1);
});
test('actual adapter returns actionable removed-content diagnostic without creating a file',async()=>{
 const f=await fixture();await f.toolRegistry.inspect_asset.execute({filename:'garden.pdf'});
 const r=await f.toolRegistry.revise_file.execute({patch:[{op:'replace',path:'/blocks/0/text',value:'Changed'}]});
 assert.equal(r.result.ok,false);assert.match(r.result.error,/ORCHID-4729/);assert.equal(f.outputs.length,0);
});
test('generated image can be reused immediately by a later document tool',async()=>{
 const f=await fixture();await f.toolRegistry.generate_image.execute({prompt:'A garden'});
 await f.toolRegistry.create_file.execute({format:'pdf',filename:'flyer.pdf',title:'Garden',blocks:[{type:'image',filename:'generated.png'}]});
 assert.ok(f.calls[0].availableImages.some(a=>a.filename==='generated.png'));assert.equal(f.producedAttachments.length,2);
});
test('all three seats get document and research tools; video stays Gemini-native',async()=>{
 for(const seat of ['chatgpt','claude','gemini']){const f=await fixture(seat);assert.ok(f.toolRegistry.search_conversation);assert.ok(f.toolRegistry.read_full_conversation);assert.ok(f.toolRegistry.inspect_asset);assert.ok(f.toolRegistry.create_file);assert.ok(f.toolRegistry.search_web);assert.equal(Boolean(f.toolRegistry.inspect_video),seat==='gemini');}
});

test('revision replaces its earlier attachment while keeping other deliverables and formats',async()=>{
 const f=await fixture();
 const args={format:'pdf',filename:'flyer.pdf',title:'Garden',blocks:[{type:'paragraph',text:'ORCHID-4729 $4,200'}]};
 await f.toolRegistry.create_file.execute(args);
 await f.toolRegistry.revise_file.execute({edit_scope:'redesign',filename:'flyer-final.pdf',patch:[{op:'add',path:'/design',value:{backgroundColor:'#ffffff'}}]});
 assert.equal(f.producedAttachments.length,1);
 assert.equal(f.producedAttachments[0],f.outputs[1].durableUrl);
 assert.equal(f.calls[1].revisionContext.preserveLayout,false);
 assert.equal(f.calls[1].revisionContext.preserveParentContent,true);
 await f.toolRegistry.create_file.execute({...args,format:'docx',filename:'flyer.docx'});
 assert.equal(f.producedAttachments.length,2);
 await f.toolRegistry.create_file.execute({...args,filename:'essay.pdf'});
 assert.equal(f.producedAttachments.length,3);
});
test('all seats can create then inspect a document and research sourced information',async()=>{
 for(const seat of ['chatgpt','claude','gemini']){
  const f=await fixture(seat);
  const research=await f.toolRegistry.search_web.execute({query:'brochure typography'});
  assert.equal(research.result.ok,true);assert.equal(research.result.sources.length,1);
  await f.toolRegistry.create_file.execute({format:'pdf',filename:'flyer.pdf',title:'Garden',blocks:[{type:'paragraph',text:'ORCHID-4729 $4,200'}]});
  const inspected=await f.toolRegistry.inspect_asset.execute({filename:'flyer.pdf'});
  assert.ok(inspected.messages.length);assert.equal(f.outputs.length,1);
 }
});
