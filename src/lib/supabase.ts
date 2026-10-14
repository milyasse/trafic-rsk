import { createClient, type SupabaseClient } from "@supabase/supabase-js";
import { CONFIG_OK, SUPABASE_KEY, SUPABASE_URL } from "../config";

export const supabase: SupabaseClient = createClient(
  CONFIG_OK ? SUPABASE_URL : "https://invalid.localhost",
  CONFIG_OK ? SUPABASE_KEY : "missing",
  {
    auth: { persistSession: true, autoRefreshToken: true, detectSessionInUrl: true },
    realtime: { params: { eventsPerSecond: 10 } },
  },
);

/**
 * Garantit une session (anonyme si besoin) avant une écriture : signalement, vote.
 * Les sessions anonymes doivent être activées dans Supabase (Authentication > Sign In / Providers).
 */
export async function ensureSession(): Promise<void> {
  const { data } = await supabase.auth.getSession();
  if (data.session) return;
  const { error } = await supabase.auth.signInAnonymously();
  if (error) throw new Error(`anonymous_disabled: ${error.message}`);
}
