import "server-only";
import { createClient, type SupabaseClient } from "@supabase/supabase-js";

// One shared server-side client using the service role key.
// The service role bypasses row-level security, so this must never reach the browser
// ("server-only" makes the build fail if a client component imports this file).
let client: SupabaseClient | null = null;

export function supabaseAdmin(): SupabaseClient {
  if (!client) {
    const url = process.env.SUPABASE_URL;
    const key = process.env.SUPABASE_SERVICE_ROLE_KEY;
    if (!url || !key) {
      throw new Error("Missing SUPABASE_URL or SUPABASE_SERVICE_ROLE_KEY");
    }
    client = createClient(url, key, {
      auth: { persistSession: false, autoRefreshToken: false },
    });
  }
  return client;
}
