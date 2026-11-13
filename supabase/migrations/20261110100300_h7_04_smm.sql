-- =====================================================================
-- HITY7 · Migration 04 · SMM sağlayıcı entegrasyonu: hata ve işlem kayıtları
--
-- 01–03'ten SONRA çalıştırın. Tekrar çalıştırılabilir. Tek transaction.
-- Sağlayıcıya gönderilen siparişin durumu orders.payload.smm alanında tutulur;
-- başarısız API çağrıları bu tabloya yazılır. API anahtarları provider_secrets'ta kalır (tarayıcı okuyamaz).
-- =====================================================================
begin;

create table if not exists public.smm_logs (
  id bigint generated always as identity primary key,
  level text not null default 'error' check (level in ('error', 'info')),
  event text not null,               -- add | status | sync | …
  message text,
  provider_id text,                  -- smm_providers.id
  order_id bigint,                   -- orders.id
  details jsonb not null default '{}'::jsonb,
  created_at timestamptz not null default now()
);
create index if not exists smm_logs_created_idx on public.smm_logs (created_at desc);
alter table public.smm_logs enable row level security;

-- SMM servislerini kodla hızlı bulmak için (sipariş gönderiminde kullanılır)
do $$
begin
  if exists (
    select 1 from information_schema.columns
    where table_schema = 'public' and table_name = 'smm_services' and column_name = 'code'
  ) then
    create index if not exists smm_services_code_idx on public.smm_services (code);
  end if;
end $$;

commit;
