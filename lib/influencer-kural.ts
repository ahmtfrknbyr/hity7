/**
 * lib/influencer-kural.ts
 * Influencer kampanya kuralları. Hem Influencer Marketing sayfası (arayüz) hem /api/siparis (sunucu) bu dosyayı
 * kullanır; böylece arayüzdeki kural ile sunucunun uyguladığı kural her zaman aynıdır.
 *  - TikTok Video kampanyasında en az TIKTOK_MIN (30) FARKLI hesap seçilmelidir.
 *  - Instagram Reels kampanyasında en az 1 influencer yeterlidir (eski kural).
 *  - Aynı hesap bir kampanyada iki kez yer alamaz. "Hesap", kayıt numarasına değil TikTok kullanıcı adına göre
 *    belirlenir; aynı kişi panelde iki kez eklenmiş olsa bile iki kez seçilemez.
 * React'e bağlı değildir.
 */

export const TIKTOK = "TikTok Video";
export const REELS = "Instagram Reels";
export const CAMPAIGN_TYPES = [TIKTOK, REELS] as const;

/** TikTok kampanyasında seçilmesi gereken en az farklı hesap sayısı. */
export const TIKTOK_MIN = 30;

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
