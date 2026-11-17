-- =====================================================================
-- HITY7 · Migration 12 · h7_paket_fiyat: ziyaretçi / üye erişimini kapat (sertleştirme)
--
-- 01–11'den SONRA çalıştırın. Tekrar çalıştırılabilir. Tek transaction. Veri değiştirmez, tablo eklemez.
--
-- Neden? h7_paket_fiyat(paket, an) "security definer"dır ve tarih parametresi alır. Ziyaretçi eski bir tarih vererek
-- satır güvenliğinin (RLS) gizlediği SÜRESİ DOLMUŞ kampanya fiyatını ve tarihlerini öğrenebiliyordu.
-- Hiçbir istemci bu fonksiyonu çağırmaz (fiyatı sayfa kendisi hesaplar); yalnızca sunucu, sipariş fonksiyonları
-- (h7_paket_siparis) içinden kullanır. Bu yüzden tarayıcı rollerinin erişimi gereksizdir ve kapatılır.
-- =====================================================================
begin;

revoke execute on function public.h7_paket_fiyat(uuid, timestamptz) from public, anon, authenticated;
grant execute on function public.h7_paket_fiyat(uuid, timestamptz) to service_role;

commit;
