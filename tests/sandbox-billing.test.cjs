const {test}=require('node:test');
const assert=require('node:assert/strict');
const fs=require('node:fs'),vm=require('node:vm'),ts=require('typescript'),path=require('node:path');
function load(file,env,mocks={}){const exports={};vm.runInNewContext(ts.transpileModule(fs.readFileSync(file,'utf8'),{compilerOptions:{module:ts.ModuleKind.CommonJS}}).outputText,{exports,process:{env},require:id=>{if(mocks[id])return mocks[id];if(id.startsWith('@/'))return load('src/'+id.slice(2)+'.ts',env,mocks);if(id.startsWith('.'))return load(path.resolve(path.dirname(file),id)+'.ts',env,mocks);return require(id)}});return exports;}
const preview={VERCEL_ENV:'preview',VERCEL_GIT_COMMIT_REF:'preview/weekly-paid-entry',STRIPE_BILLING_MODE:'sandbox'};
test('sandbox routes every billing table and balance operation away from live data',()=>{
 const h=load('src/lib/billingEnvironment.ts',preview);assert.equal(h.billingProfileTable(),'stripe_sandbox_profiles');assert.equal(h.balanceRpc(),'get_my_sandbox_balance');assert.equal(h.spendRpc(),'spend_sandbox_credits');
 const live=load('src/lib/billingEnvironment.ts',{VERCEL_ENV:'production'});assert.equal(live.billingProfileTable(),'profiles');assert.equal(live.balanceRpc(),'get_my_balance');assert.equal(live.spendRpc(),'spend_credits');
});
test('sandbox mode cannot run on production or unrelated previews',()=>{
 for(const env of [{...preview,VERCEL_ENV:'production'},{...preview,VERCEL_GIT_COMMIT_REF:'other'}])assert.throws(()=>load('src/lib/billingEnvironment.ts',env).billingProfileTable(),/restricted/);
});
test('sandbox initialization never resets an existing balance or writes live profiles',async()=>{
 const calls=[];const h=load('src/lib/previewCredits.ts',preview,{'@/utils/supabase/service':{createServiceClient:()=>({from:table=>({upsert:async(row,options)=>{calls.push({table,row,options});return {error:null}}})})}});
 await h.initializePreviewCredits({id:'tester',created_at:'2020-01-01'});
 assert.equal(calls[0].table,'stripe_sandbox_profiles');assert.equal(calls[0].row.id,'tester');assert.equal(Object.keys(calls[0].row).length,1);assert.equal(calls[0].options.ignoreDuplicates,true);
});
