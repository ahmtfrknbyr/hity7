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
