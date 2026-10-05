// DUSTPAN — public Supabase settings.
//
// Both values are SAFE to publish: the anon key only works within the
// row-level-security rules in supabase/schema.sql. Never put the
// "service_role" key anywhere in this repo.
//
// Find them in Supabase -> Project Settings -> API.
// The same two values must also be set as Vercel environment variables
// (https://gunxxydnpbzddaiubrze.supabase.co , sb_publishable_cM769aV5QmhOAj14_iDgvg_ekdyJIPD) so middleware.js can verify sessions.
export const SUPABASE_URL = 'https://YOUR-PROJECT-REF.supabase.co';
export const SUPABASE_ANON_KEY = 'YOUR-PUBLIC-ANON-KEY';
