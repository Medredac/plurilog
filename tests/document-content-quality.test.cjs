const test = require('node:test');
const assert = require('node:assert/strict');
const fs = require('node:fs');
const path = require('node:path');
const Module = require('node:module');
const ts = require('typescript');
function load(relative) {
  const filename = path.resolve(__dirname, '..', relative);
  const mod = new Module(filename, module);
  mod.filename = filename; mod.paths = Module._nodeModulePaths(path.dirname(filename));
  const originalRequire = mod.require.bind(mod);
  mod.require = name => name === './documentTemplateTreatments' ? load('src/utils/documentTemplateTreatments.ts') : name === './documentLayouts' ? load('src/utils/documentLayouts.ts') : originalRequire(name);
  mod._compile(ts.transpileModule(fs.readFileSync(filename, 'utf8'), {
    compilerOptions: { module: ts.ModuleKind.CommonJS, target: ts.ScriptTarget.ES2022, esModuleInterop: true },
  }).outputText, filename);
  return mod.exports;
}
const q = load('src/utils/documentContentQuality.ts');
const sources = load('src/utils/conversationDocumentSource.ts');
const writer = load('src/utils/docxWriter.ts');
const source = { mode: 'transcript', messages: [
  { id: 'user-1', speaker: 'User', text: 'Compare steel and aluminium for our balcony.' },
  { id: 'gpt-1', speaker: 'ChatGPT', text: 'Separate the frame from the walking surface.' },
  { id: 'claude-1', speaker: 'Claude', text: 'Check ownership and load capacity first.' },
] };
const good = { format: 'docx', filename: 'translation.docx', title: 'Übersetzung', blocks: [
  { type: 'paragraph', source_message_id: 'user-1', text: 'Nutzer: Vergleiche Stahl und Aluminium für unseren Balkon.' },
  { type: 'paragraph', source_message_id: 'gpt-1', text: 'ChatGPT: Tragwerk und Gehbelag getrennt betrachten.' },
  { type: 'paragraph', source_message_id: 'claude-1', text: 'Claude: Zuerst Eigentumsverhältnisse und Tragfähigkeit prüfen.' },
] };
function database(rows, error = null) {
  const calls = [];
  const query = { select() { return this; }, eq(k,v) { calls.push([k,v]); return this; },
    order() { return this; }, async range(a,b) { return { data: rows.slice(a,b+1), error }; } };
  return { calls, from(table) { assert.equal(table, 'messages'); return query; } };
}
test('full conversation tool is lazy, scoped by the server and returns exact text once', async () => {
  const db = database([
    {id:'first',sender:'user',content:'Original question: ORCHID-4729'},
    {id:'second',sender:'claude',content:'Keep the unknown price unknown.'},
    {id:'current',sender:'user',content:'Please translate the discussion'},
  ]);
  const session = sources.createFullConversationSession({supabase:db,discussionId:'owned-chat',currentUserMessageId:'current'});
  assert.deepEqual(db.calls, []); assert.equal(session.getSource(), null);
  const first = await session.resolve({mode:'transcript',discussion_id:'some-other-chat',currentUserMessageId:'first'});
  assert.equal(first.ok,true); assert.equal(first.message_count,2);
  assert.ok(first.source.includes('ORCHID-4729')); assert.ok(first.source.includes('Keep the unknown price unknown.'));
  assert.deepEqual(db.calls,[['discussion_id','owned-chat']]);
  assert.deepEqual(session.getSource().messages.map(m=>m.id),['first','second']);
  const again=await session.resolve({mode:'transcript'});
  assert.equal(again.reused,true); assert.equal(again.source,undefined); assert.equal(db.calls.length,1);
  assert.equal((await session.resolve({mode:'summary'})).ok,false);
  assert.equal(session.getSource().mode,'transcript'); // cannot downgrade coverage validation
});
test('invalid tool arguments and aborted requests do not load conversation data', async () => {
  const db=database([]), controller=new AbortController();
  const session=sources.createFullConversationSession({supabase:db,discussionId:'d',currentUserMessageId:'c',signal:controller.signal});
  assert.equal((await session.resolve({mode:'everything'})).ok,false);
  controller.abort();
  assert.equal((await session.resolve({mode:'summary'})).error,'request_aborted');
  assert.deepEqual(db.calls,[]);
});
test('general full-chat review retrieves source without directing document creation', async () => {
  const db=database([{id:'a',sender:'user',content:'Original requirement'}, {id:'c',sender:'user',content:'Review everything'}]);
  const session=sources.createFullConversationSession({supabase:db,discussionId:'d',currentUserMessageId:'c'});
  const result=await session.resolve({mode:'context'});
  assert.equal(result.ok,true); assert.equal(result.message_count,1);
  assert.ok(result.source.includes('Original requirement'));
  assert.ok(result.source.includes('Retrieval alone does not request'));
  assert.ok(!result.source.includes('Synthesize the requested report'));
  assert.equal(session.getSource().mode,'context');
  const exportResult=await session.resolve({mode:'transcript'});
  assert.equal(exportResult.reused,true); assert.equal(exportResult.source,undefined);
  assert.ok(exportResult.instruction.includes('source_message_id'));
  assert.equal(session.getSource().mode,'transcript'); assert.equal(db.calls.length,1);
  assert.equal((await session.resolve({mode:'context'})).ok,false);
});
test('concurrent context and transcript calls cannot weaken source coverage', async () => {
  const db=database([{id:'a',sender:'user',content:'original'}, {id:'c',sender:'user',content:'export'}]);
  const session=sources.createFullConversationSession({supabase:db,discussionId:'d',currentUserMessageId:'c'});
  await Promise.all([session.resolve({mode:'context'}),session.resolve({mode:'transcript'})]);
  assert.equal(db.calls.length,1); assert.equal(session.getSource().mode,'transcript');
  assert.equal((await session.resolve({mode:'context'})).ok,false);
});
test('failed whole-chat retrieval stays failed and prevents a partial document', async () => {
  const db=database([{id:'a',sender:'user',content:'fragment without verified boundary'}]);
  const session=sources.createFullConversationSession({supabase:db,discussionId:'d',currentUserMessageId:'missing'});
  const result=await session.resolve({mode:'transcript'});
  assert.equal(result.ok,false); assert.deepEqual(result.messages,[]);
  await assert.rejects(q.prepareDocumentContent({spec:good,prompt:'Translate',source:session.getSource()}),/boundary/);
  await session.resolve({mode:'transcript'}); assert.equal(db.calls.length,1);
});
test('concurrent repeated full-chat calls share one source read and one full result', async () => {
  const db=database([{id:'a',sender:'user',content:'original'}, {id:'c',sender:'user',content:'export'}]);
  const session=sources.createFullConversationSession({supabase:db,discussionId:'d',currentUserMessageId:'c'});
  const results=await Promise.all([session.resolve({mode:'summary'}),session.resolve({mode:'summary'})]);
  assert.equal(db.calls.length,1); assert.equal(results.filter(r=>r.source).length,1);
  assert.equal(results.filter(r=>r.reused).length,1);
});
test('database transport exceptions become explicit tool failure without source content', async () => {
  const session=sources.createFullConversationSession({supabase:{from(){throw Error('transport broke');}},discussionId:'d',currentUserMessageId:'c'});
  const result=await session.resolve({mode:'summary'});
  assert.equal(result.ok,false); assert.equal(result.complete,false); assert.deepEqual(result.messages,[]);
});
test('source loader is discussion scoped, excludes internals and stops before the requesting turn', async () => {
  const db = database([
    { id: 'a', sender: 'user', content: 'Original question' },
    { id: 'internal', sender: 'system', content: 'Working context' },
    { id: 'b', sender: 'chatgpt', content: 'Original answer' },
    { id: 'current', sender: 'user', content: 'Translate everything' },
    { id: 'later', sender: 'gemini', content: 'Must not leak into the source' },
  ]);
  const result = await sources.loadConversationDocumentSource({ supabase: db, discussionId: 'this-discussion', currentUserMessageId: 'current', mode: 'transcript' });
  assert.deepEqual(result.messages.map(m=>m.id), ['a','b']);
  assert.deepEqual(db.calls, [['discussion_id', 'this-discussion']]);
  assert.equal(result.error, undefined);
});
test('missing boundary, database errors, and oversized source never produce a partial transcript', async () => {
  for (const db of [database([{id:'a',sender:'user',content:'Only a fragment'}]), database([], {message:'error'}),
    database([{id:'a',sender:'user',content:'X'.repeat(100001)},{id:'current',sender:'user',content:'export'}])]) {
    const result = await sources.loadConversationDocumentSource({ supabase:db,discussionId:'d',currentUserMessageId:'current',mode:'transcript' });
    assert.ok(result.error); assert.deepEqual(result.messages, []);
  }
});
test('recovers Steve-shaped heading/table payload and renders every cell in Word', async () => {
  const malformed = { filename:'report.docx', blocks: [
    { type:'heading', level:1, text:'3. Vergleich der diskutierten Lösungen', headers:['Material','Concern'], rows:[['Steel','Weight'],['Aluminium','Connections'],['Composite','Expansion']] },
    { type:'heading', level:1, text:'4. Komfort' }, { type:'paragraph', text:'Consider shade and surface colour.' },
  ] };
  const normalized = q.normalizeDocumentContent(malformed);
  assert.equal(normalized.blocks[1].type, 'table');
  assert.deepEqual(normalized.blocks[1].rows, malformed.blocks[0].rows);
  assert.deepEqual(q.normalizeDocumentContent(normalized), normalized);
  assert.deepEqual(q.documentContentIssues(normalized, 'Write a report'), []);
  const rendered = writer.renderDocx(normalized);
  const mammoth = require('mammoth');
  const actual = (await mammoth.extractRawText({ buffer: rendered.buffer })).value;
  for (const value of ['Steel','Weight','Aluminium','Connections','Composite','Expansion']) assert.ok(actual.includes(value));
  assert.equal(malformed.blocks.length, 3); // original untouched
});
test('valid content and legitimate outline hierarchy remain unchanged', () => {
  assert.deepEqual(q.normalizeDocumentContent(good), good);
  assert.deepEqual(q.documentContentIssues(good, 'Translate whole chat', source), []);
  const hierarchy = { blocks:[{type:'heading',level:1,text:'Report'},{type:'heading',level:2,text:'Findings'},{type:'paragraph',text:'A finding'}] };
  assert.deepEqual(q.documentContentIssues(hierarchy,'Write a report'), []);
  const outline = { blocks:[{type:'heading',text:'Introduction'},{type:'heading',text:'Conclusion'}] };
  assert.equal(q.documentContentIssues(outline,'Write a report').length,2);
  assert.deepEqual(q.documentContentIssues(outline,'Create a blank report template'), []);
});
test('source coverage rejects missing, reordered and invented message groups', () => {
  assert.deepEqual(q.documentContentIssues({...good, blocks:[{type:'heading',text:'German transcript'},...good.blocks]},'Translate whole chat',source), []);
  for (const blocks of [good.blocks.slice(1), [...good.blocks].reverse(), [...good.blocks,{type:'paragraph',text:'Extra',source_message_id:'unknown'}]]) {
    assert.ok(q.documentContentIssues({...good,blocks},'Translate whole chat',source).some(x=>x.includes('every source message')));
  }
  assert.ok(q.documentContentIssues({blocks:[{type:'paragraph',text:'LAUFENDER ARBEITSKONTEXT – NAVIGATIONSKARTE, NICHT QUELLENBELEG'}]},'Create a translation').some(x=>x.includes('leaked')));
  const missingTags = {...good,blocks:good.blocks.map(({source_message_id,...b})=>b)};
  assert.ok(q.documentContentIssues(missingTags,'Translate whole chat',source).some(x=>x.includes('missing source_message_id')));
});
test('one repair restores missing coverage and is metered; valid draft needs no extra model call', async () => {
  let calls=0,cost=0;
  const options={spec:good,prompt:'Translate whole chat',source,model:'test',repairTool:{type:'function',function:{name:'create_file'}},
    openai:{chat:{completions:{async create(){calls++;return {usage:{cost:0.01},choices:[{message:{tool_calls:[{function:{name:'create_file',arguments:JSON.stringify(good)}}]}}]};}}}},onCost:v=>cost+=v};
  assert.deepEqual(await q.prepareDocumentContent(options),good); assert.equal(calls,0);
  const repaired = await q.prepareDocumentContent({...options,spec:{...good,blocks:good.blocks.slice(1)}});
  assert.deepEqual(repaired,good); assert.equal(calls,1); assert.equal(cost,0.01);
});
test('unsuccessful repair fails closed instead of attaching an incomplete file', async () => {
  let calls=0;
  await assert.rejects(q.prepareDocumentContent({spec:{...good,blocks:[]},prompt:'Translate',source,model:'test',repairTool:{},
    openai:{chat:{completions:{async create(){calls++;return {choices:[{message:{tool_calls:[{function:{name:'create_file',arguments:'{"blocks":[]}'}}]}}]};}}}}}),/validation failed after repair/);
  assert.equal(calls,1);
});
test('renderer limits are checked before content can be silently truncated', () => {
  assert.deepEqual(q.normalizeDocumentContent({}), {});
  assert.ok(q.documentContentIssues({}, 'Write a report').length);
  for (const block of [
    {type:'paragraph',text:'x'.repeat(30001)},
    {type:'table',headers:['x'.repeat(5001)],rows:[['value']]},
    {type:'table',headers:['value'],rows:Array.from({length:201},()=>['value'])},
    {type:'bullets',items:Array(201).fill('item')},
    {type:'numbered',items:['x'.repeat(10001)]},
  ]) assert.ok(q.documentContentIssues({blocks:[block]},'Write a report').some(x=>x.includes('renderer limit')));
});

test('pamphlet preflight rejects missing or blank panels without inventing content',()=>{
 const {documentContentIssues}=load('src/utils/documentContentQuality.ts');
 const spec={design:{layoutTemplate:'pamphlet'},blocks:[{type:'paragraph',text:'Cover'},{type:'column_break'},{type:'paragraph',text:'Back'}]};
 assert.ok(documentContentIssues(spec,'Create a pamphlet').some(x=>x.includes('panels are incomplete')));
 spec.blocks.push({type:'column_break'},{type:'paragraph',text:'Fold-in'});
 assert.equal(documentContentIssues(spec,'Create a pamphlet').length,0);
});

test('per-file requirements repair catches a photo pamphlet incorrectly authored as an essay', async () => {
 const bad={format:'pdf',filename:'pamphlet.pdf',design:{layoutTemplate:'essay'},blocks:[{type:'paragraph',text:'Original facts: ORCHID-4729 and $4,200.'}]};
 const fixed={...bad,design:{layoutTemplate:'brochure-editorial'},blocks:[...bad.blocks,{type:'image',mode:'generate',prompt:'A botanical photograph',size:'full'}]};
 const messages=[],costs=[];let n=0;
 const openai={chat:{completions:{async create(input){messages.push(input);n++;const repair=input.tool_choice.function.name==='create_file';return {usage:{cost:.001},choices:[{message:{tool_calls:[{function:{name:repair?'create_file':'review_deliverable',arguments:JSON.stringify(repair?fixed:{brief:'The second file: a modern pamphlet with photos.',family:'promotional',imagesRequired:true,issues:[]})}}]}}]};}}}};
 const out=await q.prepareDocumentContent({spec:bad,prompt:'Create an essay and another modern pamphlet with photos.',model:'test',openai,validateDeliverable:true,repairTool:{type:'function',function:{name:'create_file'}},onCost:c=>costs.push(c)});
 assert.equal(n,3);assert.equal(out.design.layoutTemplate,'brochure-editorial');assert.equal(out.blocks[0].text,bad.blocks[0].text);assert.equal(bad.blocks.length,1);assert.equal(costs.length,3);
 const repair=JSON.parse(messages[1].messages[1].content);assert.match(repair.deliverableBrief,/second file/);assert.ok(repair.issues.some(x=>x.includes('embedded images')));assert.ok(repair.issues.some(x=>x.includes('essay layout')));
});
test('companion essay is not forced to contain the photos requested only for a pamphlet', async()=>{
 const spec={format:'pdf',filename:'essay.pdf',design:{layoutTemplate:'essay'},blocks:[{type:'paragraph',text:'A developed explanation.'}]};let calls=0;
 const openai={chat:{completions:{async create(){calls++;return {choices:[{message:{tool_calls:[{function:{name:'review_deliverable',arguments:JSON.stringify({brief:'An essay, the first deliverable.',family:'prose',imagesRequired:false,issues:[]})}}]}}]};}}}};
 assert.deepEqual(await q.prepareDocumentContent({spec,prompt:'An essay and a pamphlet with photos',model:'test',openai,validateDeliverable:true}),spec);assert.equal(calls,1);
});
test('unsatisfied semantic requirements cannot be published after repair',async()=>{
 const bad={format:'pdf',filename:'pamphlet.pdf',design:{layoutTemplate:'essay'},blocks:[{type:'paragraph',text:'No photos'}]};
 const openai={chat:{completions:{async create(input){const repair=input.tool_choice.function.name==='create_file';return {choices:[{message:{tool_calls:[{function:{name:repair?'create_file':'review_deliverable',arguments:JSON.stringify(repair?bad:{brief:'Photo brochure',family:'promotional',imagesRequired:true,issues:[]})}}]}}]};}}}};
 await assert.rejects(q.prepareDocumentContent({spec:bad,prompt:'Photo brochure',model:'test',openai,validateDeliverable:true,repairTool:{type:'function',function:{name:'create_file'}}}),/validation failed after repair/);
});
