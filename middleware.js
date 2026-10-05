// DUSTPAN — server-side page protection (Vercel Routing Middleware)
//
// Runs on Vercel BEFORE any page is served, so a signed-out visitor never
// receives the HTML of a protected page. (Hiding pages with client-side JS
// alone would not be secure: anyone can bypass it.)
//
// How it decides:
//   1. Public pages + static assets (css/js/images)  -> allowed.
//   2. Everything else needs a valid Supabase session. The browser stores the
//      access token in the `dp_access` cookie (see js/auth.js); this file asks
//      Supabase to confirm the token is genuine and unexpired.
//   3. Role (from app_metadata.role, which users cannot edit themselves):
//        customer                       -> only /account.html
//        staff | admin | psp_operator   -> all operations pages
//   Default-deny: any page not listed as public or customer-only is
//   treated as an operations page.
//
// Required Vercel environment variables (Project -> Settings -> Environment Variables):
//   SUPABASE_URL        e.g. https://abcdxyz.supabase.co
//   SUPABASE_ANON_KEY   the project's public anon / publishable key

import { next } from '@vercel/functions';

const COOKIE_NAME = 'dp_access';
const OPS_ROLES = new Set(['staff', 'admin', 'psp_operator']);

// Paths are compared lower-case, without a trailing slash or ".html".
const PUBLIC_PAGES = new Set(['/', '/index', '/login', '/customer-signup']);
const CUSTOMER_PAGES = new Set(['/account']);
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

// Normalise a request path so "/Dashboard.HTML", "/dashboard/" and
// "//dashboard.html" are all judged as "/dashboard". Returns null if the
// path can't be decoded (treated as protected).
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

// Ask Supabase whether the token is valid. Returns:
//   { ok: true, user }     token is valid
//   { ok: false }          token missing/invalid/expired
// Throws if Supabase can't be reached (we then fail closed with a 503).
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

  // Undecodable path: never let it through.
  if (path === null) return redirect('/index.html');

  // Static files (styles, scripts, images) carry no private data.
  if (STATIC_FILE.test(path)) return next();

  const key = pageKey(path);
  if (PUBLIC_PAGES.has(key)) return next();

  // From here on the page is protected.
  const toLogin = () => redirect(`/index.html?next=${encodeURIComponent(path)}`);

  const token = readCookie(request, COOKIE_NAME);
  if (!token) return toLogin();

  let result;
  try {
    result = await verifyToken(token);
  } catch (err) {
    console.error('[dustpan] auth check unavailable:', err.message);
    // Fail closed: don't serve the page if we can't verify the visitor.
    return new Response('Sign-in service is temporarily unavailable. Please try again shortly.', {
      status: 503,
      headers: noStore({ 'Content-Type': 'text/plain; charset=utf-8', 'Retry-After': '30' }),
    });
  }
  if (!result.ok) return toLogin();

  const role = result.user?.app_metadata?.role || 'customer';

  if (OPS_ROLES.has(role)) return next({ headers: noStore() });

  // Customers: only their own account page.
  if (CUSTOMER_PAGES.has(key)) return next({ headers: noStore() });
  return redirect('/account.html');
}
