/**
 * lib/erisim.ts
 * Hizmet görünürlüğü ve sipariş verilebilirliği (1. aşama) + site yayın durumu (9. aşama) kuralları.
 * Ayar site_content tablosunda "erisim" anahtarıyla saklanır ve yalnızca CEO değiştirebilir (veritabanı tetikleyicisi).
 * Aynı kural üç yerde uygulanır:
 *   - proxy.ts      : gizli hizmet sayfalarına doğrudan adresle girişi ve bakım modunu sunucuda engeller
 *   - /api/siparis  : sipariş izni (rol veritabanından okunur)
 *   - veritabanı    : h7_hizmet_siparis_izni (sipariş fonksiyonları)
 * React'e bağlı değildir.
 */

export type ErisimGrubu = "visitor" | "member" | "mod" | "ceo";
export const ERISIM_GRUPLARI: ErisimGrubu[] = ["visitor", "member", "mod", "ceo"];
export const GRUP_ADI: Record<ErisimGrubu, string> = { visitor: "Ziyaretçi", member: "Üye", mod: "Moderatör / Personel", ceo: "CEO / Admin" };

export type HizmetId = "influencer" | "smm" | "remake" | "mix" | "yayin";
export const HIZMETLER: { id: HizmetId; ad: string; yol: string }[] = [
  { id: "influencer", ad: "Influencer Marketing", yol: "/influencer-marketing" },
  { id: "smm", ad: "SMM Panel", yol: "/smm-panel" },
  { id: "remake", ad: "Remake Beat", yol: "/remake-beat" },
  { id: "mix", ad: "Mix & Mastering", yol: "/mix-mastering" },
  { id: "yayin", ad: "Dijital Yayın", yol: "/dijital-yayin" },
];

export type HizmetErisim = {
  active: boolean;
  visible: Record<ErisimGrubu, boolean>;
  /** Ziyaretçi sipariş veremez (giriş zorunlu); yalnızca üye / mod / ceo için ayar vardır */
  orderable: Record<Exclude<ErisimGrubu, "visitor">, boolean>;
};

export type ErisimAyar = {
  services: Record<HizmetId, HizmetErisim>;
  /** Site kapalıyken (bakım) CEO'ya ek olarak girebilecek roller */
  bakimdaGirebilir: ("admin" | "mod" | "amele")[];
};

export const VARSAYILAN_HIZMET: HizmetErisim = {
  active: true,
  visible: { visitor: true, member: true, mod: true, ceo: true },
  orderable: { member: true, mod: true, ceo: true },
};

/** Veritabanındaki kaydı varsayılanlarla güvenli biçimde birleştirir (eksik alan = açık). */
export function mergeErisim(v: unknown): ErisimAyar {
  const src = (v && typeof v === "object" ? v : {}) as { services?: Record<string, unknown>; bakimdaGirebilir?: unknown };
  const services = {} as Record<HizmetId, HizmetErisim>;
  for (const h of HIZMETLER) {
    const s = (src.services?.[h.id] && typeof src.services[h.id] === "object" ? src.services[h.id] : {}) as Partial<{
      active: unknown;
      visible: Record<string, unknown>;
      orderable: Record<string, unknown>;
    }>;
    services[h.id] = {
      active: s.active !== false,
      visible: {
        visitor: s.visible?.visitor !== false,
        member: s.visible?.member !== false,
        mod: s.visible?.mod !== false,
        ceo: s.visible?.ceo !== false,
      },
      orderable: {
        member: s.orderable?.member !== false,
        mod: s.orderable?.mod !== false,
        ceo: s.orderable?.ceo !== false,
      },
    };
  }
  const izinli = Array.isArray(src.bakimdaGirebilir)
    ? (src.bakimdaGirebilir.filter((r) => r === "admin" || r === "mod" || r === "amele") as ErisimAyar["bakimdaGirebilir"])
    : [];
  return { services, bakimdaGirebilir: Array.from(new Set(izinli)) };
}

/** Rol → erişim grubu (veritabanındaki h7_erisim_grubu ile aynı) */
export function grupOf(rol: string | null | undefined): ErisimGrubu {
  if (rol === "ceo" || rol === "admin") return "ceo";
  if (rol === "mod" || rol === "amele") return "mod";
  if (rol === "member") return "member";
  return "visitor";
}

/** Hizmet bu rol için listelerde / menülerde / sayfada görünür mü? */
export function hizmetGorunur(ayar: ErisimAyar, hizmet: HizmetId, rol: string | null | undefined): boolean {
  const s = ayar.services[hizmet] || VARSAYILAN_HIZMET;
  const g = grupOf(rol);
  // Pasif hizmet yalnızca CEO grubuna görünür (yönetim kontrol edebilsin diye)
  if (!s.active) return g === "ceo";
  return s.visible[g];
}

/** Bu rol bu hizmetten sipariş verebilir mi? (ziyaretçi: hayır, giriş gerekir; bu role gizli hizmet: hayır) */
export function hizmetSiparisVerilebilir(ayar: ErisimAyar, hizmet: HizmetId, rol: string | null | undefined): boolean {
  const s = ayar.services[hizmet] || VARSAYILAN_HIZMET;
  const g = grupOf(rol);
  if (!s.active || g === "visitor") return false;
  return s.visible[g] && s.orderable[g];
}

/** Site kapalıyken bu rol siteye girebilir mi? */
export function bakimdaGirebilir(ayar: ErisimAyar, rol: string | null | undefined): boolean {
  if (rol === "ceo") return true;
  return !!rol && (ayar.bakimdaGirebilir as string[]).includes(rol);
}

/** Adres → hizmet (gizli hizmet sayfasının doğrudan adresle açılmasını engellemek için) */
export function hizmetOfPath(path: string): HizmetId | null {
  const h = HIZMETLER.find((x) => path === x.yol || path.startsWith(x.yol + "/"));
  return h ? h.id : null;
}

/** Sipariş türü → hizmet */
export function hizmetOfSiparis(type: string): HizmetId | null {
  if (type === "paket") return "influencer";
  return (HIZMETLER.find((h) => h.id === type)?.id as HizmetId) || null;
}
