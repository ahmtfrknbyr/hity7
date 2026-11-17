-- =====================================================================
-- HITY7 · Atama denemesi sonrası durum kontrolü — SALT OKUNUR, hiçbir şeyi değiştirmez.
--
-- Supabase → SQL Editor → TAMAMINI yapıştır → Run. Sonuç TEK hücrede. 'BURAYA-EPOSTA' yerine hesabın e-postasını yaz.
-- Hatalı bir denemeden sonra BEKLENEN: profil_sayisi 6, hedef_profili_var false, ceo_sayisi 0, ceo_atama_kaydi 0
-- (işlem tek transaction'dı; hata olunca hiçbir şey kalmaz). Güvenlik nesnelerinin parmak izi de görünür.
-- =====================================================================
select jsonb_pretty(jsonb_build_object(
  'profil_sayisi', (select count(*) from public.profiles),
  'hedef_profili_var', exists (select 1 from public.profiles p join auth.users u on u.id = p.id where lower(u.email) = lower(trim('BURAYA-EPOSTA'))),
  'ceo_sayisi', (select count(*) from public.profiles where role::text = 'ceo'),
  'admin_sayisi', (select count(*) from public.profiles where role::text = 'admin'),
  'ceo_atama_kaydi', (select count(*) from public.audit_log where action = 'uye.ceo_atandi'),
  'influencer', (select count(*) from public.influencers),
  'siparis', (select count(*) from public.orders),
  'bakiye_hareketi', (select count(*) from public.wallet_transactions),
  -- Güvenlik tetikleyicileri açık mı? ('O' = etkin) ve fonksiyon metinlerinin parmak izi (işlem öncesi / sonrası aynı olmalı)
  'profil_tetikleyicileri', (select coalesce(jsonb_agg(jsonb_build_object('ad', t.tgname, 'durum', t.tgenabled::text) order by t.tgname), '[]')
      from pg_trigger t where t.tgrelid = 'public.profiles'::regclass and not t.tgisinternal),
  'guvenlik_parmak_izi', (select md5(coalesce(string_agg(p.proname || ':' || p.prosrc, '|' order by p.proname), ''))
      from pg_proc p where p.pronamespace = 'public'::regnamespace
        and p.proname in ('profiles_guard', 'h7_profil_koru', 'h7_ceo_ata', 'is_admin', 'current_role_name', 'h7_guvenilir'))
)) as hity7_profil_durum;
