-- =====================================================================
-- HITY7 · İlk CEO ataması (ONAYLI, korumalı) — mevcut admin hesabını CEO yapar.
--
-- Supabase → SQL Editor. Her bölümü AYRI AYRI yapıştırıp Run de (SQL Editor yalnızca son sonucu gösterir).
--
-- ÖNEMLİ
--  • CEO rolü admin'in TÜM yetkilerini içerir; admin hiçbir yetkisini kaybetmez. Ek olarak CEO: influencer maliyetleri,
--    kâr ve finans raporları, kişiye özel yetki verme, ödeme canlı moduna geçirme, siteyi açıp kapatma.
--  • Hesap silinmez, e-posta / şifre / bakiye / siparişler / yetki kayıtları değişmez. Yalnızca profiles.role 'admin' → 'ceo'.
--  • Yalnızca şu an 'admin' olan hesaba CEO verilir. Başka bir rolde veya var olmayan e-postada işlem DURUR.
--  • Bu işlem yalnızca SQL Editor'den çalışır (tarayıcıdan / API'den çağrılamaz) ve işlem kaydına (audit_log) yazılır.
-- =====================================================================


-- ---------------------------------------------------------------------
-- BÖLÜM 1 — SALT OKUNUR ön kontrol (hiçbir şeyi değiştirmez). Sonucu (tek hücre) bana gönder.
-- E-postalar maskelidir (ilk 2 harf + alan adı).
-- ---------------------------------------------------------------------
select jsonb_pretty(jsonb_build_object(
  'yonetici_hesaplar', (select coalesce(jsonb_agg(jsonb_build_object(
        'eposta', left(u.email, 2) || '***@' || split_part(u.email, '@', 2), 'rol', p.role::text, 'engelli', p.banned,
        'kayit_tarihi', p.created_at) order by p.created_at), '[]')
      from public.profiles p join auth.users u on u.id = p.id where p.role::text in ('ceo', 'admin', 'mod', 'amele')),
  'rol_kisiti', (select coalesce(jsonb_agg(pg_get_constraintdef(c.oid)), '[]') from pg_constraint c
      where c.conrelid = 'public.profiles'::regclass and c.contype = 'c' and pg_get_constraintdef(c.oid) ilike '%role%'),
  'rol_enum_degerleri', (select coalesce(jsonb_agg(e.enumlabel order by e.enumsortorder), '[]')
      from pg_attribute a join pg_enum e on e.enumtypid = a.atttypid
      where a.attrelid = 'public.profiles'::regclass and a.attname = 'role'),
  'ceo_atama_fonksiyonu_var', exists (select 1 from pg_proc p join pg_namespace n on n.oid = p.pronamespace
      where n.nspname = 'public' and p.proname = 'h7_ceo_ata'),
  'kisiye_ozel_yetki_kaydi', (select count(*) from public.user_permission_sets),
  'uye_sayisi', (select count(*) from public.profiles)
)) as hity7_ceo_on_kontrol;


-- ---------------------------------------------------------------------
-- BÖLÜM 2 — ATAMA (VERİTABANINI DEĞİŞTİRİR). Yalnızca ben "onay" dedikten sonra çalıştır.
-- 'BURAYA-ADMIN-EPOSTASI' yerine admin hesabının e-postasını yaz (tırnakları silme).
-- Beklenen sonuç: "CEO atandı: ..."   Başka bir metin ("DURDU: ...") çıkarsa hiçbir şey değişmemiştir.
-- ---------------------------------------------------------------------
select coalesce(
  (select case when p.role::text = 'admin' then public.h7_ceo_ata(u.email)
               else 'DURDU: bu hesabın rolü ' || p.role::text || '; yalnızca admin hesabına CEO verilir. Hiçbir şey değişmedi.' end
   from auth.users u join public.profiles p on p.id = u.id
   where lower(u.email) = lower(trim('BURAYA-ADMIN-EPOSTASI'))),
  'DURDU: bu e-posta ile hesap bulunamadı. Hiçbir şey değişmedi.') as sonuc;


-- ---------------------------------------------------------------------
-- BÖLÜM 3 — SALT OKUNUR doğrulama (atamadan sonra). Üye sayısı 6, influencer sayısı 68 kalmalı.
-- ---------------------------------------------------------------------
select jsonb_pretty(jsonb_build_object(
  'yonetici_hesaplar', (select coalesce(jsonb_agg(jsonb_build_object(
        'eposta', left(u.email, 2) || '***@' || split_part(u.email, '@', 2), 'rol', p.role::text, 'engelli', p.banned) order by p.role::text), '[]')
      from public.profiles p join auth.users u on u.id = p.id where p.role::text in ('ceo', 'admin', 'mod', 'amele')),
  'uye_sayisi', (select count(*) from public.profiles),
  'influencer_sayisi', (select count(*) from public.influencers),
  'son_islem_kaydi', (select jsonb_build_object('islem', action, 'zaman', created_at) from public.audit_log
      where action = 'uye.ceo_atandi' order by id desc limit 1)
)) as hity7_ceo_dogrulama;


-- ---------------------------------------------------------------------
-- GERİ ALMA (gerekirse; yalnızca SQL Editor'de): hesabı tekrar admin yapar.
-- ---------------------------------------------------------------------
-- update public.profiles set role = 'admin'
-- where id = (select id from auth.users where lower(email) = lower(trim('BURAYA-ADMIN-EPOSTASI')));
