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
test('whole conversation and report requests opt in, ordinary chat and document edits do not', () => {
  for (const p of ['ChatGPT: can you translate this entire string into German for me and create a separate downoadable PDF',
    'Export our whole conversation to Word', 'Put the full discussion into a PDF', 'Translate all of this chat into German and save a PDF']) {
    assert.equal(sources.conversationDocumentMode(p), 'transcript', p);
  }
  assert.equal(sources.conversationDocumentMode('Create a report in German that summarizes the issues, discussion and findings'), 'summary');
  for (const p of ['How is our discussion going?', 'Translate the entire attached PDF', 'Change only the title in report.docx',
    'Create a PDF about balcony materials', 'Write a report about discussion techniques',
    'How do I export the whole conversation to PDF?', 'Translate the last response into a PDF', 'Do not export the entire chat to PDF']) {
    assert.equal(sources.conversationDocumentMode(p), null, p);
  }
});
function database(rows, error = null) {
  const calls = [];
  const query = { select() { return this; }, eq(k,v) { calls.push([k,v]); return this; },
    order() { return this; }, async range(a,b) { return { data: rows.slice(a,b+1), error }; } };
  return { calls, from(table) { assert.equal(table, 'messages'); return query; } };
}
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
