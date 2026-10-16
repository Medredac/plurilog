const {test}=require('node:test'),assert=require('node:assert/strict'),fs=require('node:fs'),Module=require('node:module'),ts=require('typescript');
const m=new Module(__filename);m._compile(ts.transpileModule(fs.readFileSync('src/utils/missingDocumentInput.ts','utf8'),{compilerOptions:{module:ts.ModuleKind.CommonJS,target:ts.ScriptTarget.ES2022}}).outputText,__filename);
const {UnresolvedDocumentImageError,missingDocumentInputInstruction:check}=m.exports;
const missing=new UnresolvedDocumentImageError('logo');
function db(messages=0,artifacts=0,error=null){return {from(table){const result={count:table==='messages'?messages:artifacts,error};const q={select(){return q},eq(){return q},or(){return q},then(resolve,reject){return Promise.resolve(result).then(resolve,reject)}};return q}}}
test('asks for upload only when persisted discussion is empty of files',async()=>assert.match(await check(missing,db(),'discussion',false),/ask the user to upload/));
test('never blames user when an attachment or artifact exists',async()=>{for(const d of [db(1),db(0,1)])assert.equal(await check(missing,d,'discussion',false),null);assert.equal(await check(missing,db(),'discussion',true),null)});
test('unknown, failed and unavailable history checks cannot prove missing input',async()=>{for(const d of [db(null),db(0,null),db(0,0,{message:'failed'}),{from(){throw Error('network')}}])assert.equal(await check(missing,d,'discussion',false),null)});
test('revision and storage errors do not ask for uploads',async()=>{for(const e of [Error('Revision patch array index is invalid: /blocks/22/style/textColor'),Error('Storage download failed')])assert.equal(await check(e,db(),'discussion',false),null);assert.equal(await check(missing,db(),null,false),null)});
