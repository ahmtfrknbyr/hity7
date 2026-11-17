-- =====================================================================
-- HITY7 · Canlı kurulum kontrolü (migration 01–11) — SALT OKUNUR, hiçbir şeyi değiştirmez.
--
-- Supabase → SQL Editor → bu dosyanın TAMAMINI yapıştır → Run. Sonuç TEK hücrede (hity7_kontrol_01_11) gelir.
-- O hücredeki metni kopyalayıp gönder. Kişisel veri içermez: yalnızca şema bilgisi ve sayılar.
-- =====================================================================
with
beklenen_fonksiyon(ad) as (values
    ('h7_jwt_role'),
    ('h7_guvenilir'),
    ('h7_rol'),
    ('h7_yonetici_mi'),
    ('h7_yetki'),
    ('h7_kayit'),
    ('h7_kayit_koru'),
    ('h7_profil_koru'),
    ('h7_uye_rol'),
    ('h7_uye_engel'),
    ('h7_basvuru_red'),
    ('h7_ceo_ata'),
    ('h7_siparis_koru'),
    ('h7_siparis_olay'),
    ('h7_cuzdan_koru'),
    ('h7_siparis_durum'),
    ('h7_teslimat_ekle'),
    ('h7_revizyon_talep'),
    ('h7_bakiye_onay'),
    ('h7_bakiye_duzelt'),
    ('h7_yayin_koru'),
    ('h7_upc_gecerli'),
    ('h7_yayin_kod'),
    ('h7_yayin_durum'),
    ('h7_icerik_yetkisi'),
    ('h7_ceo_ozet'),
    ('h7_sepet_siparis'),
    ('wallet_balance'),
    ('place_order'),
    ('h7_erisim_grubu'),
    ('h7_hizmet_siparis_izni'),
    ('h7_site_icerik_koru'),
    ('h7_uye_yetki_ayarla'),
    ('h7_odeme_mod_koru'),
    ('h7_paket_koru'),
    ('h7_paket_kalem_koru'),
    ('h7_paket_maliyet_koru'),
    ('h7_influencer_maliyet_kayit'),
    ('h7_kampanya_koru'),
    ('h7_paket_fiyat_koru'),
    ('h7_bireysel_indirim_orani'),
    ('h7_paket_fiyat'),
    ('h7_sunucu_mu'),
    ('h7_influencer_siparis'),
    ('h7_paket_siparis'),
    ('h7_siparis_iade_mi'),
    ('h7_finans_rapor'),
    ('h7_paket_karlilik'),
    ('h7_yonetime_bildir'),
    ('h7_aktor_yetki'),
    ('h7_teslimat_ac'),
    ('h7_teslimat_dosya_ekle'),
    ('h7_teslimat_yayinla'),
    ('h7_teslimat_musteri'),
    ('h7_teslimat_baglanti'),
    ('h7_destek_yanit_bildir'),
    ('h7_paytr_sonuc'),
    ('h7_depo_ozet'),
    ('h7_depo_butunluk'),
    ('h7_depo_kopyalanacak'),
    ('h7_depo_kopya_kaydet')
),
beklenen_tablo(ad) as (values
    ('audit_log'),
    ('order_events'),
    ('releases'),
    ('release_tracks'),
    ('smm_logs'),
    ('h7_politika_yedegi'),
    ('h7_rls_yedegi'),
    ('user_permission_sets'),
    ('influencer_costs'),
    ('influencer_packages'),
    ('influencer_package_items'),
    ('influencer_package_costs'),
    ('package_campaigns'),
    ('order_financials'),
    ('deliveries'),
    ('delivery_files'),
    ('delivery_events'),
    ('notifications'),
    ('paytr_payments'),
    ('storage_copies')
),
beklenen_tetikleyici(ad, tablo) as (values
    ('h7_kayit_koru', 'audit_log'),
    ('h7_profil_koru', 'profiles'),
    ('h7_siparis_koru', 'orders'),
    ('h7_siparis_olay', 'orders'),
    ('h7_cuzdan_koru', 'wallet_transactions'),
    ('h7_yayin_koru', 'releases'),
    ('h7_yayin_koru', 'release_tracks'),
    ('h7_site_icerik_koru', 'site_content'),
    ('h7_odeme_mod_koru', 'payment_providers'),
    ('h7_paket_koru', 'influencer_packages'),
    ('h7_paket_kalem_koru', 'influencer_package_items'),
    ('h7_paket_maliyet_koru', 'influencer_package_costs'),
    ('h7_influencer_maliyet_kayit', 'influencer_costs'),
    ('h7_kampanya_koru', 'package_campaigns'),
    ('h7_paket_fiyat_koru', 'influencer_packages'),
    ('h7_destek_yanit_bildir', 'support_messages')
)
select jsonb_pretty(jsonb_build_object(
  'postgres_surumu', current_setting('server_version'),

  -- 1) Eksikler (hepsi boş liste olmalı)
  'eksik_tablolar', (select coalesce(jsonb_agg(t.ad order by t.ad), '[]') from beklenen_tablo t
      where to_regclass('public.' || t.ad) is null),
  'eksik_fonksiyonlar', (select coalesce(jsonb_agg(f.ad order by f.ad), '[]') from beklenen_fonksiyon f
      where not exists (select 1 from pg_proc p join pg_namespace n on n.oid = p.pronamespace
                        where n.nspname = 'public' and p.proname = f.ad)),
  'eksik_tetikleyiciler', (select coalesce(jsonb_agg(t.ad || ' @ ' || t.tablo order by t.ad), '[]') from beklenen_tetikleyici t
      where not exists (select 1 from pg_trigger g join pg_class c on c.oid = g.tgrelid join pg_namespace n on n.oid = c.relnamespace
                        where n.nspname = 'public' and c.relname = t.tablo and g.tgname = t.ad and not g.tgisinternal)),

  -- 2) Satır güvenliği (RLS): kapalı tablo olmamalı
  'rls_kapali_tablolar', (select coalesce(jsonb_agg(t.ad order by t.ad), '[]') from beklenen_tablo t
      join pg_class c on c.oid = to_regclass('public.' || t.ad) where not c.relrowsecurity),
  -- Politikası olmayan RLS'li tablo = tarayıcıdan hiç erişilemez (provider_secrets, h7_* yedek tabloları için beklenen)
  'rls_acik_politikasiz_tablolar', (select coalesce(jsonb_agg(c.relname order by c.relname), '[]')
      from pg_class c join pg_namespace n on n.oid = c.relnamespace
      where n.nspname = 'public' and c.relkind = 'r' and c.relrowsecurity
        and not exists (select 1 from pg_policies p where p.schemaname = 'public' and p.tablename = c.relname)),

  -- 3) Ziyaretçi (anon) hangi h7 / sipariş fonksiyonlarını çalıştırabilir?
  --    Beklenen yalnızca güvenli yardımcılar: h7_jwt_role, h7_guvenilir, h7_rol, h7_yonetici_mi, h7_yetki, h7_erisim_grubu,
  --    h7_icerik_yetkisi, h7_paket_fiyat, h7_bireysel_indirim_orani, h7_upc_gecerli, h7_sunucu_mu.
  --    Para / sipariş / yönetim fonksiyonu görünüyorsa SORUN vardır.
  'anon_calistirabilir', (select coalesce(jsonb_agg(distinct p.proname order by p.proname), '[]')
      from pg_proc p join pg_namespace n on n.oid = p.pronamespace
      where n.nspname = 'public' and p.prokind = 'f' and p.prorettype <> 'pg_catalog.trigger'::regtype
        and p.proname in (select ad from beklenen_fonksiyon) and has_function_privilege('anon', p.oid, 'execute')),
  -- Üye (authenticated) para / sipariş çekirdeğini DOĞRUDAN çalıştıramamalı (boş liste beklenir)
  'uye_calistirabilir_yasak', (select coalesce(jsonb_agg(distinct p.proname order by p.proname), '[]')
      from pg_proc p join pg_namespace n on n.oid = p.pronamespace
      where n.nspname = 'public' and p.proname in ('place_order', 'wallet_balance', 'h7_sepet_siparis', 'h7_influencer_siparis',
            'h7_paket_siparis', 'h7_paytr_sonuc', 'h7_teslimat_ac', 'h7_teslimat_dosya_ekle', 'h7_teslimat_yayinla',
            'h7_teslimat_musteri', 'h7_teslimat_baglanti', 'h7_hizmet_siparis_izni', 'h7_depo_kopyalanacak',
            'h7_depo_kopya_kaydet', 'h7_kayit', 'h7_ceo_ata', 'h7_yonetime_bildir')
        and has_function_privilege('authenticated', p.oid, 'execute')),
  -- Sunucu (service_role) bu çekirdek fonksiyonları çalıştırabilmeli (5 ad beklenir)
  'sunucu_calistirabilir', (select coalesce(jsonb_agg(distinct p.proname order by p.proname), '[]')
      from pg_proc p join pg_namespace n on n.oid = p.pronamespace
      where n.nspname = 'public' and p.proname in ('place_order', 'wallet_balance', 'h7_paytr_sonuc', 'h7_influencer_siparis', 'h7_paket_siparis')
        and has_function_privilege('service_role', p.oid, 'execute')),

  -- 4) Tablo yetkileri: ziyaretçi maliyet / finans / para tablolarını okuyamamalı; üye para tablolarına yazamamalı
  'anon_okuyabilir_hassas_tablo', (select coalesce(jsonb_agg(t order by t), '[]') from unnest(array[
        'influencer_costs', 'influencer_package_costs', 'order_financials', 'orders', 'wallet_transactions', 'paytr_payments',
        'provider_secrets', 'deliveries', 'delivery_files', 'notifications', 'user_permission_sets', 'storage_copies'
      ]) t where to_regclass('public.' || t) is not null and has_table_privilege('anon', 'public.' || t, 'select')),
  'uye_yazabilir_para_tablosu', (select coalesce(jsonb_agg(t order by t), '[]') from unnest(array[
        'orders', 'wallet_transactions', 'order_financials', 'paytr_payments', 'deliveries', 'delivery_files'
      ]) t where to_regclass('public.' || t) is not null
        and (has_table_privilege('authenticated', 'public.' || t, 'insert') or has_table_privilege('authenticated', 'public.' || t, 'update')
             or has_table_privilege('authenticated', 'public.' || t, 'delete'))),
  'influencers_maliyet_sutunu', (select coalesce(jsonb_agg(column_name), '[]') from information_schema.columns
      where table_schema = 'public' and table_name = 'influencers' and (column_name ilike '%cost%' or column_name ilike '%maliyet%')),

  -- 5) Mevcut kayıtların sayısı (veri kaybı olmadığını doğrulamak için; önceki sayılarla karşılaştır)
  'kayit_sayilari', jsonb_build_object(
      'uyeler', (select count(*) from public.profiles),
      'influencerlar', (select count(*) from public.influencers),
      'siparisler', (select count(*) from public.orders),
      'bakiye_hareketleri', (select count(*) from public.wallet_transactions),
      'destek_talepleri', (select count(*) from public.support_tickets),
      'site_icerik_anahtarlari', (select count(*) from public.site_content),
      'smm_saglayicilari', (select count(*) from public.smm_providers),
      'smm_servisleri_toplam', (select count(*) from public.smm_services),
      'smm_katalogu_gorunen_satir', (select count(*) from public.smm_catalog),
      'influencer_aktif', (select count(*) from public.influencers where active)),

  -- 6) Tutarlılık: eksi bakiyeli üye ve tekrar eden referans (ikisi de 0 olmalı)
  'eksi_bakiyeli_uye_sayisi', (select count(*) from (
        select user_id from public.wallet_transactions where status::text = 'ok'
        group by user_id having sum(case when kind::text = 'topup' then amount else -amount end) < 0) x),
  'tekrar_eden_referans_sayisi', (select count(*) from (
        select ref from public.wallet_transactions where ref is not null group by ref having count(*) > 1) x),

  -- 7) Roller, ödeme ayarı, bakım modu, depolar
  'rol_dagilimi', (select coalesce(jsonb_object_agg(role::text, n), '{}') from (select role, count(*) n from public.profiles group by 1) x),
  'odeme_saglayicilari', (select coalesce(jsonb_agg(jsonb_build_object('tur', kind, 'aktif', active, 'mod', mode)), '[]') from public.payment_providers),
  'paytr_anahtari_kayitli', (select exists (select 1 from public.provider_secrets s join public.payment_providers p on p.id::text = s.ref_id::text
        where p.kind::text = 'paytr' and s.data ? 'key' and s.data ? 'salt' and s.data ? 'mid')),
  'bakim_modu', (select value -> 'maintenance' from public.site_content where key = 'general'),
  'depolar', (select coalesce(jsonb_agg(jsonb_build_object('ad', id, 'herkese_acik', public)), '[]') from storage.buckets
        where id in ('hity7-uploads', 'hity7-deliveries', 'site-media'))
)) as hity7_kontrol_01_11;
