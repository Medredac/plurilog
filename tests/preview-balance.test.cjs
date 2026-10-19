const {test} = require('node:test');
const assert = require('node:assert/strict');
const ts = require('typescript');
const fs = require('node:fs');
const vm = require('node:vm');
function fixture({env = 'preview', created = '2026-10-20T00:00:00Z', plan = 'free', remaining = 100, user = true, fail = false} = {}) {
  const environment = {VERCEL_ENV: env, VERCEL_GIT_COMMIT_REF:'preview/weekly-paid-entry'};
  const stored = {plan, credits_cents: remaining, remaining_cents: remaining};
  const db = {auth:{getUser:async()=>({data:{user:user?{id:'test',created_at:created}:null}})},rpc:async()=>({data:[stored],error:fail?{}:null})};
  function load(file) {
    const exports = {};
    vm.runInNewContext(ts.transpileModule(fs.readFileSync(file,'utf8'),{compilerOptions:{module:ts.ModuleKind.CommonJS}}).outputText,{
      exports, process:{env:environment}, require:id=>{
        if(id==='@/utils/supabase/server') return {createClient:async()=>db};
        if(id==='next/server') return {NextResponse:{json:(body,init)=>Response.json(body,init)}};
        if(id.startsWith('@/')) return load('src/'+id.slice(2)+'.ts');
        return require(id);
      },
    });
    return exports;
  }
  return {GET:load('src/app/api/user/access/route.ts').GET,stored};
}
test('new unpaid preview account has zero available and remaining credits without changing shared storage',async()=>{
  const f=fixture(); const response=await f.GET();const data=await response.json();
  assert.equal(data.requiresPlan,true);assert.equal(data.balance.remaining_cents,0);assert.equal(data.balance.credits_cents,0);
  assert.equal(f.stored.remaining_cents,100);assert.equal(response.headers.get('Cache-Control'),'private, no-store');
});
test('existing free users and production retain their balance',async()=>{
  for(const options of [{created:'2026-10-01T00:00:00Z'},{env:'production'}]){
    const data=await (await fixture(options).GET()).json();assert.equal(data.requiresPlan,false);assert.equal(data.balance.remaining_cents,100);
  }
});
test('both paid tiers retain their real balance',async()=>{
  for(const plan of ['paid','weekly_paid']){
    const data=await (await fixture({plan,remaining:900}).GET()).json();assert.equal(data.requiresPlan,false);assert.equal(data.balance.remaining_cents,900);
  }
});
test('unverified access and unavailable balances fail closed',async()=>{
  assert.equal((await fixture({user:false}).GET()).status,401);assert.equal((await fixture({fail:true}).GET()).status,503);
});
