// DUSTPAN — server-side page protection (Vercel Routing Middleware)
//
// Runs on Vercel BEFORE any page is served, so a signed-out visitor never
// receives the HTML of a protected page.
//
// Required Vercel env vars:
//   SUPABASE_URL
//   SUPABASE_ANON_KEY

import { next } from '@vercel/functions';

const COOKIE_NAME = 'dp_access';
const OPS_ROLES = new Set(['staff', 'admin', 'psp_operator']);

const PUBLIC_PAGES = new Set(['/', '/index', '/login', '/customer-signup']);
const CUSTOMER_PAGES = new Set([
  '/account',
  '/wallet',
  '/deposit',
  '/transactions',
  '/trade',
  '/redeem',
  '/impact',
  '/profile',
]);
const STATIC_FILE = /\.(?:png|jpe?g|gif|svg|webp|ico|css|js|map|woff2?|ttf)$/;

export const config = {
  runtime: 'nodejs',
  matcher: ['/((?!_vercel|\\.well-known).*)'],
};

function noStore(headers = {}) {
  return { 'Cache-Control': 'private, no-store', ...headers };
}

function redirect(location) {
  return new Response(null, { status: 302, headers: noStore({ Location: location }) });
}

function readCookie(request, name) {
  const header = request.headers.get('cookie') || '';
  for (const part of header.split(';')) {
    const i = part.indexOf('=');
    if (i > -1 && part.slice(0, i).trim() === name) return part.slice(i + 1).trim();
  }
  return null;
}

function normalise(pathname) {
  let p;
  try {
    p = decodeURIComponent(pathname);
  } catch {
    return null;
  }
  p = p.toLowerCase().replace(/\/+/g, '/');
  return p;
}

function pageKey(p) {
  let key = p.length > 1 ? p.replace(/\/$/, '') : p;
  key = key.replace(/\.html$/, '');
  return key || '/';
}

async function verifyToken(token) {
  const base = (process.env.SUPABASE_URL || '').replace(/\/$/, '');
  const anon = process.env.SUPABASE_ANON_KEY || '';
  if (!base || !anon) throw new Error('SUPABASE_URL / SUPABASE_ANON_KEY are not set');

  const res = await fetch(`${base}/auth/v1/user`, {
    headers: { apikey: anon, Authorization: `Bearer ${token}` },
    signal: AbortSignal.timeout(5000),
  });
  if (res.status === 401 || res.status === 403) return { ok: false };
  if (!res.ok) throw new Error(`Supabase auth check failed with ${res.status}`);
  return { ok: true, user: await res.json() };
}

export default async function middleware(request) {
  const url = new URL(request.url);
  const path = normalise(url.pathname);

  if (path === null) return redirect('/index.html');
  if (STATIC_FILE.test(path)) return next();

  const key = pageKey(path);
  if (PUBLIC_PAGES.has(key)) return next();

  const toLogin = () => redirect(`/index.html?next=${encodeURIComponent(path)}`);

  const token = readCookie(request, COOKIE_NAME);
  if (!token) return toLogin();

  let result;
  try {
    result = await verifyToken(token);
  } catch (err) {
    console.error('[dustpan] auth check unavailable:', err.message);
    return new Response('Sign-in service is temporarily unavailable. Please try again shortly.', {
      status: 503,
      headers: noStore({ 'Content-Type': 'text/plain; charset=utf-8', 'Retry-After': '30' }),
    });
  }
  if (!result.ok) return toLogin();

  const role = result.user?.app_metadata?.role || 'customer';

  if (OPS_ROLES.has(role)) return next({ headers: noStore() });
  if (CUSTOMER_PAGES.has(key)) return next({ headers: noStore() });
  return redirect('/account.html');
}
