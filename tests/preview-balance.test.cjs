const {test} = require('node:test');
const assert = require('node:assert/strict');
const ts = require('typescript');
const fs = require('node:fs');
const vm = require('node:vm');
const path = require('node:path');
function fixture({env = 'preview', created = '2026-10-20T00:00:00Z', plan = 'free', remaining = 100, user = true, fail = false} = {}) {
  const environment = {VERCEL_ENV: env, VERCEL_GIT_COMMIT_REF:'preview/weekly-paid-entry'};
  const stored = {plan, credits_cents: remaining, remaining_cents: remaining};
  let initialized = false;
  const service = {rpc:async()=>{if(!initialized){if(stored.plan==='free'){stored.credits_cents=0;stored.remaining_cents=0;} initialized=true;}return {error:null};}};
  const db = {from:()=>({select:()=>({eq:()=>({single:async()=>({data:{plan_status:'active'},error:null})})})}),auth:{getUser:async()=>({data:{user:user?{id:'test',created_at:created}:null}})},rpc:async()=>({data:[stored],error:fail?{}:null})};
  function load(file) {
    const exports = {};
    vm.runInNewContext(ts.transpileModule(fs.readFileSync(file,'utf8'),{compilerOptions:{module:ts.ModuleKind.CommonJS}}).outputText,{
      exports, process:{env:environment}, require:id=>{
        if(id==='@/utils/supabase/service') return {createServiceClient:()=>service};
        if(id.startsWith('.')) return load(path.resolve(path.dirname(file),id)+'.ts');
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
test('new unpaid preview account has zero available and remaining credits initialized once',async()=>{
  const f=fixture(); const response=await f.GET();const data=await response.json();
  assert.equal(data.requiresPlan,true);assert.equal(data.balance.remaining_cents,0);assert.equal(data.balance.credits_cents,0);
  assert.equal(f.stored.remaining_cents,0);assert.equal(response.headers.get('Cache-Control'),'private, no-store');
});
test('existing free balances are preserved, but preview still requires a paid tier',async()=>{
  for(const options of [{created:'2026-10-01T00:00:00Z'},{env:'production'}]){
    const data=await (await fixture(options).GET()).json();assert.equal(data.requiresPlan,options.env!=='production');assert.equal(data.balance.remaining_cents,100);
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

test('manual positive free balance remains blocked; either paid tier also needs positive balance',async()=>{
 const f=fixture();await f.GET();f.stored.remaining_cents=100;
 let data=await(await f.GET()).json();assert.equal(data.balance.remaining_cents,100);assert.equal(data.blocked,true);
 for(const plan of ['paid','weekly_paid']){
  f.stored.plan=plan;f.stored.remaining_cents=100;
  data=await(await f.GET()).json();assert.equal(data.blocked,false);
  f.stored.remaining_cents=0;data=await(await f.GET()).json();assert.equal(data.blocked,true);
 }
});
