/**
 * lib/ses-dogrula.ts
 * Remake Beat paket örnek sesleri: dosya doğrulama ve kayıt birleştirme kuralları. Saf işlevler (React / Supabase yok),
 * bu yüzden hem CEO panelinde hem sayfada hem testlerde aynen kullanılır.
 *
 * Kayıt: site_content tablosunda key = "remake_sesler":
 *   { "free": { "url": "https://…", "name": "ornek.mp3", "size": 123456, "type": "mp3", "at": "2026-11-17T…Z" }, "birebir": {…}, … }
 * Her paket kendi alanıdır; bir paketin değişmesi diğerlerine dokunmaz.
 */

export type RemakePaketId = "free" | "birebir" | "modern" | "ozgun";
export const REMAKE_PAKETLERI: { id: RemakePaketId; ad: string }[] = [
  { id: "free", ad: "FREE BEAT" },
  { id: "birebir", ad: "BİREBİR REMAKE" },
  { id: "modern", ad: "MODERN REMAKE" },
  { id: "ozgun", ad: "ÖZGÜN REMAKE" },
];

export const SES_ANAHTARI = "remake_sesler";
/** Örnek ses dosyası üst sınırı (Supabase Free dosya sınırı 50 MB; örnek için 25 MB fazlasıyla yeter) */
export const SES_MAX_BOYUT = 25 * 1024 * 1024;

export type SesKaydi = { url: string; name: string; size: number; type: "mp3" | "wav"; at: string };
export type SesHaritasi = Partial<Record<RemakePaketId, SesKaydi>>;

const PAKET_IDLERI = new Set<string>(REMAKE_PAKETLERI.map((p) => p.id));

export type SesDogrulama = { ok: true; type: "mp3" | "wav"; mime: string } | { ok: false; error: string };

/**
 * Dosyanın gerçekten MP3 / WAV olduğunu doğrular (uzantı + dosya başlığı). Tarayıcının bildirdiği MIME türüne güvenilmez:
 * ad "x.mp3" olan bir HTML / program dosyası reddedilir.
 * @param bas dosyanın ilk baytları (en az ilk 4096 bayt önerilir)
 */
export function sesDosyasiDogrula(bas: Uint8Array, ad: string, boyut: number): SesDogrulama {
  const uz = (/\.([A-Za-z0-9]+)$/.exec(ad || "")?.[1] || "").toLowerCase();
  if (uz !== "mp3" && uz !== "wav") return { ok: false, error: "Yalnızca MP3 veya WAV dosyası yüklenebilir." };
  if (!Number.isFinite(boyut) || boyut <= 0) return { ok: false, error: "Dosya boş görünüyor." };
  if (boyut > SES_MAX_BOYUT) return { ok: false, error: `Dosya ${Math.round(SES_MAX_BOYUT / 1048576)} MB'tan büyük olamaz.` };
  const asc = (a: number, b: number) => String.fromCharCode(...Array.from(bas.slice(a, b)));
  if (uz === "wav") {
    if (bas.length >= 12 && asc(0, 4) === "RIFF" && asc(8, 12) === "WAVE") return { ok: true, type: "wav", mime: "audio/wav" };
    return { ok: false, error: "Bu dosya geçerli bir WAV değil (başlık okunamadı)." };
  }
  // MP3: ID3 etiketiyle başlar veya ilk bölgede bir MPEG çerçeve işareti (0xFF 0xEx) bulunur
  if (bas.length >= 3 && asc(0, 3) === "ID3") return { ok: true, type: "mp3", mime: "audio/mpeg" };
  const sinir = Math.min(bas.length - 1, 4096);
  for (let i = 0; i < sinir; i++) {
    if (bas[i] === 0xff && (bas[i + 1] & 0xe0) === 0xe0 && (bas[i + 1] & 0x18) !== 0x08 && (bas[i + 1] & 0x06) !== 0x00) {
      return { ok: true, type: "mp3", mime: "audio/mpeg" };
    }
  }
  return { ok: false, error: "Bu dosya geçerli bir MP3 değil (başlık okunamadı)." };
}

/**
 * Veritabanından gelen değeri güvenli hâle getirir: yalnızca bilinen 4 paket ve https adresleri kabul edilir.
 * Bozuk / eksik / beklenmeyen veri sessizce yok sayılır (sayfa hiçbir zaman bozulmaz).
 */
export function sesleriTemizle(value: unknown): SesHaritasi {
  const out: SesHaritasi = {};
  if (!value || typeof value !== "object" || Array.isArray(value)) return out;
  for (const [id, raw] of Object.entries(value as Record<string, unknown>)) {
    if (!PAKET_IDLERI.has(id) || !raw || typeof raw !== "object") continue;
    const r = raw as Record<string, unknown>;
    const url = typeof r.url === "string" ? r.url.trim() : "";
    if (!/^https:\/\/\S+$/i.test(url) || url.length > 1000) continue;
    out[id as RemakePaketId] = {
      url,
      name: typeof r.name === "string" ? r.name.slice(0, 200) : "ornek-ses",
      size: Number.isFinite(Number(r.size)) ? Number(r.size) : 0,
      type: r.type === "wav" ? "wav" : "mp3",
      at: typeof r.at === "string" ? r.at : "",
    };
  }
  return out;
}

/**
 * Tek bir paketin kaydını değiştirir / kaldırır; DİĞER paketlere dokunmaz. kayit = null → o paketin sesi kaldırılır.
 * Kaydetmeden hemen önce veritabanından okunan GÜNCEL değer verilir (başka bir yöneticinin değişikliği ezilmesin).
 */
export function sesBirlestir(mevcut: unknown, id: RemakePaketId, kayit: SesKaydi | null): SesHaritasi {
  const temiz = sesleriTemizle(mevcut);
  if (kayit) temiz[id] = kayit;
  else delete temiz[id];
  return temiz;
}
