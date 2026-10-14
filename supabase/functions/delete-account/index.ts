// Trafic RSK — suppression du compte de l'utilisateur connecté (droit à l'effacement, loi 09-08).
// L'identité est vérifiée à partir du jeton de session ; seul le titulaire peut supprimer son compte.
// Effets (cascade SQL) : profil, favoris, historique, votes et lien d'auteur supprimés ;
// les signalements eux-mêmes restent, anonymes, jusqu'à leur expiration/purge.

import { createClient } from "npm:@supabase/supabase-js@2";

const ALLOWED_ORIGINS = (Deno.env.get("ALLOWED_ORIGINS") ??
  "https://milyasse.github.io,http://localhost:5173,http://localhost:4173").split(",").map((s) => s.trim());

function corsHeaders(req: Request): Record<string, string> {
  const origin = req.headers.get("origin") ?? "";
  return {
    "Access-Control-Allow-Origin": ALLOWED_ORIGINS.includes(origin) ? origin : ALLOWED_ORIGINS[0],
    "Access-Control-Allow-Headers": "authorization, x-client-info, apikey, content-type",
    "Access-Control-Allow-Methods": "POST, OPTIONS",
    "Vary": "Origin",
  };
}
function json(req: Request, body: unknown, status = 200): Response {
  return new Response(JSON.stringify(body), { status, headers: { ...corsHeaders(req), "Content-Type": "application/json" } });
}
function serviceKey(): string {
  const legacy = Deno.env.get("SUPABASE_SERVICE_ROLE_KEY");
  if (legacy) return legacy;
  try {
    const keys = JSON.parse(Deno.env.get("SUPABASE_SECRET_KEYS") ?? "{}");
    return keys.default ?? Object.values(keys)[0] as string;
  } catch {
    return "";
  }
}
const admin = createClient(Deno.env.get("SUPABASE_URL")!, serviceKey(), { auth: { persistSession: false } });

Deno.serve(async (req) => {
  if (req.method === "OPTIONS") return new Response(null, { headers: corsHeaders(req) });
  if (req.method !== "POST") return json(req, { error: "method_not_allowed" }, 405);

  const token = (req.headers.get("authorization") ?? "").replace(/^Bearer\s+/i, "");
  if (!token) return json(req, { error: "auth_required" }, 401);

  const { data, error } = await admin.auth.getUser(token);
  if (error || !data.user) return json(req, { error: "auth_required" }, 401);

  const { error: delErr } = await admin.auth.admin.deleteUser(data.user.id);
  if (delErr) return json(req, { error: "delete_failed" }, 500);
  return json(req, { deleted: true });
});
