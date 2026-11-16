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
