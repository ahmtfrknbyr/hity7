/**
 * lib/siparis.ts
 * Site formlarının ortak yardımcıları: dosya yükleme + sipariş gönderme.
 * Fiyat ve bakiye DAİMA sunucuda hesaplanır; buradaki hiçbir değer güvenilir kabul edilmez.
 */
import { getSupabase } from "./supabase";

export type UploadedFile = { name: string; url: string; kind?: string };

async function token(): Promise<string | undefined> {
  try {
    const sb = getSupabase();
    return (await sb.auth.getSession()).data.session?.access_token;
  } catch {
    return undefined;
  }
}

/**
 * Dosyaları kullanıcının kendi klasörüne yükler (giriş zorunlu).
 * Tür ve boyut sunucuda da kontrol edilir. onProgress: (yüklenen, toplam) dosya sayısı.
 */
export async function uploadOrderFiles(
  files: File[],
  opts: { kind?: string; onProgress?: (done: number, total: number) => void } = {}
): Promise<UploadedFile[]> {
  const sb = getSupabase();
  const t = await token();
  if (!t) throw new Error("Dosya yüklemek için giriş yapmalısın.");
  const out: UploadedFile[] = [];
  let done = 0;
  for (const f of files) {
    opts.onProgress?.(done, files.length);
    if (f.size > 50 * 1024 * 1024) throw new Error(`“${f.name}” 50 MB’tan büyük. Daha küçük bir dosya veya ZIP yükle.`);
    const res = await fetch("/api/yukle", {
      method: "POST",
      headers: { "content-type": "application/json", Authorization: `Bearer ${t}` },
      body: JSON.stringify({ name: f.name, size: f.size }),
    });
    const j = await res.json().catch(() => ({}));
    if (!res.ok) throw new Error(j.error || `“${f.name}” yüklenemedi.`);
    const up = await sb.storage.from("site-media").uploadToSignedUrl(j.path, j.token, f, { contentType: f.type || undefined });
    if (up.error) throw new Error(`“${f.name}” yüklenemedi: ${up.error.message}`);
    out.push({ name: f.name, url: j.publicUrl, ...(opts.kind ? { kind: opts.kind } : {}) });
    done += 1;
  }
  opts.onProgress?.(done, files.length);
  return out;
}

/** Rastgele istek kimliği (tarayıcı destekliyorsa UUID). */
export function yeniIstekId(): string {
  try {
    if (typeof crypto !== "undefined" && typeof crypto.randomUUID === "function") return crypto.randomUUID();
  } catch {
    /* güvenli olmayan bağlam */
  }
  return `${Date.now().toString(36)}-${Math.random().toString(36).slice(2, 12)}`;
}

/**
 * Tekrar koruması (idempotency) için sipariş denemesi kimliği.
 * Form içeriği (imza) aynı kaldıkça AYNI kimliği döndürür: bağlantı kopup sipariş yeniden gönderilirse sunucu
 * ikinci siparişi oluşturmaz, bakiye ikinci kez düşmez. İçerik değişince yeni kimlik üretilir.
 * Sipariş başarılı olunca sayfa ref.current = null yapar; aynı içerikle verilen yeni sipariş yeni bir sipariştir.
 */
export function istekKimligi(ref: { current: { key: string; sig: string } | null }, sig: string): string {
  if (!ref.current || ref.current.sig !== sig) ref.current = { key: yeniIstekId(), sig };
  return ref.current.key;
}

export type OrderInput = {
  type: "influencer" | "yayin" | "mix" | "remake" | "smm";
  /** Sözleşme onay kutusu (components/SozlesmeOnay). Sunucu işaretlenmemiş siparişi kabul etmez. */
  accept: boolean;
  /** Tekrar koruması: aynı sipariş denemesinin her gönderiminde aynı kalır (bkz. istekKimligi). */
  istekId?: string;
  name?: string;
  contact?: string;
  details: [string, string][];
  files?: UploadedFile[];
  [key: string]: unknown;
};

/** repeat: bu istek daha önce işlenmişti; yeni sipariş oluşmadı, bakiye ikinci kez düşmedi (code = ilk siparişin kodu). */
export type OrderResult = { ok: boolean; code?: string; amount?: number; balance?: number; status?: string; error?: string; repeat?: boolean };

/** Siparişi kaydeder. Başarılıysa sipariş kodunu döndürür. */
export async function sendOrder(input: OrderInput): Promise<OrderResult> {
  try {
    const t = await token();
    const res = await fetch("/api/siparis", {
      method: "POST",
      headers: { "content-type": "application/json", ...(t ? { Authorization: `Bearer ${t}` } : {}) },
      body: JSON.stringify(input),
    });
    const j = await res.json().catch(() => ({}));
    if (res.status === 401) {
      setTimeout(() => { window.location.href = "/giris?next=" + encodeURIComponent(window.location.pathname); }, 1800);
      return { ok: false, error: "Sipariş vermek için giriş yapmalısın. Giriş sayfasına yönlendiriliyorsun…" };
    }
    if (res.status === 402) {
      const fmt = (n: number) => Number(n || 0).toLocaleString("tr-TR", { minimumFractionDigits: 2, maximumFractionDigits: 2 });
      setTimeout(() => { window.location.href = "/bakiye?tutar=" + Math.ceil(Number(j.missing) || 0); }, 2500);
      return { ok: false, error: `Bakiyen yetersiz. Sipariş tutarı ${fmt(j.amount)} TL, bakiyen ${fmt(j.balance)} TL. Bakiye yüklemek için yönlendiriliyorsun…` };
    }
    if (!res.ok) return { ok: false, error: j.error || "Sipariş gönderilemedi." };
    try { window.dispatchEvent(new Event("hity7:bakiye")); } catch {}
    return { ok: true, code: j.code, amount: j.amount, balance: j.balance, status: j.status, repeat: !!j.repeat };
  } catch {
    return { ok: false, error: "Bağlantı hatası. Tekrar deneyebilirsin; aynı sipariş ikinci kez ücretlendirilmez." };
  }
}

/** Para biçimi: 1.234,50 TL */
export const tlFmt = (n: number) =>
  Number(n || 0).toLocaleString("tr-TR", { minimumFractionDigits: 2, maximumFractionDigits: 2 }) + " TL";
