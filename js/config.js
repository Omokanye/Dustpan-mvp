// DUSTPAN — public Supabase settings.
//
// Both values are SAFE to publish: the anon key only works within the
// row-level-security rules in supabase/schema.sql. Never put the
// "service_role" key anywhere in this repo.
//
// Find them in Supabase -> Project Settings -> API.
// The same two values must also be set as Vercel environment variables
// (SUPABASE_URL, SUPABASE_ANON_KEY) so middleware.js can verify sessions.
export const SUPABASE_URL = 'https://YOUR-PROJECT-REF.supabase.co';
export const SUPABASE_ANON_KEY = 'YOUR-PUBLIC-ANON-KEY';
