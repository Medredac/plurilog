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
const helpers = load('src/lib/stripeIntroOffer.ts');
const coupon = { valid: true, amount_off: 1000, currency: 'usd', duration: 'repeating', duration_in_months: 3, applies_to: { products: ['prod_plus'] } };
const price = { active: true, unit_amount: 1900, currency: 'usd', recurring: { interval: 'month', interval_count: 1 }, product: 'prod_plus' };

function fixture({ user = { id: 'user-1', email: 'test@example.com' }, profile = {}, history = [], invoices = [], failInvoices = false, priceOverride = {}, couponOverride = {}, failHistory = false, nextPayment = 900 } = {}) {
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
    '@/lib/stripe': { stripe },
    '@/lib/stripeIntroOffer': helpers,
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
