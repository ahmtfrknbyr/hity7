-- =====================================================================
-- HITY7 · Migration 07'yi GERİ AL (cüzdan çekirdeği)
--
-- DİKKAT: Geri alındıktan sonra site sipariş ALAMAZ (place_order olmadan sipariş oluşturulamaz).
-- Yalnızca 07'den sonra beklenmeyen bir sorun çıkarsa kullanın. Tek transaction. Veri silmez.
--
-- Tarayıcı rollerinin siparişlere ve bakiye hareketlerine YAZMA yetkisi kapalı kalır:
-- site bu tablolara tarayıcıdan hiç yazmadığı için bu bir şeyi bozmaz, yalnızca güvenliği korur.
-- =====================================================================
begin;

drop function if exists public.place_order(uuid, text, text, text, text, numeric, jsonb, text);
drop function if exists public.wallet_balance(uuid);
drop index if exists public.orders_istek_tekil;
drop index if exists public.orders_code_tekil;
drop index if exists public.orders_user_created_idx;
drop index if exists public.wallet_transactions_user_status_idx;

commit;
