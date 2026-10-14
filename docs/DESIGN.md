# Design de l'interface

## Deux propositions comparées (14/10/2026)

| | Figma | Canva |
|---|---|---|
| Fichier | [Trafic RSK — Proposition design (Figma)](https://www.figma.com/design/IlRi1f2nCNJl6sswlv2cMY) | [Trafic RSK UI Mockup (Canva)](https://www.canva.com/d/wQPmYjZ763XaUmu) |
| Contenu | 4 écrans (accueil, choix d'itinéraire, navigation guidée, signalement) + bibliothèque de composants | 1 planche de présentation avec 4 téléphones |
| Fidélité aux données de l'app | textes et chiffres réels (Gare Rabat Ville → Gare de Kénitra, 41 min / 47 km), 10 types d'incidents exacts | chiffres inventés, types d'incidents différents de l'application |
| Qualité rédactionnelle | conforme | fautes (« indisponsible », « Emboutaillage ») |
| Réutilisation par le code | variables de couleur, styles de texte, effet d'ombre, composants (Bouton, Carte itinéraire, Tuile incident, Bouton carte, Pastille état), 10 icônes vectorielles | maquettes aplaties, non exploitables écran par écran |
| Atout | spécification directement transposable | rendu « vitrine » efficace pour une présentation |

**Décision : la proposition Figma est retenue** et sert de référence à l'interface. La planche Canva peut servir de visuel de présentation (après correction des textes).

## Système retenu

- **Typographie** : Atkinson Hyperlegible Next (lisibilité d'un coup d'œil en conduite). Échelle : manœuvre 44 ExtraBold, titre 22, durée 28, corps 17, légende 14.
- **Couleurs** : primaire `#1D5FA6` (bleu des Oudayas), profond `#0B3563`, doux `#E4EEF9`, fond `#F3F5F8`, encre `#14202B`, atténué `#5B6673`, trait `#DDE3EA`, alerte `#C62828`. Vert / orange / rouge / rouge foncé / gris réservés au trafic.
- **Formes** : boutons et tuiles 14 px, cartes 16 px, barre de recherche 18 px, feuilles 24 px, bandeau de manœuvre 26 px ; ombre « flottant » à deux couches.
- **Pictogrammes** : tracés vectoriels communs à la maquette (`Icône incident/*`), à l'interface (`src/lib/icons.ts`) et aux marqueurs de la carte.
- **Mode sombre** : défini dans le code (`src/index.css`) ; l'offre Figma gratuite ne permet qu'un mode de variables.

## Écrans complémentaires (Incidents, Compte, Administration, ordinateur)

Composants ajoutés au fichier Figma : **Ligne incident**, **Champ**, **Interrupteur**, **Segment**, **Statistique**.
Les écrans 5 à 8 n'ont pas pu être dessinés dans Figma (limite d'appels de l'offre Figma Starter) ; ils sont
implémentés directement dans l'application à partir de ces composants :

| Écran | Composition |
|---|---|
| Incidents | onglets de la feuille · titre 22 + compteur · résumé par pictogramme · Segment « En cours / Dernières 24 h » · 3 Champs de filtre · liste de Lignes incident (pastille 40 px à anneau coloré) |
| Compte | encart « sans compte » (fond `#F3F5F8`, rayon 14) · Champs e-mail / mot de passe · Bouton primaire pleine largeur · lignes de préférence 48 px avec Interrupteur (48×28) |
| Administration | bandeau bleu primaire · sections en cartes flottantes (rayon 16, ombre « flottant ») · tuiles Statistique (libellé 14, valeur 28 gras) |
| Ordinateur (≥ 1024 px) | panneau latéral flottant de 400 px (rayon 24, ombre « flottant ») posé sur la carte, marges de 12 px |

Classes CSS correspondantes : `.field`, `.field-label`, `.segment` / `.segment-item`, `.switch`, `.stat`, `.note-card`, `.pref-row`, `.panel-title`, `.btn-*` (`src/index.css`).
