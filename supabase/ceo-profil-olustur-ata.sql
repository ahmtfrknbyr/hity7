-- =====================================================================
-- HITY7 · Eksik profili oluştur + CEO ata (KORUMALI, tek işlem) — ceo-ata-onayli.sql'in profil eksikliği için sürümü
--
-- Supabase → SQL Editor. Bölümleri AYRI AYRI yapıştırıp Run de. Bölüm 2 yalnızca "onay" dedikten sonra.
-- 'BURAYA-EPOSTA' yerine CEO olacak hesabın e-postasını yaz (tırnakları silme; Bölüm 2'de TEK yerde).
--
-- GÜVENCELER (hepsi tek işlemde; biri tutmazsa HİÇBİR şey değişmez, işlem geri alınır):
--  • Hesap auth.users'ta tam 1 kez bulunmalı ve e-postası doğrulanmış olmalı.
--  • Başka bir CEO varsa durur (CEO yalnızca bu hesaba verilir).
--  • Profil yoksa oluşturulur (yalnızca id, e-posta, ad; rol önce 'member'); varsa dokunulmaz, yalnızca rol 'ceo' olur.
--  • CEO ataması mevcut denetimli fonksiyonla (h7_ceo_ata) yapılır → işlem kaydına (audit_log) yazılır. Eski profiles_guard
--    tetikleyicisi GİRİŞ YAPMIŞ bir admin ister; bu yüzden işlem transaction boyunca TEK mevcut admin adına yapılır.
--    Hiçbir güvenlik tetikleyicisi / fonksiyonu kaldırılmaz, devre dışı bırakılmaz veya değiştirilmez (parmak iziyle doğrulanır).
--  • Sonunda doğrulanır: diğer TÜM profiller byte düzeyinde aynı (mevcut admin dahil), influencer / sipariş / bakiye hareketi sayıları
--    ve toplam bakiye aynı, profil sayısı yalnızca +1 (yeni profil açıldıysa), tam 1 CEO ve o bu hesap. Aksi hâlde hata → geri alma.
-- =====================================================================


-- ---------------------------------------------------------------------
-- BÖLÜM 1 — SALT OKUNUR ön durum (hiçbir şeyi değiştirmez)
-- ---------------------------------------------------------------------
select jsonb_pretty(jsonb_build_object(
  'profil_sayisi', (select count(*) from public.profiles),
  'influencer', (select count(*) from public.influencers),
  'siparis', (select count(*) from public.orders),
  'bakiye_hareketi', (select count(*) from public.wallet_transactions),
  'roller', (select coalesce(jsonb_object_agg(role::text, n), '{}') from (select role, count(*) n from public.profiles group by 1) x),
  'hedef_hesap', (select coalesce(jsonb_agg(jsonb_build_object('dogrulandi', u.email_confirmed_at is not null,
        'profili_var', exists (select 1 from public.profiles p where p.id = u.id))), '[]')
      from auth.users u where lower(u.email) = lower(trim('BURAYA-EPOSTA')))
)) as hity7_on_durum;


-- ---------------------------------------------------------------------
-- BÖLÜM 2 — OLUŞTUR + ATA (VERİTABANINI DEĞİŞTİRİR) — yalnızca "onay"dan sonra
-- Başarılıysa sonuç ekranında "Query returned successfully" görünür; hata olursa hata metni görünür ve HİÇBİR şey değişmez.
-- ---------------------------------------------------------------------
begin;

do $$
declare
  v_eposta constant text := lower(trim('BURAYA-EPOSTA'));
  v_adet int;
  v_id uuid;
  v_onayli timestamptz;
  v_meta jsonb;
  v_profil_vardi boolean;
  v_once record;
  v_sonra record;
  v_aktor uuid;
  v_yonetici int;
  v_koruma_once text;
  v_koruma_sonra text;
begin
  -- 0) Eşzamanlılık koruması: profiles tablosuna işlem boyunca yazma (ekleme / güncelleme / silme) kilitlenir; okumalar sürer.
  --    Aynı anda başka bir CEO ataması, yeni üye kaydı veya profil değişikliği bu işlemle çakışamaz (kontroller ile yazma arasında
  --    boşluk kalmaz). Kilit 5 saniyede alınamazsa işlem hata verip hiçbir şey yapmadan sona erer; kilit transaction bitince kalkar.
  perform set_config('lock_timeout', '5s', true);
  lock table public.profiles in share row exclusive mode;

  -- 1) Hesap: tam bir tane ve doğrulanmış olmalı
  select count(*) into v_adet from auth.users where lower(email) = v_eposta;
  if v_adet <> 1 then
    raise exception 'DURDU: % için auth.users''ta % hesap bulundu (1 olmalı). Hiçbir şey değişmedi.', v_eposta, v_adet;
  end if;
  select id, email_confirmed_at, coalesce(raw_user_meta_data, '{}'::jsonb) into v_id, v_onayli, v_meta
  from auth.users where lower(email) = v_eposta;
  if v_onayli is null then
    raise exception 'DURDU: hesabın e-postası doğrulanmamış. Hiçbir şey değişmedi.';
  end if;

  -- 2) Başka CEO varsa dur
  if exists (select 1 from public.profiles where role::text = 'ceo' and id <> v_id) then
    raise exception 'DURDU: başka bir CEO hesabı zaten var. Hiçbir şey değişmedi.';
  end if;

  -- 2b) İşlemi onaylayan MEVCUT admin. Eski profiles_guard tetikleyicisi rol değişikliğini yalnızca GİRİŞ YAPMIŞ bir adminin
  --     yapmasına izin verir; SQL Editor'de giriş yok (auth.uid() boş) → "Rol değişikliği için admin yetkisi gerekir" hatası.
  --     Tetikleyiciye / fonksiyona DOKUNMAYIZ: işlem yalnızca bu transaction boyunca, tek ve engelsiz mevcut admin adına yapılır
  --     ve transaction bitince kendiliğinden sona erer.
  select count(*) into v_yonetici from public.profiles where role::text = 'admin' and not banned and id <> v_id;
  if v_yonetici <> 1 then
    raise exception 'DURDU: engelsiz tam 1 mevcut admin olmalı (bulunan: %). Hiçbir şey değişmedi.', v_yonetici;
  end if;
  select id into v_aktor from public.profiles where role::text = 'admin' and not banned and id <> v_id;

  -- Güvenlik nesnelerinin parmak izi (işlem öncesi): profil tetikleyici tanımları + durumları + ilgili fonksiyon metinleri
  select md5(coalesce((select string_agg(pg_get_triggerdef(t.oid) || t.tgenabled::text, '|' order by t.tgname)
                         from pg_trigger t where t.tgrelid = 'public.profiles'::regclass and not t.tgisinternal), '')
          || coalesce((select string_agg(p.proname || p.prosrc, '|' order by p.proname) from pg_proc p
                        where p.pronamespace = 'public'::regnamespace
                          and p.proname in ('profiles_guard', 'h7_profil_koru', 'h7_ceo_ata', 'is_admin', 'current_role_name', 'h7_guvenilir')), ''))
    into v_koruma_once;

  -- 3) Ön durum (hedef hesap hariç tüm profiller + sayılar + toplam bakiye)
  select (select count(*) from public.profiles) as profil,
         (select count(*) from public.influencers) as inf,
         (select count(*) from public.orders) as sip,
         (select count(*) from public.wallet_transactions) as hrk,
         (select coalesce(sum(case when kind::text = 'topup' then amount else -amount end), 0)
            from public.wallet_transactions where status::text = 'ok') as bak,
         (select coalesce(md5(string_agg(md5(p::text), ',' order by p.id)), '') from public.profiles p where p.id <> v_id) as digerleri,
         (select count(*) from public.profiles where role::text = 'admin' and id <> v_id) as admin_sayisi
    into v_once;

  -- 4) Profil yoksa oluştur (rol önce 'member'; CEO'ya denetimli fonksiyon yükseltir)
  v_profil_vardi := exists (select 1 from public.profiles where id = v_id);
  if not v_profil_vardi then
    insert into public.profiles (id, email, full_name, role)
    values (v_id, v_eposta, coalesce(nullif(btrim(v_meta ->> 'full_name'), ''), split_part(v_eposta, '@', 1)), 'member');
  end if;

  -- 5) CEO ata (denetimli; audit_log'a yazar)
  perform set_config('request.jwt.claim.sub', v_aktor::text, true);
  perform set_config('request.jwt.claims', json_build_object('sub', v_aktor)::text, true);
  if auth.uid() is distinct from v_aktor then
    raise exception 'GERİ ALINDI: onaylayan admin kimliği ayarlanamadı.';
  end if;
  perform public.h7_ceo_ata(v_eposta);
  -- Kimlik ayarı hemen sıfırlanır (zaten yalnızca bu transaction için geçerliydi)
  perform set_config('request.jwt.claim.sub', '', true);
  perform set_config('request.jwt.claims', '', true);

  -- 6) Sonuç doğrulaması — herhangi biri tutmazsa hata verir ve her şey geri alınır
  select (select count(*) from public.profiles) as profil,
         (select count(*) from public.influencers) as inf,
         (select count(*) from public.orders) as sip,
         (select count(*) from public.wallet_transactions) as hrk,
         (select coalesce(sum(case when kind::text = 'topup' then amount else -amount end), 0)
            from public.wallet_transactions where status::text = 'ok') as bak,
         (select coalesce(md5(string_agg(md5(p::text), ',' order by p.id)), '') from public.profiles p where p.id <> v_id) as digerleri,
         (select count(*) from public.profiles where role::text = 'admin' and id <> v_id) as admin_sayisi
    into v_sonra;

  select md5(coalesce((select string_agg(pg_get_triggerdef(t.oid) || t.tgenabled::text, '|' order by t.tgname)
                         from pg_trigger t where t.tgrelid = 'public.profiles'::regclass and not t.tgisinternal), '')
          || coalesce((select string_agg(p.proname || p.prosrc, '|' order by p.proname) from pg_proc p
                        where p.pronamespace = 'public'::regnamespace
                          and p.proname in ('profiles_guard', 'h7_profil_koru', 'h7_ceo_ata', 'is_admin', 'current_role_name', 'h7_guvenilir')), ''))
    into v_koruma_sonra;
  if v_koruma_sonra is distinct from v_koruma_once then
    raise exception 'GERİ ALINDI: bir güvenlik tetikleyicisi / fonksiyonu değişmiş görünüyor.';
  end if;
  if v_sonra.digerleri is distinct from v_once.digerleri then
    raise exception 'GERİ ALINDI: diğer profillerden biri değişmiş görünüyor.';
  end if;
  if v_sonra.admin_sayisi is distinct from v_once.admin_sayisi then
    raise exception 'GERİ ALINDI: admin hesap sayısı değişti.';
  end if;
  if v_sonra.inf is distinct from v_once.inf or v_sonra.sip is distinct from v_once.sip
     or v_sonra.hrk is distinct from v_once.hrk or v_sonra.bak is distinct from v_once.bak then
    raise exception 'GERİ ALINDI: influencer / sipariş / bakiye sayıları değişti.';
  end if;
  if v_sonra.profil is distinct from v_once.profil + (case when v_profil_vardi then 0 else 1 end) then
    raise exception 'GERİ ALINDI: profil sayısı beklenmedik değişti (% → %).', v_once.profil, v_sonra.profil;
  end if;
  if (select count(*) from public.profiles where role::text = 'ceo') <> 1
     or not exists (select 1 from public.profiles where id = v_id and role::text = 'ceo') then
    raise exception 'GERİ ALINDI: CEO yalnızca hedef hesapta olmalı.';
  end if;

  raise notice 'TAMAM: profil % (%), CEO atandı. Profil sayısı % → %.',
    case when v_profil_vardi then 'zaten vardı' else 'oluşturuldu' end, left(v_eposta, 2) || '***', v_once.profil, v_sonra.profil;
end $$;

commit;


-- ---------------------------------------------------------------------
-- BÖLÜM 3 — SALT OKUNUR doğrulama (atamadan sonra). Beklenen: profil_sayisi 7, ceo_sayisi 1, admin_sayisi 1,
-- influencer 68, siparis 0 (veya öncekiyle aynı), son_islem_kaydi = uye.ceo_atandi
-- ---------------------------------------------------------------------
select jsonb_pretty(jsonb_build_object(
  'profil_sayisi', (select count(*) from public.profiles),
  'ceo_sayisi', (select count(*) from public.profiles where role::text = 'ceo'),
  'admin_sayisi', (select count(*) from public.profiles where role::text = 'admin'),
  'yoneticiler', (select coalesce(jsonb_agg(jsonb_build_object('eposta', left(u.email, 2) || '***@' || split_part(u.email, '@', 2),
        'rol', p.role::text, 'engelli', p.banned) order by p.role::text), '[]')
      from public.profiles p join auth.users u on u.id = p.id where p.role::text in ('ceo', 'admin', 'mod', 'amele')),
  'ceo_dogru_hesap_mi', (select exists (select 1 from public.profiles p join auth.users u on u.id = p.id
      where p.role::text = 'ceo' and lower(u.email) = lower(trim('BURAYA-EPOSTA')))),
  'influencer', (select count(*) from public.influencers),
  'siparis', (select count(*) from public.orders),
  'bakiye_hareketi', (select count(*) from public.wallet_transactions),
  'son_islem_kaydi', (select jsonb_build_object('islem', action, 'zaman', created_at) from public.audit_log
      where action = 'uye.ceo_atandi' order by id desc limit 1)
)) as hity7_ceo_dogrulama;


-- ---------------------------------------------------------------------
-- GERİ ALMA (gerekirse; yalnızca SQL Editor'de). Yalnızca ROLÜ geri alır (profil satırı kalır):
-- ---------------------------------------------------------------------
-- update public.profiles set role = 'member'
-- where id = (select id from auth.users where lower(email) = lower(trim('BURAYA-EPOSTA')));
