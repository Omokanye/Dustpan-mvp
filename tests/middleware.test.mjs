// Run with: npm test   (needs `npm install` first)
// Checks the page-protection rules in middleware.js using a fake Supabase.
import test from 'node:test';
import assert from 'node:assert/strict';
import middleware from '../middleware.js';

process.env.SUPABASE_URL = 'https://fake.supabase.test';
process.env.SUPABASE_ANON_KEY = 'anon-key';

const USERS = {
  'customer-token': { id: '1', email: 'c@example.com', app_metadata: { role: 'customer' } },
  'norole-token': { id: '2', email: 'n@example.com', app_metadata: {} },
  'staff-token': { id: '3', email: 's@example.com', app_metadata: { role: 'staff' } },
  'admin-token': { id: '4', email: 'a@example.com', app_metadata: { role: 'admin' } },
};

let supabaseDown = false;
const realFetch = globalThis.fetch;
globalThis.fetch = async (input, init = {}) => {
  const u = String(input);
  if (!u.startsWith('https://fake.supabase.test/auth/v1/user')) return realFetch(input, init);
  if (supabaseDown) throw new Error('network down');
  const token = (init.headers?.Authorization || '').replace('Bearer ', '');
  const user = USERS[token];
  return user
    ? new Response(JSON.stringify(user), { status: 200 })
    : new Response(JSON.stringify({ msg: 'bad jwt' }), { status: 403 });
};

const call = (path, token) =>
  middleware(new Request(`https://dustpan.test${path}`, {
    headers: token ? { cookie: `theme=x; dp_access=${token}; other=1` } : {},
  }));
const allowed = (res) => res.headers.get('x-middleware-next') === '1';
const redirectsTo = (res) => (res.status === 302 ? res.headers.get('location') : null);

const OPS_PAGES = ['dashboard', 'customers', 'collections', 'payments', 'waivers', 'staffs', 'settings', 'reports'];

test('public pages and static assets need no login', async () => {
  for (const p of ['/', '/index.html', '/login.html', '/customer-signup.html', '/assets/logo.png', '/style.css', '/js/auth.js', '/script.js']) {
    assert.ok(allowed(await call(p)), `${p} should be public`);
  }
});

test('signed-out visitors are redirected to sign in from every protected page', async () => {
  for (const name of OPS_PAGES.concat('account')) {
    const res = await call(`/${name}.html`);
    assert.equal(redirectsTo(res), `/index.html?next=${encodeURIComponent(`/${name}.html`)}`, name);
  }
});

test('path tricks do not bypass the lock', async () => {
  for (const p of ['/dashboard', '/DASHBOARD.HTML', '/Dashboard.html', '//dashboard.html', '/dashboard.html/', '/%64ashboard.html', '/customers/', '/unknown-new-page.html', '/%E0%A4%A']) {
    const res = await call(p);
    assert.ok(!allowed(res), `${p} must not be served to a signed-out visitor`);
    assert.equal(res.status, 302, p);
  }
});

test('forged, garbage or expired tokens are rejected', async () => {
  for (const t of ['garbage', 'expired-token', '']) {
    const res = await call('/dashboard.html', t);
    assert.equal(res.status, 302, `token "${t}"`);
  }
});

test('customers can open their account page only', async () => {
  assert.ok(allowed(await call('/account.html', 'customer-token')));
  for (const name of OPS_PAGES) {
    assert.equal(redirectsTo(await call(`/${name}.html`, 'customer-token')), '/account.html', name);
  }
});

test('a user with no role is treated as a customer, never staff', async () => {
  assert.ok(allowed(await call('/account.html', 'norole-token')));
  assert.equal(redirectsTo(await call('/payments.html', 'norole-token')), '/account.html');
});

test('staff and admins can open operations pages', async () => {
  for (const token of ['staff-token', 'admin-token']) {
    for (const name of OPS_PAGES) assert.ok(allowed(await call(`/${name}.html`, token)), `${token} ${name}`);
  }
});

test('protected responses are not cached', async () => {
  assert.match((await call('/dashboard.html', 'staff-token')).headers.get('cache-control') || '', /no-store/);
  assert.match((await call('/dashboard.html')).headers.get('cache-control') || '', /no-store/);
});

test('fails closed (503) if Supabase is unreachable or env vars are missing', async () => {
  supabaseDown = true;
  assert.equal((await call('/dashboard.html', 'staff-token')).status, 503);
  supabaseDown = false;

  const saved = process.env.SUPABASE_URL;
  delete process.env.SUPABASE_URL;
  assert.equal((await call('/dashboard.html', 'staff-token')).status, 503);
  process.env.SUPABASE_URL = saved;
});
