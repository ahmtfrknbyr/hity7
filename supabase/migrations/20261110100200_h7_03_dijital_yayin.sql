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
