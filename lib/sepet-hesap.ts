/**
 * lib/sepet-hesap.ts
 * Sepet fiyat kuralları: ana hizmetin ve ek hizmetin birim fiyatı, adet sınırları, öneri kartı.
 * Hem sepet ekranı (gösterim) hem /api/sepet (asıl hesap) BU dosyayı kullanır; böylece müşterinin gördüğü
 * toplam ile sunucunun bakiyeden düştüğü toplam aynı kurallardan çıkar. Sunucu fiyatları her siparişte
 * Supabase'teki güncel içerikten yeniden hesaplar; tarayıcıdan gelen hiçbir fiyat kullanılmaz.
 * React'e bağlı değildir.
 */
import type { AddonItem, CartService, SiteContent } from "./site-content";

export const SERVICE_NAMES: Record<CartService, string> = { remake: "Remake Beat", mix: "Mix & Mastering" };

export const REMAKE_OPTIONS: Record<string, string> = {
  free: "FREE BEAT",
  birebir: "BİREBİR REMAKE",
  modern: "MODERN REMAKE",
  ozgun: "ÖZGÜN REMAKE",
};

export const MIX_KINDS: Record<"mix" | "stems", string> = { mix: "Mix & Mastering", stems: "Stems Mix & Mastering" };

/** Bir satırda en fazla kaç adet. Ek hizmetin adedi ana hizmetin adedini geçemez. */
export const MAX_QTY = 10;

export const clampQty = (n: unknown, max = MAX_QTY) => {
  const v = Math.floor(Number(n));
  return Number.isFinite(v) ? Math.min(Math.max(v, 1), Math.max(1, max)) : 1;
};

export const round2 = (n: number) => Math.round(n * 100) / 100;

/** Ana hizmetin fiyatlandırmada kullanılan alanları (formdaki diğer alanlar fiyatı etkilemez). */
export type MainRef = { optionId?: string; service?: string; producerId?: string };

export type UnitResult = { ok: true; unit: number; name: string } | { ok: false; error: string };

/** Ana hizmetin birim fiyatı ve görünen adı. Geçersiz seçim veya fiyatı belirlenmemiş prodüktör hata döndürür. */
export function mainUnit(content: SiteContent, service: CartService, ref: MainRef): UnitResult {
  if (service === "remake") {
    const opt = String(ref.optionId || "");
    if (!REMAKE_OPTIONS[opt]) return { ok: false, error: "Remake seçeneği geçersiz." };
    const unit = Number(content.pricing.remake[opt as keyof SiteContent["pricing"]["remake"]]) || 0;
    return { ok: true, unit: round2(unit), name: `${SERVICE_NAMES.remake} · ${REMAKE_OPTIONS[opt]}` };
  }
  const kind = ref.service === "stems" ? "stems" : "mix";
  const p = content.producers.find((x) => x.id === ref.producerId && x.active !== false);
  if (!p) return { ok: false, error: "Seçilen prodüktör artık listede değil. Mix sayfasından yeniden seç." };
  const unit = Number(kind === "stems" ? p.stemsPrice : p.mixPrice) || 0;
  if (!(unit > 0)) return { ok: false, error: "Bu prodüktörün fiyatı henüz belirlenmemiş." };
  return { ok: true, unit: round2(unit), name: `${MIX_KINDS[kind]} · ${p.name}` };
}

export type Offer = { title: string; addons: AddonItem[] };

/** Hizmet sayfasında ve sepette önerilecek ek hizmetler (kapalıysa veya satışta ek hizmet yoksa null). */
export function offerFor(content: SiteContent, service: CartService): Offer | null {
  const o = content.upsell.offers[service];
  if (!o || !o.enabled) return null;
  const addons = o.addonIds
    .map((id) => content.upsell.addons.find((a) => a.id === id))
    .filter((a): a is AddonItem => !!a && a.active);
  return addons.length ? { title: o.title, addons } : null;
}

/** Ek hizmet bu ana hizmetin yanında satılıyor mu? Satılıyorsa kaydını döndürür. */
export function addonFor(content: SiteContent, service: CartService, addonId: string): AddonItem | null {
  return offerFor(content, service)?.addons.find((a) => a.id === addonId) || null;
}

/** TL biçimi: 3.000 TL / 1.234,50 TL */
export const tl = (n: number) =>
  Number(n || 0).toLocaleString("tr-TR", { minimumFractionDigits: Number.isInteger(round2(n)) ? 0 : 2, maximumFractionDigits: 2 }) + " TL";
