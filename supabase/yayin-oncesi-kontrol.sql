-- =====================================================================
-- HITY7 · Yayın öncesi son kontrol — SALT OKUNUR, hiçbir şeyi değiştirmez.
-- Supabase → SQL Editor → TAMAMINI yapıştır → Run → tek hücreyi kopyalayıp gönder. Kişisel veri yok (e-postalar maskeli).
-- Beklenen: migration_12_uygulandi true, migration_13_uygulandi true, profil_sayisi 7, ceo_sayisi 1, influencer 68,
--           eksik_* boş, siparis 0, eksi_bakiyeli_uye 0.
-- =====================================================================
select jsonb_pretty(jsonb_build_object(
  -- Migration 12: h7_paket_fiyat ziyaretçi / üyeye KAPALI olmalı
  'migration_12_uygulandi', (select not has_function_privilege('anon', p.oid, 'execute') and not has_function_privilege('authenticated', p.oid, 'execute')
                              from pg_proc p where p.proname = 'h7_paket_fiyat' and p.pronamespace = 'public'::regnamespace limit 1),
  -- Migration 13: profiles_guard CEO'yu tanımalı
  'migration_13_uygulandi', (select p.prosrc ilike '%h7_rol%' from pg_proc p where p.proname = 'profiles_guard' and p.pronamespace = 'public'::regnamespace limit 1),
  'profiles_guard_tetikleyici_acik', (select t.tgenabled::text = 'O' from pg_trigger t where t.tgname = 'profiles_guard_trg' and t.tgrelid = 'public.profiles'::regclass),

  'profil_sayisi', (select count(*) from public.profiles),
  'ceo_sayisi', (select count(*) from public.profiles where role::text = 'ceo'),
  'admin_sayisi', (select count(*) from public.profiles where role::text = 'admin'),
  'profilsiz_hesap', (select count(*) from auth.users u where not exists (select 1 from public.profiles p where p.id = u.id)),
  'influencer', (select count(*) from public.influencers),
  'siparis', (select count(*) from public.orders),
  'bakiye_hareketi', (select count(*) from public.wallet_transactions),
  'eksi_bakiyeli_uye', (select count(*) from (select user_id from public.wallet_transactions where status::text = 'ok'
        group by user_id having sum(case when kind::text = 'topup' then amount else -amount end) < 0) x),

  -- Ödeme durumu (anahtar değerleri GÖSTERİLMEZ)
  'odeme_saglayicilari', (select coalesce(jsonb_agg(jsonb_build_object('tur', kind, 'aktif', active, 'mod', mode)), '[]') from public.payment_providers),
  'paytr_anahtari_kayitli', (select exists (select 1 from public.provider_secrets s join public.payment_providers p on p.id::text = s.ref_id::text
        where p.kind::text = 'paytr' and s.data ? 'key' and s.data ? 'salt' and s.data ? 'mid')),

  -- Site ve içerik
  'bakim_modu', (select value -> 'maintenance' from public.site_content where key = 'general'),
  'smm_servisleri', (select count(*) from public.smm_services),
  'remake_ses_kaydi_var', exists (select 1 from public.site_content where key = 'remake_sesler'),

  -- Depo politikaları (site-media'ya kim yazabilir?) — politika adı, komut, roller; koşul metni kısaltılmış
  'depo_politikalari', (select coalesce(jsonb_agg(jsonb_build_object('ad', policyname, 'komut', cmd, 'roller', roles,
        'kosul', left(coalesce(with_check, qual, ''), 160))), '[]') from pg_policies where schemaname = 'storage' and tablename = 'objects')
)) as hity7_yayin_oncesi;
