/**
 * lib/paket.ts
 * Hazır influencer paketleri (müşteri tarafı). Maliyet, kâr ve marj bilgisi burada YOKTUR ve okunamaz
 * (veritabanında ayrı, yalnızca CEO'nun okuyabildiği tablolardadır).
 * Kampanyanın geçerli olup olmadığı ekranda sunucu saatine göre gösterilir; sipariş anında ayrıca
 * veritabanında (h7_paket_siparis) sunucu saatiyle yeniden kontrol edilir.
 */
import { getSupabase } from "./supabase";

export type PaketTuru = "liste" | "bagimsiz";

export type Kampanya = { id: string; fiyat: number; baslangic: string; bitis: string };

export type Paket = {
  id: string;
  tur: PaketTuru;
  ad: string;
  aciklama: string;
  icerik: string;
  adet: number | null;
  birim: string;
  gorsel: string | null;
  fiyat: number;
  influencerlar: { id: string; ad: string; foto: string | null; kullanici: string | null }[];
  kampanyalar: Kampanya[];
};

type Row = {
  id: string;
  kind: PaketTuru;
  name: string;
  description: string;
  content: string;
  unit_count: number | null;
  unit_label: string;
  image_url: string | null;
  price: number;
  influencer_package_items: { influencers: { id: string; name: string; photo_url: string | null; username: string | null } | null }[];
  package_campaigns: { id: string; price: number; starts_at: string; ends_at: string; cancelled_at: string | null }[];
};

/** Satıştaki paketleri okur (yalnızca herkese açık alanlar). */
export async function paketleriOku(): Promise<{ ok: true; paketler: Paket[] } | { ok: false; error: string }> {
  try {
    const sb = getSupabase();
    const { data, error } = await sb
      .from("influencer_packages")
      .select(
        "id,kind,name,description,content,unit_count,unit_label,image_url,price,influencer_package_items(influencers(id,name,photo_url,username)),package_campaigns(id,price,starts_at,ends_at,cancelled_at)"
      )
      .eq("active", true)
      .is("archived_at", null)
      .order("sort", { ascending: true })
      .order("created_at", { ascending: true });
    if (error) {
      // Tablo henüz yoksa (migration uygulanmadı) paket bölümü boş görünür
      return { ok: false, error: error.code === "PGRST205" || error.code === "42P01" ? "kurulmadi" : error.message };
    }
    const rows = (data || []) as unknown as Row[];
    return {
      ok: true,
      paketler: rows.map((r) => ({
        id: r.id,
        tur: r.kind,
        ad: r.name,
        aciklama: r.description || "",
        icerik: r.content || "",
        adet: r.unit_count,
        birim: r.unit_label || "video",
        gorsel: r.image_url,
        fiyat: Number(r.price) || 0,
        influencerlar: (r.influencer_package_items || [])
          .map((i) => i.influencers)
          .filter((x): x is NonNullable<typeof x> => !!x)
          .map((x) => ({ id: x.id, ad: x.name, foto: x.photo_url, kullanici: x.username })),
        kampanyalar: (r.package_campaigns || [])
          .filter((c) => !c.cancelled_at)
          .map((c) => ({ id: c.id, fiyat: Number(c.price) || 0, baslangic: c.starts_at, bitis: c.ends_at })),
      })),
    };
  } catch {
    return { ok: false, error: "baglanti" };
  }
}

/** Sunucu saati ile tarayıcı saati arasındaki fark (ms). Geri sayım ve kampanya durumu sunucu saatine göre gösterilir. */
export async function sunucuSaatFarki(): Promise<number> {
  try {
    const t0 = Date.now();
    const res = await fetch("/api/zaman", { cache: "no-store" });
    const j = (await res.json()) as { now?: number };
    const t1 = Date.now();
    if (!j.now) return 0;
    return j.now - Math.round((t0 + t1) / 2);
  } catch {
    return 0;
  }
}

export type PaketFiyat = {
  normal: number;
  final: number;
  kampanya: Kampanya | null;
  /** Kampanya indirim yüzdesi (tam sayıya yuvarlanmış gösterim) */
  oran: number;
  /** Henüz başlamamış ilk kampanya (bilgi amaçlı) */
  planli: Kampanya | null;
};

/** Verilen anda (sunucu saati) paketin geçerli fiyatı. Veritabanındaki h7_paket_fiyat ile aynı kural. */
export function paketFiyat(p: Paket, simdi: number): PaketFiyat {
  const aktif = p.kampanyalar
    .filter((k) => Date.parse(k.baslangic) <= simdi && Date.parse(k.bitis) > simdi && k.fiyat < p.fiyat)
    .sort((a, b) => Date.parse(b.baslangic) - Date.parse(a.baslangic))[0];
  const planli = p.kampanyalar.filter((k) => Date.parse(k.baslangic) > simdi).sort((a, b) => Date.parse(a.baslangic) - Date.parse(b.baslangic))[0] || null;
  if (!aktif) return { normal: p.fiyat, final: p.fiyat, kampanya: null, oran: 0, planli };
  const oran = Math.round(((p.fiyat - aktif.fiyat) * 100) / p.fiyat);
  return { normal: p.fiyat, final: aktif.fiyat, kampanya: aktif, oran, planli };
}

/** "2 gün 14 saat 05 dk 09 sn" biçiminde kalan süre */
export function kalanSure(ms: number): string {
  if (ms <= 0) return "Sona erdi";
  const s = Math.floor(ms / 1000);
  const g = Math.floor(s / 86400);
  const sa = Math.floor((s % 86400) / 3600);
  const dk = Math.floor((s % 3600) / 60);
  const sn = s % 60;
  const p = (n: number) => String(n).padStart(2, "0");
  return g > 0 ? `${g} gün ${sa} saat ${p(dk)} dk` : `${p(sa)}:${p(dk)}:${p(sn)}`;
}
