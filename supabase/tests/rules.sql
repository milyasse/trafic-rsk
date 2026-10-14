-- Tests des règles métier et de la sécurité (RLS), exécutés dans une transaction annulée.
-- Usage : coller dans Supabase > SQL Editor (aucune donnée n'est conservée : ROLLBACK final).
begin;

insert into auth.users (id, instance_id, aud, role, email, is_anonymous, created_at, updated_at) values
  ('11111111-1111-1111-1111-111111111111','00000000-0000-0000-0000-000000000000','authenticated','authenticated',null,true,now(),now()),
  ('22222222-2222-2222-2222-222222222222','00000000-0000-0000-0000-000000000000','authenticated','authenticated',null,true,now(),now());

create temp table t_out(step text, val text) on commit drop;
grant all on t_out to authenticated, anon;

-- Utilisateur A
set local role authenticated;
set local request.jwt.claims = '{"sub":"11111111-1111-1111-1111-111111111111","role":"authenticated"}';
insert into t_out select '1. création (attendu merged=false)', public.create_report('accident', 3, 34.0249, -6.8226, 'Test')::text;
do $$ begin perform public.create_report('jam', 2, 31.6, -8.0, null);
  exception when others then insert into t_out values ('2. hors zone (attendu out_of_coverage)', sqlerrm); end $$;
do $$ begin perform public.vote_report((select id from public.reports limit 1), 'confirm');
  exception when others then insert into t_out values ('3. auto-confirmation (attendu own_report)', sqlerrm); end $$;
do $$ begin insert into public.reports(type,lat,lng,expires_at) values ('jam',34,-6.8,now());
  exception when others then insert into t_out values ('4. insertion directe (attendu permission denied)', sqlerrm); end $$;
update public.app_settings set value = '99' where key = 'merge_radius_m';
insert into t_out select '5. paramètre modifié par non-admin (attendu 150)', value::text from public.app_settings where key = 'merge_radius_m';
do $$ begin update public.profiles set role = 'admin' where id = auth.uid();
  exception when others then insert into t_out values ('6. élévation de rôle (attendu permission denied)', sqlerrm); end $$;

-- Utilisateur B
set local request.jwt.claims = '{"sub":"22222222-2222-2222-2222-222222222222","role":"authenticated"}';
insert into t_out select '7. doublon à 40 m (attendu merged=true)', public.create_report('accident', 2, 34.0252, -6.8230, null)::text;
insert into t_out select '8. après fusion (attendu confirmed c=1 city=Rabat)', status || ' c=' || confirmations || ' city=' || city from public.reports limit 1;
insert into t_out select '9. vote « n''y est plus »', public.vote_report((select id from public.reports limit 1), 'gone')::text;

-- Anonyme (non connecté)
reset role;
set local role anon;
set local request.jwt.claims = '{"role":"anon"}';
insert into t_out select '10. lecture publique (attendu 1)', count(*)::text from public.reports;
do $$ begin perform public.create_report('jam', 2, 34.02, -6.83, null);
  exception when others then insert into t_out values ('11. création sans session (attendu permission denied)', sqlerrm); end $$;
do $$ begin perform * from public.report_votes;
  exception when others then insert into t_out values ('12. lecture des votes (attendu permission denied)', sqlerrm); end $$;
do $$ begin perform * from private.report_authors;
  exception when others then insert into t_out values ('13. lecture des auteurs (attendu permission denied)', sqlerrm); end $$;

reset role;
select * from t_out order by step;
rollback;
