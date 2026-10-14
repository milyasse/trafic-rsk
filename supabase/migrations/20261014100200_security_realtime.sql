-- =====================================================================
-- Trafic RSK — RLS, privilèges, temps réel, tâches planifiées
-- =====================================================================

alter table public.app_settings        enable row level security;
alter table public.profiles            enable row level security;
alter table public.cities              enable row level security;
alter table public.reports             enable row level security;
alter table public.report_votes        enable row level security;
alter table public.favorites           enable row level security;
alter table public.destination_history enable row level security;
alter table public.traffic_points      enable row level security;
alter table public.traffic_segments    enable row level security;
alter table public.traffic_status      enable row level security;
alter table public.service_status      enable row level security;

-- Privilèges de base : lecture contrôlée par RLS, écritures limitées aux colonnes utiles
revoke insert, update, delete, truncate on all tables in schema public from anon, authenticated;

grant select on public.app_settings, public.cities, public.reports, public.traffic_points,
                public.traffic_segments, public.traffic_status to anon, authenticated;
grant select on public.profiles, public.report_votes, public.favorites,
                public.destination_history, public.service_status to authenticated;

grant update (value) on public.app_settings to authenticated;
grant update (display_name, preferences, history_consent) on public.profiles to authenticated;
grant update (status, severity, description, expires_at) on public.reports to authenticated;
grant delete on public.reports to authenticated;
grant insert, update (kind, label, address, lat, lng), delete on public.favorites to authenticated;
grant insert (label, lat, lng), delete on public.destination_history to authenticated;
grant update (enabled) on public.traffic_points to authenticated;

-- app_settings
create policy "settings: lecture publique" on public.app_settings for select using (true);
create policy "settings: modification admin" on public.app_settings for update
  to authenticated using (public.is_admin()) with check (public.is_admin());

-- profiles
create policy "profiles: lecture du sien ou admin" on public.profiles for select
  to authenticated using (id = (select auth.uid()) or public.is_admin());
create policy "profiles: modification du sien" on public.profiles for update
  to authenticated using (id = (select auth.uid())) with check (id = (select auth.uid()));

-- cities
create policy "cities: lecture publique" on public.cities for select using (true);

-- reports : visibles par tous sauf masqués ; modération admin
create policy "reports: lecture publique" on public.reports for select
  using (status <> 'hidden' or public.is_admin());
create policy "reports: modération admin" on public.reports for update
  to authenticated using (public.is_admin()) with check (public.is_admin());
create policy "reports: suppression admin" on public.reports for delete
  to authenticated using (public.is_admin());

-- report_votes : chacun ne voit que ses votes ; écriture via vote_report()
create policy "votes: lecture des siens" on public.report_votes for select
  to authenticated using (user_id = (select auth.uid()));

-- favorites
create policy "favorites: lecture des siens" on public.favorites for select
  to authenticated using (user_id = (select auth.uid()));
create policy "favorites: ajout" on public.favorites for insert
  to authenticated with check (user_id = (select auth.uid()));
create policy "favorites: modification" on public.favorites for update
  to authenticated using (user_id = (select auth.uid())) with check (user_id = (select auth.uid()));
create policy "favorites: suppression" on public.favorites for delete
  to authenticated using (user_id = (select auth.uid()));

-- destination_history : uniquement avec consentement explicite
create policy "history: lecture du sien" on public.destination_history for select
  to authenticated using (user_id = (select auth.uid()));
create policy "history: ajout avec consentement" on public.destination_history for insert
  to authenticated with check (
    user_id = (select auth.uid())
    and exists (select 1 from public.profiles p where p.id = (select auth.uid()) and p.history_consent));
create policy "history: suppression" on public.destination_history for delete
  to authenticated using (user_id = (select auth.uid()));

-- trafic
create policy "traffic_points: lecture publique" on public.traffic_points for select using (true);
create policy "traffic_points: admin" on public.traffic_points for update
  to authenticated using (public.is_admin()) with check (public.is_admin());
create policy "traffic_segments: lecture publique" on public.traffic_segments for select using (true);
create policy "traffic_status: lecture publique" on public.traffic_status for select using (true);
create policy "service_status: admin" on public.service_status for select
  to authenticated using (public.is_admin());

-- Fonctions : exposer uniquement ce qui doit l'être
revoke execute on all functions in schema public from public, anon, authenticated;
revoke execute on all functions in schema private from public, anon, authenticated;

grant execute on function public.is_admin() to anon, authenticated;
grant execute on function public.create_report(text, integer, double precision, double precision, text) to authenticated;
grant execute on function public.vote_report(uuid, text) to authenticated;
grant execute on function public.my_report_ids() to authenticated;
grant execute on function public.delete_my_account() to authenticated;
grant execute on function public.admin_stats() to authenticated;

grant execute on function public.hit_rate_limit(text, integer, integer) to service_role;
grant execute on function public.record_service_call(text, text, boolean, text) to service_role;
grant execute on function public.claim_traffic_refresh(integer) to service_role;
grant execute on function public.finish_traffic_refresh(text, boolean, text, boolean) to service_role;

alter default privileges in schema public revoke execute on functions from public, anon, authenticated;

-- Temps réel
alter publication supabase_realtime add table public.reports, public.traffic_segments, public.traffic_status;

-- Tâches planifiées
select cron.schedule('trafic-rsk-expire-reports', '*/2 * * * *', $$select private.expire_reports()$$);
select cron.schedule('trafic-rsk-purge', '17 3 * * *', $$select private.purge_old_data()$$);
