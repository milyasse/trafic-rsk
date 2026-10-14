# Architecture

## Choix techniques (et pourquoi)

| Besoin | Choix | Raison | Alternative écartée |
|---|---|---|---|
| Interface | React 19 + TypeScript + Vite + Tailwind CSS 4 | écosystème standard, build statique hébergeable sur GitHub Pages | — |
| Carte | MapLibre GL JS 5 | rendu vectoriel fluide, rotation/inclinaison, libre (BSD) | Google Maps JS (coût, licence) |
| Fond de carte | OpenFreeMap (tuiles OSM) | gratuit, sans clé ni quota publié, couverture OSM détaillée de Rabat/Salé/Kénitra | tile.openstreetmap.org (usage applicatif déconseillé par sa politique) |
| Recherche | Photon (komoot), repli Nominatim | autocomplétion, données OSM, sans clé ; usage raisonnable | Nominatim seul (pas d'autocomplétion autorisée) |
| Itinéraires | Edge Function `route` : openrouteservice si `ORS_API_KEY`, sinon OSRM public | clé gardée côté serveur, réponse normalisée, bascule automatique | Valhalla auto-hébergé (coût serveur) — option future |
| Trafic | Edge Function `traffic` + TomTom Traffic Flow | couverture « flux + incidents » documentée pour le Maroc ; 20 000 requêtes/mois gratuites | HERE (couverture à confirmer par contrat), Google Routes (aucune donnée de flux exploitable hors itinéraire, coût) |
| Backend | Supabase : PostgreSQL 17 + PostGIS, RLS, Auth, Realtime, Edge Functions, pg_cron | un seul service géré pour base spatiale, temps réel et authentification ; offre gratuite suffisante au démarrage | Node.js + WebSocket auto-hébergé (exploitation plus lourde) |
| Hébergement frontend | GitHub Pages via GitHub Actions | gratuit, HTTPS, lié au dépôt | Vercel/Netlify (équivalent, compte supplémentaire) |

GitHub Pages n'héberge que le frontend statique ; base, temps réel, authentification et fonctions serveur sont sur Supabase.

## Flux de données

```
                       ┌────────────── Supabase ───────────────────────────────┐
Navigateur ── REST ───►│ PostgREST ── RLS ──► tables (reports, profiles, …)    │
          ◄─ WebSocket─│ Realtime ◄── publication (reports, traffic_*)         │
          ── HTTPS ───►│ Edge Functions                                        │
                       │   route   ──► openrouteservice │ OSRM                 │
                       │   traffic ──► claim_traffic_refresh() ──► TomTom      │
                       │               └─► upsert traffic_segments ──► Realtime │
                       │ pg_cron : expiration des signalements (2 min)          │
                       └───────────────────────────────────────────────────────┘
```

### Trois fréquences distinctes

1. **Réception des événements** : instantanée. Chaque signalement, vote, expiration ou nouvelle mesure de trafic est poussé par Supabase Realtime à tous les clients connectés.
2. **Interrogation du fournisseur de trafic** : côté serveur uniquement, au plus toutes les `refresh_minutes` (30 par défaut), pendant les heures actives (6 h – 22 h), dans la limite d'un budget journalier (600 requêtes). Le verrou `claim_traffic_refresh()` garantit qu'un seul appel part même si 1 000 navigateurs demandent en même temps. Aucun appel par déplacement de carte ni par utilisateur.
3. **Rafraîchissement de l'interface** : l'âge des données et les expirations sont recalculés toutes les 30 s ; chaque client demande au serveur s'il faut rafraîchir le trafic toutes les 5 min (le serveur décide) ; resynchronisation complète au retour sur l'onglet, au retour du réseau et après une reconnexion Realtime.

### Fraîcheur et honnêteté des données

- Statut `traffic_status.available=false` → bandeau « Trafic en temps réel indisponible », axes en gris.
- Mesure plus ancienne que `stale_after_minutes` (75 min) → affichée en gris (« inconnu »), bandeau « Données de trafic anciennes » avec l'âge.
- Les durées d'itinéraire sont libellées « selon le réseau routier » ; un retard n'est ajouté (« Avec trafic mesuré : … ») que si un segment mesuré récent se trouve réellement sur le trajet.
- Signalements des usagers (« Signalement d'usager ») et données du fournisseur (« Trafic mesuré », source affichée) sont toujours distingués.

## Modèle de données

| Table | Contenu | Accès |
|---|---|---|
| `reports` | type, gravité, description, lat/lng + `location` (geography, index GiST), ville, statut, compteurs, expiration | lecture publique (sauf masqués) ; écriture via `create_report()` / `vote_report()` ; modération admin |
| `private.report_authors` | lien signalement → utilisateur | jamais exposé (schéma non publié) |
| `report_votes` | confirm / gone / abuse par utilisateur | chacun ne voit que ses votes |
| `profiles` | rôle, nom privé, préférences, consentement historique | propriétaire (+ admin) ; rôle non modifiable par l'utilisateur |
| `favorites`, `destination_history` | lieux de l'utilisateur | propriétaire uniquement ; historique seulement avec consentement |
| `traffic_points`, `traffic_segments`, `traffic_status` | points de mesure, dernières mesures, état du fournisseur | lecture publique, écriture serveur |
| `service_status` | appels/erreurs des services externes | administrateurs |
| `app_settings` | durées de validité, seuils, budget trafic, zone couverte | lecture publique, modification admin |
| `cities` | villes de référence | lecture publique |
| `private.rate_limits` | compteurs anti-abus des fonctions | serveur |

### Règles métier côté serveur (`supabase/migrations`)

- Validation : type, gravité 1–3, coordonnées dans la zone couverte (`coverage_bbox`), description ≤ 280 caractères.
- Anti-spam : 5 signalements / 10 min et 30 votes / 10 min par utilisateur (paramétrables) ; 20 itinéraires / min et 12 appels trafic / min par IP.
- Fusion : un signalement du même type à moins de 150 m d'un signalement actif devient une confirmation.
- Cycle de vie : `active` → `confirmed` (confirmation, prolonge de 30 min) → `resolved` (auteur ou 2 votes « n'y est plus » postérieurs à la dernière confirmation) ou `expired` (pg_cron). 3 signalements d'abus → `hidden` en attente de modération.
- Ville déduite de la position (ville de référence la plus proche à moins de 30 km).

## Sécurité

- RLS activée sur toutes les tables ; privilèges colonne par colonne (un utilisateur ne peut pas changer son rôle) ; fonctions `SECURITY DEFINER` avec `search_path` vide.
- Clés privées (TomTom, openrouteservice, service_role) uniquement dans les secrets Supabase ; le frontend ne contient que l'URL et la clé *publishable*.
- Edge Functions : validation des entrées, CORS restreint (`ALLOWED_ORIGINS`), limitation de débit en base, délais d'attente (8–10 s).
- Administration : route `#/admin` affichée seulement aux administrateurs, mais la protection réelle est en base (RLS + `is_admin()`).

## Extension au reste du Maroc

- Élargir `coverage_bbox` (paramètre admin) et `COVERAGE` (`src/lib/geo.ts`), ajouter des villes et des points de mesure.
- Les tuiles, la recherche et les itinéraires couvrent déjà tout le pays ; les limites de la carte (`MAX_BOUNDS`) sont dans `src/config.ts`.
- Pour un fort trafic : OSRM ou Valhalla auto-hébergé sur un extrait Geofabrik du Maroc, et un forfait payant TomTom/HERE.

## Objectifs mesurables (à vérifier en conditions réelles)

| Indicateur | Objectif | Mesure |
|---|---|---|
| Propagation d'un signalement à un autre usager | < 2 s (p95) | `npm run test:realtime` (temps affiché) |
| Calcul d'itinéraire Rabat → Kénitra | < 3 s (p95) | `npm run test:smoke` (durées par appel) |
| Premier affichage de la carte sur 4G | < 4 s | Lighthouse mobile |
| Âge maximal d'une mesure de trafic affichée en couleur | ≤ 75 min | règle `stale_after_minutes` |
