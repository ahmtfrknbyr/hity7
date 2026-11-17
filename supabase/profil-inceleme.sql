-- =====================================================================
-- HITY7 · Profil eksikliği incelemesi — SALT OKUNUR, hiçbir şeyi değiştirmez.
--
-- Supabase → SQL Editor → TAMAMINI yapıştır → Run. Sonuç TEK hücrede (hity7_profil_inceleme). Hücreyi kopyalayıp gönder.
-- E-postalar maskelidir (ilk 2 harf + alan adı). Şifre / anahtar / kişisel veri içermez.
--
-- Amaç: profiles satırını kim açıyor (tetikleyici?), neden bu hesapta açılmamış, başka profilsiz hesap var mı,
-- profiles tablosunun sütunları (yeni profil kaydı için) neler.
-- =====================================================================
select jsonb_pretty(jsonb_build_object(
  -- 1) auth.users üzerindeki tetikleyiciler (profili açan kod burada olmalı) ve fonksiyon metinleri
  'auth_users_tetikleyicileri', (select coalesce(jsonb_agg(jsonb_build_object(
        'ad', t.tgname, 'etkin', t.tgenabled <> 'D', 'fonksiyon', p.proname,
        'tanim', pg_get_functiondef(p.oid)) order by t.tgname), '[]')
      from pg_trigger t join pg_proc p on p.oid = t.tgfoid
      where t.tgrelid = 'auth.users'::regclass and not t.tgisinternal),

  -- 2) Hesap sayıları ve profilsiz hesaplar (yeni üyeler de profilsiz kalıyor mu?)
  'auth_hesap_sayisi', (select count(*) from auth.users),
  'profil_sayisi', (select count(*) from public.profiles),
  'profilsiz_hesaplar', (select coalesce(jsonb_agg(jsonb_build_object(
        'eposta', left(u.email, 2) || '***@' || split_part(u.email, '@', 2),
        'olusturma', u.created_at, 'dogrulandi', u.email_confirmed_at is not null,
        'son_giris', u.last_sign_in_at, 'saglayici', u.raw_app_meta_data ->> 'provider',
        'meta_anahtarlari', (select coalesce(jsonb_agg(k), '[]') from jsonb_object_keys(coalesce(u.raw_user_meta_data, '{}'::jsonb)) k)
      ) order by u.created_at), '[]')
      from auth.users u where not exists (select 1 from public.profiles p where p.id = u.id)),
  'profilsiz_hesap_sayisi', (select count(*) from auth.users u where not exists (select 1 from public.profiles p where p.id = u.id)),

  -- 3) Profili olan hesapların zaman aralığı (tetikleyici hangi tarihten beri çalışıyor?)
  'ilk_profil', (select min(created_at) from public.profiles),
  'son_profil', (select max(created_at) from public.profiles),
  'ilk_auth_hesabi', (select min(created_at) from auth.users),

  -- 4) profiles tablosu: sütunlar (yeni kayıt için zorunlu alan var mı?) ve kısıtlar
  'profil_sutunlari', (select coalesce(jsonb_agg(jsonb_build_object('ad', column_name, 'tur', data_type, 'zorunlu', is_nullable = 'NO',
        'varsayilan', column_default) order by ordinal_position), '[]')
      from information_schema.columns where table_schema = 'public' and table_name = 'profiles'),
  'profil_kisitlari', (select coalesce(jsonb_agg(pg_get_constraintdef(c.oid)), '[]') from pg_constraint c where c.conrelid = 'public.profiles'::regclass),
  'profil_tetikleyicileri', (select coalesce(jsonb_agg(t.tgname order by t.tgname), '[]') from pg_trigger t
      where t.tgrelid = 'public.profiles'::regclass and not t.tgisinternal)
)) as hity7_profil_inceleme;
