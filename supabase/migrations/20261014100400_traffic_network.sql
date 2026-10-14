-- Réseau d'axes mesurés élargi : grands axes des villes prioritaires (12 → 32 points).
-- Chaque point est rattaché par le fournisseur au tronçon routier le plus proche.
-- Budget : 32 points × 16 actualisations (toutes les heures, 6 h – 22 h) = 512 requêtes/jour
-- ≈ 15 400/mois, sous l'offre gratuite TomTom (20 000/mois) ; plafond journalier 660.
insert into public.traffic_points (id, name, city, lat, lng) values
  ('rabat-pont-moulay-hassan', 'Pont Mohammed VI (rocade Rabat ↔ Salé)', 'Rabat', 34.0080, -6.7930),
  ('rabat-agdal-ibn-sina', 'Avenue Ibn Sina, Agdal', 'Rabat', 33.9990, -6.8510),
  ('rabat-allal-el-fassi', 'Avenue Allal El Fassi', 'Rabat', 33.9810, -6.8600),
  ('rabat-mehdi-ben-barka', 'Avenue Mehdi Ben Barka, Souissi', 'Rabat', 33.9660, -6.8560),
  ('rabat-akkari-hassan2', 'Avenue Hassan II, Akkari', 'Rabat', 34.0040, -6.8600),
  ('rabat-corniche', 'Corniche de Rabat', 'Rabat', 34.0230, -6.8520),
  ('sale-tabriquet-hassan2', 'Avenue Hassan II, Tabriquet', 'Salé', 34.0480, -6.7920),
  ('sale-al-jadida', 'Boulevard principal, Salé Al Jadida', 'Salé', 34.0080, -6.7500),
  ('sale-route-kenitra', 'Route de Kénitra (N1), sortie nord de Salé', 'Salé', 34.0680, -6.7720),
  ('temara-hassan2', 'Avenue Hassan II, centre de Témara', 'Témara', 33.9280, -6.9120),
  ('temara-harhoura', 'Route côtière, Harhoura', 'Témara', 33.9500, -6.9400),
  ('skhirat-n1', 'Route nationale 1, Skhirat', 'Skhirat', 33.8530, -7.0350),
  ('kenitra-diouri', 'Boulevard Mohammed Diouri', 'Kénitra', 34.2620, -6.5750),
  ('kenitra-hassan2', 'Avenue Hassan II, Kénitra', 'Kénitra', 34.2540, -6.5900),
  ('kenitra-pont-sebou', 'Pont sur le Sebou, route de Mehdia', 'Kénitra', 34.2720, -6.6050),
  ('kenitra-n1-nord', 'Route nationale 1, sortie nord de Kénitra', 'Kénitra', 34.2950, -6.5550),
  ('sidi-kacem-centre', 'Traversée de Sidi Kacem (N4)', 'Sidi Kacem', 34.2260, -5.7070),
  ('sidi-slimane-centre', 'Traversée de Sidi Slimane', 'Sidi Slimane', 34.2650, -5.9250),
  ('khemisset-centre', 'Avenue Mohammed V, Khémisset', 'Khémisset', 33.8240, -6.0660),
  ('a2-khemisset', 'Autoroute A2, échangeur de Khémisset', 'Khémisset', 33.8150, -6.0300)
on conflict (id) do nothing;

update public.app_settings
set value = value || '{"refresh_minutes":60,"daily_budget":660}'::jsonb
where key = 'traffic';
