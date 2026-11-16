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
