const {test}=require('node:test');
const assert=require('node:assert/strict');
const fs=require('node:fs');const Module=require('node:module');const ts=require('typescript');
const m=new Module(__filename,module);m.paths=module.paths;
m._compile(ts.transpileModule(fs.readFileSync('src/utils/workspaceDocumentReference.ts','utf8'),{compilerOptions:{module:ts.ModuleKind.CommonJS,target:ts.ScriptTarget.ES2022}}).outputText,__filename);
const {workspaceUsesLatestDocument}=m.exports;
function options(response){return {openai:{chat:{completions:{create:async req=>{const evidence=JSON.parse(req.messages[1].content);assert.equal(evidence.userRequest,'make it Word');assert.equal(evidence.latestDeliveredDocument.filename,'six-pages.pdf');assert.equal(evidence.proposedRetrieval.filename,'original.pdf');return response;}}}},model:'test',userRequest:'make it Word',latestDocument:{filename:'six-pages.pdf',format:'pdf'},requestedFilename:'original.pdf',retrievalNeed:'Retrieve original',onCost:()=>{}}}
test('referent resolution keeps user request distinct from model-expanded retrieval and meters cost',async()=>{
 let cost=0;const o=options({usage:{cost:.001},choices:[{message:{content:'{"useLatest":true}'}}]});o.onCost=v=>cost+=v;
 assert.equal(await workspaceUsesLatestDocument(o),true);assert.equal(cost,.001);
});
test('explicit alternative decisions do not force the latest document',async()=>{
 assert.equal(await workspaceUsesLatestDocument(options({usage:{cost:.001},choices:[{message:{content:'{"useLatest":false}'}}]})),false);
});
test('malformed decisions and missing accounting cannot silently choose a source',async()=>{
 await assert.rejects(workspaceUsesLatestDocument(options({usage:{cost:.001},choices:[{message:{content:'{}'}}]})),/invalid result/);
 await assert.rejects(workspaceUsesLatestDocument(options({usage:{},choices:[{message:{content:'{"useLatest":true}'}}]})),/accounting/);
});
const {explicitlyNamedWorkspaceSource}=m.exports;
test('literal source filename wins over stale context without inferring intent from phrases',()=>{
 const pdf={filename:'preserved.pdf',storagePath:'six-pages'};
 const docx={filename:'preserved.docx',storagePath:'old-word'};
 assert.equal(explicitlyNamedWorkspaceSource('Convert preserved.pdf to Word','output.docx',[pdf,docx]),pdf);
 assert.equal(explicitlyNamedWorkspaceSource('make it Word','output.docx',[pdf,docx]),null);
 assert.equal(explicitlyNamedWorkspaceSource('Compare preserved.pdf and preserved.docx','output.docx',[pdf,docx]),null);
 assert.equal(explicitlyNamedWorkspaceSource('Use other-preserved.pdf','output.docx',[pdf,docx]),null);
 assert.equal(explicitlyNamedWorkspaceSource('Return preserved.docx','preserved.docx',[pdf,docx]),null);
});
