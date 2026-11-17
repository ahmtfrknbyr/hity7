-- =====================================================================
-- HITY7 · Migration 13 (İSTEĞE BAĞLI, ayrı onay) · Eski profiles_guard: CEO'yu da yönetici say
--
-- 01–12'den SONRA. Tekrar çalıştırılabilir. Tek transaction. Veri değiştirmez, tetikleyiciyi kaldırmaz / devre dışı bırakmaz.
--
-- Sorun: Canlıdaki eski profiles_guard (BEFORE UPDATE) rol / panel_request değişikliğine yalnızca is_admin() = rolü TAM OLARAK 'admin'
-- olan giriş yapmış kullanıcı için izin verir. CEO rolü eklendikten sonra CEO bu kontrolden geçemez: CEO panelinden bir üyeye rol
-- vermek (h7_uye_rol) veya yönetici başvurusunu reddetmek (h7_basvuru_red) "Rol değişikliği için admin yetkisi gerekir" hatası verir.
--
-- Çözüm (dar): kontrol AYNI kalır; yalnızca CEO da (admin'in üst rolü) kabul edilir. Başka hiçbir rol, SQL Editor veya sunucu
-- için bu tetikleyicide yeni izin AÇILMAZ (SQL Editor'den doğrudan rol değişikliği hâlâ engellidir; o iş için ceo-profil-olustur-ata.sql).
-- =====================================================================
begin;

create or replace function public.profiles_guard()
returns trigger
language plpgsql
security definer
set search_path to 'public'
as $$
begin
  if (new.role is distinct from old.role or new.panel_request is distinct from old.panel_request)
     and not (public.is_admin() or coalesce(public.h7_rol(), '') = 'ceo') then
    raise exception 'Rol değişikliği için admin yetkisi gerekir.';
  end if;
  return new;
end;
$$;

commit;
