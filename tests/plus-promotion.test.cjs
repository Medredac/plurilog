const { test } = require('node:test');
const assert = require('node:assert/strict');
const fs = require('node:fs');
const path = require('node:path');
const Module = require('node:module');
const ts = require('typescript');

function load(file, mocks = {}) {
  const filename = path.resolve(file);
  const mod = new Module(filename, module);
  mod.filename = filename; mod.paths = module.paths;
  mod.require = id => {
    if (Object.hasOwn(mocks, id)) return mocks[id];
    if (id.startsWith('@/')) return load(`src/${id.slice(2)}.ts`, mocks);
    if (id.startsWith('.')) return load(path.resolve(path.dirname(filename), id) + '.ts', mocks);
    return require(id);
  };
  mod._compile(ts.transpileModule(fs.readFileSync(filename, 'utf8'), {
    compilerOptions: { module: ts.ModuleKind.CommonJS, target: ts.ScriptTarget.ES2022, esModuleInterop: true },
  }).outputText, filename);
  return mod.exports;
}

const KEY = 'plus_promotion_9_3_v1_dismissed';
function fixture({user = {id: 'u1', user_metadata: {}}, profile = {plan: 'free'}, used = false, failSave = false, canceling = true} = {}) {
  const writes = [];
  const auth = {getUser: async () => ({data: {user}}), updateUser: async args => {writes.push(args); if (!failSave) Object.assign(user.user_metadata, args.data); return {error: failSave ? new Error('offline') : null};}};
  const subscription = {customer: 'cus1', status: 'active', cancel_at_period_end: canceling, items: {data: [{price: {id:'price1'},quantity:1,discounts:[]}]}, discounts:[]};
  const route = load('src/app/api/user/plus-promotion/route.ts', {
    '@/utils/supabase/server': {createClient: async () => ({auth, from: () => ({select: () => ({eq: () => ({single: async () => ({data: profile})})})})})},
    '@/lib/stripe': {stripe: {subscriptions: {retrieve: async () => subscription}}},
    '@/lib/stripeIntroOffer': {hasUsedIntro: async () => used, introCheckoutDiscount: async () => ({})},
  });
  return {...route, writes, user};
}
process.env.STRIPE_PRICE_ID_PLUS = 'price1';
test('anonymous requests cannot read or dismiss an account promotion', async () => {
  const f=fixture({user:null}); assert.equal((await f.GET()).status,401); assert.equal((await f.POST()).status,401); assert.equal(f.writes.length,0);
});
test('dismissal survives another request and does not affect another account or existing metadata', async () => {
  const first=fixture({user:{id:'first',user_metadata:{name:'Existing'}}});
  assert.equal((await first.GET()).status,200);
  assert.equal((await first.POST()).status,200);
  assert.deepEqual(await (await first.GET()).json(),{dismissed:true});
  assert.equal(first.user.user_metadata.name,'Existing');
  assert.deepEqual(await (await fixture().GET()).json(),{dismissed:false});
  await first.POST(); assert.equal(first.writes.length,1);
});
test('failed persistence is reported instead of claiming permanent dismissal', async () => {
  assert.equal((await fixture({failSave:true}).POST()).status,503);
});
test('active Plus users do not receive a promotion', async () => {
  assert.deepEqual(await (await fixture({profile:{plan:'paid',plan_status:'active'}}).GET()).json(),{dismissed:false,activePlus:true});
});
const cancelProfile={plan:'paid',plan_status:'canceling',stripe_customer_id:'cus1',stripe_subscription_id:'sub1'};
test('unused promotion on a canceling subscription offers renewal without writing billing state', async () => {
  const f=fixture({profile:cancelProfile}); const body=await (await f.GET()).json();
  assert.equal(body.renewalOffer.amount,9); assert.match(body.renewalOffer.terms,/next 3/); assert.equal(f.writes.length,0);
});
test('used promotion or stale cancellation state never advertises a fresh discount', async () => {
  for(const extra of [{used:true},{canceling:false}]) assert.equal((await (await fixture({profile:cancelProfile,...extra}).GET()).json()).activePlus,true);
});
