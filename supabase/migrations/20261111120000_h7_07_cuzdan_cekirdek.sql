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
