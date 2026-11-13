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
