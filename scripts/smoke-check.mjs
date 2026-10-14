// Vérification après déploiement : page publique, itinéraires réels, fonction trafic, lecture publique.
// Usage : APP_URL=... VITE_SUPABASE_URL=... VITE_SUPABASE_PUBLISHABLE_KEY=... node scripts/smoke-check.mjs
const APP_URL = process.env.APP_URL ?? "https://milyasse.github.io/trafic-rsk/";
const SB_URL = process.env.VITE_SUPABASE_URL;
const KEY = process.env.VITE_SUPABASE_PUBLISHABLE_KEY;
if (!SB_URL || !KEY) {
  console.error("VITE_SUPABASE_URL et VITE_SUPABASE_PUBLISHABLE_KEY sont requis.");
  process.exit(2);
}

const headers = { apikey: KEY, Authorization: `Bearer ${KEY}`, "Content-Type": "application/json" };
const results = [];
async function check(name, fn) {
  const t0 = Date.now();
  try {
    const detail = await fn();
    results.push({ name, ok: true, ms: Date.now() - t0, detail });
  } catch (e) {
    results.push({ name, ok: false, ms: Date.now() - t0, detail: String(e.message ?? e) });
  }
}
const assert = (cond, msg) => { if (!cond) throw new Error(msg); };

await check("Page publique", async () => {
  const res = await fetch(APP_URL);
  assert(res.ok, `HTTP ${res.status}`);
  const html = await res.text();
  assert(html.includes("Trafic RSK"), "titre absent");
  const js = html.match(/src="([^"]+\.js)"/)?.[1];
  assert(js, "bundle JS introuvable");
  const jsRes = await fetch(new URL(js, APP_URL));
  assert(jsRes.ok, `bundle HTTP ${jsRes.status}`);
  return `HTTP 200, bundle ${js}`;
});

const trips = {
  "Rabat → Kénitra": [[-6.8326, 34.0209], [-6.5802, 34.2610]],
  "Salé → Rabat (Agdal)": [[-6.7985, 34.0531], [-6.8510, 33.9990]],
  "Témara → Rabat": [[-6.9063, 33.9287], [-6.8326, 34.0209]],
  "Rabat → Skhirat": [[-6.8326, 34.0209], [-7.0322, 33.8527]],
};
for (const [name, coordinates] of Object.entries(trips)) {
  await check(`Itinéraire ${name}`, async () => {
    const res = await fetch(`${SB_URL}/functions/v1/route`, { method: "POST", headers, body: JSON.stringify({ coordinates }) });
    assert(res.ok, `HTTP ${res.status}`);
    const data = await res.json();
    assert(data.routes?.length >= 1, "aucun itinéraire");
    const r = data.routes[0];
    assert(r.steps.length > 2 && r.geometry.coordinates.length > 10, "itinéraire incomplet");
    assert(data.traffic_aware === false, "traffic_aware inattendu");
    return `${data.provider} · ${data.routes.length} itinéraire(s) · ${(r.distance / 1000).toFixed(1)} km · ${Math.round(r.duration / 60)} min`;
  });
}

await check("Coordonnées hors Maroc refusées", async () => {
  const res = await fetch(`${SB_URL}/functions/v1/route`, { method: "POST", headers, body: JSON.stringify({ coordinates: [[2.35, 48.85], [2.29, 48.86]] }) });
  assert(res.status === 400, `HTTP ${res.status} au lieu de 400`);
  return "HTTP 400";
});

await check("Fonction trafic", async () => {
  const res = await fetch(`${SB_URL}/functions/v1/traffic`, { method: "POST", headers, body: "{}" });
  assert(res.ok, `HTTP ${res.status}`);
  return JSON.stringify(await res.json());
});

await check("Lecture publique des signalements (RLS)", async () => {
  const res = await fetch(`${SB_URL}/rest/v1/reports?select=id,type,status&limit=5`, { headers });
  assert(res.ok, `HTTP ${res.status}`);
  const rows = await res.json();
  return `${rows.length} ligne(s) lisible(s)`;
});

await check("Écriture directe interdite sans session (RLS)", async () => {
  const res = await fetch(`${SB_URL}/rest/v1/reports`, {
    method: "POST", headers: { ...headers, Prefer: "return=minimal" },
    body: JSON.stringify({ type: "jam", lat: 34.02, lng: -6.83, expires_at: new Date().toISOString() }),
  });
  assert(res.status === 401 || res.status === 403, `HTTP ${res.status} au lieu de 401/403`);
  return `HTTP ${res.status}`;
});

await check("Auteur jamais exposé", async () => {
  const res = await fetch(`${SB_URL}/rest/v1/report_votes?select=*&limit=1`, { headers });
  assert(res.status === 401 || res.status === 403 || (res.ok && (await res.json()).length === 0), `HTTP ${res.status}`);
  return `HTTP ${res.status}`;
});

let failed = 0;
for (const r of results) {
  if (!r.ok) failed++;
  console.log(`${r.ok ? "✅" : "❌"} ${r.name} (${r.ms} ms) — ${r.detail}`);
  if (process.env.GITHUB_ACTIONS) {
    const msg = `${r.name} (${r.ms} ms) — ${r.detail}`.replace(/\r?\n/g, " ");
    console.log(`::${r.ok ? "notice" : "error"} title=Smoke test::${msg}`);
  }
}
if (process.env.GITHUB_STEP_SUMMARY) {
  const { appendFileSync } = await import("node:fs");
  appendFileSync(process.env.GITHUB_STEP_SUMMARY,
    `## Vérification après déploiement\n\n| Test | Résultat | Durée | Détail |\n|---|---|---|---|\n` +
    results.map((r) => `| ${r.name} | ${r.ok ? "✅" : "❌"} | ${r.ms} ms | ${String(r.detail).replace(/\|/g, "/")} |`).join("\n") + "\n");
}
process.exit(failed ? 1 : 0);
