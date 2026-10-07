// DUSTPAN — sign up / sign in / session helpers (Supabase Auth)
//
// The session lives in the browser (so returning customers are recognised) and
// the access token is mirrored into the `dp_access` cookie so middleware.js can
// lock pages on the server.

import { createClient } from 'https://cdn.jsdelivr.net/npm/@supabase/supabase-js@2/+esm';
import { SUPABASE_URL, SUPABASE_ANON_KEY } from './config.js';

export const OPS_ROLES = ['staff', 'admin', 'psp_operator'];
const COOKIE = 'dp_access';
const REMEMBER_KEY = 'dp_remember';

export const isConfigured = !/YOUR-/.test(`${SUPABASE_URL}${SUPABASE_ANON_KEY}`);

// ---- storage: "Remember me" ticked -> localStorage, otherwise sessionStorage ----
function store() {
  try {
    return localStorage.getItem(REMEMBER_KEY) === '0' ? sessionStorage : localStorage;
  } catch {
    return null;
  }
}
const storage = {
  getItem: (k) => store()?.getItem(k) ?? null,
  setItem: (k, v) => store()?.setItem(k, v),
  removeItem: (k) => {
    try { localStorage.removeItem(k); sessionStorage.removeItem(k); } catch { /* ignore */ }
  },
};

export const supabase = isConfigured
  ? createClient(SUPABASE_URL, SUPABASE_ANON_KEY, {
      auth: { storage, persistSession: true, autoRefreshToken: true, detectSessionInUrl: false },
    })
  : null;

function requireClient() {
  if (!supabase) {
    throw new Error("Dustpan sign-in isn't set up yet. Add your Supabase details in js/config.js (see README).");
  }
  return supabase;
}

// ---- cookie mirror for server-side page protection ----
function writeCookie(session) {
  const secure = location.protocol === 'https:' ? '; Secure' : '';
  if (!session) {
    document.cookie = `${COOKIE}=; Max-Age=0; Path=/; SameSite=Lax${secure}`;
    return;
  }
  const seconds = Math.max(60, (session.expires_at ?? 0) - Math.floor(Date.now() / 1000));
  document.cookie = `${COOKIE}=${session.access_token}; Max-Age=${seconds}; Path=/; SameSite=Lax${secure}`;
}
supabase?.auth.onAuthStateChange((_event, session) => writeCookie(session));

// ---- helpers ----
export function friendlyError(error) {
  const msg = String(error?.message || error || '');
  if (/invalid login credentials/i.test(msg)) return 'Wrong email or password. Please try again.';
  if (/email not confirmed/i.test(msg)) return 'Please confirm your email first. Check your inbox for our message.';
  if (/already registered|already been registered/i.test(msg)) return 'That email already has an account. Try signing in instead.';
  if (/password.*(short|least|weak)/i.test(msg)) return 'Please choose a longer password (at least 8 characters).';
  if (/rate limit|too many/i.test(msg)) return 'Too many attempts. Please wait a minute and try again.';
  if (/failed to fetch|network|load failed/i.test(msg)) return "Can't reach Dustpan right now. Check your internet connection and try again.";
  return msg || 'Something went wrong. Please try again.';
}

export function roleOf(user) {
  return user?.app_metadata?.role || 'customer';
}

export function displayName(user) {
  return user?.user_metadata?.full_name || user?.email || 'Account';
}

// Only allow redirects to a single local .html page (blocks open-redirect tricks).
export function safeNext(next) {
  if (typeof next !== 'string') return null;
  const m = /^\/?([A-Za-z0-9_-]+\.html)$/.exec(next.trim());
  return m ? m[1] : null;
}

export function destinationFor(role, next) {
  const wanted = safeNext(next);
  if (OPS_ROLES.includes(role)) return wanted || 'dashboard.html';
  return 'account.html'; // customers only ever have one page
}

// ---- session ----
// Returns the signed-in user, or null. Refreshes an expired token if the
// browser still holds a valid refresh token (this is how returning customers
// are recognised) and re-syncs the server cookie.
export async function currentUser() {
  if (!supabase) return null;
  const { data: sessionData } = await supabase.auth.getSession();
  if (!sessionData?.session) {
    writeCookie(null);
    return null;
  }
  writeCookie(sessionData.session);
  const { data, error } = await supabase.auth.getUser();
  if (error || !data?.user) {
    writeCookie(null);
    return null;
  }
  return data.user;
}

export async function signUpCustomer({ fullName, phone, email, password, zone, address }) {
  const client = requireClient();
  try { localStorage.setItem(REMEMBER_KEY, '1'); } catch { /* ignore */ }
  const { data, error } = await client.auth.signUp({
    email,
    password,
    options: {
      data: {
        full_name: fullName,
        phone,
        zone,
        address,
        consent_at: new Date().toISOString(),
      },
    },
  });
  if (error) throw error;
  // Supabase returns an empty identities list (no error) when the email is already taken.
  if (data.user && Array.isArray(data.user.identities) && data.user.identities.length === 0) {
    throw new Error('That email already has an account. Try signing in instead.');
  }
  if (data.session) {
    writeCookie(data.session);
    return { signedIn: true, user: data.user };
  }
  return { signedIn: false, user: data.user }; // email confirmation required
}

export async function signIn(email, password, remember) {
  const client = requireClient();
  try { localStorage.setItem(REMEMBER_KEY, remember ? '1' : '0'); } catch { /* ignore */ }
  const { data, error } = await client.auth.signInWithPassword({ email, password });
  if (error) throw error;
  writeCookie(data.session);
  return data.user;
}

export async function signOut() {
  try {
    await supabase?.auth.signOut();
  } finally {
    writeCookie(null);
    try { sessionStorage.removeItem('dp_autoredirect'); } catch { /* ignore */ }
  }
}

// ---- stored customer details (table: public.profiles, protected by RLS) ----
export async function getProfile(userId) {
  const run = (cols) => requireClient().from('profiles').select(cols).eq('id', userId).maybeSingle();
  let { data, error } = await run('full_name, phone, email, zone, address, created_at, customer_id');
  // Before supabase/wallet.sql has been run there is no customer_id column: retry without it.
  if (error && /customer_id/i.test(`${error.message} ${error.details || ''}`)) {
    console.warn('[dustpan] profiles.customer_id is missing - run supabase/wallet.sql');
    ({ data, error } = await run('full_name, phone, email, zone, address, created_at'));
  }
  if (error) {
    console.error('[dustpan] profiles:', error);
    throw error;
  }
  return data;
}

export async function updateProfile(userId, { full_name, phone, zone, address }) {
  const { error } = await requireClient()
    .from('profiles')
    .update({ full_name, phone, zone, address, updated_at: new Date().toISOString() })
    .eq('id', userId);
  if (error) throw error;
}
