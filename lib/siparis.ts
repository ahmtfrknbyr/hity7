/**
 * lib/siparis.ts
 * Site formlarının ortak yardımcıları: dosya yükleme + sipariş gönderme (sepet yok; her hizmet doğrudan sipariş).
 * Fiyat ve bakiye DAİMA sunucuda hesaplanır; buradaki hiçbir değer güvenilir kabul edilmez.
 */
import { getSupabase } from "./supabase";

export type UploadedFile = {
  name: string;
  /** Eski (herkese açık) dosyalarda adres; yeni özel depo dosyalarında boş */
  url: string;
  kind?: string;
  /** Özel depodaki dosyanın anahtarı (yeni yüklemeler) */
  key?: string;
  provider?: "supabase" | "r2";
  bucket?: string;
  size?: number;
};

async function token(): Promise<string | undefined> {
  try {
    const sb = getSupabase();
    return (await sb.auth.getSession()).data.session?.access_token;
  } catch {
    return undefined;
  }
}

type Hedef = { provider: "supabase" | "r2"; bucket: string; key: string; method: "PUT"; url: string; headers: Record<string, string> };

/** Dosyayı imzalı adrese yükler; gerçek bayt ilerlemesini bildirir. */
function putFile(h: Hedef, f: File, onBytes?: (loaded: number, total: number) => void): Promise<void> {
  return new Promise((resolve, reject) => {
    const xhr = new XMLHttpRequest();
    xhr.open("PUT", h.url);
    for (const [k, v] of Object.entries(h.headers || {})) xhr.setRequestHeader(k, v);
    if (h.provider === "supabase") {
      const anon = process.env.NEXT_PUBLIC_SUPABASE_PUBLISHABLE_KEY || process.env.NEXT_PUBLIC_SUPABASE_ANON_KEY || "";
      if (anon) xhr.setRequestHeader("apikey", anon);
    }
    if (f.type && !(h.headers || {})["content-type"]) xhr.setRequestHeader("content-type", f.type);
    xhr.upload.onprogress = (e) => {
      if (e.lengthComputable) onBytes?.(e.loaded, e.total);
    };
    xhr.onload = () => (xhr.status >= 200 && xhr.status < 300 ? resolve() : reject(new Error(`yükleme reddedildi (${xhr.status})`)));
    xhr.onerror = () => reject(new Error("bağlantı koptu"));
    xhr.ontimeout = () => reject(new Error("zaman aşımı"));
    xhr.send(f);
  });
}

/** Sayfa adresinden hizmeti çıkarır (yükleme kuralları hizmete göre değişir) */
function sayfaHizmeti(): string {
  if (typeof window === "undefined") return "genel";
  const p = window.location.pathname;
  if (p.startsWith("/remake-beat")) return "remake";
  if (p.startsWith("/mix-mastering")) return "mix";
  if (p.startsWith("/dijital-yayin")) return "yayin";
  return "genel";
}

/**
 * Dosyaları kullanıcının kendi özel klasörüne yükler (giriş zorunlu). Tür, MIME ve boyut sunucuda denetlenir;
 * yükleme sonrası dosyanın depoda gerçekten var olduğu ve boyutunun doğru olduğu sunucuda doğrulanır.
 * onProgress: (yüklenen dosya, toplam dosya) · onBytes: (yüklenen bayt, toplam bayt) — tüm dosyalar için
 */
export async function uploadOrderFiles(
  files: File[],
  opts: {
    kind?: string;
    hizmet?: string;
    amac?: "siparis" | "destek" | "teslim";
    siparisId?: number;
    onProgress?: (done: number, total: number) => void;
    onBytes?: (loaded: number, total: number) => void;
  } = {}
): Promise<UploadedFile[]> {
  const t = await token();
  if (!t) throw new Error("Dosya yüklemek için giriş yapmalısın.");
  const out: UploadedFile[] = [];
  const toplamBayt = files.reduce((s, f) => s + f.size, 0);
  let bitenBayt = 0;
  let done = 0;
  for (const f of files) {
    opts.onProgress?.(done, files.length);
    const res = await fetch("/api/yukle", {
      method: "POST",
      headers: { "content-type": "application/json", Authorization: `Bearer ${t}` },
      body: JSON.stringify({ action: "adres", amac: opts.amac || "siparis", hizmet: opts.hizmet || sayfaHizmeti(), siparisId: opts.siparisId, name: f.name, size: f.size, mime: f.type }),
    });
    const j = await res.json().catch(() => ({}));
    if (!res.ok) throw new Error(j.error || `“${f.name}” yüklenemedi.`);
    const hedef = j as Hedef;
    try {
      await putFile(hedef, f, (l) => opts.onBytes?.(bitenBayt + l, toplamBayt));
    } catch (e) {
      throw new Error(`“${f.name}” yüklenemedi: ${e instanceof Error ? e.message : "bilinmeyen hata"}. Tekrar deneyebilirsin.`);
    }
    // Doğrulama: dosya depoda var mı, boyutu doğru mu?
    const v = await fetch("/api/yukle", {
      method: "POST",
      headers: { "content-type": "application/json", Authorization: `Bearer ${t}` },
      body: JSON.stringify({ action: "dogrula", provider: hedef.provider, bucket: hedef.bucket, key: hedef.key, size: f.size }),
    });
    const vj = await v.json().catch(() => ({}));
    if (!v.ok) throw new Error(vj.error || `“${f.name}” doğrulanamadı. Tekrar yükle.`);
    bitenBayt += f.size;
    out.push({ name: f.name, url: "", key: hedef.key, provider: hedef.provider, bucket: hedef.bucket, size: f.size, ...(opts.kind ? { kind: opts.kind } : {}) });
    done += 1;
    opts.onBytes?.(bitenBayt, toplamBayt);
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
  type: "influencer" | "paket" | "yayin" | "mix" | "remake" | "smm";
  /** Sözleşme onay kutusu (components/SozlesmeOnay). Sunucu işaretlenmemiş siparişi kabul etmez. */
  accept: boolean;
  /** Tekrar koruması: aynı sipariş denemesinin her gönderiminde aynı kalır (bkz. istekKimligi). */
  istekId?: string;
  /** Müşterinin onay ekranında gördüğü ödenecek tutar. Sunucu hesabı farklıysa sipariş oluşmaz (fiyat değişti). */
  beklenenTutar?: number;
  /** false: yetersiz bakiyede otomatik Cüzdanım yönlendirmesi yapılmaz (sayfa kendi düğmesini gösterir) */
  yonlendir?: boolean;
  name?: string;
  contact?: string;
  details: [string, string][];
  files?: UploadedFile[];
  [key: string]: unknown;
};

/** repeat: bu istek daha önce işlenmişti; yeni sipariş oluşmadı, bakiye ikinci kez düşmedi (code = ilk siparişin kodu). */
export type OrderResult = {
  ok: boolean;
  code?: string;
  amount?: number;
  balance?: number;
  status?: string;
  error?: string;
  repeat?: boolean;
  /** Yetersiz bakiye: eksik tutar (TL) */
  needTopup?: boolean;
  missing?: number;
  /** Fiyat değişti (ör. kampanya bitti): sunucunun güncel hesabı */
  fiyatDegisti?: boolean;
  guncel?: { toplam?: number; final?: number; normal?: number; oran?: number; brut?: number; indirim?: number } | null;
};

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
      // Kendi "Bakiye Yükle" düğmesini göstermeyen sayfalar Cüzdanım'a yönlendirilir
      if (input.yonlendir !== false) {
        setTimeout(() => { window.location.href = bakiyeYukleAdresi(Number(j.missing) || 0); }, 3500);
      }
      return {
        ok: false,
        needTopup: true,
        missing: Number(j.missing) || 0,
        balance: Number(j.balance) || 0,
        amount: Number(j.amount) || 0,
        error: `Yetersiz Bakiye — sipariş tutarı ${fmt(j.amount)} TL, bakiyen ${fmt(j.balance)} TL. Siparişin oluşturulmadı ve bakiyenden hiçbir şey düşülmedi.`,
      };
    }
    if (res.status === 409 && j.fiyatDegisti) {
      return { ok: false, fiyatDegisti: true, guncel: j.guncel || null, error: j.error || "Fiyat değişti. Güncel tutarı kontrol edip yeniden onayla." };
    }
    if (!res.ok) return { ok: false, error: j.error || "Sipariş gönderilemedi." };
    try { window.dispatchEvent(new Event("hity7:bakiye")); } catch {}
    return { ok: true, code: j.code, amount: j.amount, balance: j.balance, status: j.status, repeat: !!j.repeat };
  } catch {
    return { ok: false, error: "Bağlantı hatası. Tekrar deneyebilirsin; aynı sipariş ikinci kez ücretlendirilmez." };
  }
}

/** Bakiye yükleme sayfası (eksik tutarla) */
export const bakiyeYukleAdresi = (eksik?: number) => (eksik && eksik > 0 ? `/bakiye?tutar=${Math.ceil(eksik)}` : "/bakiye");

/** Para biçimi: 1.234,50 TL */
export const tlFmt = (n: number) =>
  Number(n || 0).toLocaleString("tr-TR", { minimumFractionDigits: 2, maximumFractionDigits: 2 }) + " TL";
