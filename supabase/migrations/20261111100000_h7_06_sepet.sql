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
