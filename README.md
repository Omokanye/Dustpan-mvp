# DUSTPAN — Plastics for Bitcoin rewards + waste operations

Customers sign up, trade in plastics at a drop-off point and earn Bitcoin rewards.
Staff and operators run collections, customers, payments and waivers from a dashboard.

Plain HTML + Tailwind CSS (CDN) + vanilla JavaScript. Accounts and saved customer
details use [Supabase](https://supabase.com); pages are locked on the server with
Vercel Routing Middleware.

## What's in the box

| Path | What it is |
|------|------------|
| `index.html` | Sign-in page (customers, staff and operators) |
| `customer-signup.html` | Customer sign-up (details are saved to their account) |
| `account.html` | Customer account: "Welcome back", saved details, rewards placeholder |
| `dashboard.html`, `customers.html`, `collections.html`, `payments.html`, `waivers.html`, `staffs.html`, `settings.html`, `reports.html` | Staff/operator pages (locked) |
| `middleware.js` | **The lock.** Runs on Vercel before any page is served |
| `js/auth.js`, `js/session.js`, `js/config.js` | Sign-in helpers, session check + sign-out button, Supabase settings |
| `supabase/schema.sql` | Database table, security rules and sign-up triggers |
| `tests/middleware.test.mjs` | Tests for the lock (`npm test`) |

## Who can see what

- **Signed out:** only the sign-in page, sign-up page and static files (styles, scripts, images).
- **Customer:** `account.html` (their own details only). Staff pages send them back to it.
- **Staff / admin / PSP operator:** all pages.

Any page not listed as public or customer-only is treated as staff-only, so new pages are
locked by default.

## Set up (about 15 minutes)

1. **Create a Supabase project** at supabase.com (free tier is fine).
2. **Run the database setup:** Supabase → SQL Editor → paste `supabase/schema.sql` → Run.
3. **Add your project's public details to `js/config.js`:**
   Supabase → Project Settings → API → copy the *Project URL* and the *anon / publishable* key.
   Never put the `service_role` key anywhere in this repo.
4. **Add two environment variables on Vercel** (Project → Settings → Environment Variables),
   then redeploy:
   - `SUPABASE_URL` — same Project URL
   - `SUPABASE_ANON_KEY` — same anon key

   (`middleware.js` needs these to check sessions. If they're missing, protected pages show a
   "temporarily unavailable" message rather than opening up.)
5. **Decide on email confirmation:** Supabase → Authentication → Providers → Email.
   Keep *Confirm email* on for real use (set up a proper email sender first). Turn it off only
   while testing; the sign-up page handles both.
6. **Make yourself the first admin:** create your account on the site, then run the SQL at the
   bottom of `supabase/schema.sql` with your email. Sign out and back in.
   Add staff the same way (role `staff`), or add users in Supabase → Authentication → Users.
   Staff can't sign themselves up — that is deliberate.

## Run the tests

```bash
npm install
npm test
```

## Known limits (next steps)

- No "Forgot password" flow yet (add Supabase `resetPasswordForEmail` + a reset page).
- No Google sign-in (needs Google OAuth set up in Supabase).
- Terms of Service / Privacy Policy pages don't exist yet; the sign-up consent box describes
  what is saved but should link to them before launch (see Nigeria Data Protection Act 2023).
- The access token is mirrored into a normal (JavaScript-readable) cookie. For stricter
  security, move sign-in to server-side API routes that set an HttpOnly cookie.
- Plastics intake, the rewards ledger and Bitcoin withdrawals are not built. The account page
  shows an honest empty state until they are.
- Staff pages still show sample data and mixed `$` / `₦` currency.
