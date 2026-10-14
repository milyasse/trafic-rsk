# Tests

## Ce qui est automatisé

| Niveau | Fichiers | Quand |
|---|---|---|
| Unitaires (Vitest) | `src/lib/*.test.ts` | à chaque push (CI) et `npm test` |
| Types | `tsc --noEmit` | à chaque push (CI) |
| Règles SQL et RLS | `supabase/tests/rules.sql` | manuel (SQL Editor), transaction annulée |
| Après déploiement | `scripts/smoke-check.mjs` | après chaque publication (CI) |
| Temps réel entre deux utilisateurs | `scripts/realtime-check.mjs` | après chaque publication (CI) |

### Couverture des tests unitaires

- **Calcul d'itinéraire** : recommandation du plus rapide sans incident, bascule vers l'alternative quand un accident grave est sur le trajet, incidents expirés ou résolus ignorés, retard mesuré ajouté seulement si la mesure est récente et sur le trajet, détection d'autoroute.
- **Navigation** : étape suivante au départ et après un virage, durée restante proportionnelle, détection de sortie de trajet, seuil adapté à la précision GPS.
- **Géolocalisation / géométrie** : distances Rabat ↔ Salé, Témara, Kénitra ; projection d'un point sur un tracé ; zone couverte (inclut les 8 villes prioritaires, exclut Casablanca).
- **Données indisponibles ou anciennes** : niveau « inconnu » en l'absence de mesure, mesure périmée affichée en gris, états « indisponible / ancien / en direct ».
- **Recherche** : conversion des résultats Photon, dédoublonnage, recherche locale des villes sans accents.
- **Signalements** : statut en cours/terminé, filtres ville/type/gravité, traduction des erreurs serveur.
- **Reconnexion** : délai exponentiel plafonné à 30 s avec gigue.
- **Instructions et traductions** : virages, ronds-points (1re/2e sortie), bretelles, demi-tour, arrivée, phrases vocales, repli FR pour l'arabe.

## Rapport des tests effectués (14/10/2026)

| Test | Résultat |
|---|---|
| Tests unitaires (45 tests, 5 fichiers) | ✅ 45/45 |
| Règles SQL / RLS (`supabase/tests/rules.sql`, 12 cas) | ✅ création, refus hors zone, refus d'auto-confirmation, insertion directe refusée, paramètres non modifiables par un utilisateur, fusion d'un doublon à 40 m avec rattachement à « Rabat », lecture publique, création et lecture des votes refusées sans session |
| Conseiller de sécurité Supabase | ✅ aucune table sans RLS ; 6 avertissements attendus : fonctions `SECURITY DEFINER` exposées volontairement (elles vérifient l'utilisateur et valident les entrées) |
| Edge Function `route`, Rabat → Kénitra | ✅ 2 itinéraires (47,0 km / 40 min et 53,3 km / 44 min), instructions avec noms de rues FR/AR |
| Edge Function `traffic` sans clé | ✅ `no_provider` → statut « indisponible » |
| Page publique (GitHub Pages) | ✅ HTTP 200, bundle chargé |
| Itinéraires réels via la fonction déployée | ✅ Rabat → Kénitra 47,0 km / 40 min (2 itinéraires) · Salé → Rabat-Agdal 10,2 km / 12 min · Témara → Rabat 14,1 km / 16 min (2) · Rabat → Skhirat 30,7 km / 28 min (2) — 1,5 à 3,2 s par calcul |
| Coordonnées hors Maroc | ✅ refusées (HTTP 400) |
| RLS en production | ✅ lecture publique des signalements, écriture directe refusée (401), votes/auteurs inaccessibles (401) |
| Temps réel entre deux utilisateurs (sessions anonymes distinctes) | ✅ signalement reçu par l'autre utilisateur en 1,2 s, résolution reçue en 0,6 s, aucune donnée d'auteur dans l'événement, vote refusé sur un incident terminé |
| Parcours dans l'interface (navigateur) | ✅ carte affichée (Rabat, Salé, Témara, A1/A5, RN1/RN6), recherche « Gare de Kenitra » → résultats OSM, départ « Gare Rabat Ville » saisi → 2 itinéraires (41 min / 47 km recommandé, 44 min / 51 km), mention « sans trafic en direct », état « En direct · Trafic en temps réel indisponible » |
| Correctifs issus de ces vérifications | hauteur de la carte forcée (style MapLibre prioritaire), ajout du champ « Départ » et du bouton « Partir d'ici » pour les appareils sans GPS, test temps réel rendu indépendant des signalements existants |

## Procédure manuelle : un signalement apparaît chez un autre utilisateur

1. Ouvrez l'application sur deux appareils (ou deux navigateurs différents, dont un en navigation privée).
2. Vérifiez sur les deux la pastille **« En direct »** en haut.
3. Sur l'appareil A : **Signaler** → choisissez « Accident », gravité « Forte », emplacement « Au centre de la carte » → **Envoyer le signalement**.
4. Sur l'appareil B, sans recharger : l'icône apparaît sur la carte en 1 à 2 s et dans l'onglet **Incidents** ; si B a activé sa position et se trouve à moins de 2 km, une alerte « Nouveau : Accident à … » s'affiche.
5. Sur B : touchez l'icône → **Toujours là**. Sur A : le compteur de confirmations augmente, statut « Confirmé ».
6. Sur A (auteur) : **N'y est plus**. Sur B : l'incident disparaît de la carte et passe dans « Dernières 24 h » avec le statut « Résolu ».
7. Coupure réseau : passez B en mode avion 30 s, créez un signalement sur A, réactivez le réseau sur B → la pastille passe par « Hors ligne » puis « Reconnexion… » puis « En direct », et le signalement manqué apparaît.

## Procédure manuelle : trajets prioritaires

| Trajet | Points à vérifier |
|---|---|
| Rabat (gare Rabat-Ville) → Kénitra (centre) | 2 à 3 itinéraires, autoroute A1 signalée, heure d'arrivée cohérente |
| Salé (Bab Lamrissa) → Rabat (Agdal) | passage par un pont du Bouregreg, instructions de ronds-points |
| Témara → Rabat (Hay Riad) | itinéraire par la N1 ou l'A1 / rocade |
| Navigation réelle | démarrer, s'écarter volontairement : « Vous avez quitté le trajet » puis nouvel itinéraire en moins de 20 s |

## TomTom en production (14/10/2026)

| Contrôle | Résultat |
|---|---|
| Traffic Flow : 32 axes | 32 mesures, 0 erreur ; 6 axes ralentis à la première mesure |
| Traffic Incidents : 4 zones | 54 incidents actifs (26 embouteillages, 13 routes fermées, 15 travaux), descriptions en français |
| `official_incidents` | lecture publique OK, écriture sans droit refusée (HTTP 401) — contrôle automatique après chaque déploiement |
| Routing TomTom (Rabat → Kénitra, Rabat → Skhirat, Témara → Rabat, Salé → Agdal) | 3 itinéraires chacun, `traffic_aware=true`, instructions en français, 7 à 22 limitations de vitesse par trajet, péages détectés |
| Interface (téléphone 375 px) | incidents TomTom sur la carte et dans « Info trafic TomTom (54) », fiche avec retard / longueur / horaires / source, tronçon surligné ; itinéraires « Trafic fluide » avec mention « Durées calculées avec le trafic en temps réel (TomTom) » ; départ choisi depuis un favori |
| Non vérifié ici | affichage de la limitation de vitesse et de la vitesse actuelle pendant une navigation réelle (nécessite un GPS en mouvement) |
