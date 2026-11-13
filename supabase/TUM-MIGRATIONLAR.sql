-- =====================================================================
-- HITY7 · TÜM MİGRATİON'LAR TEK DOSYADA (sırasıyla 01 → 07)
-- Supabase → SQL Editor → bu dosyanın tamamını yapıştırıp Run.
-- Her bölüm kendi transaction'ında çalışır; tekrar çalıştırılabilir.
-- Kaynak dosyalar: supabase/migrations/  ·  Çalıştırmadan önce ve sonra: supabase/on-kontrol.sql
-- =====================================================================


-- >>>>>>>>>> 20261110100000_h7_01_roller_guvenlik.sql >>>>>>>>>>

-- =====================================================================
-- HITY7 · Migration 01 · Roller, yetki fonksiyonları, işlem kaydı (audit), profil koruması
--
-- Supabase → SQL Editor'de çalıştırın. Tekrar çalıştırılabilir (idempotent).
-- Tek bir işlem (transaction) içinde çalışır: herhangi bir adım hata verirse HİÇBİR şey değişmez.
-- Mevcut veriyi silmez.
-- =====================================================================
begin;

-- ---------------------------------------------------------------------
-- 0) Profil tablosunda ihtiyaç duyulan alanlar (varsa dokunulmaz)
-- ---------------------------------------------------------------------
alter table public.profiles add column if not exists banned boolean not null default false;
alter table public.profiles add column if not exists panel_request boolean not null default false;

-- ---------------------------------------------------------------------
-- 1) İşlem / güvenlik kaydı (audit log)
-- ---------------------------------------------------------------------
create table if not exists public.audit_log (
  id bigint generated always as identity primary key,
  actor_id uuid,
  action text not null,
  target text,
  details jsonb not null default '{}'::jsonb,
  created_at timestamptz not null default now()
);
create index if not exists audit_log_created_idx on public.audit_log (created_at desc);
create index if not exists audit_log_actor_idx on public.audit_log (actor_id);
alter table public.audit_log enable row level security;

-- ---------------------------------------------------------------------
-- 2) Yardımcı fonksiyonlar
-- ---------------------------------------------------------------------

-- İsteğin JWT rolü: 'anon' | 'authenticated' | 'service_role' | '' (SQL Editor, veritabanı içi)
create or replace function public.h7_jwt_role()
returns text
language sql
stable
set search_path = public
as $$
  select coalesce(
    nullif(current_setting('request.jwt.claim.role', true), ''),
    nullif(current_setting('request.jwt.claims', true), '')::jsonb ->> 'role',
    ''
  );
$$;

-- Güvenilir bağlam mı? (sunucu gizli anahtarı, SQL Editor veya yetkisi doğrulanmış h7_ fonksiyonu)
create or replace function public.h7_guvenilir()
returns boolean
language sql
stable
set search_path = public
as $$
  select public.h7_jwt_role() = 'service_role'
      or coalesce(current_setting('hity7.yetkili_islem', true), '') = 'on'
      or (public.h7_jwt_role() = '' and session_user::text in ('postgres', 'supabase_admin'));
$$;

-- Giriş yapmış kullanıcının rolü ('ceo' | 'admin' | 'mod' | 'amele' | 'member' | 'banned' | null)
create or replace function public.h7_rol()
returns text
language sql
stable
security definer
set search_path = public
as $$
  select case when p.banned then 'banned' else p.role::text end
  from public.profiles p
  where p.id = auth.uid();
$$;

-- Yönetim paneline giren bir rol mü?
create or replace function public.h7_yonetici_mi()
returns boolean
language sql
stable
security definer
set search_path = public
as $$
  select coalesce(public.h7_rol() in ('ceo', 'admin', 'mod', 'amele'), false);
$$;

-- Panel bölümü yetkisi: CEO ve admin her şeye; moderatör / personel role_permissions tablosuna göre
create or replace function public.h7_yetki(p_tab text)
returns boolean
language sql
stable
security definer
set search_path = public
as $$
  select case
    when public.h7_rol() in ('ceo', 'admin') then true
    when public.h7_rol() in ('mod', 'amele') then exists (
      select 1 from public.role_permissions rp
      where rp.role::text = public.h7_rol() and rp.tab::text = p_tab
    )
    else false
  end;
$$;

-- İşlem kaydı yaz (yalnızca h7_ fonksiyonlarının içinden kullanılır)
create or replace function public.h7_kayit(p_islem text, p_hedef text, p_detay jsonb default '{}'::jsonb)
returns void
language plpgsql
security definer
set search_path = public
as $$
begin
  insert into public.audit_log (actor_id, action, target, details)
  values (auth.uid(), left(p_islem, 80), left(coalesce(p_hedef, ''), 200), coalesce(p_detay, '{}'::jsonb));
end;
$$;
revoke execute on function public.h7_kayit(text, text, jsonb) from public, anon, authenticated;

-- İşlem kayıtları değiştirilemez / silinemez (yalnızca SQL Editor'den)
create or replace function public.h7_kayit_koru()
returns trigger
language plpgsql
security definer
set search_path = public
as $$
begin
  if public.h7_jwt_role() = '' and session_user::text in ('postgres', 'supabase_admin') then
    return coalesce(new, old);
  end if;
  raise exception 'İşlem kayıtları değiştirilemez veya silinemez.' using errcode = '42501';
end;
$$;
drop trigger if exists h7_kayit_koru on public.audit_log;
create trigger h7_kayit_koru
  before update or delete on public.audit_log
  for each row execute function public.h7_kayit_koru();

-- ---------------------------------------------------------------------
-- 3) CEO rolü: rol kısıtını genişlet (yalnızca daha önce bir kısıt varsa)
-- ---------------------------------------------------------------------
do $$
declare
  r record;
  v_typ text;
  v_udt text;
  v_udt_schema text;
  v_eski boolean := false;
begin
  select data_type, udt_name, udt_schema into v_typ, v_udt, v_udt_schema
  from information_schema.columns
  where table_schema = 'public' and table_name = 'profiles' and column_name = 'role';

  if v_typ = 'USER-DEFINED' then
    -- rol bir ENUM ise yeni değeri ekle
    execute format('alter type %I.%I add value if not exists %L', v_udt_schema, v_udt, 'ceo');
  else
    for r in
      select conname, pg_get_constraintdef(oid) as def
      from pg_constraint
      where conrelid = 'public.profiles'::regclass and contype = 'c'
    loop
      if r.def ilike '%role%' and (r.def ilike '%amele%' or r.def ilike '%member%' or r.def ilike '%admin%') then
        execute format('alter table public.profiles drop constraint %I', r.conname);
        v_eski := true;
      end if;
    end loop;
    if v_eski then
      alter table public.profiles
        add constraint profiles_role_h7_check
        check (role in ('ceo', 'admin', 'mod', 'amele', 'member')) not valid;
    end if;
  end if;
end $$;

-- role_permissions.tab bir kısıtla sınırlıysa yeni "releases" (Dijital Yayınlar) bölümünü ekle
do $$
declare
  r record;
  v_eski boolean := false;
begin
  for r in
    select conname, pg_get_constraintdef(oid) as def
    from pg_constraint
    where conrelid = 'public.role_permissions'::regclass and contype = 'c'
  loop
    if r.def ilike '%overview%' then
      execute format('alter table public.role_permissions drop constraint %I', r.conname);
      v_eski := true;
    end if;
  end loop;
  if v_eski then
    alter table public.role_permissions
      add constraint role_permissions_tab_h7_check
      check (tab in ('overview', 'traffic', 'orders', 'support', 'wallet', 'payments', 'influencers', 'smm',
                     'services', 'producers', 'content', 'members', 'ai', 'settings', 'releases')) not valid;
  end if;
end $$;

-- ---------------------------------------------------------------------
-- 4) Profil koruması
--    - Herkese açık kayıt ekranı / tarayıcı hiçbir zaman yönetici veya CEO rolü oluşturamaz.
--    - Rol ve engel durumu yalnızca yetkili h7_ fonksiyonlarıyla, sunucuyla veya SQL Editor'den değişir.
-- ---------------------------------------------------------------------
create or replace function public.h7_profil_koru()
returns trigger
language plpgsql
security definer
set search_path = public
as $$
begin
  if public.h7_guvenilir() then
    return new;
  end if;
  if tg_op = 'INSERT' then
    new.role := 'member';
    new.banned := false;
    return new;
  end if;
  if new.role is distinct from old.role or new.banned is distinct from old.banned then
    raise exception 'YETKISIZ: Rol ve engel durumu yalnızca yetkili yönetim işlemleriyle değiştirilebilir.'
      using errcode = '42501';
  end if;
  return new;
end;
$$;
drop trigger if exists h7_profil_koru on public.profiles;
create trigger h7_profil_koru
  before insert or update on public.profiles
  for each row execute function public.h7_profil_koru();

-- ---------------------------------------------------------------------
-- 5) Üye yönetimi (panelden çağrılır; yetki burada, veritabanında kontrol edilir)
-- ---------------------------------------------------------------------

-- Rol ver: CEO herkese (CEO hariç) admin / mod / personel / üye verebilir.
--          Admin yalnızca moderatör / personel / üye rolleri arasında değişiklik yapabilir.
create or replace function public.h7_uye_rol(p_uye uuid, p_rol text)
returns jsonb
language plpgsql
security definer
set search_path = public
as $$
declare
  v_ben text := public.h7_rol();
  v_hedef text;
begin
  if v_ben is null or v_ben not in ('ceo', 'admin') then
    raise exception 'YETKISIZ: Rol vermek için CEO veya admin olmalısın.' using errcode = '42501';
  end if;
  if p_rol is null or p_rol not in ('admin', 'mod', 'amele', 'member') then
    raise exception 'Geçersiz rol. (CEO rolü panelden verilemez.)';
  end if;
  if p_uye = auth.uid() then
    raise exception 'Kendi rolünü değiştiremezsin.';
  end if;
  select role::text into v_hedef from public.profiles where id = p_uye for update;
  if v_hedef is null then
    raise exception 'Üye bulunamadı.';
  end if;
  if v_hedef = 'ceo' then
    raise exception 'CEO hesabının rolü panelden değiştirilemez.' using errcode = '42501';
  end if;
  if v_ben = 'admin' and (v_hedef = 'admin' or p_rol = 'admin') then
    raise exception 'YETKISIZ: Admin rolünü yalnızca CEO verebilir veya geri alabilir.' using errcode = '42501';
  end if;

  perform set_config('hity7.yetkili_islem', 'on', true);
  -- %L: rol sütunu metin de ENUM da olsa değer güvenle yazılır
  execute format('update public.profiles set role = %L, panel_request = false where id = %L', p_rol, p_uye);
  perform set_config('hity7.yetkili_islem', 'off', true);

  perform public.h7_kayit('uye.rol_degisti', p_uye::text, jsonb_build_object('eski', v_hedef, 'yeni', p_rol));
  return jsonb_build_object('ok', true, 'rol', p_rol);
end;
$$;

-- Engelle / engeli kaldır
create or replace function public.h7_uye_engel(p_uye uuid, p_engel boolean)
returns jsonb
language plpgsql
security definer
set search_path = public
as $$
declare
  v_ben text := public.h7_rol();
  v_hedef text;
begin
  if not public.h7_yetki('members') then
    raise exception 'YETKISIZ: Üye yönetimi yetkin yok.' using errcode = '42501';
  end if;
  if p_uye = auth.uid() then
    raise exception 'Kendini engelleyemezsin.';
  end if;
  select role::text into v_hedef from public.profiles where id = p_uye for update;
  if v_hedef is null then
    raise exception 'Üye bulunamadı.';
  end if;
  if v_hedef = 'ceo' then
    raise exception 'CEO hesabı engellenemez.' using errcode = '42501';
  end if;
  if v_hedef = 'admin' and v_ben <> 'ceo' then
    raise exception 'YETKISIZ: Admin hesabını yalnızca CEO engelleyebilir.' using errcode = '42501';
  end if;
  if v_hedef in ('mod', 'amele') and v_ben not in ('ceo', 'admin') then
    raise exception 'YETKISIZ: Yönetici hesaplarını yalnızca CEO veya admin engelleyebilir.' using errcode = '42501';
  end if;

  perform set_config('hity7.yetkili_islem', 'on', true);
  update public.profiles set banned = coalesce(p_engel, false) where id = p_uye;
  perform set_config('hity7.yetkili_islem', 'off', true);

  perform public.h7_kayit(case when p_engel then 'uye.engellendi' else 'uye.engel_kaldirildi' end, p_uye::text, '{}'::jsonb);
  return jsonb_build_object('ok', true, 'banned', coalesce(p_engel, false));
end;
$$;

-- Yönetici başvurusunu reddet
create or replace function public.h7_basvuru_red(p_uye uuid)
returns jsonb
language plpgsql
security definer
set search_path = public
as $$
begin
  if coalesce(public.h7_rol(), '') not in ('ceo', 'admin') then
    raise exception 'YETKISIZ' using errcode = '42501';
  end if;
  update public.profiles set panel_request = false where id = p_uye;
  perform public.h7_kayit('uye.basvuru_reddedildi', p_uye::text, '{}'::jsonb);
  return jsonb_build_object('ok', true);
end;
$$;

revoke execute on function public.h7_uye_rol(uuid, text) from public, anon;
revoke execute on function public.h7_uye_engel(uuid, boolean) from public, anon;
revoke execute on function public.h7_basvuru_red(uuid) from public, anon;
grant execute on function public.h7_uye_rol(uuid, text) to authenticated, service_role;
grant execute on function public.h7_uye_engel(uuid, boolean) to authenticated, service_role;
grant execute on function public.h7_basvuru_red(uuid) to authenticated, service_role;

-- ---------------------------------------------------------------------
-- 6) İlk CEO ataması — YALNIZCA Supabase SQL Editor'den çalışır.
--    Kullanım:  select public.h7_ceo_ata('patron@ornek.com');
-- ---------------------------------------------------------------------
create or replace function public.h7_ceo_ata(p_eposta text)
returns text
language plpgsql
security definer
set search_path = public
as $$
declare
  v_id uuid;
begin
  if public.h7_jwt_role() <> '' or session_user::text not in ('postgres', 'supabase_admin') then
    raise exception 'Bu işlem yalnızca Supabase SQL Editor''den çalıştırılabilir.' using errcode = '42501';
  end if;
  select id into v_id from auth.users where lower(email) = lower(trim(p_eposta)) limit 1;
  if v_id is null then
    raise exception 'Bu e-posta ile kayıtlı kullanıcı bulunamadı: %', p_eposta;
  end if;
  update public.profiles set role = 'ceo', banned = false, panel_request = false where id = v_id;
  if not found then
    raise exception 'Kullanıcının profil kaydı yok. Hesap önce siteye bir kez giriş yapmalı.';
  end if;
  insert into public.audit_log (actor_id, action, target, details)
  values (null, 'uye.ceo_atandi', v_id::text, jsonb_build_object('eposta', lower(trim(p_eposta))));
  return 'CEO atandı: ' || lower(trim(p_eposta));
end;
$$;
revoke execute on function public.h7_ceo_ata(text) from public, anon, authenticated;

commit;


-- >>>>>>>>>> 20261110100100_h7_02_siparis_cuzdan.sql >>>>>>>>>>

-- =====================================================================
-- HITY7 · Migration 02 · Sipariş durumları, sipariş geçmişi/teslimat, cüzdan koruması ve yönetim işlemleri
--
-- Supabase → SQL Editor'de 01'den SONRA çalıştırın. Tekrar çalıştırılabilir. Tek transaction.
-- Mevcut siparişler ve bakiye hareketleri silinmez. Yalnızca eski durum adları yenilerine çevrilir:
--   "Beklemede" → "Alındı",  "İptal" → "İptal Edildi"
-- =====================================================================
begin;

-- ---------------------------------------------------------------------
-- 1) Sipariş durumları
--    Ödeme Bekleniyor · Alındı · İşlemde · Revizyon · Tamamlandı · İptal Edildi
-- ---------------------------------------------------------------------
do $$
declare
  r record;
  v_typ text;
  v_udt text;
  v_udt_schema text;
  v_eski boolean := false;
begin
  select data_type, udt_name, udt_schema into v_typ, v_udt, v_udt_schema
  from information_schema.columns
  where table_schema = 'public' and table_name = 'orders' and column_name = 'status';

  if v_typ = 'USER-DEFINED' then
    execute format('alter type %I.%I add value if not exists %L', v_udt_schema, v_udt, 'Ödeme Bekleniyor');
    execute format('alter type %I.%I add value if not exists %L', v_udt_schema, v_udt, 'Alındı');
    execute format('alter type %I.%I add value if not exists %L', v_udt_schema, v_udt, 'İptal Edildi');
    raise notice 'orders.status bir ENUM: eski durum adları bu çalıştırmada çevrilmedi; migration''ı bir kez daha çalıştırın.';
  else
    for r in
      select conname, pg_get_constraintdef(oid) as def
      from pg_constraint
      where conrelid = 'public.orders'::regclass and contype = 'c'
    loop
      if r.def ilike '%status%' and (r.def ilike '%Beklemede%' or r.def ilike '%Tamamland%' or r.def ilike '%Alınd%') then
        execute format('alter table public.orders drop constraint %I', r.conname);
        v_eski := true;
      end if;
    end loop;
    if v_eski then
      alter table public.orders
        add constraint orders_status_h7_check
        check (status in ('Ödeme Bekleniyor', 'Alındı', 'İşlemde', 'Revizyon', 'Tamamlandı', 'İptal Edildi', 'Beklemede', 'İptal')) not valid;
    end if;
  end if;
end $$;

-- Eski durum adlarını yenilerine çevir (ENUM değilse; ENUM ise ikinci çalıştırmada)
do $$
declare
  v_beklemede int := 0;
  v_iptal int := 0;
begin
  begin
    update public.orders set status = 'Alındı' where status::text = 'Beklemede';
    get diagnostics v_beklemede = row_count;
    update public.orders set status = 'İptal Edildi' where status::text = 'İptal';
    get diagnostics v_iptal = row_count;
    raise notice 'Durum adları güncellendi: % sipariş "Alındı", % sipariş "İptal Edildi".', v_beklemede, v_iptal;
  exception when others then
    raise notice 'Durum adları bu çalıştırmada güncellenemedi (%). Migration''ı bir kez daha çalıştırın.', sqlerrm;
  end;
end $$;

-- ---------------------------------------------------------------------
-- 2) Sipariş geçmişi: durum değişiklikleri, teslim dosyaları, revizyon talepleri, notlar
-- ---------------------------------------------------------------------
create table if not exists public.order_events (
  id bigint generated always as identity primary key,
  order_id bigint not null,
  kind text not null check (kind in ('durum', 'teslimat', 'revizyon', 'not', 'iade')),
  status text,
  note text,
  file_name text,
  file_url text,
  actor_id uuid,
  visible boolean not null default true, -- false: yalnızca yönetim görür (iç not)
  created_at timestamptz not null default now()
);
create index if not exists order_events_order_idx on public.order_events (order_id, created_at);
alter table public.order_events enable row level security;

-- ---------------------------------------------------------------------
-- 3) Sipariş koruması: tarayıcı siparişleri doğrudan değiştiremez / silemez.
--    Siparişler yalnızca sunucu (place_order) ve yetkili h7_ fonksiyonlarıyla değişir.
-- ---------------------------------------------------------------------
create or replace function public.h7_siparis_koru()
returns trigger
language plpgsql
security definer
set search_path = public
as $$
begin
  if not public.h7_guvenilir() then
    raise exception 'YETKISIZ: Siparişler yalnızca sunucu tarafında veya yetkili yönetim işlemleriyle değiştirilebilir.'
      using errcode = '42501';
  end if;
  if tg_op = 'DELETE' then
    return old;
  end if;
  -- Eski durum adlarını yenilerine çevir (eski place_order "Beklemede" yazsa bile)
  if new.status::text = 'Beklemede' then
    new.status := 'Alındı';
  elsif new.status::text = 'İptal' then
    new.status := 'İptal Edildi';
  end if;
  return new;
end;
$$;
drop trigger if exists h7_siparis_koru on public.orders;
create trigger h7_siparis_koru
  before insert or update or delete on public.orders
  for each row execute function public.h7_siparis_koru();

-- Durum değişikliklerini geçmişe yaz
create or replace function public.h7_siparis_olay()
returns trigger
language plpgsql
security definer
set search_path = public
as $$
begin
  -- Geçmiş kaydı hiçbir koşulda sipariş oluşturmayı / güncellemeyi engellememeli
  begin
    if tg_op = 'INSERT' then
      insert into public.order_events (order_id, kind, status, note, actor_id)
      values (new.id, 'durum', new.status::text, 'Sipariş oluşturuldu', auth.uid());
    elsif new.status is distinct from old.status then
      insert into public.order_events (order_id, kind, status, note, actor_id)
      values (new.id, 'durum', new.status::text, nullif(current_setting('hity7.not', true), ''), auth.uid());
    end if;
  exception when others then
    raise warning 'order_events yazılamadı: %', sqlerrm;
  end;
  return null;
end;
$$;
drop trigger if exists h7_siparis_olay on public.orders;
create trigger h7_siparis_olay
  after insert or update of status on public.orders
  for each row execute function public.h7_siparis_olay();

-- ---------------------------------------------------------------------
-- 4) Cüzdan koruması
--    - Bakiye hareketleri tarayıcıdan oluşturulamaz / değiştirilemez / silinemez.
--    - Sonuçlanmış (ok / failed) bir hareketin durumu bir daha değişemez (çift işlem önlemi).
--    - Tutar, sahip ve tür sonradan değiştirilemez.
-- ---------------------------------------------------------------------
create or replace function public.h7_cuzdan_koru()
returns trigger
language plpgsql
security definer
set search_path = public
as $$
declare
  v_sql_editor boolean := public.h7_jwt_role() = '' and session_user::text in ('postgres', 'supabase_admin');
begin
  if not public.h7_guvenilir() then
    raise exception 'YETKISIZ: Bakiye yalnızca sunucu tarafında değiştirilebilir.' using errcode = '42501';
  end if;
  if tg_op = 'DELETE' then
    if not v_sql_editor then
      raise exception 'Bakiye hareketleri silinemez.' using errcode = '42501';
    end if;
    return old;
  end if;
  if tg_op = 'UPDATE' and not v_sql_editor then
    if old.status::text <> 'pending' and new.status is distinct from old.status then
      raise exception 'Sonuçlanmış bir bakiye hareketinin durumu değiştirilemez (çift işlem önlemi).' using errcode = '42501';
    end if;
    if new.amount is distinct from old.amount or new.user_id is distinct from old.user_id or new.kind is distinct from old.kind then
      raise exception 'Bakiye hareketinin tutarı, sahibi veya türü değiştirilemez.' using errcode = '42501';
    end if;
  end if;
  return new;
end;
$$;
drop trigger if exists h7_cuzdan_koru on public.wallet_transactions;
create trigger h7_cuzdan_koru
  before insert or update or delete on public.wallet_transactions
  for each row execute function public.h7_cuzdan_koru();

-- Aynı referansla (ödeme no / iade / düzeltme) ikinci kayıt oluşamaz → çift yükleme / çift iade önlemi
do $$
begin
  if not exists (select 1 from pg_indexes where schemaname = 'public' and indexname = 'wallet_transactions_ref_tekil') then
    if exists (
      select 1 from public.wallet_transactions where ref is not null group by ref having count(*) > 1
    ) then
      raise notice 'UYARI: wallet_transactions.ref alanında tekrar eden kayıtlar var; tekil indeks oluşturulmadı. Tekrarları temizleyip migration''ı yeniden çalıştırın.';
    else
      create unique index wallet_transactions_ref_tekil on public.wallet_transactions (ref) where ref is not null;
    end if;
  end if;
end $$;

-- ---------------------------------------------------------------------
-- 5) Yönetim işlemleri (panelden çağrılır; yetki ve kayıt veritabanında)
-- ---------------------------------------------------------------------

-- Sipariş durumunu değiştir. İptalde istenirse tutar müşterinin bakiyesine iade edilir (tek sefer).
create or replace function public.h7_siparis_durum(
  p_siparis bigint,
  p_durum text,
  p_not text default null,
  p_iade boolean default false
)
returns jsonb
language plpgsql
security definer
set search_path = public
as $$
declare
  o record;
  v_rol text := public.h7_rol();
  v_ref text;
begin
  if not public.h7_yetki('orders') then
    raise exception 'YETKISIZ: Sipariş durumunu değiştirme yetkin yok.' using errcode = '42501';
  end if;
  if p_durum is null or p_durum not in ('Ödeme Bekleniyor', 'Alındı', 'İşlemde', 'Revizyon', 'Tamamlandı', 'İptal Edildi') then
    raise exception 'Geçersiz durum.';
  end if;

  select id, code, user_id, amount, status::text as status into o
  from public.orders where id = p_siparis for update;
  if not found then
    raise exception 'Sipariş bulunamadı.';
  end if;

  perform set_config('hity7.yetkili_islem', 'on', true);

  if coalesce(p_iade, false) then
    if p_durum <> 'İptal Edildi' then
      raise exception 'İade yalnızca sipariş iptal edilirken yapılabilir.';
    end if;
    if not (v_rol in ('ceo', 'admin') or public.h7_yetki('wallet')) then
      raise exception 'YETKISIZ: İade için cüzdan yetkisi gerekir.' using errcode = '42501';
    end if;
    if coalesce(o.amount, 0) <= 0 or o.user_id is null then
      raise exception 'Bu siparişte iade edilecek tutar yok.';
    end if;
    v_ref := 'IADE-' || coalesce(o.code, o.id::text);
    if exists (select 1 from public.wallet_transactions where ref = v_ref) then
      raise exception 'Bu sipariş zaten iade edilmiş.';
    end if;
    insert into public.wallet_transactions (user_id, kind, amount, status, provider, ref, note)
    values (o.user_id, 'topup', o.amount, 'ok', 'iade', v_ref, 'Sipariş iadesi · ' || coalesce(o.code, '#' || o.id::text));
    insert into public.order_events (order_id, kind, note, actor_id)
    values (o.id, 'iade', 'Sipariş tutarı bakiyeye iade edildi: ' || o.amount::text || ' TL', auth.uid());
  end if;

  perform set_config('hity7.not', coalesce(left(p_not, 500), ''), true);
  -- %L: durum sütunu metin de ENUM da olsa değer güvenle yazılır
  execute format('update public.orders set status = %L where id = %L', p_durum, o.id);
  perform set_config('hity7.not', '', true);
  perform set_config('hity7.yetkili_islem', 'off', true);

  perform public.h7_kayit('siparis.durum', coalesce(o.code, o.id::text),
    jsonb_build_object('eski', o.status, 'yeni', p_durum, 'iade', coalesce(p_iade, false), 'tutar', o.amount, 'not', p_not));
  return jsonb_build_object('ok', true, 'status', p_durum, 'iade', coalesce(p_iade, false));
end;
$$;

-- Teslim dosyası / not ekle; istenirse siparişi "Tamamlandı" yap
create or replace function public.h7_teslimat_ekle(
  p_siparis bigint,
  p_dosya_adi text,
  p_dosya_url text,
  p_not text default null,
  p_tamamla boolean default true
)
returns jsonb
language plpgsql
security definer
set search_path = public
as $$
declare
  o record;
begin
  if not public.h7_yetki('orders') then
    raise exception 'YETKISIZ: Teslimat ekleme yetkin yok.' using errcode = '42501';
  end if;
  if coalesce(trim(p_dosya_url), '') = '' and coalesce(trim(p_not), '') = '' then
    raise exception 'Teslim dosyası veya not gerekli.';
  end if;
  if coalesce(trim(p_dosya_url), '') <> '' and p_dosya_url !~ '^https://' then
    raise exception 'Dosya adresi https:// ile başlamalı.';
  end if;

  select id, code, status::text as status into o from public.orders where id = p_siparis for update;
  if not found then
    raise exception 'Sipariş bulunamadı.';
  end if;

  insert into public.order_events (order_id, kind, note, file_name, file_url, actor_id)
  values (o.id, 'teslimat', nullif(left(trim(coalesce(p_not, '')), 1500), ''),
          nullif(left(trim(coalesce(p_dosya_adi, '')), 200), ''), nullif(trim(coalesce(p_dosya_url, '')), ''), auth.uid());

  if coalesce(p_tamamla, true) and o.status not in ('Tamamlandı', 'İptal Edildi') then
    perform set_config('hity7.yetkili_islem', 'on', true);
    perform set_config('hity7.not', 'Teslimat yapıldı', true);
    update public.orders set status = 'Tamamlandı' where id = o.id;
    perform set_config('hity7.not', '', true);
    perform set_config('hity7.yetkili_islem', 'off', true);
  end if;

  perform public.h7_kayit('siparis.teslimat', coalesce(o.code, o.id::text),
    jsonb_build_object('dosya', p_dosya_adi, 'tamamla', coalesce(p_tamamla, true)));
  return jsonb_build_object('ok', true);
end;
$$;

-- Müşteri: tamamlanan / işlemdeki siparişi için revizyon ister
create or replace function public.h7_revizyon_talep(p_siparis bigint, p_not text)
returns jsonb
language plpgsql
security definer
set search_path = public
as $$
declare
  o record;
begin
  if auth.uid() is null then
    raise exception 'Giriş gerekli.' using errcode = '42501';
  end if;
  if length(trim(coalesce(p_not, ''))) < 5 then
    raise exception 'Lütfen revizyon isteğini birkaç kelimeyle anlat.';
  end if;

  select id, code, user_id, status::text as status, type::text as type into o
  from public.orders where id = p_siparis for update;
  if not found or o.user_id is distinct from auth.uid() then
    raise exception 'Sipariş bulunamadı.';
  end if;
  if o.status not in ('Tamamlandı', 'İşlemde') then
    raise exception 'Revizyon yalnızca işlemdeki veya tamamlanan siparişler için istenebilir.';
  end if;
  if o.type = 'smm' then
    raise exception 'SMM siparişlerinde revizyon yerine destek talebi oluşturabilirsin.';
  end if;

  insert into public.order_events (order_id, kind, note, actor_id)
  values (o.id, 'revizyon', left(trim(p_not), 1500), auth.uid());

  perform set_config('hity7.yetkili_islem', 'on', true);
  perform set_config('hity7.not', 'Müşteri revizyon istedi', true);
  update public.orders set status = 'Revizyon' where id = o.id;
  perform set_config('hity7.not', '', true);
  perform set_config('hity7.yetkili_islem', 'off', true);

  perform public.h7_kayit('siparis.revizyon_talebi', coalesce(o.code, o.id::text), '{}'::jsonb);
  return jsonb_build_object('ok', true);
end;
$$;

-- Bekleyen bakiye yüklemesini (havale) onayla / reddet — tek sefer
create or replace function public.h7_bakiye_onay(p_islem bigint, p_onay boolean, p_not text default null)
returns jsonb
language plpgsql
security definer
set search_path = public
as $$
declare
  t record;
  v_not text;
begin
  if not public.h7_yetki('wallet') then
    raise exception 'YETKISIZ: Cüzdan yönetimi yetkin yok.' using errcode = '42501';
  end if;
  select id, user_id, amount, status::text as status, kind::text as kind, provider, ref, note into t
  from public.wallet_transactions where id = p_islem for update;
  if not found then
    raise exception 'İşlem bulunamadı.';
  end if;
  if t.kind <> 'topup' or t.status <> 'pending' then
    raise exception 'Bu işlem zaten sonuçlanmış.';
  end if;

  v_not := case when coalesce(trim(p_not), '') <> '' then left(coalesce(t.note, '') || ' · ' || trim(p_not), 300) else t.note end;
  perform set_config('hity7.yetkili_islem', 'on', true);
  -- %L: durum sütunu metin de ENUM da olsa değer güvenle yazılır
  execute format('update public.wallet_transactions set status = %L, note = %L where id = %L',
                 case when coalesce(p_onay, false) then 'ok' else 'failed' end, v_not, t.id);
  perform set_config('hity7.yetkili_islem', 'off', true);

  perform public.h7_kayit(case when p_onay then 'cuzdan.yukleme_onaylandi' else 'cuzdan.yukleme_reddedildi' end,
    coalesce(t.ref, t.id::text), jsonb_build_object('uye', t.user_id, 'tutar', t.amount, 'yontem', t.provider, 'not', p_not));
  return jsonb_build_object('ok', true, 'status', case when p_onay then 'ok' else 'failed' end);
end;
$$;

-- Manuel bakiye düzeltme: yalnızca CEO / admin, gerekçe zorunlu, işlem kaydına yazılır
create or replace function public.h7_bakiye_duzelt(p_uye uuid, p_tutar numeric, p_yon text, p_gerekce text)
returns jsonb
language plpgsql
security definer
set search_path = public
as $$
declare
  v_once numeric;
  v_sonra numeric;
  v_ref text;
  v_tutar numeric := round(coalesce(p_tutar, 0), 2);
begin
  if coalesce(public.h7_rol(), '') not in ('ceo', 'admin') then
    raise exception 'YETKISIZ: Manuel bakiye düzeltmesini yalnızca CEO veya admin yapabilir.' using errcode = '42501';
  end if;
  if p_yon not in ('ekle', 'dus') then
    raise exception 'Düzeltme yönü geçersiz.';
  end if;
  if v_tutar <= 0 or v_tutar > 1000000 then
    raise exception 'Tutar 0 ile 1.000.000 TL arasında olmalı.';
  end if;
  if length(trim(coalesce(p_gerekce, ''))) < 5 then
    raise exception 'Gerekçe zorunlu (en az 5 karakter).';
  end if;
  if not exists (select 1 from public.profiles where id = p_uye) then
    raise exception 'Üye bulunamadı.';
  end if;

  -- Aynı üye için eşzamanlı düzeltmeleri sıraya koy
  perform pg_advisory_xact_lock(hashtext('h7_cuzdan_' || p_uye::text));
  v_once := coalesce(public.wallet_balance(p_uye), 0);
  if p_yon = 'dus' and v_once < v_tutar then
    raise exception 'Üyenin bakiyesi (% TL) düşülecek tutardan az.', v_once;
  end if;

  v_ref := 'DZT-' || upper(substr(md5(random()::text || clock_timestamp()::text), 1, 12));
  perform set_config('hity7.yetkili_islem', 'on', true);
  -- %L: tür / durum sütunları metin de ENUM da olsa değerler güvenle yazılır
  execute format(
    'insert into public.wallet_transactions (user_id, kind, amount, status, provider, ref, note) values (%L, %L, %L, %L, %L, %L, %L)',
    p_uye, case when p_yon = 'ekle' then 'topup' else 'spend' end, trim_scale(v_tutar)::text, 'ok', 'admin', v_ref,
    left('Düzeltme: ' || trim(p_gerekce), 300));
  perform set_config('hity7.yetkili_islem', 'off', true);
  v_sonra := coalesce(public.wallet_balance(p_uye), 0);

  perform public.h7_kayit('cuzdan.manuel_duzeltme', p_uye::text,
    jsonb_build_object('yon', p_yon, 'tutar', v_tutar, 'gerekce', trim(p_gerekce), 'once', v_once, 'sonra', v_sonra, 'ref', v_ref));
  return jsonb_build_object('ok', true, 'ref', v_ref, 'once', v_once, 'sonra', v_sonra);
end;
$$;

revoke execute on function public.h7_siparis_durum(bigint, text, text, boolean) from public, anon;
revoke execute on function public.h7_teslimat_ekle(bigint, text, text, text, boolean) from public, anon;
revoke execute on function public.h7_revizyon_talep(bigint, text) from public, anon;
revoke execute on function public.h7_bakiye_onay(bigint, boolean, text) from public, anon;
revoke execute on function public.h7_bakiye_duzelt(uuid, numeric, text, text) from public, anon;
grant execute on function public.h7_siparis_durum(bigint, text, text, boolean) to authenticated, service_role;
grant execute on function public.h7_teslimat_ekle(bigint, text, text, text, boolean) to authenticated, service_role;
grant execute on function public.h7_revizyon_talep(bigint, text) to authenticated, service_role;
grant execute on function public.h7_bakiye_onay(bigint, boolean, text) to authenticated, service_role;
grant execute on function public.h7_bakiye_duzelt(uuid, numeric, text, text) to authenticated, service_role;

commit;


-- >>>>>>>>>> 20261110100200_h7_03_dijital_yayin.sql >>>>>>>>>>

-- =====================================================================
-- HITY7 · Migration 03 · Dijital yayın başvuruları (Single / EP / Albüm), ISRC ve UPC
--
-- 01 ve 02'den SONRA çalıştırın. Tekrar çalıştırılabilir. Tek transaction.
-- ISRC / UPC sanatçıdan istenmez: her şarkıya ISRC, her yayın paketine UPC'yi HITY7 yönetimi atar.
-- =====================================================================
begin;

create table if not exists public.releases (
  id uuid primary key default gen_random_uuid(),
  order_id bigint,                                   -- ilgili sipariş (orders.id)
  user_id uuid not null references auth.users (id) on delete cascade,
  format text not null check (format in ('single', 'ep', 'album')),
  title text not null,
  artist text not null,
  release_date date,
  genre text,
  language text,
  country text,
  explicit boolean not null default false,
  release_type text not null default 'original',     -- original | cover
  cover_url text,
  stores text[] not null default '{}',
  upc text,
  status text not null default 'Başvuru alındı',
  admin_note text,                                   -- müşteriye görünen yönetim notu
  meta jsonb not null default '{}'::jsonb,
  created_at timestamptz not null default now(),
  updated_at timestamptz not null default now()
);
create index if not exists releases_user_idx on public.releases (user_id, created_at desc);
create index if not exists releases_order_idx on public.releases (order_id);
create unique index if not exists releases_upc_tekil on public.releases (upc) where upc is not null;

create table if not exists public.release_tracks (
  id uuid primary key default gen_random_uuid(),
  release_id uuid not null references public.releases (id) on delete cascade,
  position int not null,
  title text not null,
  audio_url text,
  audio_name text,
  songwriter text,
  composer text,
  language text,
  explicit boolean not null default false,
  instrumental boolean not null default false,
  isrc text,
  created_at timestamptz not null default now(),
  unique (release_id, position)
);
create unique index if not exists release_tracks_isrc_tekil on public.release_tracks (isrc) where isrc is not null;

alter table public.releases enable row level security;
alter table public.release_tracks enable row level security;

-- Tarayıcı yayın kayıtlarını doğrudan değiştiremez (ISRC / UPC dahil); yalnızca sunucu ve yetkili fonksiyonlar
create or replace function public.h7_yayin_koru()
returns trigger
language plpgsql
security definer
set search_path = public
as $$
begin
  if not public.h7_guvenilir() then
    raise exception 'YETKISIZ: Yayın kayıtları yalnızca HITY7 yönetimi tarafından değiştirilebilir.' using errcode = '42501';
  end if;
  return coalesce(new, old);
end;
$$;
drop trigger if exists h7_yayin_koru on public.releases;
create trigger h7_yayin_koru before insert or update or delete on public.releases
  for each row execute function public.h7_yayin_koru();
drop trigger if exists h7_yayin_koru on public.release_tracks;
create trigger h7_yayin_koru before insert or update or delete on public.release_tracks
  for each row execute function public.h7_yayin_koru();

-- UPC-A (12 hane) / EAN-13 (13 hane) kontrol hanesi doğrulaması
create or replace function public.h7_upc_gecerli(p text)
returns boolean
language plpgsql
immutable
set search_path = public
as $$
declare
  v_toplam int := 0;
  v_n int;
  i int;
  d int;
begin
  if p is null or p !~ '^[0-9]{12,13}$' then
    return false;
  end if;
  v_n := length(p);
  -- sağdan başlayarak (kontrol hanesi hariç) 3,1,3,1… ağırlıkları
  for i in 1 .. v_n - 1 loop
    d := substr(p, v_n - i, 1)::int;
    v_toplam := v_toplam + case when i % 2 = 1 then d * 3 else d end;
  end loop;
  return (10 - (v_toplam % 10)) % 10 = substr(p, v_n, 1)::int;
end;
$$;

-- Yönetim: UPC ve şarkı ISRC kodlarını ata
-- p_isrc örneği: '[{"id": "<şarkı uuid>", "isrc": "TRA1B2600001"}]'
create or replace function public.h7_yayin_kod(p_yayin uuid, p_upc text, p_isrc jsonb default '[]'::jsonb)
returns jsonb
language plpgsql
security definer
set search_path = public
as $$
declare
  v_upc text;
  v_isrc text;
  e jsonb;
  v_sayac int := 0;
begin
  if not public.h7_yetki('releases') then
    raise exception 'YETKISIZ: Dijital yayın yönetimi yetkin yok.' using errcode = '42501';
  end if;
  perform 1 from public.releases where id = p_yayin for update;
  if not found then
    raise exception 'Yayın bulunamadı.';
  end if;

  v_upc := nullif(regexp_replace(coalesce(p_upc, ''), '[^0-9]', '', 'g'), '');
  if v_upc is not null and not public.h7_upc_gecerli(v_upc) then
    raise exception 'UPC geçersiz: 12 (UPC-A) veya 13 (EAN-13) haneli olmalı ve kontrol hanesi doğru olmalı.';
  end if;

  perform set_config('hity7.yetkili_islem', 'on', true);
  begin
    update public.releases set upc = v_upc, updated_at = now() where id = p_yayin;
  exception when unique_violation then
    raise exception 'Bu UPC başka bir yayına atanmış.';
  end;

  for e in select value from jsonb_array_elements(coalesce(p_isrc, '[]'::jsonb))
  loop
    v_isrc := nullif(upper(regexp_replace(coalesce(e ->> 'isrc', ''), '[^A-Za-z0-9]', '', 'g')), '');
    if v_isrc is not null and v_isrc !~ '^[A-Z]{2}[A-Z0-9]{3}[0-9]{7}$' then
      raise exception 'ISRC geçersiz: % (doğru biçim: ülke 2 harf + kayıt sahibi 3 karakter + yıl 2 hane + 5 hane, örn. TRA1B2600001)', e ->> 'isrc';
    end if;
    begin
      update public.release_tracks set isrc = v_isrc
      where id = (e ->> 'id')::uuid and release_id = p_yayin;
      if found then v_sayac := v_sayac + 1; end if;
    exception when unique_violation then
      raise exception 'ISRC % başka bir şarkıya atanmış.', v_isrc;
    end;
  end loop;
  perform set_config('hity7.yetkili_islem', 'off', true);

  perform public.h7_kayit('yayin.kod_atandi', p_yayin::text, jsonb_build_object('upc', v_upc, 'sarki', v_sayac));
  return jsonb_build_object('ok', true, 'upc', v_upc, 'sarki', v_sayac);
end;
$$;

-- Yönetim: yayın durumunu değiştir (müşteri "Dijital Yayınlarım"da görür)
create or replace function public.h7_yayin_durum(p_yayin uuid, p_durum text, p_not text default null)
returns jsonb
language plpgsql
security definer
set search_path = public
as $$
declare
  r record;
begin
  if not public.h7_yetki('releases') then
    raise exception 'YETKISIZ: Dijital yayın yönetimi yetkin yok.' using errcode = '42501';
  end if;
  if p_durum is null or p_durum not in ('Başvuru alındı', 'İncelemede', 'Düzeltme gerekli', 'Onaylandı',
                                        'Dağıtıma gönderildi', 'Yayında', 'Reddedildi') then
    raise exception 'Geçersiz yayın durumu.';
  end if;
  select id, order_id, status into r from public.releases where id = p_yayin for update;
  if not found then
    raise exception 'Yayın bulunamadı.';
  end if;

  perform set_config('hity7.yetkili_islem', 'on', true);
  update public.releases
  set status = p_durum,
      admin_note = case when p_not is null then admin_note else nullif(left(trim(p_not), 1000), '') end,
      updated_at = now()
  where id = p_yayin;

  -- Yayına çıkınca bağlı siparişi "Tamamlandı" yap
  if p_durum = 'Yayında' and r.order_id is not null then
    perform set_config('hity7.not', 'Yayın platformlarda yayında', true);
    update public.orders set status = 'Tamamlandı'
    where id = r.order_id and status::text not in ('Tamamlandı', 'İptal Edildi', 'İptal');
    perform set_config('hity7.not', '', true);
  elsif p_durum in ('İncelemede', 'Onaylandı', 'Dağıtıma gönderildi') and r.order_id is not null then
    update public.orders set status = 'İşlemde'
    where id = r.order_id and status::text in ('Alındı', 'Beklemede', 'Ödeme Bekleniyor');
  end if;
  perform set_config('hity7.yetkili_islem', 'off', true);

  perform public.h7_kayit('yayin.durum', p_yayin::text, jsonb_build_object('eski', r.status, 'yeni', p_durum, 'not', p_not));
  return jsonb_build_object('ok', true, 'status', p_durum);
end;
$$;

revoke execute on function public.h7_yayin_kod(uuid, text, jsonb) from public, anon;
revoke execute on function public.h7_yayin_durum(uuid, text, text) from public, anon;
grant execute on function public.h7_yayin_kod(uuid, text, jsonb) to authenticated, service_role;
grant execute on function public.h7_yayin_durum(uuid, text, text) to authenticated, service_role;

commit;


-- >>>>>>>>>> 20261110100300_h7_04_smm.sql >>>>>>>>>>

-- =====================================================================
-- HITY7 · Migration 04 · SMM sağlayıcı entegrasyonu: hata ve işlem kayıtları
--
-- 01–03'ten SONRA çalıştırın. Tekrar çalıştırılabilir. Tek transaction.
-- Sağlayıcıya gönderilen siparişin durumu orders.payload.smm alanında tutulur;
-- başarısız API çağrıları bu tabloya yazılır. API anahtarları provider_secrets'ta kalır (tarayıcı okuyamaz).
-- =====================================================================
begin;

create table if not exists public.smm_logs (
  id bigint generated always as identity primary key,
  level text not null default 'error' check (level in ('error', 'info')),
  event text not null,               -- add | status | sync | …
  message text,
  provider_id text,                  -- smm_providers.id
  order_id bigint,                   -- orders.id
  details jsonb not null default '{}'::jsonb,
  created_at timestamptz not null default now()
);
create index if not exists smm_logs_created_idx on public.smm_logs (created_at desc);
alter table public.smm_logs enable row level security;

-- SMM servislerini kodla hızlı bulmak için (sipariş gönderiminde kullanılır)
do $$
begin
  if exists (
    select 1 from information_schema.columns
    where table_schema = 'public' and table_name = 'smm_services' and column_name = 'code'
  ) then
    create index if not exists smm_services_code_idx on public.smm_services (code);
  end if;
end $$;

commit;


-- >>>>>>>>>> 20261110100400_h7_05_rls_ve_ceo_ozet.sql >>>>>>>>>>

-- =====================================================================
-- HITY7 · Migration 05 · Satır düzeyi güvenlik (RLS) + CEO özet istatistikleri
--
-- 01–04'ten SONRA çalıştırın. Tekrar çalıştırılabilir. Tek transaction.
--
-- Ne yapar?
--   1) Mevcut RLS politikalarının bir kopyasını public.h7_politika_yedegi tablosuna alır (ilk çalıştırmada).
--   2) Aşağıdaki tablolardaki ESKİ politikaları kaldırıp bilinen, test edilmiş bir politika setiyle değiştirir:
--      - Kullanıcı yalnızca KENDİ profilini, siparişlerini, bakiye hareketlerini, yayınlarını görür.
--      - Yönetim, yalnızca rolünün / bölüm yetkisinin izin verdiği verileri görür ve değiştirir.
--      - Gizli anahtar tablosuna (provider_secrets) tarayıcıdan hiçbir erişim yoktur.
--   3) CEO paneli için h7_ceo_ozet() istatistik fonksiyonunu oluşturur.
--
-- Geri dönüş: eski politikalar h7_politika_yedegi, tabloların eski RLS durumu h7_rls_yedegi tablosunda saklanır.
-- Geri yüklemek için: supabase/geri-al/05-rls-geri-al.sql
-- =====================================================================
begin;

-- ---------------------------------------------------------------------
-- 0) Eski politikaların yedeği (yalnızca ilk çalıştırmada doldurulur)
-- ---------------------------------------------------------------------
create table if not exists public.h7_politika_yedegi (
  alindi timestamptz not null default now(),
  tablename text,
  policyname text,
  permissive text,
  roles text[],
  cmd text,
  qual text,
  with_check text
);
alter table public.h7_politika_yedegi enable row level security;

insert into public.h7_politika_yedegi (tablename, policyname, permissive, roles, cmd, qual, with_check)
select tablename, policyname, permissive, roles::text[], cmd, qual, with_check
from pg_policies
where schemaname = 'public'
  and policyname not like 'h7\_%'
  and not exists (select 1 from public.h7_politika_yedegi);

-- Tabloların eski RLS durumu (açık / kapalı) — geri dönüş için (yalnızca ilk çalıştırmadaki durum saklanır)
create table if not exists public.h7_rls_yedegi (
  tablename text primary key,
  rls_acik boolean not null,
  alindi timestamptz not null default now()
);
alter table public.h7_rls_yedegi enable row level security;

insert into public.h7_rls_yedegi (tablename, rls_acik)
select c.relname, c.relrowsecurity
from pg_class c join pg_namespace n on n.oid = c.relnamespace
where n.nspname = 'public' and c.relkind in ('r', 'p')
  and c.relname in ('profiles', 'orders', 'wallet_transactions', 'page_views', 'role_permissions', 'site_content',
                    'influencers', 'samples', 'smm_providers', 'smm_services', 'smm_catalog', 'provider_secrets',
                    'payment_providers', 'support_tickets', 'support_messages', 'order_events', 'releases',
                    'release_tracks', 'audit_log', 'smm_logs')
on conflict (tablename) do nothing;

-- ---------------------------------------------------------------------
-- 1) Eski politikaları kaldır
-- ---------------------------------------------------------------------
do $$
declare
  r record;
begin
  for r in
    select tablename, policyname
    from pg_policies
    where schemaname = 'public'
      and tablename in ('profiles', 'orders', 'wallet_transactions', 'page_views', 'role_permissions', 'site_content',
                        'influencers', 'samples', 'smm_providers', 'smm_services', 'smm_catalog', 'provider_secrets',
                        'payment_providers', 'support_tickets', 'support_messages', 'order_events', 'releases',
                        'release_tracks', 'audit_log', 'smm_logs')
  loop
    execute format('drop policy if exists %I on public.%I', r.policyname, r.tablename);
  end loop;
end $$;

-- ---------------------------------------------------------------------
-- 2) RLS'i aç (tablo düzeyi)
-- ---------------------------------------------------------------------
alter table public.profiles enable row level security;
alter table public.orders enable row level security;
alter table public.wallet_transactions enable row level security;
alter table public.page_views enable row level security;
alter table public.role_permissions enable row level security;
alter table public.site_content enable row level security;
alter table public.influencers enable row level security;
alter table public.samples enable row level security;
alter table public.smm_providers enable row level security;
alter table public.smm_services enable row level security;
alter table public.provider_secrets enable row level security;
alter table public.payment_providers enable row level security;
alter table public.support_tickets enable row level security;
alter table public.support_messages enable row level security;
alter table public.order_events enable row level security;
alter table public.releases enable row level security;
alter table public.release_tracks enable row level security;
alter table public.audit_log enable row level security;
alter table public.smm_logs enable row level security;

-- Gizli anahtarlar: tarayıcı rolleri hiçbir şekilde erişemez
revoke all on public.provider_secrets from anon, authenticated;

-- İçerik düzenleme yetkisi (site yazıları, hizmetler, prodüktörler, ayarlar)
create or replace function public.h7_icerik_yetkisi()
returns boolean
language sql
stable
security definer
set search_path = public
as $$
  select public.h7_yetki('content') or public.h7_yetki('services') or public.h7_yetki('producers') or public.h7_yetki('settings');
$$;

-- ---------------------------------------------------------------------
-- 3) Politikalar
-- ---------------------------------------------------------------------

-- PROFILLER: kendi profilin + yönetim; rol / engel alanları tetikleyiciyle korunur
create policy h7_profiles_select on public.profiles for select to authenticated
  using (id = (select auth.uid()) or (select public.h7_yonetici_mi()));
create policy h7_profiles_insert on public.profiles for insert to authenticated
  with check (id = (select auth.uid()));
create policy h7_profiles_update on public.profiles for update to authenticated
  using (id = (select auth.uid())) with check (id = (select auth.uid()));

-- SİPARİŞLER: kendi siparişin + yönetim (yazma yalnızca sunucu / yetkili fonksiyon)
create policy h7_orders_select on public.orders for select to authenticated
  using (user_id = (select auth.uid()) or (select public.h7_yonetici_mi()));

-- SİPARİŞ GEÇMİŞİ: müşteri kendi siparişinin görünür kayıtlarını görür
create policy h7_order_events_select on public.order_events for select to authenticated
  using (
    (select public.h7_yetki('orders'))
    or (visible and exists (select 1 from public.orders o where o.id = order_id and o.user_id = (select auth.uid())))
  );

-- CÜZDAN: kendi hareketlerin + cüzdan / ödeme yetkisi olan yönetim (yazma yalnızca sunucu)
create policy h7_wallet_select on public.wallet_transactions for select to authenticated
  using (user_id = (select auth.uid()) or (select public.h7_yetki('wallet')) or (select public.h7_yetki('payments')));

-- ZİYARET SAYACI: herkes ekleyebilir, yalnızca trafik yetkisi olan okuyabilir
create policy h7_page_views_insert on public.page_views for insert to anon, authenticated
  with check (true);
create policy h7_page_views_select on public.page_views for select to authenticated
  using ((select public.h7_yetki('traffic')) or (select public.h7_yetki('overview')));

-- ROL YETKİLERİ: yönetim okur; yalnızca CEO / admin değiştirir
create policy h7_role_permissions_select on public.role_permissions for select to authenticated
  using ((select public.h7_yonetici_mi()));
create policy h7_role_permissions_insert on public.role_permissions for insert to authenticated
  with check ((select public.h7_rol()) in ('ceo', 'admin'));
create policy h7_role_permissions_delete on public.role_permissions for delete to authenticated
  using ((select public.h7_rol()) in ('ceo', 'admin'));

-- SİTE İÇERİĞİ: herkes okur; içerik yetkisi olan yönetim yazar
create policy h7_site_content_select on public.site_content for select to anon, authenticated
  using (true);
create policy h7_site_content_insert on public.site_content for insert to authenticated
  with check ((select public.h7_icerik_yetkisi()));
create policy h7_site_content_update on public.site_content for update to authenticated
  using ((select public.h7_icerik_yetkisi())) with check ((select public.h7_icerik_yetkisi()));

-- INFLUENCERLAR: aktif olanları herkes görür; influencer yetkisi olan yönetim hepsini görür ve düzenler
create policy h7_influencers_select on public.influencers for select to anon, authenticated
  using (active or (select public.h7_yetki('influencers')));
create policy h7_influencers_insert on public.influencers for insert to authenticated
  with check ((select public.h7_yetki('influencers')));
create policy h7_influencers_update on public.influencers for update to authenticated
  using ((select public.h7_yetki('influencers'))) with check ((select public.h7_yetki('influencers')));
create policy h7_influencers_delete on public.influencers for delete to authenticated
  using ((select public.h7_yetki('influencers')));

-- ÖRNEK SESLER: herkes dinler; prodüktör / hizmet / içerik yetkisi olan yönetim düzenler
create policy h7_samples_select on public.samples for select to anon, authenticated
  using (true);
create policy h7_samples_insert on public.samples for insert to authenticated
  with check ((select public.h7_icerik_yetkisi()));
create policy h7_samples_update on public.samples for update to authenticated
  using ((select public.h7_icerik_yetkisi())) with check ((select public.h7_icerik_yetkisi()));
create policy h7_samples_delete on public.samples for delete to authenticated
  using ((select public.h7_icerik_yetkisi()));

-- SMM SAĞLAYICILARI ve SERVİSLERİ: yalnızca SMM yetkisi (ekle / sil sunucuda)
create policy h7_smm_providers_select on public.smm_providers for select to authenticated
  using ((select public.h7_yetki('smm')));
create policy h7_smm_providers_update on public.smm_providers for update to authenticated
  using ((select public.h7_yetki('smm'))) with check ((select public.h7_yetki('smm')));
create policy h7_smm_services_select on public.smm_services for select to authenticated
  using ((select public.h7_yetki('smm')));
create policy h7_smm_services_insert on public.smm_services for insert to authenticated
  with check ((select public.h7_yetki('smm')));
create policy h7_smm_services_update on public.smm_services for update to authenticated
  using ((select public.h7_yetki('smm'))) with check ((select public.h7_yetki('smm')));
create policy h7_smm_services_delete on public.smm_services for delete to authenticated
  using ((select public.h7_yetki('smm')));
create policy h7_smm_logs_select on public.smm_logs for select to authenticated
  using ((select public.h7_yetki('smm')) or (select public.h7_yetki('orders')));

-- SMM KATALOĞU (satıştaki hizmetler): herkes okuyabilmeli
do $$
declare
  v_kind "char";
  v_opts text[];
begin
  select c.relkind, c.reloptions into v_kind, v_opts
  from pg_class c join pg_namespace n on n.oid = c.relnamespace
  where n.nspname = 'public' and c.relname = 'smm_catalog';

  if v_kind = 'r' then
    -- smm_catalog bir tabloysa: herkese okuma
    execute 'alter table public.smm_catalog enable row level security';
    execute 'create policy h7_smm_catalog_select on public.smm_catalog for select to anon, authenticated using (true)';
  elsif v_kind = 'v' and coalesce(array_to_string(v_opts, ','), '') ilike '%security_invoker=true%' then
    -- Görünüm çağıranın yetkisiyle çalışıyorsa satıştaki servisleri herkese açmak gerekir
    execute 'create policy h7_smm_services_public on public.smm_services for select to anon, authenticated using (active)';
    execute 'create policy h7_smm_providers_public on public.smm_providers for select to anon, authenticated using (active)';
  end if;
end $$;

-- GİZLİ ANAHTARLAR: politika YOK → tarayıcıdan erişilemez (yalnızca sunucu gizli anahtarı)

-- ÖDEME SAĞLAYICILARI: yalnızca ödeme yetkisi (ekle / sil sunucuda)
create policy h7_payment_providers_select on public.payment_providers for select to authenticated
  using ((select public.h7_yetki('payments')));
create policy h7_payment_providers_update on public.payment_providers for update to authenticated
  using ((select public.h7_yetki('payments'))) with check ((select public.h7_yetki('payments')));

-- DESTEK: müşteri kendi taleplerini görür; destek yetkisi olan yönetim hepsini görür / yanıtlar
create policy h7_support_tickets_select on public.support_tickets for select to authenticated
  using (user_id = (select auth.uid()) or (select public.h7_yetki('support')));
create policy h7_support_tickets_update on public.support_tickets for update to authenticated
  using ((select public.h7_yetki('support'))) with check ((select public.h7_yetki('support')));
create policy h7_support_messages_select on public.support_messages for select to authenticated
  using (
    (select public.h7_yetki('support'))
    or exists (select 1 from public.support_tickets t where t.id = ticket_id and t.user_id = (select auth.uid()))
  );
create policy h7_support_messages_insert on public.support_messages for insert to authenticated
  with check ((select public.h7_yetki('support')) and sender = 'staff');

-- DİJİTAL YAYINLAR: kendi yayınların + yayın yetkisi olan yönetim (yazma yalnızca sunucu / yetkili fonksiyon)
create policy h7_releases_select on public.releases for select to authenticated
  using (user_id = (select auth.uid()) or (select public.h7_yetki('releases')));
create policy h7_release_tracks_select on public.release_tracks for select to authenticated
  using (exists (
    select 1 from public.releases r
    where r.id = release_id and (r.user_id = (select auth.uid()) or (select public.h7_yetki('releases')))
  ));

-- İŞLEM KAYITLARI: yalnızca CEO ve admin okur; kimse değiştiremez
create policy h7_audit_log_select on public.audit_log for select to authenticated
  using ((select public.h7_rol()) in ('ceo', 'admin'));

grant select on public.order_events, public.releases, public.release_tracks, public.audit_log, public.smm_logs to authenticated;

-- ---------------------------------------------------------------------
-- 4) CEO özet istatistikleri (yalnızca CEO ve admin)
-- ---------------------------------------------------------------------
create or replace function public.h7_ceo_ozet()
returns jsonb
language plpgsql
stable
security definer
set search_path = public
as $$
declare
  v_tz constant text := 'Europe/Istanbul';
  v_bugun date := (now() at time zone 'Europe/Istanbul')::date;
  v_gun timestamptz := date_trunc('day', now() at time zone 'Europe/Istanbul') at time zone 'Europe/Istanbul';
  v_ay timestamptz := date_trunc('month', now() at time zone 'Europe/Istanbul') at time zone 'Europe/Istanbul';
  v_30 timestamptz := now() - interval '30 days';
  v jsonb;
begin
  if coalesce(public.h7_rol(), '') not in ('ceo', 'admin') then
    raise exception 'YETKISIZ' using errcode = '42501';
  end if;

  select jsonb_build_object(
    'olusturuldu', now(),
    'uye_toplam', (select count(*) from public.profiles),
    'uye_30g', (select count(*) from public.profiles where created_at >= v_30),
    'yonetici', (select count(*) from public.profiles where role::text in ('ceo', 'admin', 'mod', 'amele')),

    'ziyaret_bugun', (select count(*) from public.page_views where created_at >= v_gun),
    'ziyaretci_bugun', (select count(distinct nullif(session_id, '')) from public.page_views where created_at >= v_gun),
    'ziyaret_ay', (select count(*) from public.page_views where created_at >= v_ay),
    'ziyaretci_ay', (select count(distinct nullif(session_id, '')) from public.page_views where created_at >= v_ay),
    'ziyaret_30g', (select count(*) from public.page_views where created_at >= v_30),
    'ziyaretci_30g', (select count(distinct nullif(session_id, '')) from public.page_views where created_at >= v_30),

    'siparis_toplam', (select count(*) from public.orders where status::text not in ('İptal Edildi', 'İptal')),
    'ciro_toplam', (select coalesce(sum(amount), 0) from public.orders where status::text not in ('İptal Edildi', 'İptal')),
    'ciro_ay', (select coalesce(sum(amount), 0) from public.orders where status::text not in ('İptal Edildi', 'İptal') and created_at >= v_ay),
    'ciro_bugun', (select coalesce(sum(amount), 0) from public.orders where status::text not in ('İptal Edildi', 'İptal') and created_at >= v_gun),
    'siparis_ay', (select count(*) from public.orders where status::text not in ('İptal Edildi', 'İptal') and created_at >= v_ay),
    'siparis_bekleyen', (select count(*) from public.orders where status::text in ('Ödeme Bekleniyor', 'Alındı', 'Beklemede', 'İşlemde', 'Revizyon')),
    'siparis_revizyon', (select count(*) from public.orders where status::text = 'Revizyon'),
    'siparis_iptal', (select count(*) from public.orders where status::text in ('İptal Edildi', 'İptal')),
    'durumlar', (
      select coalesce(jsonb_object_agg(s, n), '{}'::jsonb)
      from (select status::text as s, count(*) as n from public.orders group by 1) x
    ),
    'hizmetler', (
      select coalesce(jsonb_agg(jsonb_build_object('tur', t, 'adet', n, 'ciro', c) order by c desc), '[]'::jsonb)
      from (
        select coalesce(type::text, 'diger') as t, count(*) as n, coalesce(sum(amount), 0) as c
        from public.orders where status::text not in ('İptal Edildi', 'İptal') group by 1
      ) x
    ),

    'yukleme_toplam', (select coalesce(sum(amount), 0) from public.wallet_transactions
                       where kind::text = 'topup' and status::text = 'ok' and coalesce(provider, '') not in ('iade', 'admin')),
    'yukleme_ay', (select coalesce(sum(amount), 0) from public.wallet_transactions
                   where kind::text = 'topup' and status::text = 'ok' and coalesce(provider, '') not in ('iade', 'admin') and created_at >= v_ay),
    'yukleme_bekleyen_adet', (select count(*) from public.wallet_transactions where kind::text = 'topup' and status::text = 'pending'),
    'yukleme_bekleyen_tutar', (select coalesce(sum(amount), 0) from public.wallet_transactions where kind::text = 'topup' and status::text = 'pending'),
    'yukleme_basarisiz_30g', (select count(*) from public.wallet_transactions where kind::text = 'topup' and status::text = 'failed' and created_at >= v_30),
    'iade_adet', (select count(*) from public.wallet_transactions where provider = 'iade' and status::text = 'ok'),
    'iade_tutar', (select coalesce(sum(amount), 0) from public.wallet_transactions where provider = 'iade' and status::text = 'ok'),
    'duzeltme_adet', (select count(*) from public.wallet_transactions where provider = 'admin' and status::text = 'ok'),
    'uyelerdeki_bakiye', (select coalesce(sum(case when kind::text = 'topup' then amount else -amount end), 0)
                          from public.wallet_transactions where status::text = 'ok'),

    'destek_yeni', (select count(*) from public.support_tickets where status::text = 'Yeni'),
    'yayin_bekleyen', (select count(*) from public.releases where status in ('Başvuru alındı', 'İncelemede', 'Düzeltme gerekli', 'Onaylandı')),
    'yayin_kodsuz', (select count(*) from public.release_tracks t join public.releases r on r.id = t.release_id
                     where t.isrc is null and r.status not in ('Reddedildi')),

    'gunluk', (
      select coalesce(jsonb_agg(jsonb_build_object(
               'gun', to_char(d.gun, 'YYYY-MM-DD'),
               'ciro', coalesce(s.ciro, 0),
               'siparis', coalesce(s.adet, 0),
               'ziyaret', coalesce(pv.adet, 0)) order by d.gun), '[]'::jsonb)
      from (select v_bugun - i as gun from generate_series(0, 13) as i) d
      left join (
        select (created_at at time zone v_tz)::date as gun, sum(amount) as ciro, count(*) as adet
        from public.orders
        where status::text not in ('İptal Edildi', 'İptal') and created_at >= v_gun - interval '14 days'
        group by 1
      ) s on s.gun = d.gun
      left join (
        select (created_at at time zone v_tz)::date as gun, count(*) as adet
        from public.page_views
        where created_at >= v_gun - interval '14 days'
        group by 1
      ) pv on pv.gun = d.gun
    )
  ) into v;

  return v;
end;
$$;
revoke execute on function public.h7_ceo_ozet() from public, anon;
grant execute on function public.h7_ceo_ozet() to authenticated, service_role;

commit;


-- >>>>>>>>>> 20261111100000_h7_06_sepet.sql >>>>>>>>>>

-- =====================================================================
-- HITY7 · Migration 06 · Sepet ödemesi: siparişler + bakiye düşümü TEK işlemde
--
-- Supabase → SQL Editor'de 01–05'ten SONRA çalıştırın. Tekrar çalıştırılabilir. Tek transaction.
-- Hiçbir tabloyu değiştirmez, veri silmez; yalnızca h7_sepet_siparis fonksiyonunu ekler.
--
-- Ne yapar?
--  - Sitenin sunucusu (gizli anahtar) sepetteki her ana hizmet için bir sipariş hazırlar. Ek hizmetler
--    ana hizmetle AYNI siparişin içindedir. Fiyatlar sunucuda Supabase'teki güncel fiyatlardan hesaplanır.
--  - Bu fonksiyon üyenin cüzdanını kilitler, toplamı bakiyeyle karşılaştırır; yeterliyse her siparişi mevcut
--    place_order fonksiyonuyla oluşturur (sipariş kaydı + bakiye düşümü).
--  - Herhangi bir adım hata verirse HİÇBİR sipariş oluşmaz ve bakiyeden HİÇBİR şey düşmez.
--  - Aynı sepet kimliği ikinci kez gönderilirse yeni sipariş oluşturmaz, var olanları döndürür.
--  - Tarayıcı (anon / authenticated) bu fonksiyonu çağıramaz.
--
-- Bu fonksiyon kurulmadan da tek hizmetlik sepetler mevcut place_order ile (yine tek işlemde) ödenir;
-- birden fazla hizmetlik sepet için bu dosya gerekir.
-- =====================================================================
begin;

create or replace function public.h7_sepet_siparis(
  p_user uuid,
  p_ad text,
  p_sepet text,
  p_siparisler jsonb,
  p_toplam numeric
)
returns jsonb
language plpgsql
security invoker
set search_path = public
as $$
declare
  v_o jsonb;
  v_r jsonb;
  v_tutar numeric;
  v_toplam numeric := 0;
  v_bakiye numeric;
  v_mevcut jsonb;
  v_kodlar jsonb := '[]'::jsonb;
  v_adet int;
begin
  -- Yalnızca sitenin sunucusu (gizli anahtar) veya SQL Editor
  if not (public.h7_jwt_role() = 'service_role'
          or (public.h7_jwt_role() = '' and session_user::text in ('postgres', 'supabase_admin'))) then
    raise exception 'YETKISIZ: Sepet ödemesi yalnızca sunucu tarafından yapılabilir.' using errcode = '42501';
  end if;

  if p_user is null then
    raise exception 'SEPET_GECERSIZ: üye yok';
  end if;
  if coalesce(p_sepet, '') !~ '^[A-Za-z0-9-]{8,64}$' then
    raise exception 'SEPET_GECERSIZ: sepet kimliği';
  end if;
  if jsonb_typeof(p_siparisler) is distinct from 'array' then
    raise exception 'SEPET_GECERSIZ: sipariş listesi';
  end if;
  v_adet := jsonb_array_length(p_siparisler);
  if v_adet < 1 or v_adet > 10 then
    raise exception 'SEPET_GECERSIZ: sipariş sayısı';
  end if;

  -- Her siparişin alanlarını ve tutarını doğrula, toplamı hesapla
  for v_o in select e.value from jsonb_array_elements(p_siparisler) as e(value) loop
    if jsonb_typeof(v_o -> 'amount') is distinct from 'number'
       or coalesce(v_o ->> 'type', '') not in ('remake', 'mix')
       or coalesce(btrim(v_o ->> 'service'), '') = ''
       or coalesce(btrim(v_o ->> 'title'), '') = ''
       or jsonb_typeof(v_o -> 'payload') is distinct from 'object' then
      raise exception 'SEPET_GECERSIZ: sipariş alanları';
    end if;
    v_tutar := (v_o ->> 'amount')::numeric;
    if v_tutar < 0 or v_tutar > 10000000 or v_tutar <> round(v_tutar, 2) then
      raise exception 'SEPET_GECERSIZ: tutar';
    end if;
    v_toplam := v_toplam + v_tutar;
  end loop;

  if p_toplam is null or round(p_toplam, 2) <> round(v_toplam, 2) then
    raise exception 'SEPET_TUTAR_UYUSMAZ';
  end if;

  -- Aynı üyenin eşzamanlı ödemelerini ve bakiye düzeltmelerini sıraya koy (h7_bakiye_duzelt ile aynı kilit)
  perform pg_advisory_xact_lock(hashtext('h7_cuzdan_' || p_user::text));

  -- Bu sepet daha önce ödendiyse yeni sipariş oluşturma (çift tıklama / bağlantı kopması sonrası tekrar)
  select coalesce(jsonb_agg(o.code order by o.id), '[]'::jsonb) into v_mevcut
  from public.orders o
  where o.user_id = p_user and o.payload ->> 'sepetId' = p_sepet;
  if jsonb_array_length(v_mevcut) > 0 then
    return jsonb_build_object('ok', true, 'tekrar', true, 'codes', v_mevcut, 'total', v_toplam,
                              'balance', coalesce(public.wallet_balance(p_user), 0));
  end if;

  v_bakiye := coalesce(public.wallet_balance(p_user), 0);
  if v_bakiye < v_toplam then
    raise exception 'YETERSIZ_BAKIYE' using detail = format('bakiye=%s toplam=%s', v_bakiye, v_toplam);
  end if;

  -- Siparişleri mevcut place_order ile oluştur (sipariş kaydı + bakiye düşümü).
  -- Biri bile hata verirse bu fonksiyonun tamamı geri alınır.
  for v_o in select e.value from jsonb_array_elements(p_siparisler) as e(value) loop
    execute format(
      'select to_jsonb(r) from public.place_order(p_user => %L, p_name => %L, p_type => %L, p_service => %L, '
      'p_title => %L, p_amount => %L, p_payload => %L) as r limit 1',
      p_user,
      left(coalesce(nullif(btrim(p_ad), ''), 'Müşteri'), 120),
      v_o ->> 'type',
      left(v_o ->> 'service', 120),
      left(v_o ->> 'title', 300),
      trim_scale((v_o ->> 'amount')::numeric)::text,
      ((v_o -> 'payload') || jsonb_build_object('sepetId', p_sepet))::text
    ) into v_r;
    if jsonb_typeof(v_r) = 'array' then
      v_r := v_r -> 0;
    end if;
    if v_r is null or jsonb_typeof(v_r) <> 'object' or coalesce(v_r ->> 'code', '') = '' then
      raise exception 'SIPARIS_OLUSMADI: place_order sipariş kodu döndürmedi';
    end if;
    v_kodlar := v_kodlar || jsonb_build_array(v_r ->> 'code');
  end loop;

  return jsonb_build_object('ok', true, 'tekrar', false, 'codes', v_kodlar, 'total', v_toplam,
                            'balance', coalesce(public.wallet_balance(p_user), 0));
end;
$$;

comment on function public.h7_sepet_siparis(uuid, text, text, jsonb, numeric) is
  'HITY7 sepet ödemesi: siparişler + bakiye düşümü tek işlemde. Yalnızca sunucu (service_role) çağırır.';

revoke execute on function public.h7_sepet_siparis(uuid, text, text, jsonb, numeric) from public, anon, authenticated;
grant execute on function public.h7_sepet_siparis(uuid, text, text, jsonb, numeric) to service_role;

commit;


-- >>>>>>>>>> 20261111120000_h7_07_cuzdan_cekirdek.sql >>>>>>>>>>

-- =====================================================================
-- HITY7 · Migration 07 · Cüzdan çekirdeği: wallet_balance + place_order
--
-- 01–06'dan SONRA çalıştırın (TUM-MIGRATIONLAR.sql'de en sonda). Tekrar çalıştırılabilir. Tek transaction.
-- Mevcut tabloları ve verileri SİLMEZ, DEĞİŞTİRMEZ. Yalnızca:
--   - wallet_balance(p_user)  : üyenin kullanılabilir bakiyesi (onaylı yüklemeler − onaylı harcamalar)
--   - place_order(...)        : siparişi kaydeder ve tutarı bakiyeden düşer — TEK işlemde (atomik)
--   - hız ve tekrar koruması için indeksler
--   - tarayıcı rollerinin (anon, authenticated) siparişlere ve bakiye hareketlerine YAZMA yetkisinin kaldırılması
--     (site bu iki tabloya tarayıcıdan hiç yazmıyor; okuma, migration 05'teki RLS kurallarıyla sürer)
--
-- Kurallar
--   - İki fonksiyonu da YALNIZCA sitenin sunucusu (gizli anahtar = service_role) çağırabilir.
--   - Yetersiz bakiyede sipariş oluşmaz, bakiyeden hiçbir şey düşmez (YETERSIZ_BAKIYE).
--   - Aynı istek kimliği (istekId / sepetId) ikinci kez gelirse yeni sipariş oluşmaz, bakiye ikinci kez düşmez.
--   - Aynı üyenin eşzamanlı siparişleri sıraya girer (cüzdan kilidi); bakiye eksiye düşemez.
--   - Kayıtlı tutar ile düşülen tutar birebir aynı değilse işlem geri alınır.
--
-- Önce tabloların bu fonksiyonlarla uyumlu olduğu denetlenir (0. bölüm). Uyumsuzluk varsa açıklayıcı bir hata
-- verilir ve HİÇBİR şey değişmez. Deneme kayıtları aynı anda geri alınır; kalıcı veri oluşmaz.
-- =====================================================================
begin;

-- ---------------------------------------------------------------------
-- 0) Ön kontrol: tablolar, sütunlar ve izin verilen değerler
-- ---------------------------------------------------------------------
do $$
declare
  v text;
  r record;
  v_eksik text[];
begin
  -- a) Kodun kullandığı sütunlar mevcut mu?
  select string_agg(req.t || '.' || req.c, ', ') into v
  from (values
    ('orders', 'code'), ('orders', 'user_id'), ('orders', 'customer_name'), ('orders', 'type'), ('orders', 'service'),
    ('orders', 'title'), ('orders', 'amount'), ('orders', 'status'), ('orders', 'payload'), ('orders', 'created_at'),
    ('wallet_transactions', 'user_id'), ('wallet_transactions', 'kind'), ('wallet_transactions', 'amount'),
    ('wallet_transactions', 'status'), ('wallet_transactions', 'provider'), ('wallet_transactions', 'ref'),
    ('wallet_transactions', 'note')
  ) as req(t, c)
  where not exists (
    select 1 from information_schema.columns ic
    where ic.table_schema = 'public' and ic.table_name = req.t and ic.column_name = req.c
  );
  if v is not null then
    raise exception 'HITY7 07: eksik sütun: %. Hiçbir değişiklik yapılmadı.', v;
  end if;

  -- b) orders.payload json / jsonb olmalı
  select ic.data_type into v from information_schema.columns ic
  where ic.table_schema = 'public' and ic.table_name = 'orders' and ic.column_name = 'payload';
  if v not in ('json', 'jsonb') then
    raise exception 'HITY7 07: orders.payload sütunu json/jsonb değil (%). Hiçbir değişiklik yapılmadı.', v;
  end if;

  -- c) place_order'ın doldurmadığı, varsayılanı olmayan zorunlu sütun var mı?
  select string_agg(ic.table_name || '.' || ic.column_name, ', ') into v
  from information_schema.columns ic
  where ic.table_schema = 'public'
    and ic.is_nullable = 'NO' and ic.column_default is null
    and coalesce(ic.is_identity, 'NO') = 'NO' and coalesce(ic.is_generated, 'NEVER') = 'NEVER'
    and ((ic.table_name = 'orders'
          and ic.column_name not in ('code', 'user_id', 'customer_name', 'type', 'service', 'title', 'amount', 'status', 'payload'))
      or (ic.table_name = 'wallet_transactions'
          and ic.column_name not in ('user_id', 'kind', 'amount', 'status', 'provider', 'ref', 'note')));
  if v is not null then
    raise exception 'HITY7 07: place_order''ın doldurmadığı zorunlu sütun var: %. Hiçbir değişiklik yapılmadı.', v;
  end if;

  -- d) Sütun bir ENUM ise kodun yazdığı değerler tanımlı mı?
  for r in
    select ic.table_name::text as t, ic.column_name::text as c, ic.udt_schema::text as s, ic.udt_name::text as u
    from information_schema.columns ic
    where ic.table_schema = 'public' and ic.data_type = 'USER-DEFINED'
      and ((ic.table_name = 'wallet_transactions' and ic.column_name in ('kind', 'status'))
        or (ic.table_name = 'orders' and ic.column_name in ('status', 'type')))
  loop
    select array_agg(x) into v_eksik
    from unnest(case
      when r.t = 'wallet_transactions' and r.c = 'kind' then array['topup', 'spend']
      when r.t = 'wallet_transactions' and r.c = 'status' then array['pending', 'ok', 'failed']
      when r.t = 'orders' and r.c = 'status' then array['Alındı']
      else array['influencer', 'yayin', 'mix', 'remake', 'smm']
    end) as x
    where not exists (
      select 1 from pg_enum e
      join pg_type ty on ty.oid = e.enumtypid
      join pg_namespace n on n.oid = ty.typnamespace
      where n.nspname = r.s and ty.typname = r.u and e.enumlabel = x
    );
    if v_eksik is not null then
      raise exception 'HITY7 07: %.% sütunu (% türü) şu değerleri kabul etmiyor: %. Hiçbir değişiklik yapılmadı.',
        r.t, r.c, r.u, array_to_string(v_eksik, ', ');
    end if;
  end loop;
end $$;

-- e) Deneme kaydı: tablo kısıtları (CHECK, yabancı anahtar vb.) kodun yazdığı değerleri kabul ediyor mu?
--    Deneme kayıtları aynı blok içinde GERİ ALINIR; kalıcı hiçbir kayıt oluşmaz.
do $$
declare
  v_uye uuid;
begin
  select p.id into v_uye from public.profiles p limit 1;
  if v_uye is null then
    raise notice 'HITY7 07: henüz üye olmadığı için deneme kaydı atlandı.';
    return;
  end if;
  begin
    perform set_config('hity7.yetkili_islem', 'on', true);
    execute format(
      'insert into public.wallet_transactions (user_id, kind, amount, status, provider, ref, note) values (%L, %L, %L, %L, %L, %L, %L)',
      v_uye, 'spend', '1', 'ok', 'siparis', 'H7-DENEME-' || md5(random()::text), 'deneme (geri alınır)');
    execute format(
      'insert into public.wallet_transactions (user_id, kind, amount, status, provider, ref, note) values (%L, %L, %L, %L, %L, %L, %L)',
      v_uye, 'topup', '1', 'failed', 'havale', 'H7-DENEME-' || md5(random()::text), 'deneme (geri alınır)');
    execute format(
      'insert into public.orders (code, user_id, customer_name, type, service, title, amount, status, payload) values (%L, %L, %L, %L, %L, %L, %L, %L, %L)',
      'H7-DENEME-' || md5(random()::text), v_uye, 'Deneme', 'remake', 'Remake Beat', 'deneme (geri alınır)', '1', 'Alındı', '{}');
    raise exception using errcode = 'P0H07', message = 'deneme_tamam';
  exception
    when sqlstate 'P0H07' then
      null; -- deneme başarılı; içindeki tüm kayıtlar geri alındı
    when others then
      raise exception 'HITY7 07: tablolar kodun yazdığı değerleri kabul etmiyor: % (kod %). Hiçbir değişiklik yapılmadı.', sqlerrm, sqlstate;
  end;
end $$;

-- ---------------------------------------------------------------------
-- 1) wallet_balance: kullanılabilir bakiye
--    Onaylı (ok) yüklemeler − onaylı harcamalar. Bekleyen / başarısız kayıtlar sayılmaz.
--    İadeler (provider 'iade') ve yönetim düzeltmeleri (provider 'admin') de topup / spend olarak sayılır.
-- ---------------------------------------------------------------------
create or replace function public.wallet_balance(p_user uuid)
returns numeric
language sql
stable
security invoker
set search_path = public
as $$
  select coalesce(round(sum(
           case when t.kind::text = 'topup' then t.amount::numeric
                when t.kind::text = 'spend' then -t.amount::numeric
                else 0 end), 2), 0)
  from public.wallet_transactions t
  where t.user_id = p_user and t.status::text = 'ok';
$$;

comment on function public.wallet_balance(uuid) is
  'HITY7: üyenin kullanılabilir bakiyesi (onaylı yüklemeler − onaylı harcamalar). Yalnızca sunucu (service_role) çağırır.';

-- ---------------------------------------------------------------------
-- 2) place_order: sipariş + bakiye düşümü (tek işlem)
--    Dönen değer: {"code": "7777-3-48213", "balance": 1200.00, "tekrar": false}
--    Hata kodları (mesajın başında): YETKISIZ, SIPARIS_GECERSIZ, YETERSIZ_BAKIYE, SIPARIS_KODU_URETILEMEDI,
--    SIPARIS_TUTAR_UYUSMAZ. Hata olursa sipariş oluşmaz ve bakiyeden hiçbir şey düşmez.
-- ---------------------------------------------------------------------
create or replace function public.place_order(
  p_user uuid,
  p_name text,
  p_type text,
  p_service text,
  p_title text,
  p_amount numeric,
  p_payload jsonb,
  p_istek text default null
)
returns jsonb
language plpgsql
security invoker
set search_path = public
as $$
declare
  v_rol text := coalesce(
    nullif(current_setting('request.jwt.claim.role', true), ''),
    nullif(current_setting('request.jwt.claims', true), '')::jsonb ->> 'role',
    '');
  v_tutar numeric := round(p_amount, 2);
  v_payload jsonb := coalesce(p_payload, '{}'::jsonb);
  v_anahtar text;
  v_kod text;
  v_kayitli numeric;
  v_bakiye numeric;
  v_no text;
  v_tamam boolean := false;
  i int;
begin
  -- 1) Yalnızca sitenin sunucusu (gizli anahtar) veya SQL Editor
  if not (v_rol = 'service_role' or (v_rol = '' and session_user::text in ('postgres', 'supabase_admin'))) then
    raise exception 'YETKISIZ: Sipariş yalnızca sunucu tarafından oluşturulabilir.' using errcode = '42501';
  end if;

  -- 2) Doğrulama
  if p_user is null then
    raise exception 'SIPARIS_GECERSIZ: üye yok';
  end if;
  if coalesce(p_type, '') not in ('influencer', 'yayin', 'mix', 'remake', 'smm') then
    raise exception 'SIPARIS_GECERSIZ: sipariş türü';
  end if;
  if p_amount is null or p_amount < 0 or p_amount > 10000000 or p_amount <> v_tutar then
    raise exception 'SIPARIS_GECERSIZ: tutar';
  end if;
  if coalesce(btrim(p_title), '') = '' or coalesce(btrim(p_service), '') = '' then
    raise exception 'SIPARIS_GECERSIZ: başlık';
  end if;
  if jsonb_typeof(v_payload) <> 'object' or length(v_payload::text) > 300000 then
    raise exception 'SIPARIS_GECERSIZ: sipariş içeriği';
  end if;

  -- 3) Tekrar anahtarı: istek kimliği (p_istek / payload.istekId) ya da sepet kimliği + tür
  v_anahtar := coalesce(
    nullif(btrim(p_istek), ''),
    nullif(btrim(v_payload ->> 'istekId'), ''),
    case when coalesce(v_payload ->> 'sepetId', '') <> '' then (v_payload ->> 'sepetId') || ':' || p_type end);
  if v_anahtar is not null then
    if v_anahtar !~ '^[A-Za-z0-9:_-]{8,100}$' then
      raise exception 'SIPARIS_GECERSIZ: istek kimliği';
    end if;
    v_payload := v_payload || jsonb_build_object('istekId', v_anahtar);
  end if;

  -- 4) Aynı üyenin bakiye işlemlerini sıraya koy (h7_bakiye_duzelt ve h7_sepet_siparis ile aynı kilit)
  perform pg_advisory_xact_lock(hashtext('h7_cuzdan_' || p_user::text));

  -- 5) Bu istek daha önce işlendiyse: yeni sipariş YOK, bakiye ikinci kez düşmez
  if v_anahtar is not null then
    select o.code::text into v_kod
    from public.orders o
    where o.user_id = p_user and o.payload ->> 'istekId' = v_anahtar
    limit 1;
    if v_kod is not null then
      return jsonb_build_object('code', v_kod, 'balance', public.wallet_balance(p_user), 'tekrar', true);
    end if;
  end if;

  -- 6) Bakiye kontrolü (kilit altında)
  v_bakiye := coalesce(public.wallet_balance(p_user), 0);
  if v_bakiye < v_tutar then
    raise exception 'YETERSIZ_BAKIYE' using detail = format('bakiye=%s tutar=%s', v_bakiye, v_tutar);
  end if;

  -- 7) Siparişi kaydet. Kod: 7777-<tür no>-<5 hane> (1 influencer, 2 SMM, 3 remake, 4 yayın, 5 mix), benzersiz.
  --    Değerler sütun türü ne olursa olsun (text / enum / json / jsonb) güvenle yazılsın diye %L ile verilir.
  v_no := case p_type when 'influencer' then '1' when 'smm' then '2' when 'remake' then '3' when 'yayin' then '4' else '5' end;
  for i in 1 .. 8 loop
    v_kod := '7777-' || v_no || '-' || lpad((floor(random() * 100000))::int::text, 5, '0');
    if exists (select 1 from public.orders o where o.code::text = v_kod) then
      continue;
    end if;
    begin
      execute format(
        'insert into public.orders (code, user_id, customer_name, type, service, title, amount, status, payload) '
        'values (%L, %L, %L, %L, %L, %L, %L, %L, %L) returning code::text, amount::numeric',
        v_kod, p_user, left(coalesce(nullif(btrim(p_name), ''), 'Müşteri'), 120), p_type,
        left(btrim(p_service), 120), left(btrim(p_title), 300), trim_scale(v_tutar)::text, 'Alındı', v_payload::text)
      into v_kod, v_kayitli;
      v_tamam := true;
      exit;
    exception when unique_violation then
      -- çok nadir: aynı anda aynı kod üretildi; yeni kodla tekrar dene
      null;
    end;
  end loop;
  if not v_tamam then
    raise exception 'SIPARIS_KODU_URETILEMEDI';
  end if;
  if v_kayitli is distinct from v_tutar then
    raise exception 'SIPARIS_TUTAR_UYUSMAZ: kayıtlı % / beklenen %', v_kayitli, v_tutar;
  end if;

  -- 8) Tutarı bakiyeden düş (aynı işlem: biri hata verirse ikisi de geri alınır)
  if v_tutar > 0 then
    execute format(
      'insert into public.wallet_transactions (user_id, kind, amount, status, provider, ref, note) '
      'values (%L, %L, %L, %L, %L, %L, %L) returning amount::numeric',
      p_user, 'spend', trim_scale(v_tutar)::text, 'ok', 'siparis', 'SPN-' || v_kod,
      left('Sipariş ' || v_kod || ' · ' || btrim(p_title), 300))
    into v_kayitli;
    if v_kayitli is distinct from v_tutar then
      raise exception 'SIPARIS_TUTAR_UYUSMAZ: düşülen % / beklenen %', v_kayitli, v_tutar;
    end if;
  end if;

  return jsonb_build_object('code', v_kod, 'balance', coalesce(public.wallet_balance(p_user), 0), 'tekrar', false);
end;
$$;

comment on function public.place_order(uuid, text, text, text, text, numeric, jsonb, text) is
  'HITY7: sipariş + bakiye düşümü tek işlemde; yetersiz bakiyede sipariş yok; aynı istek kimliği tekrar ücretlendirilmez. Yalnızca sunucu (service_role) çağırır.';

-- ---------------------------------------------------------------------
-- 3) İndeksler (hız + tekrar koruması)
-- ---------------------------------------------------------------------
create index if not exists wallet_transactions_user_status_idx on public.wallet_transactions (user_id, status);
create index if not exists orders_user_created_idx on public.orders (user_id, created_at desc);

-- Aynı üyenin aynı istek kimliğiyle iki siparişi olamaz (kilit atlatılsa bile veritabanı engeller)
create unique index if not exists orders_istek_tekil
  on public.orders (user_id, (payload ->> 'istekId'))
  where (payload ->> 'istekId') is not null;

-- Sipariş kodu tekil (yalnızca mevcut kayıtlarda tekrar yoksa)
do $$
begin
  if not exists (select 1 from pg_indexes where schemaname = 'public' and indexname = 'orders_code_tekil') then
    if exists (select 1 from public.orders where code is not null group by code having count(*) > 1) then
      raise notice 'UYARI: orders.code alanında tekrar eden kayıtlar var; tekil kod indeksi oluşturulmadı.';
    else
      create unique index orders_code_tekil on public.orders (code) where code is not null;
    end if;
  end if;
end $$;

-- ---------------------------------------------------------------------
-- 4) Yetkiler
-- ---------------------------------------------------------------------
-- Fonksiyonları yalnızca sunucu çağırır (tarayıcı başka üyenin bakiyesini soramaz, sipariş oluşturamaz)
revoke execute on function public.wallet_balance(uuid) from public, anon, authenticated;
grant execute on function public.wallet_balance(uuid) to service_role;
revoke execute on function public.place_order(uuid, text, text, text, text, numeric, jsonb, text) from public, anon, authenticated;
grant execute on function public.place_order(uuid, text, text, text, text, numeric, jsonb, text) to service_role;

-- Tarayıcı rolleri siparişlere ve bakiye hareketlerine YAZAMAZ (kullanıcı kendi bakiyesini değiştiremez).
-- Okuma: migration 05'teki RLS (üye yalnızca kendi kayıtlarını, yetkili yönetim hepsini görür). Ziyaretçi hiç okuyamaz.
revoke insert, update, delete, truncate on public.orders, public.wallet_transactions from anon, authenticated;
revoke select on public.orders, public.wallet_transactions from anon;

commit;
