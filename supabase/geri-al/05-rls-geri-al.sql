-- =====================================================================
-- HITY7 · Migration 05'i GERİ AL (RLS politikaları)
--
-- YALNIZCA migration 05'ten sonra giriş, üyelik veya panelde bir sorun çıkarsa kullanın. Tek transaction.
--   1) 05'in eklediği h7_ politikalarını kaldırır (05'in yönettiği tablolarda).
--   2) h7_politika_yedegi tablosundaki ESKİ politikaları aynen geri kurar.
--   3) Tabloların RLS durumunu (açık / kapalı) 05'ten önceki hâline döndürür (h7_rls_yedegi).
--
-- Güvenlik gereği provider_secrets (ödeme anahtarları) tarayıcıya KAPALI kalır; bu tablo geri açılmaz.
-- Veri silmez. Yedek tabloları silinmez (05 yeniden çalıştırılabilir).
-- =====================================================================
begin;

do $$
declare
  r record;
  v_sql text;
  v_tablolar text[] := array['profiles', 'orders', 'wallet_transactions', 'page_views', 'role_permissions', 'site_content',
                             'influencers', 'samples', 'smm_providers', 'smm_services', 'smm_catalog', 'provider_secrets',
                             'payment_providers', 'support_tickets', 'support_messages', 'order_events', 'releases',
                             'release_tracks', 'audit_log', 'smm_logs'];
begin
  if to_regclass('public.h7_politika_yedegi') is null then
    raise exception 'h7_politika_yedegi tablosu yok: migration 05 hiç çalıştırılmamış, geri alınacak bir şey yok.';
  end if;

  -- 1) 05'in politikalarını kaldır
  for r in
    select p.tablename, p.policyname from pg_policies p
    where p.schemaname = 'public' and p.policyname like 'h7\_%' and p.tablename = any (v_tablolar)
  loop
    execute format('drop policy if exists %I on public.%I', r.policyname, r.tablename);
  end loop;

  -- 2) Eski politikaları geri kur
  for r in
    select distinct on (y.tablename, y.policyname) y.*
    from public.h7_politika_yedegi y
    where to_regclass('public.' || quote_ident(y.tablename)) is not null
    order by y.tablename, y.policyname, y.alindi
  loop
    continue when exists (
      select 1 from pg_policies p where p.schemaname = 'public' and p.tablename = r.tablename and p.policyname = r.policyname);
    v_sql := format('create policy %I on public.%I as %s for %s to %s',
      r.policyname, r.tablename, r.permissive, r.cmd,
      (select string_agg(case when x = 'public' then 'public' else quote_ident(x) end, ', ') from unnest(r.roles) as x));
    if r.qual is not null then
      v_sql := v_sql || ' using (' || r.qual || ')';
    end if;
    if r.with_check is not null then
      v_sql := v_sql || ' with check (' || r.with_check || ')';
    end if;
    execute v_sql;
  end loop;

  -- 3) Tabloların RLS durumunu eski hâline döndür (provider_secrets hariç: kapalı kalır)
  if to_regclass('public.h7_rls_yedegi') is not null then
    for r in
      select y.tablename, y.rls_acik from public.h7_rls_yedegi y
      where y.tablename <> 'provider_secrets' and to_regclass('public.' || quote_ident(y.tablename)) is not null
    loop
      execute format('alter table public.%I %s row level security', r.tablename, case when r.rls_acik then 'enable' else 'disable' end);
    end loop;
  end if;
end $$;

commit;
