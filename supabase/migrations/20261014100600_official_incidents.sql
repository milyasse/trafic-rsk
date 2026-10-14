-- Incidents officiels du fournisseur de trafic (TomTom Traffic Incidents) : accidents, fermetures,
-- travaux, bouchons, intempéries… Récupérés côté serveur par la fonction « traffic » (une requête par
-- zone et par actualisation), jamais par le navigateur. Les incidents qui ne sont plus publiés par le
-- fournisseur passent à active = false.
create table public.official_incidents (
  id            text primary key,
  provider      text not null default 'tomtom',
  category      smallint not null default 0,
  magnitude     smallint not null default 0,
  description   text,
  from_name     text,
  to_name       text,
  road_numbers  text[] not null default '{}',
  length_m      numeric,
  delay_s       integer,
  start_time    timestamptz,
  end_time      timestamptz,
  geometry      jsonb not null,
  lat           double precision not null,
  lng           double precision not null,
  active        boolean not null default true,
  observed_at   timestamptz not null default now()
);
create index official_incidents_active_idx on public.official_incidents (active) where active;

alter table public.official_incidents enable row level security;
create policy "official_incidents: lecture publique" on public.official_incidents for select
  to anon, authenticated using (true);
grant select on public.official_incidents to anon, authenticated;
grant select, insert, update on public.official_incidents to service_role;

alter publication supabase_realtime add table public.official_incidents;
