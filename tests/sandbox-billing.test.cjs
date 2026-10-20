const {test}=require('node:test');
const assert=require('node:assert/strict');
const fs=require('node:fs'),vm=require('node:vm'),ts=require('typescript'),path=require('node:path');
function load(file,env,mocks={}){const exports={};vm.runInNewContext(ts.transpileModule(fs.readFileSync(file,'utf8'),{compilerOptions:{module:ts.ModuleKind.CommonJS}}).outputText,{exports,process:{env},require:id=>{if(mocks[id])return mocks[id];if(id.startsWith('@/'))return load('src/'+id.slice(2)+'.ts',env,mocks);if(id.startsWith('.'))return load(path.resolve(path.dirname(file),id)+'.ts',env,mocks);return require(id)}});return exports;}
const preview={VERCEL_ENV:'preview',VERCEL_GIT_COMMIT_REF:'preview/weekly-paid-entry',STRIPE_BILLING_MODE:'sandbox'};
test('sandbox uses the same existing profile and usage operations',()=>{
 const h=load('src/lib/billingEnvironment.ts',preview);assert.equal(h.billingProfileTable(),'profiles');assert.equal(h.balanceRpc(),'get_my_balance');assert.equal(h.spendRpc(),'spend_credits');
 const live=load('src/lib/billingEnvironment.ts',{VERCEL_ENV:'production'});assert.equal(live.billingProfileTable(),'profiles');assert.equal(live.balanceRpc(),'get_my_balance');assert.equal(live.spendRpc(),'spend_credits');
});
test('sandbox mode cannot run on production or unrelated previews',()=>{
 for(const env of [{...preview,VERCEL_ENV:'production'},{...preview,VERCEL_GIT_COMMIT_REF:'other'}])assert.throws(()=>load('src/lib/billingEnvironment.ts',env).billingProfileTable(),/restricted/);
});
test('new preview account initializes existing credits once without creating a separate profile',async()=>{
 const calls=[];const h=load('src/lib/previewCredits.ts',preview,{'@/utils/supabase/service':{createServiceClient:()=>({rpc:async(name)=>{calls.push(name);return {error:null}},from:()=>{throw Error('must not seed a separate table')}})}});
 await h.initializePreviewCredits({id:'tester',created_at:'2026-10-20T00:00:00Z'});
 assert.deepEqual(calls,['initialize_preview_credits']);
});
test('existing users credits remain untouched',async()=>{
 const h=load('src/lib/previewCredits.ts',preview,{'@/utils/supabase/service':{createServiceClient:()=>({rpc:()=>{throw Error('must preserve existing balance')},from:()=>{throw Error('must preserve existing profile')}})}});
 await h.initializePreviewCredits({id:'existing',created_at:'2026-01-01T00:00:00Z'});
});
