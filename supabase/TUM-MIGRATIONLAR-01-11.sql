-- HITY7 · Migration 01 → 11 (tek dosya). Her bölüm kendi begin/commit içindedir; sırayla çalışır.
-- ÖNCE yedek al ve on-kontrol.sql'i çalıştır (supabase/KURULUM.md). Migration'lar tekrar çalıştırılabilir (iki kez temiz denendi).

-- ======================================================================
-- 20261110100000_h7_01_roller_guvenlik.sql
-- ======================================================================
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

-- ======================================================================
-- 20261110100100_h7_02_siparis_cuzdan.sql
-- ======================================================================
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

-- ======================================================================
-- 20261110100200_h7_03_dijital_yayin.sql
-- ======================================================================
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

-- ======================================================================
-- 20261110100300_h7_04_smm.sql
-- ======================================================================
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

-- ======================================================================
-- 20261110100400_h7_05_rls_ve_ceo_ozet.sql
-- ======================================================================
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

-- ======================================================================
-- 20261111100000_h7_06_sepet.sql
-- ======================================================================
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

-- ======================================================================
-- 20261111120000_h7_07_cuzdan_cekirdek.sql
-- ======================================================================
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

-- ======================================================================
-- 20261116100000_h7_08_erisim_yetki_cuzdan.sql
-- ======================================================================
-- =====================================================================
-- HITY7 · Migration 08 · Erişim (hizmet görünürlüğü, site yayın kontrolü), kişiye özel yönetici yetkileri,
--                        çift işleme karşı korumalı manuel bakiye, ödeme modu koruması
--
-- 01–07'den SONRA çalıştırın. Tekrar çalıştırılabilir. Tek transaction.
-- Mevcut hiçbir kaydı SİLMEZ, DEĞİŞTİRMEZ. Yalnızca yeni tablo / fonksiyon / tetikleyici ekler.
--
-- Aşamalar: 1 (hizmet görünürlüğü), 3 (moderatör yetkileri), 5 (manuel bakiye), 9A (site yayın kontrolü), 17 (ödeme modu)
-- =====================================================================
begin;

-- ---------------------------------------------------------------------
-- 1) Rol grupları ve hizmet erişim ayarı
--    Ayar site_content tablosunda "erisim" anahtarıyla saklanır (yalnızca CEO değiştirebilir):
--    {
--      "services": { "<hizmet>": { "active": true,
--                                   "visible":   {"visitor":true,"member":true,"mod":true,"ceo":true},
--                                   "orderable": {"member":true,"mod":true,"ceo":true} } },
--      "bakimdaGirebilir": ["admin"]      -- site kapalıyken CEO'ya ek olarak girebilecek roller
--    }
--    Kayıt yoksa / bir alan eksikse varsayılan: aktif, herkese görünür, üyeler sipariş verebilir.
-- ---------------------------------------------------------------------

-- Rolün erişim grubu: ziyaretçi (oturum yok) · member · mod (mod, personel) · ceo (ceo, admin)
create or replace function public.h7_erisim_grubu(p_rol text)
returns text
language sql
immutable
set search_path = public
as $$
  select case
    when p_rol in ('ceo', 'admin') then 'ceo'
    when p_rol in ('mod', 'amele') then 'mod'
    when p_rol = 'member' then 'member'
    else 'visitor'
  end;
$$;

-- Bir üyenin bir hizmetten sipariş verip veremeyeceği (sipariş fonksiyonları ve sunucu kullanır).
-- Site bakımdaysa yalnızca CEO ve CEO'nun izin verdiği roller sipariş verebilir.
create or replace function public.h7_hizmet_siparis_izni(p_user uuid, p_hizmet text)
returns boolean
language plpgsql
stable
security definer
set search_path = public
as $$
declare
  v_rol text;
  v_banned boolean;
  v_grup text;
  v_erisim jsonb;
  v_genel jsonb;
  v_h jsonb;
begin
  select p.role::text, coalesce(p.banned, false) into v_rol, v_banned from public.profiles p where p.id = p_user;
  if v_rol is null or v_banned then
    return false;
  end if;
  v_grup := public.h7_erisim_grubu(v_rol);
  select value into v_erisim from public.site_content where key = 'erisim';
  select value into v_genel from public.site_content where key = 'general';

  -- Site kapalı (bakım): CEO her zaman; diğer roller yalnızca açıkça izin verildiyse
  if coalesce((v_genel ->> 'maintenance')::boolean, false) and v_rol <> 'ceo' then
    if not coalesce(v_erisim -> 'bakimdaGirebilir' ? v_rol, false) then
      return false;
    end if;
  end if;

  v_h := v_erisim -> 'services' -> p_hizmet;
  if v_h is null then
    return true;
  end if;
  if coalesce((v_h ->> 'active')::boolean, true) = false then
    return false;
  end if;
  -- Bu role gizlenen hizmetten sipariş de verilemez (gizli hizmet API üzerinden de kapalıdır)
  return coalesce((v_h -> 'visible' ->> v_grup)::boolean, true)
     and coalesce((v_h -> 'orderable' ->> v_grup)::boolean, true);
end;
$$;
revoke execute on function public.h7_hizmet_siparis_izni(uuid, text) from public, anon, authenticated;
grant execute on function public.h7_hizmet_siparis_izni(uuid, text) to service_role;

-- ---------------------------------------------------------------------
-- 2) Site içeriği koruması
--    - "erisim" (hizmet görünürlüğü / sipariş izni) yalnızca CEO tarafından değiştirilir.
--    - "general.maintenance" (Site Yayında anahtarı) yalnızca CEO tarafından değiştirilir.
--    Diğer içerik alanları eskisi gibi içerik yetkisi olan yönetimce düzenlenir (RLS, migration 05).
-- ---------------------------------------------------------------------
create or replace function public.h7_site_icerik_koru()
returns trigger
language plpgsql
security definer
set search_path = public
as $$
declare
  v_rol text := coalesce(public.h7_rol(), '');
  v_eski jsonb := case when tg_op = 'UPDATE' then old.value::jsonb else null end;
begin
  if public.h7_guvenilir() then
    return new;
  end if;
  if new.key = 'erisim' and v_rol <> 'ceo' then
    raise exception 'YETKISIZ: Hizmet görünürlüğü ve sipariş ayarlarını yalnızca CEO değiştirebilir.' using errcode = '42501';
  end if;
  if new.key = 'general'
     and coalesce((new.value::jsonb ->> 'maintenance')::boolean, false)
         is distinct from coalesce((v_eski ->> 'maintenance')::boolean, false)
     and v_rol <> 'ceo' then
    raise exception 'YETKISIZ: Siteyi yayına alma / kapatma işlemini yalnızca CEO yapabilir.' using errcode = '42501';
  end if;
  if new.key in ('erisim', 'general') then
    perform public.h7_kayit('icerik.' || new.key, new.key,
      case when new.key = 'general'
        then jsonb_build_object('bakim', coalesce((new.value::jsonb ->> 'maintenance')::boolean, false))
        else jsonb_build_object('erisim', new.value::jsonb) end);
  end if;
  return new;
end;
$$;
drop trigger if exists h7_site_icerik_koru on public.site_content;
create trigger h7_site_icerik_koru
  before insert or update on public.site_content
  for each row execute function public.h7_site_icerik_koru();

-- ---------------------------------------------------------------------
-- 3) Kişiye özel yönetici yetkileri (3. aşama)
--    Bir moderatör / personel için kayıt varsa YALNIZCA bu liste geçerlidir (boş liste = hiçbir bölüm).
--    Kayıt yoksa eskisi gibi rol varsayılanları (role_permissions) kullanılır.
-- ---------------------------------------------------------------------
create table if not exists public.user_permission_sets (
  user_id uuid primary key references public.profiles (id) on delete cascade,
  tabs text[] not null default '{}',
  updated_by uuid,
  updated_at timestamptz not null default now(),
  constraint user_permission_sets_tabs_h7_check check (
    tabs <@ array['overview', 'traffic', 'orders', 'support', 'wallet', 'payments', 'influencers', 'smm',
                  'services', 'producers', 'content', 'members', 'ai', 'settings', 'releases', 'deliveries']::text[])
);
alter table public.user_permission_sets enable row level security;
revoke all on public.user_permission_sets from anon;
revoke insert, update, delete, truncate on public.user_permission_sets from authenticated;
grant select on public.user_permission_sets to authenticated;
drop policy if exists h7_user_permission_sets_select on public.user_permission_sets;
create policy h7_user_permission_sets_select on public.user_permission_sets for select to authenticated
  using (user_id = (select auth.uid()) or (select public.h7_rol()) in ('ceo', 'admin'));

-- role_permissions.tab kısıtı varsa yeni "deliveries" (Teslimatlar) bölümünü ekle
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
    if r.def ilike '%overview%' and r.def not ilike '%deliveries%' then
      execute format('alter table public.role_permissions drop constraint %I', r.conname);
      v_eski := true;
    end if;
  end loop;
  if v_eski then
    alter table public.role_permissions
      add constraint role_permissions_tab_h7_08_check
      check (tab in ('overview', 'traffic', 'orders', 'support', 'wallet', 'payments', 'influencers', 'smm',
                     'services', 'producers', 'content', 'members', 'ai', 'settings', 'releases', 'deliveries')) not valid;
  end if;
end $$;

-- Panel bölümü yetkisi (01'deki h7_yetki'nin yerine geçer; imza aynı)
create or replace function public.h7_yetki(p_tab text)
returns boolean
language sql
stable
security definer
set search_path = public
as $$
  select case
    when public.h7_rol() in ('ceo', 'admin') then true
    when public.h7_rol() in ('mod', 'amele') then
      case
        when exists (select 1 from public.user_permission_sets s where s.user_id = auth.uid())
          then exists (select 1 from public.user_permission_sets s where s.user_id = auth.uid() and p_tab = any (s.tabs))
        else exists (select 1 from public.role_permissions rp where rp.role::text = public.h7_rol() and rp.tab::text = p_tab)
      end
    else false
  end;
$$;

-- Kişiye özel yetki ayarla (yalnızca CEO). p_tabs null → kişiye özel liste kaldırılır, rol varsayılanı geçerli olur.
create or replace function public.h7_uye_yetki_ayarla(p_uye uuid, p_tabs text[])
returns jsonb
language plpgsql
security definer
set search_path = public
as $$
declare
  v_hedef text;
  v_eski text[];
  v_tabs text[];
begin
  if coalesce(public.h7_rol(), '') <> 'ceo' then
    raise exception 'YETKISIZ: Yönetici yetkilerini yalnızca CEO belirleyebilir.' using errcode = '42501';
  end if;
  select role::text into v_hedef from public.profiles where id = p_uye for update;
  if v_hedef is null then
    raise exception 'Üye bulunamadı.';
  end if;
  if v_hedef not in ('mod', 'amele') then
    raise exception 'Kişiye özel yetki yalnızca moderatör ve personel için tanımlanır.';
  end if;
  select s.tabs into v_eski from public.user_permission_sets s where s.user_id = p_uye;
  if p_tabs is null then
    delete from public.user_permission_sets where user_id = p_uye;
  else
    select coalesce(array_agg(distinct t order by t), '{}') into v_tabs from unnest(p_tabs) t where t is not null;
    insert into public.user_permission_sets (user_id, tabs, updated_by, updated_at)
    values (p_uye, v_tabs, auth.uid(), now())
    on conflict (user_id) do update set tabs = excluded.tabs, updated_by = excluded.updated_by, updated_at = now();
  end if;
  perform public.h7_kayit('uye.yetki_degisti', p_uye::text,
    jsonb_build_object('rol', v_hedef, 'eski', to_jsonb(v_eski), 'yeni', to_jsonb(v_tabs)));
  return jsonb_build_object('ok', true, 'tabs', to_jsonb(v_tabs));
end;
$$;
revoke execute on function public.h7_uye_yetki_ayarla(uuid, text[]) from public, anon;
grant execute on function public.h7_uye_yetki_ayarla(uuid, text[]) to authenticated, service_role;

-- Rol ver (01'deki h7_uye_rol'ün yerine geçer; imza ve kurallar aynı).
-- Ek: yönetici rolünden üyeye dönen kişinin kişiye özel yetki listesi de kaldırılır.
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
  execute format('update public.profiles set role = %L, panel_request = false where id = %L', p_rol, p_uye);
  perform set_config('hity7.yetkili_islem', 'off', true);
  if p_rol not in ('mod', 'amele') then
    delete from public.user_permission_sets where user_id = p_uye;
  end if;

  perform public.h7_kayit('uye.rol_degisti', p_uye::text, jsonb_build_object('eski', v_hedef, 'yeni', p_rol));
  return jsonb_build_object('ok', true, 'rol', p_rol);
end;
$$;
revoke execute on function public.h7_uye_rol(uuid, text) from public, anon;
grant execute on function public.h7_uye_rol(uuid, text) to authenticated, service_role;

-- ---------------------------------------------------------------------
-- 4) Manuel bakiye düzeltme — çift işleme karşı korumalı sürüm (5. aşama)
--    p_istek: paneldeki her düzeltme denemesinin tek kimliği. Aynı kimlik ikinci kez gelirse
--    yeni hareket oluşmaz (çift tıklama, bağlantı kopması). Kurallar 02'deki sürümle aynıdır.
-- ---------------------------------------------------------------------
create or replace function public.h7_bakiye_duzelt(p_uye uuid, p_tutar numeric, p_yon text, p_gerekce text, p_istek text)
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
  v_var record;
begin
  if coalesce(public.h7_rol(), '') not in ('ceo', 'admin') then
    raise exception 'YETKISIZ: Manuel bakiye düzeltmesini yalnızca CEO veya admin yapabilir.' using errcode = '42501';
  end if;
  if p_yon not in ('ekle', 'dus') then
    raise exception 'Düzeltme yönü geçersiz.';
  end if;
  if p_tutar is null or p_tutar <> v_tutar then
    raise exception 'Tutar en fazla 2 ondalık basamak (kuruş) içerebilir.';
  end if;
  if v_tutar <= 0 or v_tutar > 1000000 then
    raise exception 'Tutar 0 ile 1.000.000 TL arasında olmalı.';
  end if;
  if length(trim(coalesce(p_gerekce, ''))) < 5 then
    raise exception 'Gerekçe zorunlu (en az 5 karakter).';
  end if;
  if coalesce(p_istek, '') !~ '^[A-Za-z0-9-]{8,64}$' then
    raise exception 'İşlem kimliği geçersiz. Sayfayı yenileyip tekrar dene.';
  end if;
  if not exists (select 1 from public.profiles where id = p_uye) then
    raise exception 'Üye bulunamadı.';
  end if;

  v_ref := 'DZT-' || p_istek;
  perform pg_advisory_xact_lock(hashtext('h7_cuzdan_' || p_uye::text));

  -- Aynı işlem daha önce kaydedildiyse ikinci kez uygulanmaz
  select t.user_id, t.kind::text as kind, t.amount into v_var from public.wallet_transactions t where t.ref = v_ref;
  if found then
    if v_var.user_id is distinct from p_uye then
      raise exception 'İşlem kimliği başka bir üyeye ait. Sayfayı yenileyip tekrar dene.';
    end if;
    v_sonra := coalesce(public.wallet_balance(p_uye), 0);
    return jsonb_build_object('ok', true, 'ref', v_ref, 'once', null, 'sonra', v_sonra, 'tekrar', true);
  end if;

  v_once := coalesce(public.wallet_balance(p_uye), 0);
  if p_yon = 'dus' and v_once < v_tutar then
    raise exception 'Üyenin bakiyesi (% TL) düşülecek tutardan az.', v_once;
  end if;

  perform set_config('hity7.yetkili_islem', 'on', true);
  execute format(
    'insert into public.wallet_transactions (user_id, kind, amount, status, provider, ref, note) values (%L, %L, %L, %L, %L, %L, %L)',
    p_uye, case when p_yon = 'ekle' then 'topup' else 'spend' end, trim_scale(v_tutar)::text, 'ok', 'admin', v_ref,
    left('Düzeltme: ' || trim(p_gerekce), 300));
  perform set_config('hity7.yetkili_islem', 'off', true);
  v_sonra := coalesce(public.wallet_balance(p_uye), 0);

  perform public.h7_kayit('cuzdan.manuel_duzeltme', p_uye::text,
    jsonb_build_object('yon', p_yon, 'tutar', v_tutar, 'gerekce', trim(p_gerekce), 'once', v_once, 'sonra', v_sonra, 'ref', v_ref));
  return jsonb_build_object('ok', true, 'ref', v_ref, 'once', v_once, 'sonra', v_sonra, 'tekrar', false);
end;
$$;
revoke execute on function public.h7_bakiye_duzelt(uuid, numeric, text, text, text) from public, anon;
grant execute on function public.h7_bakiye_duzelt(uuid, numeric, text, text, text) to authenticated, service_role;

-- Eski (kimliksiz) sürüm artık panelden çağrılmaz; tarayıcıdan çağrılamaz hâle getirilir (silinmez).
revoke execute on function public.h7_bakiye_duzelt(uuid, numeric, text, text) from authenticated;

-- ---------------------------------------------------------------------
-- 5) Ödeme sağlayıcısı modu: canlı moda yalnızca CEO geçirebilir (17. aşama)
-- ---------------------------------------------------------------------
create or replace function public.h7_odeme_mod_koru()
returns trigger
language plpgsql
security definer
set search_path = public
as $$
begin
  if public.h7_guvenilir() then
    return new;
  end if;
  if coalesce(new.mode::text, '') = 'live'
     and (tg_op = 'INSERT' or coalesce(old.mode::text, '') <> 'live')
     and coalesce(public.h7_rol(), '') <> 'ceo' then
    raise exception 'YETKISIZ: Ödeme sağlayıcısını canlı moda yalnızca CEO alabilir.' using errcode = '42501';
  end if;
  if tg_op = 'UPDATE' and new.mode is distinct from old.mode then
    perform public.h7_kayit('odeme.mod_degisti', coalesce(new.kind::text, '') || ':' || new.id::text,
      jsonb_build_object('eski', old.mode, 'yeni', new.mode));
  end if;
  return new;
end;
$$;
drop trigger if exists h7_odeme_mod_koru on public.payment_providers;
create trigger h7_odeme_mod_koru
  before insert or update on public.payment_providers
  for each row execute function public.h7_odeme_mod_koru();

commit;

-- ======================================================================
-- 20261116110000_h7_09_influencer_finans_paket.sql
-- ======================================================================
-- =====================================================================
-- HITY7 · Migration 09 · Influencer maliyet ve kâr, hazır paketler (2 tür), süreli kampanyalar,
--                        kademeli bireysel indirim, sipariş anı finansal kaydı
--
-- 01–08'den SONRA çalıştırın. Tekrar çalıştırılabilir. Tek transaction.
-- Mevcut influencer kayıtlarını, siparişleri ve bakiyeleri DEĞİŞTİRMEZ. Yalnızca yeni tablo ve fonksiyon ekler.
--
-- Gizlilik: gerçek maliyetler, kâr ve finansal kayıtlar AYRI tablolardadır ve yalnızca CEO okuyabilir (RLS).
--           influencers tablosu (herkese açık) maliyet alanı İÇERMEZ.
-- Para: tüm tutarlar numeric(.., 2) — kuruş hassasiyetinde, kayan nokta yok. Hesaplar veritabanında yapılır.
-- Aşamalar: 9B (en az 5 influencer), 10 (indirim), 11 (maliyet/kâr), 13 (paketler), 14 (kampanyalar)
-- =====================================================================
begin;

-- ---------------------------------------------------------------------
-- 1) Influencer gerçek maliyeti (yalnızca CEO)
-- ---------------------------------------------------------------------
create table if not exists public.influencer_costs (
  influencer_id uuid primary key references public.influencers (id) on delete cascade,
  cost numeric(12, 2) not null check (cost >= 0 and cost <= 100000000),
  updated_by uuid,
  updated_at timestamptz not null default now()
);

-- ---------------------------------------------------------------------
-- 2) Hazır paketler
--    kind = 'liste'    : mevcut influencer listesinden seçilen hesaplar (maliyet otomatik toplanır)
--    kind = 'bagimsiz' : listeden bağımsız toplu anlaşma (maliyet CEO tarafından elle girilir)
--    Silme yerine arşiv: archived_at dolu paket satılmaz ve listelenmez; geçmiş siparişler etkilenmez.
-- ---------------------------------------------------------------------
create table if not exists public.influencer_packages (
  id uuid primary key default gen_random_uuid(),
  kind text not null check (kind in ('liste', 'bagimsiz')),
  name text not null check (length(btrim(name)) between 2 and 120),
  description text not null default '' check (length(description) <= 2000),
  content text not null default '' check (length(content) <= 4000),
  unit_count integer check (unit_count is null or unit_count between 1 and 100000),
  unit_label text not null default 'video' check (length(unit_label) between 1 and 40),
  image_url text check (image_url is null or image_url ~ '^https://'),
  price numeric(12, 2) not null check (price > 0 and price <= 100000000),
  active boolean not null default false,
  sort integer not null default 0,
  created_by uuid,
  created_at timestamptz not null default now(),
  updated_at timestamptz not null default now(),
  archived_at timestamptz
);
create index if not exists influencer_packages_listing_idx on public.influencer_packages (active, sort) where archived_at is null;

create table if not exists public.influencer_package_items (
  package_id uuid not null references public.influencer_packages (id) on delete cascade,
  -- Pakette kullanılan influencer silinemez (önce paketten çıkarılmalı); kayıt kopyalanmaz, yalnızca bağlanır
  influencer_id uuid not null references public.influencers (id) on delete restrict,
  primary key (package_id, influencer_id)
);
create index if not exists influencer_package_items_inf_idx on public.influencer_package_items (influencer_id);

-- Bağımsız paketin elle girilen toplam gerçek maliyeti (yalnızca CEO)
create table if not exists public.influencer_package_costs (
  package_id uuid primary key references public.influencer_packages (id) on delete cascade,
  cost numeric(12, 2) not null check (cost >= 0 and cost <= 100000000),
  updated_by uuid,
  updated_at timestamptz not null default now()
);

-- ---------------------------------------------------------------------
-- 3) Süreli kampanyalar (her iki paket türünde)
--    Durum: iptal (cancelled_at) · planlandı (başlamadı) · aktif · sona erdi — saklanmaz, sunucu saatinden hesaplanır.
-- ---------------------------------------------------------------------
create table if not exists public.package_campaigns (
  id uuid primary key default gen_random_uuid(),
  package_id uuid not null references public.influencer_packages (id) on delete cascade,
  price numeric(12, 2) not null check (price > 0),
  starts_at timestamptz not null,
  ends_at timestamptz not null,
  cancelled_at timestamptz,
  created_by uuid,
  created_at timestamptz not null default now(),
  updated_at timestamptz not null default now(),
  constraint package_campaigns_sure_check check (ends_at > starts_at)
);
create index if not exists package_campaigns_package_idx on public.package_campaigns (package_id, starts_at);

-- ---------------------------------------------------------------------
-- 4) Sipariş anı finansal kaydı (yalnızca CEO) — sonradan fiyat / maliyet değişse de geçmiş değişmez
-- ---------------------------------------------------------------------
create table if not exists public.order_financials (
  order_id bigint primary key references public.orders (id) on delete restrict,
  kind text not null check (kind in ('bireysel', 'paket')),
  gross numeric(14, 2) not null check (gross >= 0),            -- indirimsiz / normal fiyat
  discount_rate numeric(5, 2) not null default 0 check (discount_rate between 0 and 100),
  discount numeric(14, 2) not null default 0 check (discount >= 0),
  revenue numeric(14, 2) not null check (revenue >= 0),        -- müşterinin gerçekten ödediği
  cost numeric(14, 2) check (cost is null or cost >= 0),       -- null: maliyeti girilmemiş kalem vardı
  cost_missing integer not null default 0,
  package_id uuid,
  package_kind text,
  campaign_id uuid,
  snapshot jsonb not null default '{}'::jsonb,
  created_at timestamptz not null default now(),
  constraint order_financials_tutar_check check (revenue = gross - discount)
);
create index if not exists order_financials_created_idx on public.order_financials (created_at desc);
create index if not exists order_financials_package_idx on public.order_financials (package_id);

-- ---------------------------------------------------------------------
-- 5) Kurallar: paket ve kampanya doğrulama, değişikliklerin işlem kaydı
-- ---------------------------------------------------------------------
create or replace function public.h7_paket_koru()
returns trigger
language plpgsql
security definer
set search_path = public
as $$
begin
  if tg_op = 'UPDATE' then
    if new.kind is distinct from old.kind then
      raise exception 'Paket türü sonradan değiştirilemez. Yeni bir paket oluşturun.';
    end if;
    new.updated_at := now();
  end if;
  if new.archived_at is not null then
    new.active := false;
  end if;
  perform public.h7_kayit(case when tg_op = 'INSERT' then 'paket.olusturuldu' else 'paket.guncellendi' end, new.id::text,
    jsonb_build_object('ad', new.name, 'tur', new.kind, 'fiyat', new.price, 'aktif', new.active, 'arsiv', new.archived_at is not null));
  return new;
end;
$$;
drop trigger if exists h7_paket_koru on public.influencer_packages;
create trigger h7_paket_koru
  before insert or update on public.influencer_packages
  for each row execute function public.h7_paket_koru();

-- Listeden paket: kalem yalnızca 'liste' türündeki pakete eklenir
create or replace function public.h7_paket_kalem_koru()
returns trigger
language plpgsql
security definer
set search_path = public
as $$
declare
  v_tur text;
begin
  select kind into v_tur from public.influencer_packages where id = new.package_id;
  if v_tur is distinct from 'liste' then
    raise exception 'Influencer yalnızca "Listeden Oluşturulan" pakete eklenebilir.';
  end if;
  return new;
end;
$$;
drop trigger if exists h7_paket_kalem_koru on public.influencer_package_items;
create trigger h7_paket_kalem_koru
  before insert or update on public.influencer_package_items
  for each row execute function public.h7_paket_kalem_koru();

create or replace function public.h7_paket_maliyet_koru()
returns trigger
language plpgsql
security definer
set search_path = public
as $$
declare
  v_tur text;
begin
  select kind into v_tur from public.influencer_packages where id = new.package_id;
  if v_tur is distinct from 'bagimsiz' then
    raise exception 'Elle toplam maliyet yalnızca "Bağımsız" pakete girilir; listeden paketin maliyeti influencer maliyetlerinden hesaplanır.';
  end if;
  new.updated_by := coalesce(auth.uid(), new.updated_by);
  new.updated_at := now();
  perform public.h7_kayit('paket.maliyet', new.package_id::text, jsonb_build_object('maliyet', new.cost));
  return new;
end;
$$;
drop trigger if exists h7_paket_maliyet_koru on public.influencer_package_costs;
create trigger h7_paket_maliyet_koru
  before insert or update on public.influencer_package_costs
  for each row execute function public.h7_paket_maliyet_koru();

create or replace function public.h7_influencer_maliyet_kayit()
returns trigger
language plpgsql
security definer
set search_path = public
as $$
begin
  if tg_op = 'DELETE' then
    perform public.h7_kayit('influencer.maliyet_silindi', old.influencer_id::text, '{}'::jsonb);
    return old;
  end if;
  new.updated_by := coalesce(auth.uid(), new.updated_by);
  new.updated_at := now();
  perform public.h7_kayit('influencer.maliyet', new.influencer_id::text,
    jsonb_build_object('eski', case when tg_op = 'UPDATE' then old.cost end, 'yeni', new.cost));
  return new;
end;
$$;
drop trigger if exists h7_influencer_maliyet_kayit on public.influencer_costs;
create trigger h7_influencer_maliyet_kayit
  before insert or update or delete on public.influencer_costs
  for each row execute function public.h7_influencer_maliyet_kayit();

create or replace function public.h7_kampanya_koru()
returns trigger
language plpgsql
security definer
set search_path = public
as $$
declare
  v_normal numeric;
begin
  if tg_op = 'UPDATE' then
    new.updated_at := now();
    if old.cancelled_at is not null and new.cancelled_at is null then
      raise exception 'İptal edilen kampanya yeniden açılamaz. Yeni kampanya oluşturun.';
    end if;
  end if;
  if new.cancelled_at is null then
    select price into v_normal from public.influencer_packages where id = new.package_id;
    if v_normal is null then
      raise exception 'Paket bulunamadı.';
    end if;
    if new.price >= v_normal then
      raise exception 'Kampanya fiyatı (% TL) normal paket fiyatından (% TL) düşük olmalı.', new.price, v_normal;
    end if;
    if exists (
      select 1 from public.package_campaigns c
      where c.package_id = new.package_id and c.id <> new.id and c.cancelled_at is null
        and tstzrange(c.starts_at, c.ends_at, '[)') && tstzrange(new.starts_at, new.ends_at, '[)')
    ) then
      raise exception 'Bu pakette aynı zaman aralığında başka bir kampanya var. Aynı anda yalnızca bir kampanya geçerli olabilir.';
    end if;
  end if;
  perform public.h7_kayit(case when tg_op = 'INSERT' then 'kampanya.olusturuldu'
                               when new.cancelled_at is not null and old.cancelled_at is null then 'kampanya.iptal'
                               else 'kampanya.guncellendi' end,
    new.package_id::text,
    jsonb_build_object('kampanya', new.id, 'fiyat', new.price, 'baslangic', new.starts_at, 'bitis', new.ends_at));
  return new;
end;
$$;
drop trigger if exists h7_kampanya_koru on public.package_campaigns;
create trigger h7_kampanya_koru
  before insert or update on public.package_campaigns
  for each row execute function public.h7_kampanya_koru();

-- Paketin normal fiyatı kampanya fiyatının altına inerse uyarı yerine kural: kampanya fiyatı normalden düşük kalmalı
create or replace function public.h7_paket_fiyat_koru()
returns trigger
language plpgsql
security definer
set search_path = public
as $$
begin
  if new.price is distinct from old.price and exists (
    select 1 from public.package_campaigns c
    where c.package_id = new.id and c.cancelled_at is null and c.ends_at > now() and c.price >= new.price
  ) then
    raise exception 'Bu paketin planlanmış veya aktif kampanya fiyatı yeni normal fiyattan düşük değil. Önce kampanyayı düzenleyin.';
  end if;
  return new;
end;
$$;
drop trigger if exists h7_paket_fiyat_koru on public.influencer_packages;
create trigger h7_paket_fiyat_koru
  before update of price on public.influencer_packages
  for each row execute function public.h7_paket_fiyat_koru();

-- ---------------------------------------------------------------------
-- 6) Fiyat kuralları (tek kaynak)
-- ---------------------------------------------------------------------

-- Bireysel influencer siparişi kademeli indirimi (birikmez; tek oran). Eşikler indirimsiz toplam üzerinden.
create or replace function public.h7_bireysel_indirim_orani(p_brut numeric)
returns numeric
language sql
immutable
set search_path = public
as $$
  select case
    when p_brut >= 50000 then 20
    when p_brut >= 30000 then 15
    when p_brut >= 20000 then 10
    else 0
  end::numeric;
$$;

-- Paketin şu anki (veya verilen andaki) satış fiyatı: geçerli kampanya varsa kampanya fiyatı, yoksa normal fiyat.
create or replace function public.h7_paket_fiyat(p_paket uuid, p_an timestamptz default now())
returns jsonb
language plpgsql
stable
security definer
set search_path = public
as $$
declare
  v_normal numeric;
  c record;
begin
  select price into v_normal from public.influencer_packages
  where id = p_paket and active and archived_at is null;
  if v_normal is null then
    return null;
  end if;
  select k.id, k.price, k.starts_at, k.ends_at into c
  from public.package_campaigns k
  where k.package_id = p_paket and k.cancelled_at is null and k.starts_at <= p_an and k.ends_at > p_an
  order by k.starts_at desc
  limit 1;
  if c.id is not null and c.price < v_normal then
    return jsonb_build_object('normal', v_normal, 'final', c.price, 'kampanya', c.id, 'bitis', c.ends_at,
                              'indirim', v_normal - c.price, 'oran', round((v_normal - c.price) * 100 / v_normal, 2));
  end if;
  return jsonb_build_object('normal', v_normal, 'final', v_normal, 'kampanya', null, 'bitis', null, 'indirim', 0, 'oran', 0);
end;
$$;
grant execute on function public.h7_paket_fiyat(uuid, timestamptz) to anon, authenticated, service_role;

-- Yalnızca sunucu (gizli anahtar) veya SQL Editor
create or replace function public.h7_sunucu_mu()
returns boolean
language sql
stable
set search_path = public
as $$
  select public.h7_jwt_role() = 'service_role' or (public.h7_jwt_role() = '' and session_user::text in ('postgres', 'supabase_admin'));
$$;

-- ---------------------------------------------------------------------
-- 7) Bireysel influencer siparişi (sipariş + bakiye düşümü + finansal kayıt: TEK işlem)
--    Fiyat ve indirim burada, güncel veritabanı fiyatlarından hesaplanır; tarayıcıdan gelen tutar kullanılmaz.
--    p_beklenen: müşterinin ekranda onayladığı tutar. Farklıysa sipariş oluşmaz (FIYAT_DEGISTI).
-- ---------------------------------------------------------------------
create or replace function public.h7_influencer_siparis(
  p_user uuid,
  p_name text,
  p_influencers uuid[],
  p_types text[],
  p_payload jsonb,
  p_istek text,
  p_beklenen numeric
)
returns jsonb
language plpgsql
security invoker
set search_path = public
as $$
declare
  v_ids uuid[];
  v_types text[];
  v_adet int;
  v_brut numeric;
  v_oran numeric;
  v_indirim numeric;
  v_toplam numeric;
  v_fiyatsiz int;
  v_kalemler jsonb;
  v_maliyet numeric;
  v_eksik int;
  v_sonuc jsonb;
  v_siparis bigint;
  v_payload jsonb := coalesce(p_payload, '{}'::jsonb);
begin
  if not public.h7_sunucu_mu() then
    raise exception 'YETKISIZ: Sipariş yalnızca sunucu tarafından oluşturulabilir.' using errcode = '42501';
  end if;
  if not public.h7_hizmet_siparis_izni(p_user, 'influencer') then
    raise exception 'HIZMET_KAPALI: Influencer Marketing şu an sipariş almıyor.';
  end if;

  select coalesce(array_agg(distinct x), '{}') into v_ids from unnest(coalesce(p_influencers, '{}')) x where x is not null;
  if cardinality(v_ids) <> cardinality(coalesce(p_influencers, '{}')) then
    raise exception 'SIPARIS_GECERSIZ: aynı influencer iki kez seçilemez';
  end if;
  v_adet := cardinality(v_ids);
  if v_adet < 1 or v_adet > 100 then
    raise exception 'SIPARIS_GECERSIZ: influencer sayısı';
  end if;
  select coalesce(array_agg(distinct t), '{}') into v_types from unnest(coalesce(p_types, '{}')) t
  where t in ('TikTok Video', 'Instagram Reels');
  if cardinality(v_types) = 0 or cardinality(v_types) <> cardinality(coalesce(p_types, '{}')) then
    raise exception 'SIPARIS_GECERSIZ: paylaşım türü';
  end if;
  -- "Influencerları Kendin Seç": TikTok kampanyasında en az 5 influencer (paketlerde bu kural yok)
  if 'TikTok Video' = any (v_types) and v_adet < 5 then
    raise exception 'MIN_INFLUENCER: TikTok kampanyası için en az 5 influencer seçilmeli (seçilen: %).', v_adet;
  end if;

  -- Güncel satış fiyatları (yalnızca satıştaki influencerlar)
  select count(*), count(*) filter (where coalesce(i.price, 0) <= 0), coalesce(sum(round(i.price::numeric, 2)), 0)
  into v_adet, v_fiyatsiz, v_brut
  from public.influencers i
  where i.id = any (v_ids) and i.active;
  if v_adet <> cardinality(v_ids) then
    raise exception 'INFLUENCER_YOK: seçilen influencerlardan biri artık satışta değil';
  end if;
  if v_fiyatsiz > 0 then
    raise exception 'FIYAT_YOK: seçilen influencerlardan birinin fiyatı belirlenmemiş';
  end if;

  v_oran := public.h7_bireysel_indirim_orani(v_brut);
  v_indirim := round(v_brut * v_oran / 100, 2);
  v_toplam := v_brut - v_indirim;
  if p_beklenen is not null and round(p_beklenen, 2) <> v_toplam then
    raise exception 'FIYAT_DEGISTI' using detail = jsonb_build_object('brut', v_brut, 'oran', v_oran, 'indirim', v_indirim, 'toplam', v_toplam)::text;
  end if;

  v_payload := v_payload || jsonb_build_object(
    'influencers', to_jsonb(v_ids),
    'campaignTypes', to_jsonb(v_types),
    'indirim', jsonb_build_object('brut', v_brut, 'oran', v_oran, 'tutar', v_indirim, 'toplam', v_toplam));

  v_sonuc := public.place_order(p_user, p_name, 'influencer', 'Influencer Marketing',
    'Influencer kampanyası · ' || cardinality(v_ids) || ' influencer', v_toplam, v_payload, p_istek);

  if coalesce((v_sonuc ->> 'tekrar')::boolean, false) then
    return v_sonuc || jsonb_build_object('amount', v_toplam, 'brut', v_brut, 'oran', v_oran, 'indirim', v_indirim);
  end if;

  select o.id into v_siparis from public.orders o where o.code::text = v_sonuc ->> 'code';

  -- Sipariş anındaki satış fiyatı ve gerçek maliyet (CEO'ya özel kayıt)
  select coalesce(jsonb_agg(jsonb_build_object('id', i.id, 'ad', i.name, 'fiyat', round(i.price::numeric, 2), 'maliyet', c.cost)
                            order by i.name), '[]'::jsonb),
         sum(c.cost), count(*) filter (where c.cost is null)
  into v_kalemler, v_maliyet, v_eksik
  from public.influencers i
  left join public.influencer_costs c on c.influencer_id = i.id
  where i.id = any (v_ids);

  insert into public.order_financials (order_id, kind, gross, discount_rate, discount, revenue, cost, cost_missing, snapshot)
  values (v_siparis, 'bireysel', v_brut, v_oran, v_indirim, v_toplam,
          case when v_eksik = 0 then v_maliyet end, v_eksik,
          jsonb_build_object('kalemler', v_kalemler, 'turler', to_jsonb(v_types)));

  return v_sonuc || jsonb_build_object('amount', v_toplam, 'brut', v_brut, 'oran', v_oran, 'indirim', v_indirim);
end;
$$;

-- ---------------------------------------------------------------------
-- 8) Hazır paket siparişi (her iki tür). İndirim yalnızca CEO'nun tanımladığı süreli kampanya;
--    bireysel influencer indirimleri UYGULANMAZ. Kampanya geçerliliği sipariş anında sunucu saatiyle kontrol edilir.
-- ---------------------------------------------------------------------
create or replace function public.h7_paket_siparis(
  p_user uuid,
  p_name text,
  p_paket uuid,
  p_payload jsonb,
  p_istek text,
  p_beklenen numeric
)
returns jsonb
language plpgsql
security invoker
set search_path = public
as $$
declare
  k record;
  v_fiyat jsonb;
  v_final numeric;
  v_normal numeric;
  v_kalemler jsonb := '[]'::jsonb;
  v_maliyet numeric;
  v_eksik int := 0;
  v_sonuc jsonb;
  v_siparis bigint;
  v_payload jsonb := coalesce(p_payload, '{}'::jsonb);
begin
  if not public.h7_sunucu_mu() then
    raise exception 'YETKISIZ: Sipariş yalnızca sunucu tarafından oluşturulabilir.' using errcode = '42501';
  end if;
  if not public.h7_hizmet_siparis_izni(p_user, 'influencer') then
    raise exception 'HIZMET_KAPALI: Influencer Marketing şu an sipariş almıyor.';
  end if;

  -- Sipariş sırasında paketin değişmemesi için satır kilitlenir (CEO düzenlemesi bu işlemi bekler)
  select * into k from public.influencer_packages p where p.id = p_paket for share;
  if not found or not k.active or k.archived_at is not null then
    raise exception 'PAKET_YOK: paket artık satışta değil';
  end if;

  v_fiyat := public.h7_paket_fiyat(p_paket, now());
  v_final := (v_fiyat ->> 'final')::numeric;
  v_normal := (v_fiyat ->> 'normal')::numeric;
  if p_beklenen is not null and round(p_beklenen, 2) <> v_final then
    raise exception 'FIYAT_DEGISTI' using detail = v_fiyat::text;
  end if;

  if k.kind = 'liste' then
    select coalesce(jsonb_agg(jsonb_build_object('id', i.id, 'ad', i.name, 'maliyet', c.cost) order by i.name), '[]'::jsonb),
           sum(c.cost), count(*) filter (where c.cost is null)
    into v_kalemler, v_maliyet, v_eksik
    from public.influencer_package_items pi
    join public.influencers i on i.id = pi.influencer_id
    left join public.influencer_costs c on c.influencer_id = i.id
    where pi.package_id = k.id;
    if jsonb_array_length(v_kalemler) = 0 then
      raise exception 'PAKET_YOK: pakette influencer yok';
    end if;
  else
    select pc.cost into v_maliyet from public.influencer_package_costs pc where pc.package_id = k.id;
    v_eksik := case when v_maliyet is null then 1 else 0 end;
  end if;

  -- Müşterinin göreceği paket kapsamı (maliyet İÇERMEZ) siparişe sabitlenir
  v_payload := v_payload || jsonb_build_object('paket', jsonb_build_object(
    'id', k.id, 'tur', k.kind, 'ad', k.name, 'aciklama', k.description, 'icerik', k.content,
    'adet', k.unit_count, 'birim', k.unit_label,
    'influencerlar', (select coalesce(jsonb_agg(jsonb_build_object('id', x ->> 'id', 'ad', x ->> 'ad')), '[]'::jsonb)
                      from jsonb_array_elements(v_kalemler) x),
    'normalFiyat', v_normal, 'fiyat', v_final, 'kampanya', v_fiyat -> 'kampanya'));

  v_sonuc := public.place_order(p_user, p_name, 'influencer', 'Influencer Marketing',
    'Influencer paketi · ' || k.name, v_final, v_payload, p_istek);

  if coalesce((v_sonuc ->> 'tekrar')::boolean, false) then
    return v_sonuc || jsonb_build_object('amount', v_final, 'normal', v_normal);
  end if;

  select o.id into v_siparis from public.orders o where o.code::text = v_sonuc ->> 'code';

  insert into public.order_financials (order_id, kind, gross, discount_rate, discount, revenue, cost, cost_missing,
                                       package_id, package_kind, campaign_id, snapshot)
  values (v_siparis, 'paket', v_normal, coalesce((v_fiyat ->> 'oran')::numeric, 0), v_normal - v_final, v_final,
          case when v_eksik = 0 then v_maliyet end, v_eksik,
          k.id, k.kind, nullif(v_fiyat ->> 'kampanya', '')::uuid,
          jsonb_build_object('paket', jsonb_build_object('ad', k.name, 'tur', k.kind, 'icerik', k.content,
                                                         'adet', k.unit_count, 'birim', k.unit_label),
                             'kalemler', v_kalemler));

  return v_sonuc || jsonb_build_object('amount', v_final, 'normal', v_normal);
end;
$$;

revoke execute on function public.h7_influencer_siparis(uuid, text, uuid[], text[], jsonb, text, numeric) from public, anon, authenticated;
grant execute on function public.h7_influencer_siparis(uuid, text, uuid[], text[], jsonb, text, numeric) to service_role;
revoke execute on function public.h7_paket_siparis(uuid, text, uuid, jsonb, text, numeric) from public, anon, authenticated;
grant execute on function public.h7_paket_siparis(uuid, text, uuid, jsonb, text, numeric) to service_role;

-- ---------------------------------------------------------------------
-- 9) CEO finansal raporları (yalnızca CEO)
-- ---------------------------------------------------------------------

-- İadesi yapılmış sipariş mi? (iptalle birlikte bakiyeye iade: wallet_transactions ref = 'IADE-<kod>')
create or replace function public.h7_siparis_iade_mi(p_kod text)
returns boolean
language sql
stable
security definer
set search_path = public
as $$
  select exists (select 1 from public.wallet_transactions t where t.ref = 'IADE-' || p_kod and t.status::text = 'ok');
$$;
revoke execute on function public.h7_siparis_iade_mi(text) from public, anon, authenticated;

create or replace function public.h7_finans_rapor(p_bas timestamptz, p_bit timestamptz)
returns jsonb
language plpgsql
stable
security definer
set search_path = public
as $$
declare
  v jsonb;
begin
  if coalesce(public.h7_rol(), '') <> 'ceo' then
    raise exception 'YETKISIZ: Finansal raporları yalnızca CEO görebilir.' using errcode = '42501';
  end if;

  with s as (
    select f.*, o.code::text as code, o.status::text as status, o.customer_name,
           public.h7_siparis_iade_mi(o.code::text) as iade
    from public.order_financials f
    join public.orders o on o.id = f.order_id
    where f.created_at >= coalesce(p_bas, '-infinity') and f.created_at < coalesce(p_bit, 'infinity')
  ),
  gecerli as (select * from s where not iade)
  select jsonb_build_object(
    'donem', jsonb_build_object('baslangic', p_bas, 'bitis', p_bit),
    'siparis_adet', (select count(*) from gecerli),
    'satis_geliri', (select coalesce(sum(revenue), 0) from gecerli),
    'indirimsiz_toplam', (select coalesce(sum(gross), 0) from gecerli),
    'toplam_indirim', (select coalesce(sum(discount), 0) from gecerli),
    'maliyetli_gelir', (select coalesce(sum(revenue), 0) from gecerli where cost is not null),
    'gercek_maliyet', (select coalesce(sum(cost), 0) from gecerli where cost is not null),
    'brut_kar', (select coalesce(sum(revenue - cost), 0) from gecerli where cost is not null),
    'brut_kar_marji', (select case when coalesce(sum(revenue), 0) > 0
                                   then round(sum(revenue - cost) * 100 / sum(revenue), 2) end
                       from gecerli where cost is not null),
    'maliyetsiz_siparis_adet', (select count(*) from gecerli where cost is null),
    'maliyetsiz_gelir', (select coalesce(sum(revenue), 0) from gecerli where cost is null),
    'iade_adet', (select count(*) from s where iade),
    'iade_tutar', (select coalesce(sum(revenue), 0) from s where iade),
    'iptal_iadesiz_adet', (select count(*) from gecerli where status in ('İptal Edildi', 'İptal')),
    'siparisler', (
      select coalesce(jsonb_agg(jsonb_build_object(
               'kod', code, 'tarih', created_at, 'tur', kind, 'durum', status, 'musteri', customer_name,
               'paket', snapshot -> 'paket' ->> 'ad', 'kampanya', campaign_id is not null,
               'brut', gross, 'oran', discount_rate, 'indirim', discount, 'gelir', revenue, 'maliyet', cost,
               'kar', case when cost is not null then revenue - cost end,
               'marj', case when cost is not null and revenue > 0 then round((revenue - cost) * 100 / revenue, 2) end,
               'iade', iade) order by created_at desc), '[]'::jsonb)
      from (select * from s order by created_at desc limit 500) x
    ),
    'influencerlar', (
      -- Bireysel siparişlerde kalem bazlı: gelir payı = fiyat × (gelir / brüt)
      select coalesce(jsonb_agg(jsonb_build_object(
               'id', id, 'ad', ad, 'adet', adet, 'satis', satis, 'gelir', gelir, 'maliyet', maliyet,
               'maliyetsiz_adet', maliyetsiz, 'kar', case when maliyetsiz = 0 then gelir - maliyet end,
               'marj', case when maliyetsiz = 0 and gelir > 0 then round((gelir - maliyet) * 100 / gelir, 2) end)
             order by gelir desc), '[]'::jsonb)
      from (
        select k ->> 'id' as id, max(k ->> 'ad') as ad, count(*) as adet,
               sum((k ->> 'fiyat')::numeric) as satis,
               round(sum((k ->> 'fiyat')::numeric * g.revenue / nullif(g.gross, 0)), 2) as gelir,
               coalesce(sum((k ->> 'maliyet')::numeric), 0) as maliyet,
               count(*) filter (where k ->> 'maliyet' is null) as maliyetsiz
        from gecerli g, jsonb_array_elements(g.snapshot -> 'kalemler') k
        where g.kind = 'bireysel'
        group by 1
      ) y
    ),
    'paketler', (
      select coalesce(jsonb_agg(jsonb_build_object(
               'id', package_id, 'ad', ad, 'tur', package_kind, 'adet', adet, 'gelir', gelir, 'indirim', indirim,
               'kampanyali_adet', kampanyali, 'maliyet', maliyet, 'maliyetsiz_adet', maliyetsiz,
               'kar', case when maliyetsiz = 0 then gelir - maliyet end,
               'marj', case when maliyetsiz = 0 and gelir > 0 then round((gelir - maliyet) * 100 / gelir, 2) end)
             order by gelir desc), '[]'::jsonb)
      from (
        select package_id, max(snapshot -> 'paket' ->> 'ad') as ad, max(package_kind) as package_kind,
               count(*) as adet, sum(revenue) as gelir, sum(discount) as indirim,
               count(*) filter (where campaign_id is not null) as kampanyali,
               coalesce(sum(cost), 0) as maliyet, count(*) filter (where cost is null) as maliyetsiz
        from gecerli where kind = 'paket'
        group by package_id
      ) z
    )
  ) into v;
  return v;
end;
$$;
revoke execute on function public.h7_finans_rapor(timestamptz, timestamptz) from public, anon;
grant execute on function public.h7_finans_rapor(timestamptz, timestamptz) to authenticated, service_role;

-- Paketlerin GÜNCEL kârlılık önizlemesi (normal fiyat ve aktif/planlanan kampanya fiyatı ayrı) — yalnızca CEO
create or replace function public.h7_paket_karlilik()
returns jsonb
language plpgsql
stable
security definer
set search_path = public
as $$
begin
  if coalesce(public.h7_rol(), '') <> 'ceo' then
    raise exception 'YETKISIZ: Paket kârlılığını yalnızca CEO görebilir.' using errcode = '42501';
  end if;
  return (
    select coalesce(jsonb_agg(row order by (row ->> 'sira')::int, row ->> 'ad'), '[]'::jsonb)
    from (
      select jsonb_build_object(
        'id', p.id, 'ad', p.name, 'tur', p.kind, 'aktif', p.active, 'arsiv', p.archived_at is not null, 'sira', p.sort,
        'normal_fiyat', p.price,
        'maliyet', m.maliyet, 'maliyet_eksik', m.eksik, 'kalem_adet', m.kalem,
        'normal_kar', case when m.maliyet is not null then p.price - m.maliyet end,
        'normal_marj', case when m.maliyet is not null then round((p.price - m.maliyet) * 100 / p.price, 2) end,
        'kampanya', (
          select jsonb_build_object('id', c.id, 'fiyat', c.price, 'baslangic', c.starts_at, 'bitis', c.ends_at,
                   'durum', case when c.starts_at > now() then 'planlandi' else 'aktif' end,
                   'indirim', p.price - c.price, 'oran', round((p.price - c.price) * 100 / p.price, 2),
                   'kar', case when m.maliyet is not null then c.price - m.maliyet end,
                   'marj', case when m.maliyet is not null then round((c.price - m.maliyet) * 100 / c.price, 2) end)
          from public.package_campaigns c
          where c.package_id = p.id and c.cancelled_at is null and c.ends_at > now()
          order by c.starts_at limit 1),
        'satis', (
          select jsonb_build_object('adet', count(*), 'gelir', coalesce(sum(f.revenue), 0),
                   'kar', coalesce(sum(f.revenue - f.cost) filter (where f.cost is not null), 0),
                   'maliyetsiz_adet', count(*) filter (where f.cost is null))
          from public.order_financials f
          join public.orders o on o.id = f.order_id
          where f.package_id = p.id and not public.h7_siparis_iade_mi(o.code::text))
      ) as row
      from public.influencer_packages p
      cross join lateral (
        select case when p.kind = 'liste'
                    then (select case when count(*) filter (where c.cost is null) = 0 and count(*) > 0 then sum(c.cost) end
                          from public.influencer_package_items pi
                          left join public.influencer_costs c on c.influencer_id = pi.influencer_id
                          where pi.package_id = p.id)
                    else (select pc.cost from public.influencer_package_costs pc where pc.package_id = p.id) end as maliyet,
               case when p.kind = 'liste'
                    then (select count(*) filter (where c.cost is null)
                          from public.influencer_package_items pi
                          left join public.influencer_costs c on c.influencer_id = pi.influencer_id
                          where pi.package_id = p.id)
                    else case when exists (select 1 from public.influencer_package_costs pc where pc.package_id = p.id) then 0 else 1 end
               end as eksik,
               (select count(*) from public.influencer_package_items pi where pi.package_id = p.id) as kalem
      ) m
    ) q
  );
end;
$$;
revoke execute on function public.h7_paket_karlilik() from public, anon;
grant execute on function public.h7_paket_karlilik() to authenticated, service_role;

-- ---------------------------------------------------------------------
-- 10) Satır güvenliği (RLS)
-- ---------------------------------------------------------------------
alter table public.influencer_costs enable row level security;
alter table public.influencer_packages enable row level security;
alter table public.influencer_package_items enable row level security;
alter table public.influencer_package_costs enable row level security;
alter table public.package_campaigns enable row level security;
alter table public.order_financials enable row level security;

-- Ziyaretçi hiçbir maliyet / finans tablosuna erişemez; üye yalnızca RLS'in izin verdiğini görür (CEO dışında: hiçbir şey)
revoke all on public.influencer_costs, public.influencer_package_costs, public.order_financials from anon;
revoke insert, update, delete, truncate on public.order_financials from authenticated;
grant select on public.order_financials to authenticated;
grant select, insert, update, delete on public.influencer_costs, public.influencer_package_costs to authenticated;
grant select on public.influencer_packages, public.influencer_package_items, public.package_campaigns to anon;
grant select, insert, update, delete on public.influencer_packages, public.influencer_package_items, public.package_campaigns to authenticated;

drop policy if exists h7_influencer_costs_ceo on public.influencer_costs;
create policy h7_influencer_costs_ceo on public.influencer_costs for all to authenticated
  using ((select public.h7_rol()) = 'ceo') with check ((select public.h7_rol()) = 'ceo');

drop policy if exists h7_package_costs_ceo on public.influencer_package_costs;
create policy h7_package_costs_ceo on public.influencer_package_costs for all to authenticated
  using ((select public.h7_rol()) = 'ceo') with check ((select public.h7_rol()) = 'ceo');

drop policy if exists h7_order_financials_ceo on public.order_financials;
create policy h7_order_financials_ceo on public.order_financials for select to authenticated
  using ((select public.h7_rol()) = 'ceo');

-- Paketler: satıştakileri herkes görür; tümünü ve yazmayı yalnızca CEO (fiyat yalnızca CEO tarafından belirlenir)
drop policy if exists h7_packages_select on public.influencer_packages;
create policy h7_packages_select on public.influencer_packages for select to anon, authenticated
  using ((active and archived_at is null) or (select public.h7_rol()) = 'ceo');
drop policy if exists h7_packages_write on public.influencer_packages;
create policy h7_packages_write on public.influencer_packages for all to authenticated
  using ((select public.h7_rol()) = 'ceo') with check ((select public.h7_rol()) = 'ceo');

drop policy if exists h7_package_items_select on public.influencer_package_items;
create policy h7_package_items_select on public.influencer_package_items for select to anon, authenticated
  using (exists (select 1 from public.influencer_packages p where p.id = package_id and p.active and p.archived_at is null)
         or (select public.h7_rol()) = 'ceo');
drop policy if exists h7_package_items_write on public.influencer_package_items;
create policy h7_package_items_write on public.influencer_package_items for all to authenticated
  using ((select public.h7_rol()) = 'ceo') with check ((select public.h7_rol()) = 'ceo');

drop policy if exists h7_campaigns_select on public.package_campaigns;
create policy h7_campaigns_select on public.package_campaigns for select to anon, authenticated
  using ((cancelled_at is null and ends_at > now()
          and exists (select 1 from public.influencer_packages p where p.id = package_id and p.active and p.archived_at is null))
         or (select public.h7_rol()) = 'ceo');
drop policy if exists h7_campaigns_write on public.package_campaigns;
create policy h7_campaigns_write on public.package_campaigns for all to authenticated
  using ((select public.h7_rol()) = 'ceo') with check ((select public.h7_rol()) = 'ceo');

commit;

-- ======================================================================
-- 20261116120000_h7_10_teslimat_destek_odeme.sql
-- ======================================================================
-- =====================================================================
-- HITY7 · Migration 10 · Teslimat merkezi, bildirimler, destek dosyaları, PayTR ödeme kayıtları, özel dosya depoları
--
-- 01–09'dan SONRA çalıştırın. Tekrar çalıştırılabilir. Tek transaction.
-- Mevcut siparişleri, destek taleplerini, mesajları ve dosyaları SİLMEZ, DEĞİŞTİRMEZ.
-- Aşamalar: 8 (teslimat + destek dosyaları), 17 (PayTR), 7/18 (özel depolar)
-- =====================================================================
begin;

-- ---------------------------------------------------------------------
-- 1) Teslimatlar (Remake Beat, Mix & Mastering)
--    code: tahmin edilemeyen bağlantı kodu (sunucuda kriptografik rastgele üretilir), ör. a8K2mP9xQ4vN7rT3
--    Durum: hazirlaniyor → teslim_edildi → (revizyon → teslim_edildi)* → tamamlandi
-- ---------------------------------------------------------------------
create table if not exists public.deliveries (
  id uuid primary key default gen_random_uuid(),
  order_id bigint not null unique references public.orders (id) on delete restrict,
  user_id uuid not null,
  code text not null unique check (code ~ '^[A-Za-z0-9]{16,40}$'),
  status text not null default 'hazirlaniyor' check (status in ('hazirlaniyor', 'teslim_edildi', 'revizyon', 'tamamlandi')),
  access_enabled boolean not null default true,
  current_version integer not null default 1 check (current_version >= 1),
  -- Müşteriye yayınlanmış son sürüm (0 = henüz yayınlanmadı). Müşteri yalnızca bu sürüme kadar olan dosyaları görür.
  published_version integer not null default 0 check (published_version >= 0),
  note text check (note is null or length(note) <= 2000),
  delivered_at timestamptz,
  created_by uuid,
  created_at timestamptz not null default now(),
  updated_at timestamptz not null default now()
);
create index if not exists deliveries_user_idx on public.deliveries (user_id, created_at desc);
alter table public.deliveries add column if not exists published_version integer not null default 0;

create table if not exists public.delivery_files (
  id uuid primary key default gen_random_uuid(),
  delivery_id uuid not null references public.deliveries (id) on delete restrict,
  version integer not null check (version >= 1),
  name text not null check (length(name) between 1 and 200),
  size bigint not null check (size > 0),
  mime text,
  storage_provider text not null check (storage_provider in ('supabase', 'r2')),
  storage_bucket text not null,
  storage_key text not null,
  sha256 text check (sha256 is null or sha256 ~ '^[0-9a-f]{64}$'),
  uploaded_by uuid,
  created_at timestamptz not null default now(),
  unique (storage_provider, storage_bucket, storage_key)
);
create index if not exists delivery_files_delivery_idx on public.delivery_files (delivery_id, version);

create table if not exists public.delivery_events (
  id bigint generated always as identity primary key,
  delivery_id uuid not null references public.deliveries (id) on delete restrict,
  kind text not null check (kind in ('olusturuldu', 'yukleme', 'yayinlandi', 'indirme', 'erisim_reddi', 'revizyon', 'onay',
                                     'baglanti_kapatildi', 'baglanti_acildi', 'baglanti_yenilendi')),
  file_id uuid,
  actor_id uuid,
  note text check (note is null or length(note) <= 1500),
  created_at timestamptz not null default now()
);
create index if not exists delivery_events_delivery_idx on public.delivery_events (delivery_id, created_at);

-- ---------------------------------------------------------------------
-- 2) Uygulama içi bildirimler (e-posta servisi kurulmadığı için bildirimler sitede gösterilir)
-- ---------------------------------------------------------------------
create table if not exists public.notifications (
  id bigint generated always as identity primary key,
  user_id uuid not null,
  kind text not null check (length(kind) <= 40),
  title text not null check (length(title) <= 160),
  body text check (body is null or length(body) <= 600),
  link text check (link is null or link ~ '^/'),
  read_at timestamptz,
  created_at timestamptz not null default now()
);
create index if not exists notifications_user_idx on public.notifications (user_id, created_at desc);

-- Yönetime bildirim: CEO + (varsa) siparişler yetkisi olan yöneticiler
create or replace function public.h7_yonetime_bildir(p_kind text, p_title text, p_body text, p_link text)
returns void
language plpgsql
security definer
set search_path = public
as $$
begin
  insert into public.notifications (user_id, kind, title, body, link)
  select p.id, left(p_kind, 40), left(p_title, 160), left(p_body, 600), p_link
  from public.profiles p
  where not coalesce(p.banned, false) and p.role::text in ('ceo', 'admin');
end;
$$;
revoke execute on function public.h7_yonetime_bildir(text, text, text, text) from public, anon, authenticated;

-- ---------------------------------------------------------------------
-- 3) Teslimat işlemleri — yalnızca sitenin sunucusu çağırır (yetki API'de oturumla doğrulanır, burada tekrar kontrol edilir)
-- ---------------------------------------------------------------------

-- Yönetici bu işlemi yapabilir mi? (sunucunun gönderdiği aktör kimliğiyle)
create or replace function public.h7_aktor_yetki(p_actor uuid, p_tab text)
returns boolean
language sql
stable
security definer
set search_path = public
as $$
  select coalesce((
    select case
      when p.banned then false
      when p.role::text in ('ceo', 'admin') then true
      when p.role::text in ('mod', 'amele') then
        case
          when exists (select 1 from public.user_permission_sets s where s.user_id = p.id)
            then exists (select 1 from public.user_permission_sets s where s.user_id = p.id and p_tab = any (s.tabs))
          else exists (select 1 from public.role_permissions rp where rp.role::text = p.role::text and rp.tab::text = p_tab)
        end
      else false
    end
    from public.profiles p where p.id = p_actor), false);
$$;
revoke execute on function public.h7_aktor_yetki(uuid, text) from public, anon, authenticated;

-- Siparişe teslimat aç (yoksa) ve döndür
create or replace function public.h7_teslimat_ac(p_siparis bigint, p_kod text, p_actor uuid)
returns jsonb
language plpgsql
security invoker
set search_path = public
as $$
declare
  o record;
  d record;
begin
  if not public.h7_sunucu_mu() then
    raise exception 'YETKISIZ' using errcode = '42501';
  end if;
  if not (public.h7_aktor_yetki(p_actor, 'deliveries') or public.h7_aktor_yetki(p_actor, 'orders')) then
    raise exception 'YETKISIZ: Teslimat yetkin yok.' using errcode = '42501';
  end if;
  select id, code, user_id, type::text as type into o from public.orders where id = p_siparis;
  if not found then
    raise exception 'Sipariş bulunamadı.';
  end if;
  if o.type not in ('remake', 'mix') then
    raise exception 'Teslimat merkezi yalnızca Remake Beat ve Mix & Mastering siparişleri içindir.';
  end if;
  if o.user_id is null then
    raise exception 'Bu siparişin müşteri hesabı yok.';
  end if;
  select * into d from public.deliveries where order_id = p_siparis;
  if not found then
    insert into public.deliveries (order_id, user_id, code, created_by)
    values (p_siparis, o.user_id, p_kod, p_actor)
    returning * into d;
    insert into public.delivery_events (delivery_id, kind, actor_id) values (d.id, 'olusturuldu', p_actor);
  end if;
  return to_jsonb(d);
end;
$$;

-- Doğrulanmış (depoda var olduğu sunucuda kontrol edilmiş) dosyaları kaydet.
-- p_yeni_surum: true ise yeni bir teslim sürümü açılır; önceki sürümlerin dosyaları kayıtta kalır.
create or replace function public.h7_teslimat_dosya_ekle(p_teslimat uuid, p_dosyalar jsonb, p_yeni_surum boolean, p_actor uuid)
returns jsonb
language plpgsql
security invoker
set search_path = public
as $$
declare
  d record;
  v_surum int;
  f jsonb;
  v_adet int := 0;
begin
  if not public.h7_sunucu_mu() then
    raise exception 'YETKISIZ' using errcode = '42501';
  end if;
  if not (public.h7_aktor_yetki(p_actor, 'deliveries') or public.h7_aktor_yetki(p_actor, 'orders')) then
    raise exception 'YETKISIZ: Teslimat yetkin yok.' using errcode = '42501';
  end if;
  select * into d from public.deliveries where id = p_teslimat for update;
  if not found then
    raise exception 'Teslimat bulunamadı.';
  end if;
  if jsonb_typeof(p_dosyalar) <> 'array' or jsonb_array_length(p_dosyalar) = 0 or jsonb_array_length(p_dosyalar) > 30 then
    raise exception 'Dosya listesi geçersiz.';
  end if;
  v_surum := d.current_version;
  if coalesce(p_yeni_surum, false) and exists (select 1 from public.delivery_files where delivery_id = d.id and version = v_surum) then
    v_surum := v_surum + 1;
    update public.deliveries set current_version = v_surum, updated_at = now() where id = d.id;
  end if;
  for f in select * from jsonb_array_elements(p_dosyalar) loop
    insert into public.delivery_files (delivery_id, version, name, size, mime, storage_provider, storage_bucket, storage_key, sha256, uploaded_by)
    values (d.id, v_surum, left(f ->> 'name', 200), (f ->> 'size')::bigint, left(f ->> 'mime', 100),
            f ->> 'provider', f ->> 'bucket', f ->> 'key', nullif(f ->> 'sha256', ''), p_actor)
    on conflict (storage_provider, storage_bucket, storage_key) do nothing;
    v_adet := v_adet + 1;
  end loop;
  insert into public.delivery_events (delivery_id, kind, actor_id, note)
  values (d.id, 'yukleme', p_actor, v_adet || ' dosya · sürüm ' || v_surum);
  return jsonb_build_object('ok', true, 'surum', v_surum, 'adet', v_adet);
end;
$$;

-- Teslimatı müşteriye yayınla: durum "Teslim Edildi", sipariş "Tamamlandı", müşteriye bildirim
create or replace function public.h7_teslimat_yayinla(p_teslimat uuid, p_not text, p_actor uuid)
returns jsonb
language plpgsql
security invoker
set search_path = public
as $$
declare
  d record;
  o record;
  v_ilk boolean;
begin
  if not public.h7_sunucu_mu() then
    raise exception 'YETKISIZ' using errcode = '42501';
  end if;
  if not (public.h7_aktor_yetki(p_actor, 'deliveries') or public.h7_aktor_yetki(p_actor, 'orders')) then
    raise exception 'YETKISIZ: Teslimat yetkin yok.' using errcode = '42501';
  end if;
  select * into d from public.deliveries where id = p_teslimat for update;
  if not found then
    raise exception 'Teslimat bulunamadı.';
  end if;
  if not exists (select 1 from public.delivery_files where delivery_id = d.id and version = d.current_version) then
    raise exception 'Bu sürümde dosya yok. Önce dosya yükleyin.';
  end if;
  v_ilk := d.delivered_at is null;
  update public.deliveries
  set status = 'teslim_edildi', delivered_at = coalesce(delivered_at, now()), updated_at = now(),
      published_version = d.current_version,
      note = coalesce(nullif(left(btrim(coalesce(p_not, '')), 2000), ''), note)
  where id = d.id;
  insert into public.delivery_events (delivery_id, kind, actor_id, note) values (d.id, 'yayinlandi', p_actor, left(p_not, 1500));

  select id, code, status::text as status into o from public.orders where id = d.order_id for update;
  if o.status not in ('Tamamlandı', 'İptal Edildi') then
    perform set_config('hity7.yetkili_islem', 'on', true);
    perform set_config('hity7.not', 'Teslimat yayınlandı', true);
    update public.orders set status = 'Tamamlandı' where id = o.id;
    perform set_config('hity7.not', '', true);
    perform set_config('hity7.yetkili_islem', 'off', true);
  end if;

  insert into public.notifications (user_id, kind, title, body, link)
  values (d.user_id, 'teslimat',
          case when v_ilk then 'Teslimatın hazır' else 'Teslimatına yeni sürüm yüklendi' end,
          'Sipariş ' || coalesce(o.code::text, '#' || o.id::text) || ' · sürüm ' || d.current_version,
          '/teslim/' || d.code);
  insert into public.audit_log (actor_id, action, target, details)
  values (p_actor, 'teslimat.yayinlandi', coalesce(o.code::text, o.id::text), jsonb_build_object('surum', d.current_version));
  return jsonb_build_object('ok', true, 'surum', d.current_version);
end;
$$;

-- Müşteri: teslimatı onayla veya revizyon iste (yalnızca kendi teslimatı)
create or replace function public.h7_teslimat_musteri(p_kod text, p_user uuid, p_islem text, p_not text)
returns jsonb
language plpgsql
security invoker
set search_path = public
as $$
declare
  d record;
  o record;
begin
  if not public.h7_sunucu_mu() then
    raise exception 'YETKISIZ' using errcode = '42501';
  end if;
  if p_islem not in ('onay', 'revizyon') then
    raise exception 'İşlem geçersiz.';
  end if;
  select * into d from public.deliveries where code = p_kod for update;
  if not found or d.user_id is distinct from p_user or not d.access_enabled then
    raise exception 'TESLIMAT_YOK';
  end if;
  if d.status <> 'teslim_edildi' then
    raise exception 'Bu teslimat şu an onay veya revizyon için uygun değil.';
  end if;
  select id, code, status::text as status into o from public.orders where id = d.order_id for update;

  if p_islem = 'onay' then
    update public.deliveries set status = 'tamamlandi', updated_at = now() where id = d.id;
    insert into public.delivery_events (delivery_id, kind, actor_id, note) values (d.id, 'onay', p_user, left(p_not, 1500));
    perform public.h7_yonetime_bildir('teslimat_onay', 'Teslimat onaylandı', 'Sipariş ' || coalesce(o.code::text, o.id::text), '/ceo');
  else
    if length(btrim(coalesce(p_not, ''))) < 5 then
      raise exception 'Lütfen revizyon isteğini birkaç kelimeyle anlat.';
    end if;
    update public.deliveries set status = 'revizyon', updated_at = now() where id = d.id;
    insert into public.delivery_events (delivery_id, kind, actor_id, note) values (d.id, 'revizyon', p_user, left(btrim(p_not), 1500));
    insert into public.order_events (order_id, kind, note, actor_id) values (o.id, 'revizyon', left(btrim(p_not), 1500), p_user);
    if o.status <> 'İptal Edildi' then
      perform set_config('hity7.yetkili_islem', 'on', true);
      perform set_config('hity7.not', 'Müşteri revizyon istedi', true);
      update public.orders set status = 'Revizyon' where id = o.id;
      perform set_config('hity7.not', '', true);
      perform set_config('hity7.yetkili_islem', 'off', true);
    end if;
    perform public.h7_yonetime_bildir('teslimat_revizyon', 'Revizyon istendi', 'Sipariş ' || coalesce(o.code::text, o.id::text) || ': ' || left(btrim(p_not), 300), '/ceo');
  end if;
  insert into public.audit_log (actor_id, action, target, details)
  values (p_user, 'teslimat.' || p_islem, coalesce(o.code::text, o.id::text), '{}'::jsonb);
  return jsonb_build_object('ok', true, 'status', case when p_islem = 'onay' then 'tamamlandi' else 'revizyon' end);
end;
$$;

-- Bağlantıyı kapat / aç / yenile (yenile: eski kod geçersiz olur)
create or replace function public.h7_teslimat_baglanti(p_teslimat uuid, p_islem text, p_yeni_kod text, p_actor uuid)
returns jsonb
language plpgsql
security invoker
set search_path = public
as $$
declare
  d record;
begin
  if not public.h7_sunucu_mu() then
    raise exception 'YETKISIZ' using errcode = '42501';
  end if;
  if not (public.h7_aktor_yetki(p_actor, 'deliveries') or public.h7_aktor_yetki(p_actor, 'orders')) then
    raise exception 'YETKISIZ: Teslimat yetkin yok.' using errcode = '42501';
  end if;
  select * into d from public.deliveries where id = p_teslimat for update;
  if not found then
    raise exception 'Teslimat bulunamadı.';
  end if;
  if p_islem = 'kapat' then
    update public.deliveries set access_enabled = false, updated_at = now() where id = d.id;
    insert into public.delivery_events (delivery_id, kind, actor_id) values (d.id, 'baglanti_kapatildi', p_actor);
  elsif p_islem = 'ac' then
    update public.deliveries set access_enabled = true, updated_at = now() where id = d.id;
    insert into public.delivery_events (delivery_id, kind, actor_id) values (d.id, 'baglanti_acildi', p_actor);
  elsif p_islem = 'yenile' then
    update public.deliveries set code = p_yeni_kod, access_enabled = true, updated_at = now() where id = d.id;
    insert into public.delivery_events (delivery_id, kind, actor_id) values (d.id, 'baglanti_yenilendi', p_actor);
  else
    raise exception 'İşlem geçersiz.';
  end if;
  return (select to_jsonb(x) from public.deliveries x where x.id = d.id);
end;
$$;

revoke execute on function public.h7_teslimat_ac(bigint, text, uuid) from public, anon, authenticated;
revoke execute on function public.h7_teslimat_dosya_ekle(uuid, jsonb, boolean, uuid) from public, anon, authenticated;
revoke execute on function public.h7_teslimat_yayinla(uuid, text, uuid) from public, anon, authenticated;
revoke execute on function public.h7_teslimat_musteri(text, uuid, text, text) from public, anon, authenticated;
revoke execute on function public.h7_teslimat_baglanti(uuid, text, text, uuid) from public, anon, authenticated;
grant execute on function public.h7_teslimat_ac(bigint, text, uuid) to service_role;
grant execute on function public.h7_teslimat_dosya_ekle(uuid, jsonb, boolean, uuid) to service_role;
grant execute on function public.h7_teslimat_yayinla(uuid, text, uuid) to service_role;
grant execute on function public.h7_teslimat_musteri(text, uuid, text, text) to service_role;
grant execute on function public.h7_teslimat_baglanti(uuid, text, text, uuid) to service_role;

-- ---------------------------------------------------------------------
-- 4) Destek: mesajlara dosya eki, okunmamış takibi (mevcut talepler ve mesajlar korunur)
--    Durum değerleri değişmez (Yeni / Yanıtlandı / Kapandı); ekranda Açık / İşlemde / Çözüldü olarak gösterilir.
-- ---------------------------------------------------------------------
alter table public.support_messages add column if not exists attachments jsonb not null default '[]'::jsonb;
alter table public.support_tickets add column if not exists staff_read_at timestamptz;
alter table public.support_tickets add column if not exists customer_read_at timestamptz;
alter table public.support_tickets add column if not exists order_code text;

-- Ekip yanıt verince talep sahibine site içi bildirim (talep sahibi giriş yapmış bir üyeyse)
create or replace function public.h7_destek_yanit_bildir()
returns trigger
language plpgsql
security definer
set search_path = public
as $$
declare
  v_user uuid;
  v_no text;
  v_konu text;
begin
  if new.sender = 'staff' then
    select t.user_id, t.no::text, t.subject::text into v_user, v_no, v_konu from public.support_tickets t where t.id = new.ticket_id;
    if v_user is not null then
      insert into public.notifications (user_id, kind, title, body, link)
      values (v_user, 'destek', 'Destek talebine yanıt geldi', left(coalesce(v_no, '') || ' · ' || coalesce(v_konu, ''), 600), '/destek');
    end if;
  end if;
  return new;
end;
$$;
drop trigger if exists h7_destek_yanit_bildir on public.support_messages;
create trigger h7_destek_yanit_bildir
  after insert on public.support_messages
  for each row execute function public.h7_destek_yanit_bildir();

-- ---------------------------------------------------------------------
-- 5) PayTR ödeme kayıtları: test ve canlı AYRI tutulur.
--    - Test modundaki ödeme hiçbir zaman bakiye yüklemez.
--    - Canlı ödeme yalnızca imzası doğrulanmış "success" bildirimiyle ve tutar eşleşirse, TEK kez bakiyeye işlenir.
-- ---------------------------------------------------------------------
create table if not exists public.paytr_payments (
  merchant_oid text primary key check (merchant_oid ~ '^[A-Za-z0-9]{1,64}$'),
  user_id uuid not null,
  amount numeric(12, 2) not null check (amount > 0),
  mode text not null check (mode in ('test', 'live')),
  status text not null default 'pending' check (status in ('pending', 'success', 'failed')),
  wallet_ref text,
  callback_count integer not null default 0,
  last_callback_at timestamptz,
  paid_total_kurus bigint,
  failed_reason text,
  created_at timestamptz not null default now(),
  updated_at timestamptz not null default now()
);
create index if not exists paytr_payments_user_idx on public.paytr_payments (user_id, created_at desc);

-- Bildirim sonucu işle (imza sunucuda doğrulandıktan sonra çağrılır). Tekrarlanan bildirim hiçbir şeyi değiştirmez.
create or replace function public.h7_paytr_sonuc(p_oid text, p_status text, p_total_kurus bigint, p_reason text)
returns jsonb
language plpgsql
security invoker
set search_path = public
as $$
declare
  p record;
  v_beklenen bigint;
  v_yeni text;
  v_not text;
begin
  if not public.h7_sunucu_mu() then
    raise exception 'YETKISIZ' using errcode = '42501';
  end if;
  select * into p from public.paytr_payments where merchant_oid = p_oid for update;
  if not found then
    return jsonb_build_object('ok', false, 'neden', 'kayit_yok');
  end if;
  update public.paytr_payments set callback_count = callback_count + 1, last_callback_at = now(), updated_at = now()
  where merchant_oid = p_oid;
  if p.status <> 'pending' then
    return jsonb_build_object('ok', true, 'tekrar', true, 'status', p.status, 'mode', p.mode);
  end if;

  v_beklenen := round(p.amount * 100)::bigint;
  v_yeni := case when p_status = 'success' then 'success' else 'failed' end;
  if v_yeni = 'success' and (p_total_kurus is null or p_total_kurus < v_beklenen) then
    v_yeni := 'failed';
    v_not := 'Tutar uyuşmadı, yönetim kontrol etmeli';
  end if;

  update public.paytr_payments
  set status = v_yeni, paid_total_kurus = p_total_kurus,
      failed_reason = case when v_yeni = 'failed' then left(coalesce(v_not, p_reason, ''), 300) end, updated_at = now()
  where merchant_oid = p_oid;

  -- Yalnızca CANLI ödeme bakiyeye yansır. Bekleyen kayıt ödeme başlatılırken açılmıştır (ref = merchant_oid).
  if p.mode = 'live' then
    perform set_config('hity7.yetkili_islem', 'on', true);
    execute format('update public.wallet_transactions set status = %L%s where ref = %L and status::text = %L',
                   case when v_yeni = 'success' then 'ok' else 'failed' end,
                   case when v_not is not null then format(', note = %L', v_not) else '' end,
                   p_oid, 'pending');
    perform set_config('hity7.yetkili_islem', 'off', true);
  end if;

  insert into public.audit_log (actor_id, action, target, details)
  values (p.user_id, case when v_yeni = 'success' then 'odeme.paytr.basarili' else 'odeme.paytr.basarisiz' end, p_oid,
          jsonb_build_object('mod', p.mode, 'tutar', p.amount, 'odenen_kurus', p_total_kurus, 'neden', coalesce(v_not, p_reason)));
  return jsonb_build_object('ok', true, 'tekrar', false, 'status', v_yeni, 'mode', p.mode);
end;
$$;
revoke execute on function public.h7_paytr_sonuc(text, text, bigint, text) from public, anon, authenticated;
grant execute on function public.h7_paytr_sonuc(text, text, bigint, text) to service_role;

-- ---------------------------------------------------------------------
-- 6) RLS
-- ---------------------------------------------------------------------
alter table public.deliveries enable row level security;
alter table public.delivery_files enable row level security;
alter table public.delivery_events enable row level security;
alter table public.notifications enable row level security;
alter table public.paytr_payments enable row level security;

revoke all on public.deliveries, public.delivery_files, public.delivery_events, public.notifications, public.paytr_payments from anon;
revoke insert, update, delete, truncate on public.deliveries, public.delivery_files, public.delivery_events, public.paytr_payments from authenticated;
revoke insert, update, delete, truncate on public.notifications from authenticated;
grant select on public.deliveries, public.delivery_files, public.delivery_events, public.notifications, public.paytr_payments to authenticated;
-- Üye yalnızca kendi bildiriminin "okundu" zamanını işaretleyebilir
grant update (read_at) on public.notifications to authenticated;

drop policy if exists h7_deliveries_select on public.deliveries;
create policy h7_deliveries_select on public.deliveries for select to authenticated
  using ((user_id = (select auth.uid()) and access_enabled)
         or (select public.h7_yetki('deliveries')) or (select public.h7_yetki('orders')));
drop policy if exists h7_delivery_files_select on public.delivery_files;
create policy h7_delivery_files_select on public.delivery_files for select to authenticated
  using (exists (select 1 from public.deliveries d where d.id = delivery_id
                 and ((d.user_id = (select auth.uid()) and d.access_enabled and version <= d.published_version)
                      or (select public.h7_yetki('deliveries')) or (select public.h7_yetki('orders')))));
drop policy if exists h7_delivery_events_select on public.delivery_events;
create policy h7_delivery_events_select on public.delivery_events for select to authenticated
  using ((select public.h7_yetki('deliveries')) or (select public.h7_yetki('orders')));

drop policy if exists h7_notifications_select on public.notifications;
create policy h7_notifications_select on public.notifications for select to authenticated
  using (user_id = (select auth.uid()));
drop policy if exists h7_notifications_update on public.notifications;
create policy h7_notifications_update on public.notifications for update to authenticated
  using (user_id = (select auth.uid())) with check (user_id = (select auth.uid()));

drop policy if exists h7_paytr_payments_select on public.paytr_payments;
create policy h7_paytr_payments_select on public.paytr_payments for select to authenticated
  using (user_id = (select auth.uid()) or (select public.h7_yetki('payments')) or (select public.h7_yetki('wallet')));

-- ---------------------------------------------------------------------
-- 7) Özel dosya depoları (Supabase Storage) — herkese AÇIK DEĞİL. Erişim yalnızca sunucunun ürettiği
--    kısa süreli imzalı bağlantılarla. Mevcut "site-media" deposuna ve içindeki dosyalara dokunulmaz.
--    Ücretsiz planda dosya başına sınır 50 MB'tır.
-- ---------------------------------------------------------------------
do $$
begin
  if to_regclass('storage.buckets') is not null then
    insert into storage.buckets (id, name, public, file_size_limit)
    values ('hity7-uploads', 'hity7-uploads', false, 52428800),
           ('hity7-deliveries', 'hity7-deliveries', false, 52428800)
    on conflict (id) do nothing;
  else
    raise notice 'storage şeması yok (yerel prova): özel depolar oluşturulmadı.';
  end if;
end $$;

commit;

-- ======================================================================
-- 20261116130000_h7_11_depo_yedek.sql
-- ======================================================================
-- =====================================================================
-- HITY7 · Migration 11 · Depolama: kopya / yedek kayıtları, depo özeti, bütünlük kontrolü (7. aşama)
--
-- 01–10'dan SONRA çalıştırın. Tekrar çalıştırılabilir. Tek transaction.
-- Hiçbir dosyayı ve kaydı SİLMEZ, DEĞİŞTİRMEZ. Yalnızca yeni tablo ve fonksiyon ekler.
--
-- Kurallar:
--   - Kaynak dosya hiçbir koşulda silinmez. Kopya; boyutu ve (mümkünse) içerik özeti (ETag) kaynakla eşleşince
--     "dogrulandi" sayılır. Kayıtların hangi depoyu gösterdiği bu migration ile DEĞİŞMEZ.
--   - Yedekler ayrı bir depoya (R2 · hity7-backups) alınır; aktarım kopyaları kaynakla aynı adlı R2 deposuna gider.
--   - Kayıtları yalnızca sunucu (gizli anahtar) yazar; yalnızca CEO okuyabilir.
-- =====================================================================
begin;

create table if not exists public.storage_copies (
  id bigint generated always as identity primary key,
  purpose text not null check (purpose in ('aktarim', 'yedek')),
  source_provider text not null default 'supabase' check (source_provider in ('supabase', 'r2')),
  source_bucket text not null,
  source_key text not null,
  target_provider text not null check (target_provider in ('supabase', 'r2')),
  target_bucket text not null,
  target_key text not null,
  size bigint,
  etag text,
  status text not null default 'bekliyor' check (status in ('bekliyor', 'dogrulandi', 'hata')),
  verify_method text check (verify_method is null or verify_method in ('boyut+etag', 'boyut')),
  attempts integer not null default 0,
  last_error text check (last_error is null or length(last_error) <= 500),
  verified_at timestamptz,
  created_at timestamptz not null default now(),
  updated_at timestamptz not null default now(),
  unique (purpose, source_provider, source_bucket, source_key)
);
alter table public.storage_copies enable row level security;
revoke all on public.storage_copies from anon;
revoke insert, update, delete, truncate on public.storage_copies from authenticated;
grant select on public.storage_copies to authenticated;
grant select, insert, update on public.storage_copies to service_role;
drop policy if exists h7_storage_copies_select on public.storage_copies;
create policy h7_storage_copies_select on public.storage_copies for select to authenticated
  using ((select public.h7_rol()) = 'ceo');

-- ---------------------------------------------------------------------
-- Depo özeti: depolar, gizlilik, dosya sayısı ve toplam boyut + kopya kayıtları (yalnızca CEO / sunucu)
-- ---------------------------------------------------------------------
create or replace function public.h7_depo_ozet()
returns jsonb
language plpgsql
stable
security definer
set search_path = public
as $$
declare
  v_kovalar jsonb := '[]'::jsonb;
  v_storage boolean := to_regclass('storage.objects') is not null and to_regclass('storage.buckets') is not null;
begin
  if not (public.h7_sunucu_mu() or coalesce(public.h7_rol(), '') = 'ceo') then
    raise exception 'YETKISIZ: Depolama durumunu yalnızca CEO görebilir.' using errcode = '42501';
  end if;
  if v_storage then
    execute $q$
      select coalesce(jsonb_agg(jsonb_build_object('ad', b.id, 'ozel', not b.public,
               'adet', coalesce(o.adet, 0), 'boyut', coalesce(o.boyut, 0)) order by b.id), '[]'::jsonb)
      from storage.buckets b
      left join (select bucket_id, count(*) as adet, sum(coalesce((metadata ->> 'size')::bigint, 0)) as boyut
                 from storage.objects group by bucket_id) o on o.bucket_id = b.id
    $q$ into v_kovalar;
  end if;
  return jsonb_build_object(
    'storage', v_storage,
    'kovalar', v_kovalar,
    'kopyalar', (select coalesce(jsonb_agg(jsonb_build_object('amac', purpose, 'durum', status, 'adet', n) order by purpose, status), '[]'::jsonb)
                 from (select purpose, status, count(*) as n from public.storage_copies group by 1, 2) x));
end;
$$;
revoke execute on function public.h7_depo_ozet() from public, anon;
grant execute on function public.h7_depo_ozet() to authenticated, service_role;

-- ---------------------------------------------------------------------
-- Bütünlük kontrolü: kayıtlarda geçen (Supabase'teki) özel dosyalar depoda var mı, boyutları tutuyor mu?
-- Teslimat dosyaları, sipariş dosyaları, destek ekleri ve dijital yayın dosyaları kontrol edilir.
-- ---------------------------------------------------------------------
create or replace function public.h7_depo_butunluk()
returns jsonb
language plpgsql
stable
security definer
set search_path = public
as $$
declare
  v jsonb;
begin
  if not (public.h7_sunucu_mu() or coalesce(public.h7_rol(), '') = 'ceo') then
    raise exception 'YETKISIZ: Bütünlük kontrolünü yalnızca CEO yapabilir.' using errcode = '42501';
  end if;
  if to_regclass('storage.objects') is null then
    return jsonb_build_object('kontrol', 0, 'eksik', '[]'::jsonb, 'boyutHatali', '[]'::jsonb, 'kesik', false, 'storage', false);
  end if;
  execute $q$
    with ref as (
      select 'teslimat'::text as tur, f.name as ad, f.storage_bucket as kova, f.storage_key as anahtar, f.size as boyut
      from public.delivery_files f
      where f.storage_provider = 'supabase'
      union all
      select 'siparis', coalesce(x ->> 'name', 'dosya'), coalesce(nullif(x ->> 'depo', ''), 'hity7-uploads'), x ->> 'key',
             case when (x ->> 'size') ~ '^[0-9]+$' then (x ->> 'size')::bigint end
      from public.orders o,
           jsonb_array_elements(case when jsonb_typeof(o.payload -> 'files') = 'array' then o.payload -> 'files' else '[]'::jsonb end) x
      where coalesce(x ->> 'key', '') <> '' and coalesce(x ->> 'provider', 'supabase') = 'supabase'
      union all
      select 'destek', coalesce(x ->> 'name', 'dosya'), coalesce(nullif(x ->> 'depo', ''), 'hity7-uploads'), x ->> 'key',
             case when (x ->> 'size') ~ '^[0-9]+$' then (x ->> 'size')::bigint end
      from public.support_messages m,
           jsonb_array_elements(case when jsonb_typeof(m.attachments) = 'array' then m.attachments else '[]'::jsonb end) x
      where coalesce(x ->> 'key', '') <> '' and coalesce(x ->> 'provider', 'supabase') = 'supabase'
      union all
      select 'yayin-kapak', 'kapak', substring(r.cover_url from '^depo://supabase/([a-z0-9-]+)/'),
             regexp_replace(r.cover_url, '^depo://supabase/[a-z0-9-]+/', ''), null::bigint
      from public.releases r
      where r.cover_url like 'depo://supabase/%'
      union all
      select 'yayin-ses', coalesce(t.audio_name, 'ses'), substring(t.audio_url from '^depo://supabase/([a-z0-9-]+)/'),
             regexp_replace(t.audio_url, '^depo://supabase/[a-z0-9-]+/', ''), null::bigint
      from public.release_tracks t
      where t.audio_url like 'depo://supabase/%'
    ),
    k as (
      select ref.*, so.name is not null as var_mi, case when so.metadata ->> 'size' ~ '^[0-9]+$' then (so.metadata ->> 'size')::bigint end as depo_boyut
      from ref
      left join storage.objects so on so.bucket_id = ref.kova and so.name = ref.anahtar
    )
    select jsonb_build_object(
      'kontrol', (select count(*) from k),
      'eksik', (select coalesce(jsonb_agg(jsonb_build_object('tur', tur, 'ad', ad, 'key', kova || '/' || anahtar)), '[]'::jsonb)
                from (select * from k where not var_mi limit 200) a),
      'boyutHatali', (select coalesce(jsonb_agg(jsonb_build_object('tur', tur, 'ad', ad, 'key', kova || '/' || anahtar)), '[]'::jsonb)
                      from (select * from k where var_mi and boyut is not null and depo_boyut is not null and boyut <> depo_boyut limit 200) b),
      'kesik', (select count(*) from k where not var_mi or (boyut is not null and depo_boyut is not null and boyut <> depo_boyut)) > 200,
      'storage', true)
  $q$ into v;
  return v;
end;
$$;
revoke execute on function public.h7_depo_butunluk() from public, anon;
grant execute on function public.h7_depo_butunluk() to authenticated, service_role;

-- ---------------------------------------------------------------------
-- Kopyalanacak dosyalar (yalnızca sunucu). p_yeniden: yalnızca hata almış olanlar.
-- Aktarım: özel depolar. Yedek: özel depolar + site görselleri (site-media, herkese açık kalır; yedeği özeldir).
-- ---------------------------------------------------------------------
create or replace function public.h7_depo_kopyalanacak(p_amac text, p_limit integer, p_yeniden boolean)
returns jsonb
language plpgsql
stable
security definer
set search_path = public
as $$
declare
  v jsonb;
  v_kovalar text[];
begin
  if not public.h7_sunucu_mu() then
    raise exception 'YETKISIZ' using errcode = '42501';
  end if;
  if p_amac not in ('aktarim', 'yedek') then
    raise exception 'Geçersiz amaç.';
  end if;
  if to_regclass('storage.objects') is null then
    return '[]'::jsonb;
  end if;
  v_kovalar := case when p_amac = 'yedek'
                    then array['hity7-uploads', 'hity7-deliveries', 'site-media']
                    else array['hity7-uploads', 'hity7-deliveries'] end;
  execute $q$
    select coalesce(jsonb_agg(jsonb_build_object('kova', o.bucket_id, 'anahtar', o.name,
             'boyut', case when o.metadata ->> 'size' ~ '^[0-9]+$' then (o.metadata ->> 'size')::bigint end,
             'etag', o.metadata ->> 'eTag', 'mime', o.metadata ->> 'mimetype')), '[]'::jsonb)
    from (
      select o.*
      from storage.objects o
      left join public.storage_copies c
        on c.purpose = $1 and c.source_provider = 'supabase' and c.source_bucket = o.bucket_id and c.source_key = o.name
      where o.bucket_id = any ($2)
        and o.name not like '%/.emptyFolderPlaceholder'
        and case when $3 then c.status = 'hata' else (c.id is null or c.status = 'bekliyor') end
      order by o.created_at, o.name
      limit least(greatest(coalesce($4, 8), 1), 50)
    ) o
  $q$ into v using p_amac, v_kovalar, coalesce(p_yeniden, false), p_limit;
  return v;
end;
$$;
revoke execute on function public.h7_depo_kopyalanacak(text, integer, boolean) from public, anon, authenticated;
grant execute on function public.h7_depo_kopyalanacak(text, integer, boolean) to service_role;

-- Kopya sonuçlarını kaydeder (yalnızca sunucu). Deneme sayısı her çağrıda artar; doğrulanmış kayıt bozulmaz.
create or replace function public.h7_depo_kopya_kaydet(p_kayitlar jsonb)
returns integer
language plpgsql
security definer
set search_path = public
as $$
declare
  r jsonb;
  n integer := 0;
begin
  if not public.h7_sunucu_mu() then
    raise exception 'YETKISIZ' using errcode = '42501';
  end if;
  for r in select * from jsonb_array_elements(coalesce(p_kayitlar, '[]'::jsonb))
  loop
    insert into public.storage_copies as c (purpose, source_provider, source_bucket, source_key, target_provider, target_bucket,
                                            target_key, size, etag, status, verify_method, attempts, last_error, verified_at)
    values (r ->> 'amac', 'supabase', r ->> 'kova', r ->> 'anahtar', 'r2', r ->> 'hedef_kova', r ->> 'hedef_anahtar',
            nullif(r ->> 'boyut', '')::bigint, r ->> 'etag', r ->> 'durum', r ->> 'yontem', 1, left(r ->> 'hata', 500),
            case when r ->> 'durum' = 'dogrulandi' then now() end)
    on conflict (purpose, source_provider, source_bucket, source_key) do update
      set target_bucket = excluded.target_bucket,
          target_key = excluded.target_key,
          size = coalesce(excluded.size, c.size),
          etag = coalesce(excluded.etag, c.etag),
          status = case when c.status = 'dogrulandi' then c.status else excluded.status end,
          verify_method = coalesce(excluded.verify_method, c.verify_method),
          attempts = c.attempts + 1,
          last_error = case when excluded.status = 'dogrulandi' then null else excluded.last_error end,
          verified_at = coalesce(c.verified_at, excluded.verified_at),
          updated_at = now();
    n := n + 1;
  end loop;
  return n;
end;
$$;
revoke execute on function public.h7_depo_kopya_kaydet(jsonb) from public, anon, authenticated;
grant execute on function public.h7_depo_kopya_kaydet(jsonb) to service_role;

commit;

