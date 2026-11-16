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
