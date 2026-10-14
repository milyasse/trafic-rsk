-- =====================================================================
-- Trafic RSK — schéma principal
-- PostGIS pour les requêtes spatiales (fusion de signalements proches,
-- incidents le long d'un itinéraire), RLS partout, écritures sensibles
-- uniquement via des fonctions SECURITY DEFINER validées côté serveur.
-- =====================================================================

create extension if not exists postgis with schema extensions;
create extension if not exists pg_cron;

create schema if not exists private;
revoke all on schema private from public, anon, authenticated;

-- ---------------------------------------------------------------------
-- Paramètres de configuration (lisibles par tous, modifiables par admin)
-- ---------------------------------------------------------------------
create table public.app_settings (
  key         text primary key,
  value       jsonb not null,
  description text,
  updated_at  timestamptz not null default now(),
  updated_by  uuid
);

insert into public.app_settings (key, value, description) values
  ('report_ttl_minutes',
   '{"jam":60,"accident":120,"road_closed":360,"roadworks":1440,"breakdown":60,"obstacle":90,"flood":360,"danger":240,"police":60,"other":120}',
   'Durée de validité initiale d''un signalement, par type (minutes)'),
  ('confirm_extends_minutes', '30', 'Prolongation de validité à chaque confirmation (minutes)'),
  ('resolve_votes_threshold', '2', 'Nombre de votes « disparu » nécessaires pour résoudre un incident'),
  ('hide_flags_threshold', '3', 'Nombre de signalements d''abus avant masquage automatique (en attente de modération)'),
  ('report_rate_limit', '{"max":5,"window_minutes":10}', 'Nombre maximal de signalements par utilisateur et par fenêtre'),
  ('vote_rate_limit', '{"max":30,"window_minutes":10}', 'Nombre maximal de votes par utilisateur et par fenêtre'),
  ('merge_radius_m', '150', 'Rayon de fusion des signalements identiques (mètres)'),
  ('coverage_bbox', '{"min_lng":-7.35,"min_lat":33.35,"max_lng":-5.35,"max_lat":34.95}', 'Zone couverte (région Rabat-Salé-Kénitra)'),
  ('traffic', '{"enabled":true,"refresh_minutes":30,"active_hours":[6,22],"daily_budget":600,"stale_after_minutes":75}',
   'Interrogation du fournisseur de trafic : fréquence, heures actives (heure du Maroc), budget journalier de requêtes'),
  ('retention_days', '{"reports":30,"history":90}', 'Durée de conservation des signalements et de l''historique');

-- ---------------------------------------------------------------------
-- Profils utilisateurs
-- ---------------------------------------------------------------------
create table public.profiles (
  id              uuid primary key references auth.users(id) on delete cascade,
  display_name    text check (char_length(display_name) <= 40),
  role            text not null default 'user' check (role in ('user','admin')),
  preferences     jsonb not null default '{}'::jsonb,
  history_consent boolean not null default false,
  created_at      timestamptz not null default now()
);

create table private.admin_emails (email text primary key);

create or replace function private.handle_new_user()
returns trigger language plpgsql security definer set search_path = '' as $$
begin
  insert into public.profiles (id, role)
  values (
    new.id,
    case when new.email is not null
          and exists (select 1 from private.admin_emails a where lower(a.email) = lower(new.email))
         then 'admin' else 'user' end
  )
  on conflict (id) do nothing;
  return new;
end $$;

create trigger on_auth_user_created
  after insert on auth.users
  for each row execute function private.handle_new_user();

-- Lorsqu'un compte anonyme est converti en compte e-mail
create or replace function private.handle_user_email_set()
returns trigger language plpgsql security definer set search_path = '' as $$
begin
  if new.email is not null and (old.email is distinct from new.email)
     and exists (select 1 from private.admin_emails a where lower(a.email) = lower(new.email)) then
    update public.profiles set role = 'admin' where id = new.id;
  end if;
  return new;
end $$;

create trigger on_auth_user_email_set
  after update of email on auth.users
  for each row execute function private.handle_user_email_set();

create or replace function public.is_admin()
returns boolean language sql stable security definer set search_path = '' as $$
  select exists (select 1 from public.profiles p where p.id = auth.uid() and p.role = 'admin');
$$;

-- ---------------------------------------------------------------------
-- Villes de référence (rattachement des signalements, filtres)
-- ---------------------------------------------------------------------
create table public.cities (
  name text primary key,
  lat  double precision not null,
  lng  double precision not null,
  priority smallint not null default 2
);

insert into public.cities (name, lat, lng, priority) values
  ('Rabat', 34.0132, -6.8326, 1), ('Salé', 34.0531, -6.7985, 1),
  ('Témara', 33.9287, -6.9063, 1), ('Skhirat', 33.8527, -7.0322, 1),
  ('Kénitra', 34.2610, -6.5802, 1), ('Sidi Kacem', 34.2214, -5.7078, 1),
  ('Sidi Slimane', 34.2597, -5.9264, 1), ('Khémisset', 33.8240, -6.0663, 1),
  ('Tiflet', 33.8947, -6.3065, 2), ('Sidi Yahya El Gharb', 34.3050, -6.3058, 2),
  ('Mehdia', 34.2569, -6.6546, 2), ('Bouknadel', 34.1253, -6.7445, 2),
  ('Aïn Aouda', 33.8114, -6.7924, 2), ('Rommani', 33.5272, -6.6078, 2),
  ('Souk El Arbaa', 34.6855, -5.9849, 2), ('Sidi Allal El Bahraoui', 33.9817, -6.5233, 2),
  ('Harhoura', 33.9500, -6.9330, 2), ('Sidi Taibi', 34.1906, -6.6831, 2);

-- ---------------------------------------------------------------------
-- Signalements communautaires
-- ---------------------------------------------------------------------
create table public.reports (
  id            uuid primary key default gen_random_uuid(),
  type          text not null check (type in ('jam','accident','road_closed','roadworks','breakdown','obstacle','flood','danger','police','other')),
  severity      smallint not null default 2 check (severity between 1 and 3),
  description   text check (char_length(description) <= 280),
  lat           double precision not null check (lat between 20.5 and 36.0),
  lng           double precision not null check (lng between -17.5 and -0.9),
  location      extensions.geography(Point, 4326)
                generated always as (extensions.st_setsrid(extensions.st_makepoint(lng, lat), 4326)::extensions.geography) stored,
  city          text,
  status        text not null default 'active' check (status in ('active','confirmed','resolved','expired','hidden')),
  confirmations integer not null default 0,
  resolutions   integer not null default 0,
  flags         integer not null default 0,
  source        text not null default 'community' check (source in ('community','admin')),
  created_at    timestamptz not null default now(),
  updated_at    timestamptz not null default now(),
  expires_at    timestamptz not null
);

create index reports_location_gix on public.reports using gist (location);
create index reports_status_expires_idx on public.reports (status, expires_at);
create index reports_created_idx on public.reports (created_at desc);

-- Auteur d'un signalement : jamais exposé publiquement
create table private.report_authors (
  report_id uuid primary key references public.reports(id) on delete cascade,
  user_id   uuid not null references auth.users(id) on delete cascade,
  created_at timestamptz not null default now()
);
create index report_authors_user_idx on private.report_authors (user_id, created_at desc);

create table public.report_votes (
  report_id  uuid not null references public.reports(id) on delete cascade,
  user_id    uuid not null references auth.users(id) on delete cascade,
  vote       text not null check (vote in ('confirm','gone','abuse')),
  created_at timestamptz not null default now(),
  primary key (report_id, user_id)
);
create index report_votes_user_idx on public.report_votes (user_id, created_at desc);

-- ---------------------------------------------------------------------
-- Favoris et historique (privés)
-- ---------------------------------------------------------------------
create table public.favorites (
  id         uuid primary key default gen_random_uuid(),
  user_id    uuid not null default auth.uid() references auth.users(id) on delete cascade,
  kind       text not null default 'other' check (kind in ('home','work','other')),
  label      text not null check (char_length(label) between 1 and 80),
  address    text check (char_length(address) <= 200),
  lat        double precision not null check (lat between 20.5 and 36.0),
  lng        double precision not null check (lng between -17.5 and -0.9),
  created_at timestamptz not null default now()
);
create unique index favorites_one_home_work on public.favorites (user_id, kind) where kind in ('home','work');
create index favorites_user_idx on public.favorites (user_id);

create table public.destination_history (
  id         uuid primary key default gen_random_uuid(),
  user_id    uuid not null default auth.uid() references auth.users(id) on delete cascade,
  label      text not null check (char_length(label) between 1 and 200),
  lat        double precision not null check (lat between 20.5 and 36.0),
  lng        double precision not null check (lng between -17.5 and -0.9),
  created_at timestamptz not null default now()
);
create index destination_history_user_idx on public.destination_history (user_id, created_at desc);

-- ---------------------------------------------------------------------
-- Trafic (fournisseur externe, écrit uniquement par la fonction serveur)
-- ---------------------------------------------------------------------
create table public.traffic_points (
  id      text primary key,
  name    text not null,
  city    text not null,
  lat     double precision not null,
  lng     double precision not null,
  enabled boolean not null default true
);

insert into public.traffic_points (id, name, city, lat, lng) values
  ('rabat-sale-pont-hassan2', 'Pont Hassan II (Rabat ↔ Salé)', 'Rabat', 34.0249, -6.8226),
  ('rabat-centre-hassan2', 'Boulevard Hassan II, centre', 'Rabat', 34.0175, -6.8350),
  ('rabat-hay-riad-annakhil', 'Avenue Annakhil, Hay Riad', 'Rabat', 33.9575, -6.8725),
  ('rabat-souissi-m6', 'Avenue Mohammed VI, Souissi', 'Rabat', 33.9760, -6.8460),
  ('a1-sale-nord', 'Autoroute A1, sortie Salé', 'Salé', 34.0470, -6.7560),
  ('a1-bouknadel', 'Autoroute A1, Bouknadel', 'Salé', 34.1300, -6.7300),
  ('a1-kenitra-sud', 'Autoroute A1, entrée sud de Kénitra', 'Kénitra', 34.2200, -6.6100),
  ('kenitra-centre', 'Avenue Mohammed V, centre', 'Kénitra', 34.2580, -6.5800),
  ('temara-n1', 'Route nationale 1, Témara', 'Témara', 33.9260, -6.9060),
  ('a1-temara', 'Autoroute A1, Témara', 'Témara', 33.9100, -6.9200),
  ('a1-skhirat', 'Autoroute A1, Skhirat', 'Skhirat', 33.8500, -7.0200),
  ('a2-sidi-allal', 'Autoroute A2, Sidi Allal El Bahraoui', 'Khémisset', 33.9800, -6.5200);

create table public.traffic_segments (
  point_id              text primary key references public.traffic_points(id) on delete cascade,
  name                  text not null,
  city                  text not null,
  level                 text not null check (level in ('fluid','slow','heavy','jam','unknown')),
  current_speed         numeric,
  free_flow_speed       numeric,
  current_travel_time   integer,
  free_flow_travel_time integer,
  confidence            numeric,
  road_closure          boolean not null default false,
  geometry              jsonb not null,
  provider              text not null,
  observed_at           timestamptz not null
);

create table public.traffic_status (
  id              smallint primary key default 1 check (id = 1),
  provider        text,
  available       boolean not null default false,
  message         text not null default 'no_provider',
  last_success_at timestamptz,
  last_attempt_at timestamptz,
  requests_day    date,
  requests_today  integer not null default 0,
  lock_until      timestamptz
);
insert into public.traffic_status (id) values (1);

-- État des services externes (visible des administrateurs)
create table public.service_status (
  service         text primary key,
  ok              boolean not null default true,
  provider        text,
  last_success_at timestamptz,
  last_error_at   timestamptz,
  last_error      text,
  calls_today     integer not null default 0,
  errors_today    integer not null default 0,
  day             date not null default current_date
);

-- Limitation de débit générique (utilisée par les Edge Functions)
create table private.rate_limits (
  key          text not null,
  window_start timestamptz not null,
  hits         integer not null default 0,
  primary key (key, window_start)
);
