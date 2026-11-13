-- =====================================================================
-- HITY7 · Kurulum kontrolü (salt okunur — hiçbir şeyi değiştirmez)
-- Supabase → SQL Editor'de migration'lardan sonra çalıştırıp sonuçlara bakın.
-- =====================================================================

-- 1) RLS açık mı? (rowsecurity = true olmalı)
select relname as tablo, relrowsecurity as rls_acik
from pg_class c join pg_namespace n on n.oid = c.relnamespace
where n.nspname = 'public' and c.relkind = 'r'
  and relname in ('profiles', 'orders', 'order_events', 'wallet_transactions', 'page_views', 'role_permissions',
                  'site_content', 'influencers', 'samples', 'smm_providers', 'smm_services', 'provider_secrets',
                  'payment_providers', 'support_tickets', 'support_messages', 'releases', 'release_tracks',
                  'audit_log', 'smm_logs')
order by 1;

-- 2) Etkin politikalar
select tablename as tablo, policyname as politika, cmd as islem, roles as roller
from pg_policies where schemaname = 'public'
order by tablename, policyname;

-- 3) HITY7 tetikleyicileri
select event_object_table as tablo, trigger_name as tetikleyici, action_timing as zaman, string_agg(event_manipulation, ', ') as olaylar
from information_schema.triggers
where trigger_schema = 'public' and trigger_name like 'h7\_%'
group by 1, 2, 3 order by 1, 2;

-- 4) HITY7 fonksiyonları
select p.proname as fonksiyon, p.prosecdef as security_definer
from pg_proc p join pg_namespace n on n.oid = p.pronamespace
where n.nspname = 'public' and p.proname like 'h7\_%'
order by 1;

-- 5) Mevcut sipariş fonksiyonları (sitenin sipariş / bakiye API'si bunlara ihtiyaç duyar)
select p.proname as fonksiyon, pg_get_function_identity_arguments(p.oid) as parametreler
from pg_proc p join pg_namespace n on n.oid = p.pronamespace
where n.nspname = 'public' and p.proname in ('place_order', 'wallet_balance');

-- 6) Sipariş durum dağılımı
select status, count(*) from public.orders group by 1 order by 2 desc;

-- 7) Yönetim hesapları
select p.role, count(*) from public.profiles p group by 1 order by 1;
