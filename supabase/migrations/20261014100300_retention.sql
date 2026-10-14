-- =====================================================================
-- Trafic RSK — conservation des données (purge quotidienne)
-- À appliquer séparément : contient des DELETE, que l'outil de migration
-- soumet à confirmation. Voir docs/DEPLOIEMENT.md.
-- =====================================================================

create or replace function private.purge_old_data()
returns void language plpgsql security definer set search_path = '' as $$
declare r jsonb := private.setting('retention_days');
begin
  delete from public.reports where created_at < now() - make_interval(days => (r->>'reports')::int);
  delete from public.destination_history where created_at < now() - make_interval(days => (r->>'history')::int);
  delete from private.rate_limits where window_start < now() - interval '1 day';
end $$;

select cron.schedule('trafic-rsk-purge', '17 3 * * *', $$select private.purge_old_data()$$);
