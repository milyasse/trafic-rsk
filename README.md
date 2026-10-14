# Trafic RSK — navigation et trafic communautaire pour Rabat-Salé-Kénitra

Application web (mobile et ordinateur) de navigation pour la région Rabat-Salé-Kénitra : carte détaillée jusqu'au niveau des rues, recherche d'adresses, itinéraires avec guidage pas à pas, signalements d'incidents partagés en direct entre usagers, et trafic mesuré lorsqu'un fournisseur est connecté.

- **Application** : https://milyasse.github.io/trafic-rsk/
- **Administration** : https://milyasse.github.io/trafic-rsk/#/admin (comptes administrateurs uniquement)

> **Trafic en direct** : aucun fournisseur de trafic gratuit et illimité ne couvre le Maroc. L'application est prête pour TomTom (couverture flux + incidents au Maroc, 20 000 requêtes gratuites par mois). Tant qu'aucune clé n'est configurée, elle affiche clairement « Trafic en temps réel indisponible » et n'affiche **jamais** de couleurs de trafic inventées. Les signalements des usagers restent actifs et sont distingués des données du fournisseur.

## Fonctionnalités

| Domaine | Ce qui est livré |
|---|---|
| Carte | MapLibre GL + tuiles vectorielles OpenStreetMap (OpenFreeMap), 6 fonds (standard, contrasté, épuré, nuit, satellite, satellite + routes), mode clair/sombre, rotation/inclinaison, géolocalisation avec précision, choix d'un point sur la carte par coordonnées exactes (lat, lng) ou lieu nommé (POI) le plus proche |
| Recherche | Autocomplétion Photon (OSM) limitée à la région, villes en local, favoris et destinations récentes, repli Nominatim |
| Itinéraires | Jusqu'à 3 itinéraires, durée, distance, heure d'arrivée, péage signalé / autoroute, incidents sur le trajet, itinéraire recommandé (pénalité incidents + retard mesuré) |
| Navigation | Instructions étape par étape (FR/EN, AR partiel), guidage vocal, suivi GPS, recalcul hors trajet, alertes d'incidents devant soi, proposition d'itinéraire alternatif, écran maintenu allumé, annulation |
| Trafic | Couleurs fluide / ralenti / dense / embouteillage / inconnu, âge des données, axes encombrés, mesures périmées affichées en gris |
| Signalements | 10 types, gravité, description, fusion automatique des doublons (150 m), confirmations, « n'y est plus », signalement d'abus, expiration automatique, limitation anti-spam, identité jamais exposée |
| Temps réel | Supabase Realtime (WebSocket), reconnexion automatique avec resynchronisation, état de connexion visible |
| Comptes | Usage libre sans compte, session invitée anonyme pour signaler, compte e-mail, favoris (domicile, travail…), préférences, historique avec consentement, suppression du compte |
| Administration | Statistiques, carte et modération des signalements, état et fraîcheur des services, paramètres (durées, seuils, budget trafic), points de mesure |

## Architecture

```
Navigateur (React + MapLibre, GitHub Pages)
   │  tuiles ─────────────► OpenFreeMap (OSM)
   │  recherche ──────────► Photon / Nominatim (OSM)
   │  REST + Realtime ────► Supabase (PostgreSQL + PostGIS, RLS, Auth)
   └─ fonctions ──────────► Supabase Edge Functions
                               route ─────► openrouteservice (si clé) │ OSRM public (repli)
                               traffic ───► TomTom Traffic Flow (si clé), cache + budget
                               delete-account
```

Détails : [docs/ARCHITECTURE.md](docs/ARCHITECTURE.md) · Design : [docs/DESIGN.md](docs/DESIGN.md) · Exploitation : [docs/EXPLOITATION.md](docs/EXPLOITATION.md) · Tests : [docs/TESTS.md](docs/TESTS.md)

## Lancer le projet en local

Prérequis : Node.js 22+.

```bash
git clone https://github.com/milyasse/trafic-rsk.git
cd trafic-rsk
cp .env.example .env.local      # renseigner l'URL et la clé publishable Supabase
npm install
npm run dev                     # http://localhost:5173
```

Scripts :

| Commande | Rôle |
|---|---|
| `npm run dev` | serveur de développement |
| `npm run build` | vérification des types + build de production (`dist/`) |
| `npm run preview` | servir le build localement |
| `npm test` | tests unitaires (Vitest) |
| `npm run typecheck` | vérification TypeScript |
| `npm run test:smoke` | vérification d'un déploiement (page, itinéraires, trafic, RLS) |
| `npm run test:realtime` | test temps réel entre deux utilisateurs |

## Configuration

### Frontend (valeurs publiques)

`VITE_SUPABASE_URL` et `VITE_SUPABASE_PUBLISHABLE_KEY` : publiques par conception, protégées par les règles RLS. En local dans `.env.local` ; pour le déploiement, en **variables** GitHub Actions (Settings → Secrets and variables → Actions → *Variables*).

### Secrets serveur (jamais dans le dépôt ni dans le frontend)

À définir dans Supabase → Edge Functions → Secrets (ou `supabase secrets set`) :

| Secret | Effet | Obligatoire |
|---|---|---|
| `TOMTOM_API_KEY` | active le trafic en direct | non |
| `ORS_API_KEY` | itinéraires openrouteservice au lieu du serveur OSRM public | non (recommandé en production) |
| `ALLOWED_ORIGINS` | origines autorisées (CORS) | non (défaut : GitHub Pages + localhost) |
| `TRAFFIC_PROVIDER` | `tomtom` (défaut) | non |

### Supabase Auth

Authentication → Sign In / Providers : activer **Allow anonymous sign-ins** (signalement sans compte) ; désactiver **Confirm email** ou configurer un SMTP (l'envoi d'e-mails par défaut de Supabase est réservé aux membres de l'équipe). Authentication → URL Configuration : *Site URL* = `https://milyasse.github.io/trafic-rsk/`.

### Administrateur

Après avoir créé votre compte dans l'application, exécutez dans l'éditeur SQL Supabase :

```sql
update public.profiles set role = 'admin'
where id = (select id from auth.users where email = 'votre@email');
```

Les adresses listées dans `private.admin_emails` deviennent administratrices automatiquement à l'inscription.

## Mise à jour et redéploiement

- **Frontend** : tout `git push` sur `main` lance les tests, le build, la publication GitHub Pages puis la vérification automatique (workflow *Tests et déploiement*).
- **Backend** : workflow manuel *Déployer le backend Supabase* (secrets `SUPABASE_ACCESS_TOKEN`, `SUPABASE_DB_PASSWORD`, variable `SUPABASE_PROJECT_REF`), ou `supabase functions deploy <nom> --no-verify-jwt` en local.

## Services externes et coûts

Voir [docs/EXPLOITATION.md](docs/EXPLOITATION.md#services-externes-et-coûts) : conditions d'accès, quotas et coût mensuel estimé selon l'usage.

## Licences et attributions

Données cartographiques © contributeurs OpenStreetMap (ODbL) · tuiles OpenFreeMap / OpenMapTiles · imagerie satellite © Esri, Maxar, Earthstar Geographics · recherche Photon (komoot) · itinéraires OSRM ou openrouteservice (HeiGIT) · trafic TomTom (si activé). Les attributions sont affichées dans l'application.
