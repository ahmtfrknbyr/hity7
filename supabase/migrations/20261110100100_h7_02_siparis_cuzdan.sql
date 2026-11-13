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
