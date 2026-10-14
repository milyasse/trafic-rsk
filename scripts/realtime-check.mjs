// Test de bout en bout du temps réel avec deux utilisateurs distincts :
// B s'abonne, A crée un signalement, B doit le recevoir ; puis A le déclare terminé et B reçoit la mise à jour.
// Prérequis : connexions anonymes activées dans Supabase (Authentication > Sign In / Providers).
// Usage : VITE_SUPABASE_URL=... VITE_SUPABASE_PUBLISHABLE_KEY=... node scripts/realtime-check.mjs
import { createClient } from "@supabase/supabase-js";

const URL = process.env.VITE_SUPABASE_URL;
const KEY = process.env.VITE_SUPABASE_PUBLISHABLE_KEY;
if (!URL || !KEY) {
  console.error("VITE_SUPABASE_URL et VITE_SUPABASE_PUBLISHABLE_KEY sont requis.");
  process.exit(2);
}
const opts = { auth: { persistSession: false, autoRefreshToken: false } };
const userA = createClient(URL, KEY, opts);
const userB = createClient(URL, KEY, opts);

const gh = (level, msg) => { if (process.env.GITHUB_ACTIONS) console.log(`::${level} title=Temps réel::${msg}`); };
const fail = (msg) => { console.error(`❌ ${msg}`); gh("error", msg); process.exit(1); };
const ok = (msg) => { console.log(`✅ ${msg}`); gh("notice", msg); };
const wait = (ms) => new Promise((r) => setTimeout(r, ms));

const a = await userA.auth.signInAnonymously();
if (a.error) fail(`Utilisateur A : ${a.error.message} (activez les connexions anonymes)`);
const b = await userB.auth.signInAnonymously();
if (b.error) fail(`Utilisateur B : ${b.error.message}`);
ok("Deux sessions anonymes distinctes");

const received = [];
const channel = userB.channel("realtime-check")
  .on("postgres_changes", { event: "*", schema: "public", table: "reports" }, (p) => received.push(p));
await new Promise((resolve, reject) => {
  const t = setTimeout(() => reject(new Error("abonnement trop long")), 15000);
  channel.subscribe((s) => { if (s === "SUBSCRIBED") { clearTimeout(t); resolve(); } });
}).catch((e) => fail(e.message));
ok("B est abonné au canal temps réel");

// Point de test : parking proche de la gare de Rabat-Agdal, avec un léger décalage aléatoire
const lat = 33.9935 + Math.random() * 0.002;
const lng = -6.8545 + Math.random() * 0.002;
const t0 = Date.now();
const { data: created, error: cErr } = await userA.rpc("create_report", {
  p_type: "other", p_severity: 1, p_lat: lat, p_lng: lng, p_description: "[test automatique] vérification temps réel",
});
if (cErr) fail(`Création : ${cErr.message}`);
const id = created.id;
ok(`A a créé le signalement ${id}${created.merged ? " (fusionné)" : ""}`);

let insert = null;
for (let i = 0; i < 100 && !insert; i++) {
  insert = received.find((p) => (p.new?.id ?? p.old?.id) === id);
  if (!insert) await wait(100);
}
if (!insert) fail("B n'a pas reçu le signalement en 10 s");
ok(`B a reçu l'événement ${insert.eventType} en ${Date.now() - t0} ms`);
if ("user_id" in (insert.new ?? {})) fail("L'identité de l'auteur est présente dans l'événement !");
ok("Aucune information sur l'auteur dans l'événement");

const t1 = Date.now();
const { error: vErr } = await userA.rpc("vote_report", { p_report_id: id, p_vote: "gone" });
if (vErr) fail(`Résolution : ${vErr.message}`);
let update = null;
for (let i = 0; i < 100 && !update; i++) {
  update = received.find((p) => p.eventType === "UPDATE" && p.new?.id === id && p.new?.status === "resolved");
  if (!update) await wait(100);
}
if (!update) fail("B n'a pas reçu la résolution en 10 s");
ok(`B a reçu la résolution en ${Date.now() - t1} ms`);

const { error: selfConfirm } = await userA.rpc("vote_report", { p_report_id: id, p_vote: "confirm" });
if (!selfConfirm) fail("Un signalement résolu a pu être reconfirmé");
ok(`Vote refusé sur un signalement terminé (${selfConfirm.message})`);

await userB.removeChannel(channel);
await userA.auth.signOut();
await userB.auth.signOut();
console.log("Terminé.");
process.exit(0);
