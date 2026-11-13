-- =====================================================================
-- HITY7 · Ön / son kontrol — SALT OKUNUR, hiçbir şeyi değiştirmez.
--
-- Supabase → SQL Editor → bu dosyanın TAMAMINI yapıştır → Run.
-- Sonuç tek hücrede (hity7_kontrol) gelir; o hücredeki metni kopyalayıp gönder.
-- Migration'lardan ÖNCE (uyumluluk) ve SONRA (doğrulama) çalıştırılır.
-- Kişisel veri içermez: yalnızca şema bilgisi ve sayılar.
-- =====================================================================
select jsonb_pretty(jsonb_build_object(
  'postgres_surumu', current_setting('server_version'),

  -- Kurulum durumu (migration'lar çalıştı mı?)
  'hity7_kurulum', jsonb_build_object(
    'place_order', exists (select 1 from pg_proc p where p.proname = 'place_order' and p.pronamespace = 'public'::regnamespace),
    'wallet_balance', exists (select 1 from pg_proc p where p.proname = 'wallet_balance' and p.pronamespace = 'public'::regnamespace),
    'h7_sepet_siparis', exists (select 1 from pg_proc p where p.proname = 'h7_sepet_siparis' and p.pronamespace = 'public'::regnamespace),
    'h7_fonksiyon_sayisi', (select count(*) from pg_proc p where p.proname like 'h7\_%' and p.pronamespace = 'public'::regnamespace),
    'h7_politika_sayisi', (select count(*) from pg_policies where schemaname = 'public' and policyname like 'h7\_%'),
    'politika_yedegi_var', to_regclass('public.h7_politika_yedegi') is not null,
    'audit_log_var', to_regclass('public.audit_log') is not null,
    'order_events_var', to_regclass('public.order_events') is not null
  ),

  -- Tablolar: RLS (satır güvenliği) açık mı, sahiplere de zorunlu mu, sahibi kim?
  'tablolar', (
    select coalesce(jsonb_agg(jsonb_build_object(
             'tablo', c.relname,
             'tur', case c.relkind when 'r' then 'tablo' when 'p' then 'tablo' when 'v' then 'gorunum' else 'diger' end,
             'rls', c.relrowsecurity,
             'rls_zorunlu', c.relforcerowsecurity,
             'sahip', pg_get_userbyid(c.relowner)) order by c.relname), '[]'::jsonb)
    from pg_class c join pg_namespace n on n.oid = c.relnamespace
    where n.nspname = 'public' and c.relkind in ('r', 'p', 'v', 'm')
  ),

  -- Rollerin RLS'i atlayıp atlayamadığı (sunucu ve yönetim fonksiyonları buna dayanır)
  'roller', (
    select coalesce(jsonb_object_agg(r.rolname, jsonb_build_object('rls_atlar', r.rolbypassrls, 'super', r.rolsuper)), '{}'::jsonb)
    from pg_roles r
    where r.rolname in ('postgres', 'service_role', 'authenticated', 'anon', 'authenticator', 'supabase_auth_admin', 'supabase_admin')
  ),

  -- Mevcut RLS politikaları (migration 05 bunları yedekleyip yenileriyle değiştirir)
  'politikalar', (
    select coalesce(jsonb_agg(jsonb_build_object(
             'tablo', p.tablename, 'ad', p.policyname, 'islem', p.cmd, 'roller', p.roles,
             'using', p.qual, 'check', p.with_check) order by p.tablename, p.policyname), '[]'::jsonb)
    from pg_policies p
    where p.schemaname = 'public'
  ),

  -- Cüzdan / sipariş tablolarının sütunları
  'sutunlar', (
    select coalesce(jsonb_object_agg(x.table_name, x.cols), '{}'::jsonb)
    from (
      select ic.table_name::text as table_name,
             jsonb_agg(jsonb_build_object(
               'ad', ic.column_name,
               'tur', case when ic.data_type = 'USER-DEFINED' then ic.udt_name else ic.data_type end,
               'bos_olabilir', ic.is_nullable,
               'varsayilan', ic.column_default) order by ic.ordinal_position) as cols
      from information_schema.columns ic
      where ic.table_schema = 'public'
        and ic.table_name in ('orders', 'wallet_transactions', 'profiles', 'payment_providers', 'provider_secrets', 'role_permissions')
      group by ic.table_name
    ) x
  ),

  -- Kısıtlar (CHECK, UNIQUE, yabancı anahtar)
  'kisitlar', (
    select coalesce(jsonb_agg(jsonb_build_object(
             'tablo', c.relname, 'ad', con.conname, 'tanim', pg_get_constraintdef(con.oid)) order by c.relname, con.conname), '[]'::jsonb)
    from pg_constraint con
    join pg_class c on c.oid = con.conrelid
    join pg_namespace n on n.oid = c.relnamespace
    where n.nspname = 'public' and c.relname in ('orders', 'wallet_transactions', 'profiles', 'role_permissions')
  ),

  -- ENUM türleri ve değerleri
  'enumlar', (
    select coalesce(jsonb_object_agg(t.typname, (
             select jsonb_agg(e.enumlabel order by e.enumsortorder) from pg_enum e where e.enumtypid = t.oid)), '{}'::jsonb)
    from pg_type t join pg_namespace n on n.oid = t.typnamespace
    where n.nspname = 'public' and t.typtype = 'e'
  ),

  -- Tetikleyiciler (üyelik tetikleyicisi dahil: auth.users). Fonksiyonun SECURITY DEFINER olup olmadığı ve sahibi,
  -- yeni RLS kurallarında üye kaydının bozulmaması için kontrol edilir.
  'tetikleyiciler', (
    select coalesce(jsonb_agg(jsonb_build_object(
             'tablo', n.nspname || '.' || c.relname, 'ad', tg.tgname, 'tanim', pg_get_triggerdef(tg.oid),
             'fonksiyon_security_definer', p.prosecdef, 'fonksiyon_sahibi', pg_get_userbyid(p.proowner))
             order by n.nspname, c.relname, tg.tgname), '[]'::jsonb)
    from pg_trigger tg
    join pg_class c on c.oid = tg.tgrelid
    join pg_namespace n on n.oid = c.relnamespace
    join pg_proc p on p.oid = tg.tgfoid
    where not tg.tgisinternal and n.nspname in ('public', 'auth')
  ),

  -- public şemasındaki fonksiyonlar ve kimlerin çalıştırabildiği
  'fonksiyonlar', (
    select coalesce(jsonb_agg(jsonb_build_object(
             'ad', p.proname,
             'parametreler', pg_get_function_identity_arguments(p.oid),
             'security_definer', p.prosecdef,
             'ziyaretci_calistirir', has_function_privilege('anon', p.oid, 'execute'),
             'uye_calistirir', has_function_privilege('authenticated', p.oid, 'execute')) order by p.proname), '[]'::jsonb)
    from pg_proc p
    where p.pronamespace = 'public'::regnamespace and p.prokind = 'f'
  ),

  -- Tarayıcı rollerinin hassas tablolardaki yetkileri (RLS'ten önceki ilk kapı)
  'tablo_yetkileri', (
    select coalesce(jsonb_object_agg(t.ad, jsonb_build_object(
             'ziyaretci_okur', has_table_privilege('anon', t.oid, 'select'),
             'ziyaretci_ekler', has_table_privilege('anon', t.oid, 'insert'),
             'uye_okur', has_table_privilege('authenticated', t.oid, 'select'),
             'uye_ekler', has_table_privilege('authenticated', t.oid, 'insert'),
             'uye_gunceller', has_table_privilege('authenticated', t.oid, 'update'),
             'uye_siler', has_table_privilege('authenticated', t.oid, 'delete'))), '{}'::jsonb)
    from (
      select c.oid, c.relname::text as ad
      from pg_class c join pg_namespace n on n.oid = c.relnamespace
      where n.nspname = 'public'
        and c.relname in ('orders', 'wallet_transactions', 'provider_secrets', 'payment_providers', 'profiles', 'site_content')
    ) t
  ),

  -- Sayılar (kişisel veri yok)
  'veri', jsonb_build_object(
    'uye', (select count(*) from public.profiles),
    'roller', (select coalesce(jsonb_object_agg(x.r, x.n), '{}'::jsonb)
               from (select coalesce(role::text, '(boş)') as r, count(*) as n from public.profiles group by 1) x),
    'siparis', (select count(*) from public.orders),
    'siparis_durumlari', (select coalesce(jsonb_object_agg(x.s, x.n), '{}'::jsonb)
                          from (select coalesce(status::text, '(boş)') as s, count(*) as n from public.orders group by 1) x),
    'tekrarlanan_siparis_kodu', (select count(*) from (select code from public.orders where code is not null group by code having count(*) > 1) x),
    'bakiye_hareketi', (select count(*) from public.wallet_transactions),
    'hareket_turleri', (select coalesce(jsonb_object_agg(x.k, x.n), '{}'::jsonb)
                        from (select coalesce(kind::text, '?') || ' / ' || coalesce(status::text, '?') as k, count(*) as n
                              from public.wallet_transactions group by 1) x),
    'tekrarlanan_odeme_ref', (select count(*) from (select ref from public.wallet_transactions where ref is not null group by ref having count(*) > 1) x)
  )
)) as hity7_kontrol;
