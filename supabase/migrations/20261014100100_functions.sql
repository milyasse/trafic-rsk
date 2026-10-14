-- =====================================================================
-- Trafic RSK — fonctions métier (validation côté serveur)
-- =====================================================================

create or replace function private.setting(p_key text)
returns jsonb language sql stable security definer set search_path = '' as $$
  select value from public.app_settings where key = p_key;
$$;

create or replace function private.nearest_city(p_lat double precision, p_lng double precision)
returns text language sql stable security definer set search_path = '' as $$
  select coalesce((
    select c.name
    from public.cities c
    where extensions.st_dwithin(
      extensions.st_setsrid(extensions.st_makepoint(c.lng, c.lat), 4326)::extensions.geography,
      extensions.st_setsrid(extensions.st_makepoint(p_lng, p_lat), 4326)::extensions.geography,
      30000)
    order by extensions.st_distance(
      extensions.st_setsrid(extensions.st_makepoint(c.lng, c.lat), 4326)::extensions.geography,
      extensions.st_setsrid(extensions.st_makepoint(p_lng, p_lat), 4326)::extensions.geography)
    limit 1), 'Autre');
$$;

-- Recalcule compteurs et statut d'un signalement après un vote
create or replace function private.apply_vote(p_report_id uuid, p_user uuid, p_vote text)
returns void language plpgsql security definer set search_path = '' as $$
declare
  v_is_author boolean;
  v_confirm int; v_gone int; v_abuse int; v_gone_after_last_confirm int;
  v_resolve_threshold int := (private.setting('resolve_votes_threshold'))::text::int;
  v_hide_threshold int := (private.setting('hide_flags_threshold'))::text::int;
  v_extend int := (private.setting('confirm_extends_minutes'))::text::int;
begin
  select exists (select 1 from private.report_authors a where a.report_id = p_report_id and a.user_id = p_user)
    into v_is_author;

  insert into public.report_votes (report_id, user_id, vote)
  values (p_report_id, p_user, p_vote)
  on conflict (report_id, user_id) do update set vote = excluded.vote, created_at = now();

  select count(*) filter (where vote = 'confirm'),
         count(*) filter (where vote = 'gone'),
         count(*) filter (where vote = 'abuse')
    into v_confirm, v_gone, v_abuse
    from public.report_votes where report_id = p_report_id;

  select count(*) into v_gone_after_last_confirm
    from public.report_votes v
   where v.report_id = p_report_id and v.vote = 'gone'
     and v.created_at > coalesce((select max(created_at) from public.report_votes
                                   where report_id = p_report_id and vote = 'confirm'), '-infinity');

  update public.reports r set
    confirmations = v_confirm,
    resolutions   = v_gone,
    flags         = v_abuse,
    updated_at    = now(),
    status = case
      when v_abuse >= v_hide_threshold then 'hidden'
      when p_vote = 'gone' and v_is_author then 'resolved'
      when v_gone_after_last_confirm >= v_resolve_threshold then 'resolved'
      when p_vote = 'confirm' then 'confirmed'
      else r.status end,
    expires_at = case
      when p_vote = 'confirm' then greatest(r.expires_at, now() + make_interval(mins => v_extend))
      else r.expires_at end
  where r.id = p_report_id;
end $$;

-- ---------------------------------------------------------------------
-- Créer un signalement (fusion automatique avec un signalement identique proche)
-- ---------------------------------------------------------------------
create or replace function public.create_report(
  p_type text, p_severity integer, p_lat double precision, p_lng double precision,
  p_description text default null)
returns jsonb language plpgsql security definer set search_path = '' as $$
declare
  v_uid uuid := auth.uid();
  v_bbox jsonb := private.setting('coverage_bbox');
  v_rl jsonb := private.setting('report_rate_limit');
  v_radius double precision := (private.setting('merge_radius_m'))::text::double precision;
  v_ttl int;
  v_desc text := nullif(btrim(p_description), '');
  v_count int;
  v_existing uuid;
  v_id uuid;
  v_point extensions.geography;
begin
  if v_uid is null then raise exception 'auth_required' using errcode = '28000'; end if;
  if p_type is null or p_type not in ('jam','accident','road_closed','roadworks','breakdown','obstacle','flood','danger','police','other') then
    raise exception 'invalid_type' using errcode = '22023';
  end if;
  if p_severity is null or p_severity not between 1 and 3 then
    raise exception 'invalid_severity' using errcode = '22023';
  end if;
  if p_lat is null or p_lng is null
     or p_lat < (v_bbox->>'min_lat')::float8 or p_lat > (v_bbox->>'max_lat')::float8
     or p_lng < (v_bbox->>'min_lng')::float8 or p_lng > (v_bbox->>'max_lng')::float8 then
    raise exception 'out_of_coverage' using errcode = '22023';
  end if;
  if v_desc is not null and char_length(v_desc) > 280 then
    raise exception 'description_too_long' using errcode = '22023';
  end if;

  select count(*) into v_count from private.report_authors
   where user_id = v_uid and created_at > now() - make_interval(mins => (v_rl->>'window_minutes')::int);
  if v_count >= (v_rl->>'max')::int then
    raise exception 'rate_limited' using errcode = 'P0001';
  end if;

  v_point := extensions.st_setsrid(extensions.st_makepoint(p_lng, p_lat), 4326)::extensions.geography;

  select r.id into v_existing
    from public.reports r
   where r.type = p_type and r.status in ('active','confirmed') and r.expires_at > now()
     and extensions.st_dwithin(r.location, v_point, v_radius)
   order by extensions.st_distance(r.location, v_point)
   limit 1;

  if v_existing is not null then
    if not exists (select 1 from private.report_authors a where a.report_id = v_existing and a.user_id = v_uid) then
      perform private.apply_vote(v_existing, v_uid, 'confirm');
    end if;
    return jsonb_build_object('id', v_existing, 'merged', true);
  end if;

  v_ttl := coalesce((private.setting('report_ttl_minutes')->>p_type)::int, 120);

  insert into public.reports (type, severity, description, lat, lng, city, source, expires_at)
  values (p_type, p_severity, v_desc, p_lat, p_lng, private.nearest_city(p_lat, p_lng),
          case when public.is_admin() then 'admin' else 'community' end,
          now() + make_interval(mins => v_ttl))
  returning id into v_id;

  insert into private.report_authors (report_id, user_id) values (v_id, v_uid);

  return jsonb_build_object('id', v_id, 'merged', false);
end $$;

-- ---------------------------------------------------------------------
-- Voter : confirmer, signaler la disparition, signaler un abus
-- ---------------------------------------------------------------------
create or replace function public.vote_report(p_report_id uuid, p_vote text)
returns jsonb language plpgsql security definer set search_path = '' as $$
declare
  v_uid uuid := auth.uid();
  v_rl jsonb := private.setting('vote_rate_limit');
  v_status text;
  v_count int;
  v_is_author boolean;
  v_row public.reports;
begin
  if v_uid is null then raise exception 'auth_required' using errcode = '28000'; end if;
  if p_vote not in ('confirm','gone','abuse') then raise exception 'invalid_vote' using errcode = '22023'; end if;

  select status into v_status from public.reports where id = p_report_id for update;
  if v_status is null or v_status = 'hidden' then raise exception 'not_found' using errcode = 'P0002'; end if;
  if v_status in ('resolved','expired') and p_vote <> 'abuse' then
    raise exception 'report_closed' using errcode = 'P0001';
  end if;

  select count(*) into v_count from public.report_votes
   where user_id = v_uid and created_at > now() - make_interval(mins => (v_rl->>'window_minutes')::int);
  if v_count >= (v_rl->>'max')::int then raise exception 'rate_limited' using errcode = 'P0001'; end if;

  select exists (select 1 from private.report_authors a where a.report_id = p_report_id and a.user_id = v_uid)
    into v_is_author;
  if v_is_author and p_vote in ('confirm','abuse') then
    raise exception 'own_report' using errcode = 'P0001';
  end if;

  perform private.apply_vote(p_report_id, v_uid, p_vote);

  select * into v_row from public.reports where id = p_report_id;
  return jsonb_build_object('id', v_row.id, 'status', v_row.status, 'confirmations', v_row.confirmations,
                            'resolutions', v_row.resolutions, 'expires_at', v_row.expires_at);
end $$;

-- Mes signalements (pour afficher « vous avez signalé ceci »)
create or replace function public.my_report_ids()
returns setof uuid language sql stable security definer set search_path = '' as $$
  select a.report_id from private.report_authors a
   where a.user_id = auth.uid() and a.created_at > now() - interval '2 days';
$$;

-- ---------------------------------------------------------------------
-- Administration
-- ---------------------------------------------------------------------
create or replace function public.admin_stats()
returns jsonb language plpgsql stable security definer set search_path = '' as $$
declare v jsonb;
begin
  if not public.is_admin() then raise exception 'forbidden' using errcode = '42501'; end if;
  select jsonb_build_object(
    'active', (select count(*) from public.reports where status in ('active','confirmed') and expires_at > now()),
    'hidden', (select count(*) from public.reports where status = 'hidden'),
    'last_24h', (select count(*) from public.reports where created_at > now() - interval '24 hours'),
    'last_7d', (select count(*) from public.reports where created_at > now() - interval '7 days'),
    'by_type_24h', coalesce((select jsonb_object_agg(type, n) from (
        select type, count(*) n from public.reports where created_at > now() - interval '24 hours' group by type) t), '{}'),
    'by_city_24h', coalesce((select jsonb_object_agg(city, n) from (
        select coalesce(city,'Autre') city, count(*) n from public.reports where created_at > now() - interval '24 hours' group by 1) t), '{}'),
    'by_status_7d', coalesce((select jsonb_object_agg(status, n) from (
        select status, count(*) n from public.reports where created_at > now() - interval '7 days' group by status) t), '{}'),
    'users', (select count(*) from public.profiles),
    'votes_24h', (select count(*) from public.report_votes where created_at > now() - interval '24 hours')
  ) into v;
  return v;
end $$;

-- ---------------------------------------------------------------------
-- Fonctions réservées au serveur (Edge Functions, rôle service_role)
-- ---------------------------------------------------------------------
create or replace function public.hit_rate_limit(p_key text, p_max integer, p_window_seconds integer)
returns boolean language plpgsql security definer set search_path = '' as $$
declare v_start timestamptz; v_hits int;
begin
  v_start := to_timestamp(floor(extract(epoch from now()) / p_window_seconds) * p_window_seconds);
  insert into private.rate_limits (key, window_start, hits) values (p_key, v_start, 1)
  on conflict (key, window_start) do update set hits = private.rate_limits.hits + 1
  returning hits into v_hits;
  return v_hits <= p_max;
end $$;

create or replace function public.record_service_call(p_service text, p_provider text, p_ok boolean, p_error text default null)
returns void language plpgsql security definer set search_path = '' as $$
begin
  insert into public.service_status as s (service, ok, provider, last_success_at, last_error_at, last_error, calls_today, errors_today, day)
  values (p_service, p_ok, p_provider,
          case when p_ok then now() end, case when not p_ok then now() end,
          case when not p_ok then left(p_error, 500) end,
          1, case when p_ok then 0 else 1 end, current_date)
  on conflict (service) do update set
    ok = excluded.ok,
    provider = excluded.provider,
    last_success_at = coalesce(excluded.last_success_at, s.last_success_at),
    last_error_at = coalesce(excluded.last_error_at, s.last_error_at),
    last_error = coalesce(excluded.last_error, s.last_error),
    calls_today = case when s.day = current_date then s.calls_today + 1 else 1 end,
    errors_today = case when s.day = current_date then s.errors_today else 0 end + excluded.errors_today,
    day = current_date;
end $$;

create or replace function public.claim_traffic_refresh(p_points integer)
returns jsonb language plpgsql security definer set search_path = '' as $$
declare
  s jsonb := private.setting('traffic');
  st public.traffic_status;
  v_local timestamp := now() at time zone 'Africa/Casablanca';
  v_hour int := extract(hour from v_local);
  v_refresh int := (s->>'refresh_minutes')::int;
begin
  select * into st from public.traffic_status where id = 1 for update;
  if st.requests_day is distinct from v_local::date then
    update public.traffic_status set requests_today = 0, requests_day = v_local::date where id = 1;
    st.requests_today := 0;
  end if;

  if not coalesce((s->>'enabled')::boolean, false) then
    return jsonb_build_object('claimed', false, 'reason', 'disabled');
  end if;
  if v_hour < (s->'active_hours'->>0)::int or v_hour >= (s->'active_hours'->>1)::int then
    return jsonb_build_object('claimed', false, 'reason', 'outside_hours');
  end if;
  if st.lock_until is not null and st.lock_until > now() then
    return jsonb_build_object('claimed', false, 'reason', 'locked');
  end if;
  if st.last_success_at is not null and st.last_success_at > now() - make_interval(mins => v_refresh) then
    return jsonb_build_object('claimed', false, 'reason', 'fresh');
  end if;
  if st.last_attempt_at is not null and st.last_attempt_at > now() - make_interval(mins => least(v_refresh, 5)) then
    return jsonb_build_object('claimed', false, 'reason', 'cooldown');
  end if;
  if st.requests_today + p_points > (s->>'daily_budget')::int then
    return jsonb_build_object('claimed', false, 'reason', 'budget_exhausted');
  end if;

  update public.traffic_status
     set lock_until = now() + interval '2 minutes',
         last_attempt_at = now(),
         requests_today = requests_today + p_points
   where id = 1;
  return jsonb_build_object('claimed', true);
end $$;

create or replace function public.finish_traffic_refresh(
  p_provider text, p_available boolean, p_message text, p_success boolean)
returns void language plpgsql security definer set search_path = '' as $$
begin
  update public.traffic_status set
    provider = p_provider,
    available = p_available,
    message = p_message,
    lock_until = null,
    last_success_at = case when p_success then now() else last_success_at end
  where id = 1
    and (provider is distinct from p_provider or available is distinct from p_available
         or message is distinct from p_message or p_success or lock_until is not null);
end $$;

-- ---------------------------------------------------------------------
-- Maintenance planifiée : expiration et conservation des données
-- ---------------------------------------------------------------------
create or replace function private.expire_reports()
returns integer language plpgsql security definer set search_path = '' as $$
declare n int;
begin
  update public.reports set status = 'expired', updated_at = now()
   where status in ('active','confirmed') and expires_at < now();
  get diagnostics n = row_count;
  return n;
end $$;


-- Horodatage des modifications de paramètres
create or replace function private.touch_setting()
returns trigger language plpgsql security definer set search_path = '' as $$
begin
  new.updated_at := now();
  new.updated_by := auth.uid();
  return new;
end $$;
create trigger app_settings_touch before update on public.app_settings
  for each row execute function private.touch_setting();
