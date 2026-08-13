import { createClient } from "@supabase/supabase-js";

const supabaseUrl = import.meta.env.VITE_SUPABASE_URL;
const supabaseAnonKey = import.meta.env.VITE_SUPABASE_ANON_KEY;

if (!supabaseUrl || !supabaseAnonKey) {
  // Fails loudly at startup rather than silently breaking the Google
  // button later — these are required for any OAuth provider to work.
  throw new Error(
    "Missing VITE_SUPABASE_URL or VITE_SUPABASE_ANON_KEY. Add them to your .env (and Netlify build env vars for the deployed app).",
  );
}

/** Deliberately NOT the app's main session store — AuthContext already
 *  owns that via its own localStorage keys and /api/auth/refresh. This
 *  client exists only to (1) kick off supabase.auth.signInWithOAuth,
 *  which needs a real Supabase client to build the redirect URL, and
 *  (2) read the session Supabase parses out of the callback URL so
 *  AuthCallbackPage can hand it to AuthContext.login(). persistSession
 *  and autoRefreshToken are off so this client never manages its own
 *  competing session lifecycle in the background. */
export const supabaseClient = createClient(supabaseUrl, supabaseAnonKey, {
  auth: {
    persistSession: false,
    autoRefreshToken: false,
    detectSessionInUrl: true,
  },
});
