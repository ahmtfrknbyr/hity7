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
