-- La fonction « traffic » (rôle service) lit les axes à mesurer et écrit les mesures.
-- Ces droits n'étaient pas accordés par défaut au rôle service sur ce projet.
grant select on public.traffic_points to service_role;
grant select, insert, update on public.traffic_segments to service_role;

-- Trois points rattachés par TomTom à une voie locale proche plutôt qu'à l'autoroute : noms corrigés.
update public.traffic_points set name = case id
  when 'a1-sale-nord' then 'Axe nord de Salé'
  when 'a1-temara' then 'Axe ouest de Témara'
  when 'a1-skhirat' then 'Axe principal de Skhirat' end
where id in ('a1-sale-nord', 'a1-temara', 'a1-skhirat');
