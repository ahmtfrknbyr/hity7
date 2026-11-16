/**
 * lib/influencer-kural.ts
 * Influencer kampanya kuralları. Hem Influencer Marketing sayfası (arayüz) hem /api/siparis (sunucu) bu dosyayı
 * kullanır; asıl doğrulama ve tutar hesabı ayrıca veritabanında (h7_influencer_siparis) tekrar yapılır.
 *  - "Influencerları Kendin Seç": TikTok Video kampanyasında en az TIKTOK_MIN (5) FARKLI hesap seçilmelidir.
 *    Hazır paketlerde bu kural YOKTUR.
 *  - Instagram Reels kampanyasında en az 1 influencer yeterlidir.
 *  - Aynı hesap bir kampanyada iki kez yer alamaz. "Hesap", kayıt numarasına değil TikTok kullanıcı adına göre
 *    belirlenir; aynı kişi panelde iki kez eklenmiş olsa bile iki kez seçilemez.
 *  - Bireysel seçimde kademeli, BİRİKMEYEN indirim (indirimsiz toplam üzerinden tek oran):
 *    20.000 TL ve üzeri %10 · 30.000 TL ve üzeri %15 · 50.000 TL ve üzeri %20 (en fazla %20).
 * Para hesapları kuruş (tam sayı) üzerinden yapılır; kayan nokta hatası oluşmaz.
 * React'e bağlı değildir.
 */

export const TIKTOK = "TikTok Video";
export const REELS = "Instagram Reels";
export const CAMPAIGN_TYPES = [TIKTOK, REELS] as const;

/** TikTok kampanyasında (bireysel seçim) seçilmesi gereken en az farklı hesap sayısı. */
export const TIKTOK_MIN = 5;

/** Bir kampanyada seçilebilecek en çok influencer. */
export const INFLUENCER_MAX = 100;

/** Seçilen paylaşım türlerine göre gereken en az farklı hesap sayısı. */
export const minInfluencers = (types: readonly string[]) => (types.includes(TIKTOK) ? TIKTOK_MIN : 1);

/**
 * Hesap kimliği: TikTok bağlantısındaki kullanıcı adı; yoksa kayıttaki kullanıcı adı; o da yoksa kayıt numarası.
 * Büyük/küçük harf ve baştaki @ önemsizdir (ör. "https://www.tiktok.com/@Ece.Music" ve "@ece.music" aynı hesaptır).
 */
export function accountKey(x: { id: string; tiktok?: string | null; username?: string | null }): string {
  const m = String(x.tiktok || "").match(/tiktok\.com\/@([A-Za-z0-9._]+)/i);
  if (m) return "@" + m[1].toLowerCase();
  const u = String(x.username || "")
    .trim()
    .replace(/^@+/, "")
    .toLowerCase();
  return u ? "@" + u : "id:" + x.id;
}

/* ------------------------------------------------------------------ */
/* Para (kuruş) yardımcıları                                           */
/* ------------------------------------------------------------------ */

/** TL → kuruş (tam sayı). 19.999,99 → 1999999 */
export const toKurus = (tl: number) => Math.round(Number(tl || 0) * 100);
/** kuruş → TL (2 ondalık) */
export const fromKurus = (k: number) => k / 100;
/** Kuruş toplamı (kayan nokta birikimi olmadan) */
export const sumTL = (values: number[]) => fromKurus(values.reduce((s, v) => s + toKurus(v), 0));

/* ------------------------------------------------------------------ */
/* Bireysel seçim indirimi                                             */
/* ------------------------------------------------------------------ */

/** Eşik (TL) → oran (%). Büyükten küçüğe. Veritabanındaki h7_bireysel_indirim_orani ile birebir aynıdır. */
export const INDIRIM_KADEMELERI: readonly { esik: number; oran: number }[] = [
  { esik: 50000, oran: 20 },
  { esik: 30000, oran: 15 },
  { esik: 20000, oran: 10 },
];

export type BireyselIndirim = {
  /** İndirimsiz toplam (TL) */
  brut: number;
  /** Uygulanan tek oran (%) */
  oran: number;
  /** İndirim tutarı (TL) */
  indirim: number;
  /** Ödenecek toplam (TL) */
  toplam: number;
  /** Bir sonraki kademe ve ona kalan tutar (en üst kademedeyse null) */
  sonraki: { esik: number; oran: number; kalan: number } | null;
};

/** Seçilen influencerların satış fiyatlarından indirimli toplamı hesaplar. */
export function bireyselIndirim(fiyatlar: number[]): BireyselIndirim {
  const brutK = fiyatlar.reduce((s, f) => s + toKurus(f), 0);
  const brut = fromKurus(brutK);
  const kademe = INDIRIM_KADEMELERI.find((k) => brutK >= toKurus(k.esik));
  const oran = kademe ? kademe.oran : 0;
  // round(brüt × oran / 100, 2) — veritabanıyla aynı yuvarlama (pozitif tutarlarda yarım yukarı)
  const indirimK = Math.round((brutK * oran) / 100);
  const toplamK = brutK - indirimK;
  const ust = [...INDIRIM_KADEMELERI].reverse().find((k) => toKurus(k.esik) > brutK);
  return {
    brut,
    oran,
    indirim: fromKurus(indirimK),
    toplam: fromKurus(toplamK),
    sonraki: ust ? { esik: ust.esik, oran: ust.oran, kalan: fromKurus(toKurus(ust.esik) - brutK) } : null,
  };
}

/** TL biçimi: 1.234,50 TL (kuruş varsa gösterilir) */
export const tlKurus = (n: number) =>
  Number(n || 0).toLocaleString("tr-TR", {
    minimumFractionDigits: Number.isInteger(Math.round(n * 100) / 100) ? 0 : 2,
    maximumFractionDigits: 2,
  }) + " TL";
