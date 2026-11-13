-- =====================================================================
-- HITY7 · İlk CEO ataması
--
-- CEO hesabı herkese açık kayıt ekranından OLUŞTURULAMAZ. Bu dosyayı yalnızca
-- Supabase → SQL Editor'de, 5 migration dosyası çalıştırıldıktan sonra çalıştırın.
--
-- 1) Aşağıdaki e-postayı CEO olacak hesabın e-postasıyla değiştirin.
--    (Hesap önce siteye bir kez kayıt olup giriş yapmış olmalı.)
--    Not: Admin panelinde kullanıcı adıyla açılan hesapların e-postası
--    "kullaniciadi@panel.hity7.net" biçimindedir.
-- 2) Çalıştırın. Sonuç satırında "CEO atandı: ..." yazmalı.
--
-- Bu fonksiyon tarayıcıdan / API'den çağrılamaz; yalnızca SQL Editor'de çalışır.
-- =====================================================================

select public.h7_ceo_ata('PATRON-EPOSTASI@ornek.com');

-- Kontrol: CEO ve yönetici hesapları
select p.id, u.email, p.role, p.banned
from public.profiles p
join auth.users u on u.id = p.id
where p.role::text in ('ceo', 'admin', 'mod', 'amele')
order by p.role;
