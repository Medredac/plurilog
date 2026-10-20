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
const pricing = load('src/lib/plusPricing.ts');
// Retain legacy-offer regression coverage; retirement tests below use the actual disabled flag.
const legacyPricing = { ...pricing, INTRO_OFFER_ENABLED: true };
const helpers = load('src/lib/stripeIntroOffer.ts', { './plusPricing': legacyPricing });
const retiredHelpers = load('src/lib/stripeIntroOffer.ts');
const coupon = { valid: true, amount_off: 1000, currency: 'usd', duration: 'repeating', duration_in_months: 3, applies_to: { products: ['prod_plus'] } };
const price = { active: true, unit_amount: 1900, currency: 'usd', recurring: { interval: 'month', interval_count: 1 }, product: 'prod_plus' };

function fixture({ retired = false, user = { id: 'user-1', email: 'test@example.com' }, profile = {}, history = [], invoices = [], failInvoices = false, priceOverride = {}, couponOverride = {}, failHistory = false, nextPayment = 900 } = {}) {
  const calls = [];
  const billingProfile = { plan: 'free', plan_status: null, stripe_customer_id: null, stripe_subscription_id: null, signup_source: 'facebook', ...profile };
  const stripe = {
    subscriptions: { list(args) {
      calls.push(['history', args]);
      return (async function* () { if (failHistory) throw new Error('History unavailable'); yield* history; })();
    } },
    prices: { async retrieve(id) { calls.push(['price', id]); return { ...price, ...priceOverride }; } },
    coupons: { async retrieve(id, args) { calls.push(['coupon', id, args]); return { ...coupon, ...couponOverride }; } },
    checkout: { sessions: { async create(params, options) { calls.push(['checkout', params, options]); return { url: 'https://checkout.stripe.com/test' }; } } },
    invoices: { list(args) { calls.push(['invoices', args]); return (async function* () { if (failInvoices) throw new Error('Invoices unavailable'); yield* invoices; })(); }, async createPreview(args) { calls.push(['invoice', args]); return { currency: 'usd', amount_due: nextPayment }; } },
  };
  const supabase = {
    auth: { async getUser() { return { data: { user } }; } },
    from() { return { select() { return { eq() { return { async single() { return { data: billingProfile, error: null }; } }; } }; } }; },
  };
  const cookieValues = { '_fbp': 'fb.1.test', '_fbc': 'fb.1.click', 'consent': 'granted', 'gclid': 'google-click' };
  const mocks = {
    '@/lib/previewCredits': { initializePreviewCredits: async () => {} },
    '@/lib/stripe': { stripe },
    '@/lib/stripeIntroOffer': retired ? retiredHelpers : helpers,
    '@/utils/supabase/server': { createClient: async () => supabase },
    'next/headers': { cookies: async () => ({ get: name => cookieValues[name] ? { value: cookieValues[name] } : undefined }) },
    '@/lib/metaConversions': { META_CONSENT_COOKIE: 'consent', isMetaSignupSource: () => true, isMetaTrackingAllowedForRequest: () => true, normalizeMetaConsentStatus: value => value },
    '@/lib/googleAds': { GOOGLE_ADS_COOKIE_NAMES: { gclid: 'gclid' }, isGoogleAdsTrackingAllowedForRequest: () => true },
  };
  return { calls, stripe, profile: billingProfile,
    checkout: load('src/app/api/stripe/checkout/route.ts', mocks).POST,
    offer: load('src/app/api/stripe/offer/route.ts', mocks).GET,
  };
}
process.env.STRIPE_PRICE_ID_PLUS = 'price_unchanged_live';
const request = () => new Request('https://preview.example.com/api/stripe/checkout', { method: 'POST' });

test('new subscriber keeps the configured price, gets automatic discount and clear renewal terms', async () => {
  const f = fixture(); const response = await f.checkout(request());
  assert.equal(response.status, 200);
  const [, params, options] = f.calls.find(c => c[0] === 'checkout');
  assert.deepEqual(params.line_items, [{ price: 'price_unchanged_live', quantity: 1 }]);
  assert.deepEqual(params.discounts, [{ coupon: 'plurilog_intro_9usd_3months_v1' }]);
  assert.match(params.custom_text.submit.message, /first 3 months, then \$19/);
  assert.equal(params.customer_email, 'test@example.com');
  assert.equal(params.client_reference_id, 'user-1');
  assert.match(params.success_url, /^https:\/\/preview.example.com\/dashboard/);
  assert.match(options.idempotencyKey, /^checkout:user-1:/);
  assert.equal(params.metadata.plurilog_fbp, 'fb.1.test');
  assert.equal(params.metadata.plurilog_gclid, 'google-click');
  assert.deepEqual(params.metadata, params.subscription_data.metadata);
});

test('a customer with no subscriptions is still eligible; customer is reused', async () => {
  const f = fixture({ profile: { stripe_customer_id: 'cus_existing' } });
  await f.checkout(request());
  const params = f.calls.find(c => c[0] === 'checkout')[1];
  assert.equal(params.customer, 'cus_existing'); assert.ok(params.discounts);
});

const usedDiscount = (couponId = 'plurilog_intro_9usd_3months_v1', amount = 1000) => ({
  total_discount_amounts: [{ amount, discount: { id: 'di_previous', source: { coupon: couponId } } }],
});

test('returning full-price subscribers receive the unused offer, even after an unused coupon was attached', async () => {
  const f = fixture({ profile: { stripe_customer_id: 'cus_old', stripe_subscription_id: 'sub_old' },
    history: [{ status: 'canceled', discounts: ['di_attached_but_unused'] }], invoices: [{ total_discount_amounts: [] }] });
  assert.equal((await f.checkout(request())).status, 200);
  assert.ok(f.calls.find(c => c[0] === 'checkout')[1].discounts);
  assert.equal((await (await f.offer()).json()).amount, 9);
});

test('a paid invoice using this offer prevents a reset, even if it is in older paginated history', async () => {
  const f = fixture({ profile: { stripe_customer_id: 'cus_old' }, history: [{ status: 'canceled' }],
    invoices: [...Array.from({ length: 110 }, () => ({ total_discount_amounts: [] })), usedDiscount()] });
  await f.checkout(request());
  assert.equal(f.calls.find(c => c[0] === 'checkout')[1].discounts, undefined);
  assert.equal((await (await f.offer()).json()).amount, 19);
});

test('unrelated coupons and zero-value discounts do not consume the offer', async () => {
  const f = fixture({ profile: { stripe_customer_id: 'cus_old' }, invoices: [usedDiscount('other_coupon'), usedDiscount(undefined, 0)] });
  assert.equal((await (await f.offer()).json()).amount, 9);
});

test('missing billing account or unreadable invoice history fails closed', async () => {
  for (const options of [
    { profile: { stripe_subscription_id: 'sub_orphan' } },
    { profile: { stripe_customer_id: 'cus_old' }, failInvoices: true },
    { profile: { stripe_customer_id: 'cus_old' }, invoices: [{ total_discount_amounts: [{ amount: 1000, discount: 'di_unexpanded' }] }] },
  ]) {
    const f = fixture(options);
    assert.equal((await f.checkout(request())).status, 503);
    assert.ok(!f.calls.some(c => c[0] === 'checkout'));
  }
});

test('active, pending and past-due Stripe subscriptions block checkout even when profile says free', async () => {
  for (const status of ['active', 'trialing', 'past_due', 'unpaid', 'incomplete', 'paused']) {
    const f = fixture({ profile: { stripe_customer_id: 'cus_existing' }, history: [{ status }] });
    assert.equal((await f.checkout(request())).status, 409);
    assert.ok(!f.calls.some(c => c[0] === 'checkout'));
  }
});

test('paid profile guard and authentication still block duplicate or anonymous checkout', async () => {
  for (const [options, expected] of [[{ user: null }, 401], [{ profile: { plan: 'paid', plan_status: 'active' } }, 400]]) {
    const f = fixture(options); assert.equal((await f.checkout(request())).status, expected);
    assert.equal(f.calls.length, 0);
  }
});

test('wrong price or coupon fails closed instead of charging an advertised $9 customer $19', async () => {
  for (const options of [
    { priceOverride: { unit_amount: 1600 } }, { priceOverride: { currency: 'cad' } },
    { priceOverride: { recurring: { interval: 'year', interval_count: 1 } } },
    { couponOverride: { valid: false } }, { couponOverride: { duration_in_months: 1 } },
    { couponOverride: { applies_to: { products: ['other'] } } },
    { couponOverride: { amount_off: 500 } },
    { profile: { stripe_customer_id: 'cus_existing' }, failHistory: true },
  ]) {
    const f = fixture(options); assert.equal((await f.checkout(request())).status, 503);
    assert.ok(!f.calls.some(c => c[0] === 'checkout'));
  }
});

test('offer is authenticated, private, and matches new-subscriber checkout', async () => {
  const anonymous = fixture({ user: null }); assert.equal((await anonymous.offer()).status, 401);
  assert.equal(anonymous.calls.length, 0);
  const response = await fixture().offer(); const offer = await response.json();
  assert.equal(response.headers.get('Cache-Control'), 'private, no-store');
  assert.equal(offer.amount, 9); assert.match(offer.terms, /then \$19/); assert.equal(offer.canSubscribe, true);
});

test('paid UI uses next actual invoice for intro, post-intro and credit balances; no charge', async () => {
  for (const amount of [900, 1900, 0, 975]) {
    const f = fixture({ profile: { plan: 'paid', stripe_customer_id: 'cus_paid', stripe_subscription_id: 'sub_paid' }, nextPayment: amount });
    const offer = await (await f.offer()).json();
    assert.equal(offer.amount, amount / 100); assert.equal(offer.canSubscribe, false);
    assert.deepEqual(f.calls, [['invoice', { customer: 'cus_paid', subscription: 'sub_paid' }]]);
  }
});

test('canceling subscribers are not promised another renewal', async () => {
  const f = fixture({ profile: { plan: 'paid', plan_status: 'canceling' } });
  const offer = await (await f.offer()).json();
  assert.equal(offer.amount, null); assert.equal(offer.canSubscribe, false);
  assert.match(offer.terms, /will not renew/); assert.equal(f.calls.length, 0);
});

test('repeat checkout preserves stable idempotency for the same verified offer', async () => {
  const f = fixture(); await f.checkout(request()); await f.checkout(request());
  const calls = f.calls.filter(c => c[0] === 'checkout');
  assert.equal(calls[0][2].idempotencyKey, calls[1][2].idempotencyKey);
});

function resumeFixture(options = {}) {
  const f = fixture(options);
  const subscription = { id: 'sub_resuming', status: 'active', customer: 'cus_old', cancel_at: null,
    cancel_at_period_end: false, discounts: [], items: { data: [{ quantity: 1, discounts: [], price: { id: 'price_unchanged_live' } }] } };
  let current = structuredClone(subscription);
  f.stripe.subscriptions.retrieve = async () => { f.calls.push(['retrieve']); return current; };
  f.stripe.subscriptions.update = async (id, params, opts) => {
    f.calls.push(['update', id, params, opts]); current = { ...current, discounts: ['di_applied'] };
  };
  return { ...f, subscription, setCurrent: value => { current = value; },
    resume: (previous = { cancel_at: 1792996540 }) => helpers.applyIntroOnResumption(f.stripe, subscription, previous, 'price_unchanged_live'),
  };
}

test('undoing either form of cancellation applies the offer once, without changing renewal, cancellation or charging', async () => {
  for (const previous of [{ cancel_at: 1792996540 }, { cancel_at_period_end: true }]) {
    const f = resumeFixture({ invoices: [{ total_discount_amounts: [] }] });
    await f.resume(previous); await f.resume(previous);
    const writes = f.calls.filter(c => c[0] === 'update');
    assert.equal(writes.length, 1);
    assert.deepEqual(writes[0], ['update', 'sub_resuming', {
      discounts: [{ coupon: 'plurilog_intro_9usd_3months_v1' }], proration_behavior: 'none',
    }, { idempotencyKey: 'resume-intro:sub_resuming:v1' }]);
  }
});

test('scheduling cancellation and unrelated updates never apply the promotion', async () => {
  for (const previous of [undefined, {}, { cancel_at: null }, { cancel_at_period_end: false }]) {
    const f = resumeFixture(); await helpers.applyIntroOnResumption(f.stripe, f.subscription, previous, 'price_unchanged_live');
    assert.equal(f.calls.length, 0);
  }
  const f = resumeFixture(); f.subscription.cancel_at = 1792996540; await f.resume(); assert.equal(f.calls.length, 0);
});

test('delayed resume events preserve later cancellations, other discounts and other plans', async () => {
  for (const change of [{ cancel_at: 1792996540 }, { status: 'canceled' }, { discounts: ['di_other'] },
    { items: { data: [{ price: { id: 'price_other' }, quantity: 1, discounts: [] }] } }]) {
    const f = resumeFixture(); f.setCurrent({ ...f.subscription, ...change }); await f.resume();
    assert.ok(!f.calls.some(c => c[0] === 'update'));
  }
});

test('resuming cannot reset a used promotion; discount or history failures remain retryable', async () => {
  const used = resumeFixture({ invoices: [usedDiscount()] }); await used.resume();
  assert.ok(!used.calls.some(c => c[0] === 'update'));
  for (const options of [{ failInvoices: true }, { couponOverride: { valid: false } }]) {
    const f = resumeFixture(options); await assert.rejects(f.resume());
    assert.ok(!f.calls.some(c => c[0] === 'update'));
  }
});

test('subscription webhook applies the conditional offer before confirming the account update, and retries failures', async () => {
  for (const failInvoices of [false, true]) {
    const f = resumeFixture({ failInvoices });
    f.stripe.webhooks = { constructEvent: () => ({ type: 'customer.subscription.updated',
      data: { object: f.subscription, previous_attributes: { cancel_at: 1792996540 } } }) };
    const profileUpdates = [];
    const POST = load('src/app/api/stripe/webhook/route.ts', {
      '@/lib/stripe': { stripe: f.stripe }, '@/lib/stripeIntroOffer': helpers,
      '@/lib/metaConversions': {},
      '@/utils/supabase/service': { createServiceClient: () => ({ from: () => ({ update: values => ({
        eq: async (key, value) => { profileUpdates.push({ values, key, value }); return { count: 1, error: null }; },
      }) }) }) },
    }).POST;
    const response = await POST(new Request('https://example.com/api/stripe/webhook', {
      method: 'POST', body: '{}', headers: { 'stripe-signature': 'verified-by-fixture' },
    }));
    assert.equal(response.status, failInvoices ? 500 : 200);
    if (failInvoices) {
      assert.equal(profileUpdates.length, 0);
    } else {
      assert.equal(profileUpdates[0].values.plan_status, 'active');
      assert.equal(profileUpdates[0].value, 'sub_resuming');
      assert.equal(profileUpdates[0].values.remaining_cents, undefined);
      assert.ok(f.calls.some(c => c[0] === 'update'));
    }
  }
});

process.env.STRIPE_PRICE_ID_PLUS_WEEKLY = 'price_weekly';
const weeklyRequest = interval => new Request('https://preview.example.com/api/stripe/checkout', {
  method: 'POST', headers: { 'Content-Type': 'application/json' }, body: JSON.stringify({ interval }),
});
test('weekly checkout charges 499 cents every week without the monthly coupon or trial', async () => {
  const f = fixture({ priceOverride: { unit_amount: 499, recurring: { interval: 'week', interval_count: 1 } } });
  assert.equal((await f.checkout(weeklyRequest('week'))).status, 200);
  const params = f.calls.find(c => c[0] === 'checkout')[1];
  assert.deepEqual(params.line_items, [{ price: 'price_weekly', quantity: 1 }]);
  assert.equal(params.discounts, undefined);
  assert.equal(params.subscription_data.trial_period_days, undefined);
  assert.equal(f.calls.some(c => c[0] === 'coupon'), false);
  assert.match(params.custom_text.submit.message, /4.99 USD billed every week/);
});
test('invalid interval cannot choose an arbitrary Stripe price', async () => {
  const f = fixture();
  assert.equal((await f.checkout(weeklyRequest('year'))).status, 400);
  assert.equal(f.calls.length, 0);
});
test('weekly cannot duplicate an existing monthly subscription', async () => {
  const f = fixture({ profile: { stripe_customer_id: 'cus_existing' }, history: [{ status: 'active' }] });
  assert.equal((await f.checkout(weeklyRequest('week'))).status, 409);
  assert.equal(f.calls.some(c => c[0] === 'checkout'), false);
});
test('preview uses real checkout flow and the selected weekly price', async () => {
  const oldEnv = process.env.VERCEL_ENV;
  const oldRef = process.env.VERCEL_GIT_COMMIT_REF;
  process.env.VERCEL_ENV = 'preview';
  process.env.VERCEL_GIT_COMMIT_REF = 'preview/weekly-paid-entry';
  try {
    const f = fixture({ priceOverride: { unit_amount: 499, recurring: { interval: 'week', interval_count: 1 } } });
    const response = await f.checkout(weeklyRequest('week'));
    assert.equal(response.status, 200);
    const checkout = f.calls.find(c => c[0] === 'checkout');
    assert.deepEqual(checkout[1].line_items, [{ price: 'price_weekly', quantity: 1 }]);
    assert.equal(checkout[1].discounts, undefined);
  } finally {
    if (oldEnv === undefined) delete process.env.VERCEL_ENV; else process.env.VERCEL_ENV = oldEnv;
    if (oldRef === undefined) delete process.env.VERCEL_GIT_COMMIT_REF; else process.env.VERCEL_GIT_COMMIT_REF = oldRef;
  }
});

function lifecycle(interval = 'week') {
  let profile = { id: 'user-1', plan: 'free', plan_status: null, remaining_cents: 0, stripe_customer_id: 'cus_one', stripe_subscription_id: null };
  const end = 1800000000;
  let sub = { id: 'sub_one', customer: 'cus_one', status: 'active', cancel_at: null, cancel_at_period_end: false, discounts: [], items: { data: [{ price: { id: interval === 'week' ? 'price_weekly' : process.env.STRIPE_PRICE_ID_PLUS }, quantity: 1, discounts: [], current_period_end: end }] } };
  const writes = [];
  let event;
  let failWrite = false;
  const db = { from() {
    let values; const filters = [];
    const q = { select() { return q; }, update(v) { values = v; return q; }, eq(k,v) { filters.push([k,v]); return q; }, neq(k,v) { filters.push([k,v,true]); return q; }, is(k,v) { filters.push([k,v]); return q; },
      async single() { return { data: {...profile}, error: null }; }, async maybeSingle() { return { data: {...profile}, error: null }; },
      then(resolve,reject) { const match = filters.every(([k,v,neq]) => neq ? profile[k] !== v : profile[k] === v);
        if (values && match && !failWrite) { writes.push(values); profile = {...profile,...values}; }
        return Promise.resolve({ data: null, error: failWrite ? { message:'db unavailable' } : null, count: match ? 1 : 0 }).then(resolve,reject); }
    };return q;
  } };
  const stripe = { webhooks: { constructEvent() { return event; } }, subscriptions: { async retrieve() { return sub; } } };
  const POST = load('src/app/api/stripe/webhook/route.ts', {
    '@/lib/stripe': { stripe }, '@/lib/stripeIntroOffer': { applyIntroOnResumption: async () => {} },
    '@/utils/supabase/service': { createServiceClient: () => db }, '@/lib/metaConversions': { isMetaSignupSource: () => false },
    'next/server': { NextResponse: { json: (body, init) => Response.json(body, init) }, after() {} },
  }).POST;
  return { end, writes, get profile() { return profile; }, get sub() { return sub; }, setProfile(v) { profile = {...profile,...v}; }, failWrites() { failWrite = true; },
    async send(type, object) { event={type,created:1790000000,data:{object}}; return POST(new Request('https://example.com/api/stripe/webhook',{method:'POST',body:'{}',headers:{'stripe-signature':'fixture'}})); },
    checkout() { return this.send('checkout.session.completed',{client_reference_id:'user-1',subscription:'sub_one',customer:'cus_one',payment_status:'paid'}); },
    invoice(periodEnd) { return this.send('invoice.paid',{id:'in_one',customer:'cus_one',subscription:'sub_one',lines:{data:[{subscription:'sub_one',price:{id:sub.items.data[0].price.id},period:{end:periodEnd}}]}}); }
  };
}
for (const interval of ['week','month']) {
  test(`${interval}: initial 900, exact Stripe period, duplicate checkout and invoice do not restore spent credit`, async () => {
    const f=lifecycle(interval); assert.equal((await f.checkout()).status,200);
    assert.equal(f.profile.plan,interval==='week'?'weekly_paid':'paid'); assert.equal(f.profile.remaining_cents,900);
    assert.equal(f.profile.current_period_end,new Date(f.end*1000).toISOString());
    f.setProfile({remaining_cents:350}); await f.checkout(); await f.invoice(f.end); assert.equal(f.profile.remaining_cents,350);
    const next=f.end+(interval==='week'?7:30)*86400; f.sub.items.data[0].current_period_end=next;
    await f.invoice(next); assert.equal(f.profile.remaining_cents,900); assert.equal(f.profile.period_reset_at,new Date(next*1000).toISOString());
    f.setProfile({remaining_cents:250}); await f.invoice(next); assert.equal(f.profile.remaining_cents,250);
  });
  test(`${interval}: canceling retains credits and expiry, deleted becomes free with zero, stale invoice cannot revive`,async()=>{
    const f=lifecycle(interval); await f.checkout(); f.setProfile({remaining_cents:260});
    f.sub.cancel_at_period_end=true; await f.send('customer.subscription.updated',f.sub);
    assert.equal(f.profile.plan_status,'canceling'); assert.equal(f.profile.remaining_cents,260);
    assert.equal(f.profile.current_period_end,new Date(f.end*1000).toISOString());
    await f.send('customer.subscription.deleted',f.sub); assert.equal(f.profile.plan,'free'); assert.equal(f.profile.plan_status,'canceled'); assert.equal(f.profile.remaining_cents,0);
    await f.invoice(f.end+7*86400); await f.checkout(); assert.equal(f.profile.plan,'free'); assert.equal(f.profile.remaining_cents,0);
  });
}
test('weekly profile gets Plus billing UI and cannot open a duplicate checkout',async()=>{
  const f=fixture({profile:{plan:'weekly_paid',plan_status:'active'}});
  assert.equal((await f.checkout(weeklyRequest('week'))).status,400);
  const offer=await (await f.offer()).json(); assert.equal(offer.amount,4.99); assert.equal(offer.canSubscribe,false);
});
test('unpaid checkout does not grant Plus or credits',async()=>{
  const f=lifecycle(); await f.send('checkout.session.completed',{client_reference_id:'user-1',subscription:'sub_one',payment_status:'unpaid'});
  assert.equal(f.writes.length,0);
});

test('canceling stays canceling on invoice replay; old failures cannot undo a successful payment', async () => {
  const f=lifecycle(); await f.checkout(); f.sub.cancel_at_period_end=true;
  await f.send('customer.subscription.updated',f.sub); await f.invoice(f.end);
  assert.equal(f.profile.plan_status,'canceling');
  await f.send('invoice.payment_failed',{subscription:'sub_one'});
  assert.equal(f.profile.plan_status,'canceling');
});
test('database failures on renewal, cancellation and payment failure return 500 for Stripe retry',async()=>{
  for(const type of ['invoice.paid','invoice.payment_failed','customer.subscription.updated','customer.subscription.deleted']){
    const f=lifecycle(); await f.checkout(); f.failWrites();
    if(type==='invoice.payment_failed') f.sub.status='past_due';
    const response=type==='invoice.paid'?await f.invoice(f.end+7*86400):await f.send(type,type.startsWith('invoice')?{subscription:'sub_one'}:f.sub);
    assert.equal(response.status,500,type);
  }
});
test('switching updates the paid tier only on the paid invoice and stale invoices cannot reverse it',async()=>{
  for(const initial of ['week','month']){
    const f=lifecycle(initial); await f.checkout(); f.setProfile({remaining_cents:130});
    const oldPrice=f.sub.items.data[0].price.id;
    const next=f.end+(initial==='week'?30:7)*86400;
    f.sub.items.data[0].price.id=initial==='week'?process.env.STRIPE_PRICE_ID_PLUS:'price_weekly';
    f.sub.items.data[0].current_period_end=next;
    await f.send('customer.subscription.updated',f.sub);
    assert.equal(f.profile.plan,initial==='week'?'weekly_paid':'paid'); assert.equal(f.profile.remaining_cents,130);
    // Monthly's legacy fallback may run before Stripe delivers the new weekly invoice.
    if(initial==='month') f.setProfile({period_reset_at:new Date((f.end+30*86400)*1000).toISOString()});
    await f.invoice(next); assert.equal(f.profile.plan,initial==='week'?'paid':'weekly_paid'); assert.equal(f.profile.remaining_cents,900);
    assert.equal(f.profile.period_reset_at,new Date(next*1000).toISOString());
    f.setProfile({remaining_cents:300}); await f.invoice(next); assert.equal(f.profile.remaining_cents,300);
    await f.send('invoice.paid',{subscription:'sub_one',lines:{data:[{price:{id:oldPrice},period:{end:f.end}}]}});
    assert.equal(f.profile.plan,initial==='week'?'paid':'weekly_paid'); assert.equal(f.profile.remaining_cents,300);
  }
});

test('mid-month weekly switch uses the new weekly line, not the later-ending monthly refund',async()=>{
  const f=lifecycle('month'); await f.checkout(); f.setProfile({remaining_cents:130});
  const oldPrice=f.sub.items.data[0].price.id;
  const next=f.end-8*86400;
  f.sub.items.data[0].price.id='price_weekly';
  f.sub.items.data[0].current_period_end=next;
  const invoice={id:'in_switch',subscription:'sub_one',lines:{data:[
    {amount:-465,pricing:{price_details:{price:oldPrice}},period:{end:f.end}},
    {amount:428,pricing:{price_details:{price:'price_weekly'}},period:{end:next}},
  ]}};
  assert.equal((await f.send('invoice.paid',invoice)).status,200);
  assert.equal(f.profile.plan,'weekly_paid');
  assert.equal(f.profile.current_period_end,new Date(next*1000).toISOString());
  assert.equal(f.profile.period_reset_at,new Date(next*1000).toISOString());
  assert.equal(f.profile.remaining_cents,900);
  f.setProfile({remaining_cents:300}); await f.send('invoice.paid',invoice);
  assert.equal(f.profile.remaining_cents,300);
});

const switching=load('src/lib/stripePlanSwitch.ts', { './plusPricing': legacyPricing, './stripeIntroOffer': helpers });
function switchFixture(interval='month', usedIntro=false){
  const end=Math.floor(Date.now()/1000)+7*86400;
  const sub={id:'sub_switch',customer:'cus_one',status:'active',cancel_at:null,cancel_at_period_end:false,items:{data:[{
    quantity:1,price:{id:interval==='week'?'price_weekly':process.env.STRIPE_PRICE_ID_PLUS},current_period_end:end,
  }]}};
  const phase={start_date:end-7*86400,end_date:end,items:[{price:sub.items.data[0].price.id,quantity:1,discounts:[]}],discounts:[{discount:'di_running'}],metadata:{attribution:'kept'},automatic_tax:{enabled:false},default_payment_method:'pm_kept'};
  const schedule={id:'sched_one',status:'active',current_phase:{start_date:phase.start_date,end_date:end},phases:[phase],metadata:{}};
  const calls=[];
  const stripe={subscriptions:{async retrieve(){return sub;}},prices:{async retrieve(id){return {...price,unit_amount:id==='price_weekly'?499:1900,recurring:{interval:id==='price_weekly'?'week':'month',interval_count:1}};}},coupons:{async retrieve(){return coupon;}},
    invoices:{list(){return (async function*(){if(usedIntro)yield usedDiscount();})();}},
    subscriptionSchedules:{async create(params,opts){calls.push(['create',params,opts]);return schedule;},async update(id,params,opts){calls.push(['update',id,params,opts]);schedule.metadata=params.metadata;schedule.phases=params.phases;return schedule;},async release(id){calls.push(['release',id]);}}
  };
  return {sub,schedule,stripe,calls,end};
}
for(const interval of ['week','month'])test(`switch from ${interval} keeps current price/discount and schedules the other interval at period end`,async()=>{
  const f=switchFixture(interval);
  const result=await switching.schedulePlanSwitch(f.stripe,f.sub,null,interval==='week'?'month':'week','unique-operation-123');
  const params=f.calls.find(c=>c[0]==='update')[2];
  assert.equal(params.proration_behavior,'none'); assert.equal(params.end_behavior,'release');
  assert.equal(params.phases[0].end_date,f.end); assert.equal(params.phases[0].items[0].price,f.sub.items.data[0].price.id);
  assert.deepEqual(params.phases[0].discounts,[{discount:'di_running'}]); assert.equal(params.phases[0].default_payment_method,'pm_kept');
  assert.equal(params.phases[1].start_date,f.end); assert.equal(params.phases[1].proration_behavior,'none');
  assert.equal(params.phases[1].billing_cycle_anchor,'phase_start');
  assert.equal(params.phases[1].duration.interval,interval==='week'?'month':'week');
  assert.deepEqual(params.phases[1].discounts,interval==='week'?[{coupon:'plurilog_intro_9usd_3months_v1'}]:'');
  assert.equal(result.pending,true);
  await switching.schedulePlanSwitch(f.stripe,f.sub,f.schedule,result.interval,'unique-operation-123');
  assert.equal(f.calls.filter(c=>c[0]==='update').length,1);
  await switching.undoPlanSwitch(f.stripe,f.schedule);assert.deepEqual(f.calls.at(-1),['release','sched_one']);
});
test('switch to monthly does not restart an already used introduction',async()=>{
  const f=switchFixture('week',true);
  const result=await switching.schedulePlanSwitch(f.stripe,f.sub,null,'month','unique-operation-123');
  assert.equal(result.amount,19);assert.equal(f.calls.find(c=>c[0]==='update')[2].phases[1].discounts,'');
});
test('switch refuses canceling, unpaid, unrelated schedules and a changed billing customer',async()=>{
  for(const change of [{cancel_at_period_end:true},{status:'past_due'}]){
    const f=switchFixture();Object.assign(f.sub,change);
    await assert.rejects(switching.schedulePlanSwitch(f.stripe,f.sub,null,'week','unique-operation-123'));assert.equal(f.calls.length,0);
  }
  const f=switchFixture();await assert.rejects(switching.schedulePlanSwitch(f.stripe,f.sub,f.schedule,'week','unique-operation-123'));
  await assert.rejects(switching.undoPlanSwitch(f.stripe,f.schedule));assert.equal(f.calls.length,0);
  await assert.rejects(switching.loadSwitchSubscription(f.stripe,'sub_switch','cus_wrong'));
});
test('failed schedule configuration releases the new empty schedule without canceling the subscription',async()=>{
  const f=switchFixture();f.stripe.subscriptionSchedules.update=async()=>{throw new Error('Stripe unavailable');};
  await assert.rejects(switching.schedulePlanSwitch(f.stripe,f.sub,null,'week','unique-operation-123'));
  assert.deepEqual(f.calls.at(-1),['release','sched_one']);assert.equal(f.sub.status,'active');
});

test('concurrent duplicate checkout and renewal cannot both grant credits',async()=>{
  const f=lifecycle();
  await Promise.all([f.checkout(),f.checkout()]);
  assert.equal(f.writes.filter(v=>v.remaining_cents===900).length,1);
  f.setProfile({remaining_cents:220}); await f.checkout();assert.equal(f.profile.remaining_cents,220);
  const end=f.end+7*86400; f.sub.items.data[0].current_period_end=end;
  await Promise.all([f.invoice(end),f.invoice(end)]);
  assert.equal(f.writes.filter(v=>v.remaining_cents===900).length,2);
  f.setProfile({remaining_cents:200});await f.invoice(end);assert.equal(f.profile.remaining_cents,200);
});

test('account settings render a manually assigned weekly tier as weekly Plus, with expiry on cancellation',()=>{
  const React=require('react');const {renderToStaticMarkup}=require('react-dom/server');
  const filename=path.resolve('src/components/AccountSettingsModal.tsx');
  const mod=new Module(filename,module);mod.paths=module.paths;
  mod.require=id=>{
    if(id==='./PlanSwitchControls')return{PlanSwitchControls:()=>null};
    if(id==='./PlusPlanCards')return{PlusPlanCards:()=>null};
    if(id==='./ResetPasswordModal')return{ResetPasswordModal:()=>null};
    if(id==='@/hooks/usePlusOffer')return{usePlusOffer:()=>({offer:{amount:9},error:null})};
    if(id==='@/utils/supabase/client')return{};
    if(id==='@/lib/plusFeatures')return{PLUS_FEATURES:['Unlimited use']};
    return require(id);
  };
  mod._compile(ts.transpileModule(fs.readFileSync(filename,'utf8'),{compilerOptions:{module:ts.ModuleKind.CommonJS,jsx:ts.JsxEmit.ReactJSX,esModuleInterop:true}}).outputText,filename);
  const props={isOpen:true,displayName:'Test',userPlan:'weekly_paid',planStatus:'canceling',periodResetAt:'2026-10-26T12:00:00Z',onClose(){},onDeleteAccountClick(){}};
  const weekly=renderToStaticMarkup(React.createElement(mod.exports.AccountSettingsModal,props));
  assert.match(weekly,/Plus · Weekly/);assert.match(weekly,/4.99 \/ week/);assert.match(weekly,/Expires/);assert.doesNotMatch(weekly,/>Free</);
  const monthly=renderToStaticMarkup(React.createElement(mod.exports.AccountSettingsModal,{...props,userPlan:'paid',planStatus:'active'}));
  assert.match(monthly,/Plus · Monthly/);assert.match(monthly,/9 next payment/);assert.match(monthly,/Renews/);
});

// Current pricing: no new discounts, existing subscription state remains intact.
test('retired offer: new and returning monthly checkout charges the full price without coupon lookups', async () => {
  for (const profile of [{}, {stripe_customer_id:'cus_old', stripe_subscription_id:'sub_old'}]) {
    const f=fixture({retired:true,profile,history:[{status:'canceled'}],failInvoices:true});
    assert.equal((await f.checkout(request())).status,200);
    const params=f.calls.find(c=>c[0]==='checkout')[1];
    assert.equal(params.discounts,undefined);
    assert.equal(params.allow_promotion_codes,undefined);
    assert.equal(params.line_items[0].price,process.env.STRIPE_PRICE_ID_PLUS);
    assert.equal((await (await f.offer()).json()).amount,19);
    assert.equal(f.calls.some(c=>['coupon','invoices'].includes(c[0])),false);
  }
});
test('retired offer: active-subscription guard still blocks duplicate purchases', async () => {
  const f=fixture({retired:true,profile:{stripe_customer_id:'cus_active'},history:[{status:'active'}]});
  assert.equal((await f.checkout(request())).status,409);
  assert.equal(f.calls.some(c=>c[0]==='checkout'),false);
});
test('retired offer: resuming never adds or removes a discount, including existing promotions', async () => {
  for(const discounts of [[],['di_existing_intro']]) {
    const f=resumeFixture(); f.subscription.discounts=discounts;
    await retiredHelpers.applyIntroOnResumption(f.stripe,f.subscription,{cancel_at_period_end:true},process.env.STRIPE_PRICE_ID_PLUS);
    assert.equal(f.calls.length,0);
    assert.deepEqual(f.subscription.discounts,discounts);
    assert.deepEqual(await retiredHelpers.introCheckoutDiscount(f.stripe,process.env.STRIPE_PRICE_ID_PLUS,true),{});
  }
});
test('retired offer: existing paid users still see their discounted actual invoice', async () => {
  const f=fixture({retired:true,profile:{plan:'paid',stripe_customer_id:'cus_paid',stripe_subscription_id:'sub_paid'},nextPayment:900});
  assert.equal((await (await f.offer()).json()).amount,9);
});
test('retired offer: legacy switching helper cannot create another promotion', async () => {
  const f=switchFixture('week');
  const current=load('src/lib/stripePlanSwitch.ts');
  const result=await current.schedulePlanSwitch(f.stripe,f.sub,null,'month','retired-offer-switch');
  assert.equal(result.amount,19);
  assert.equal(f.calls.find(c=>c[0]==='update')[2].phases[1].discounts,'');
});
