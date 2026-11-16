/**
 * lib/server/depo.ts
 * HITY7 dosya deposu katmanı (7. ve 18. aşama). TEK aktif sağlayıcı kullanılır; iki depo aynı anda yazılmaz.
 *
 *   supabase (varsayılan): mevcut Supabase Storage. Ek servis veya kart gerektirmez. Dosya başına 50 MB (ücretsiz plan).
 *   r2                    : Cloudflare R2 (S3 uyumlu). DEPO_SAGLAYICI=r2 ve R2 anahtarları tanımlıysa seçilir.
 *                           Kayıtlı her dosya hangi sağlayıcıda olduğunu kendisi taşır (provider), böylece geçiş
 *                           sırasında eski dosyalar eski depodan okunmaya devam eder.
 *
 * Depolar herkese AÇIK DEĞİLDİR. Tarayıcı dosyayı doğrudan depoya, sunucunun ürettiği tek kullanımlık imzalı adresle
 * yükler (dosya Worker'dan geçmez: büyük dosyada Worker sınırlarına takılmaz). İndirme yalnızca yetki kontrolünden
 * sonra üretilen kısa süreli imzalı bağlantıyla yapılır. Anahtarlar tarayıcıya gönderilmez.
 *
 * Ortam değişkenleri:
 *   SUPABASE_SECRET_KEY (zorunlu, Supabase depo için)
 *   DEPO_SAGLAYICI=r2, R2_ACCOUNT_ID, R2_ACCESS_KEY_ID, R2_SECRET_ACCESS_KEY (R2 için)
 */
import { SUPA_SERVICE, SUPA_URL, serviceHeaders } from "./supa";

export type Saglayici = "supabase" | "r2";
export const DEPO = { yukleme: "hity7-uploads", teslimat: "hity7-deliveries", yedek: "hity7-backups" } as const;
const MB = 1024 * 1024;

export function r2Hazir(): boolean {
  return !!(process.env.R2_ACCOUNT_ID && process.env.R2_ACCESS_KEY_ID && process.env.R2_SECRET_ACCESS_KEY);
}

/** Yeni yüklemelerin gideceği sağlayıcı */
export function aktifSaglayici(): Saglayici {
  return process.env.DEPO_SAGLAYICI === "r2" && r2Hazir() ? "r2" : "supabase";
}

/** Sağlayıcıya göre dosya başına en büyük boyut */
export function enBuyukBoyut(s: Saglayici): number {
  return s === "r2" ? 2048 * MB : 50 * MB;
}

/** Eksik yapılandırmanın ADLARI (değerler asla döndürülmez) */
export function depoEksikleri(): string[] {
  const eksik: string[] = [];
  if (!SUPA_URL) eksik.push("NEXT_PUBLIC_SUPABASE_URL");
  if (!SUPA_SERVICE) eksik.push("SUPABASE_SECRET_KEY");
  if (process.env.DEPO_SAGLAYICI === "r2") {
    for (const k of ["R2_ACCOUNT_ID", "R2_ACCESS_KEY_ID", "R2_SECRET_ACCESS_KEY"]) if (!process.env[k]) eksik.push(k);
  }
  return eksik;
}

const encPath = (key: string) => key.split("/").map((s) => encodeURIComponent(s)).join("/");

/* ------------------------------------------------------------------ */
/* Supabase Storage                                                    */
/* ------------------------------------------------------------------ */

async function sbYukleme(bucket: string, key: string) {
  const res = await fetch(`${SUPA_URL}/storage/v1/object/upload/sign/${bucket}/${encPath(key)}`, {
    method: "POST",
    headers: { ...serviceHeaders(), "content-type": "application/json" },
    body: "{}",
    cache: "no-store",
  });
  const j = (await res.json().catch(() => ({}))) as { url?: string; signedURL?: string; message?: string; error?: string };
  const signed = j.url || j.signedURL || "";
  const token = signed.includes("token=") ? new URL(signed, SUPA_URL).searchParams.get("token") : null;
  if (!res.ok || !token) throw new Error(j.message || j.error || `Yükleme adresi oluşturulamadı (${res.status}).`);
  return {
    method: "PUT" as const,
    url: `${SUPA_URL}/storage/v1/object/upload/sign/${bucket}/${encPath(key)}?token=${encodeURIComponent(token)}`,
    headers: { "x-upsert": "false" } as Record<string, string>,
  };
}

async function sbIndirme(bucket: string, key: string, ttl: number, dosyaAdi?: string) {
  const res = await fetch(`${SUPA_URL}/storage/v1/object/sign/${bucket}/${encPath(key)}`, {
    method: "POST",
    headers: { ...serviceHeaders(), "content-type": "application/json" },
    body: JSON.stringify({ expiresIn: ttl }),
    cache: "no-store",
  });
  const j = (await res.json().catch(() => ({}))) as { signedURL?: string; signedUrl?: string; message?: string };
  const s = j.signedURL || j.signedUrl;
  if (!res.ok || !s) throw new Error(j.message || `İndirme bağlantısı oluşturulamadı (${res.status}).`);
  const u = new URL(`${SUPA_URL}/storage/v1${s.startsWith("/") ? s : "/" + s}`);
  if (dosyaAdi) u.searchParams.set("download", dosyaAdi);
  return u.toString();
}

async function sbBilgi(bucket: string, key: string): Promise<{ size: number; mime: string | null } | null> {
  const res = await fetch(`${SUPA_URL}/storage/v1/object/info/${bucket}/${encPath(key)}`, { headers: serviceHeaders(), cache: "no-store" });
  if (res.ok) {
    const j = (await res.json().catch(() => ({}))) as { size?: number; content_type?: string; metadata?: { size?: number; mimetype?: string } };
    const size = Number(j.size ?? j.metadata?.size);
    if (Number.isFinite(size) && size > 0) return { size, mime: j.content_type || j.metadata?.mimetype || null };
  }
  // Eski Storage sürümleri: klasör listesinden ara
  const slash = key.lastIndexOf("/");
  const prefix = slash >= 0 ? key.slice(0, slash) : "";
  const name = key.slice(slash + 1);
  const ls = await fetch(`${SUPA_URL}/storage/v1/object/list/${bucket}`, {
    method: "POST",
    headers: { ...serviceHeaders(), "content-type": "application/json" },
    body: JSON.stringify({ prefix, search: name, limit: 10 }),
    cache: "no-store",
  });
  if (!ls.ok) return null;
  const rows = (await ls.json().catch(() => [])) as { name: string; metadata?: { size?: number; mimetype?: string } }[];
  const r = rows.find((x) => x.name === name);
  return r ? { size: Number(r.metadata?.size) || 0, mime: r.metadata?.mimetype || null } : null;
}

/* ------------------------------------------------------------------ */
/* Cloudflare R2 (S3 SigV4 ön imzalı adres)                            */
/* ------------------------------------------------------------------ */

const enc = new TextEncoder();
const hex = (b: ArrayBuffer) => Array.from(new Uint8Array(b)).map((x) => x.toString(16).padStart(2, "0")).join("");
async function hmac(key: ArrayBuffer | Uint8Array, data: string) {
  const k = await crypto.subtle.importKey("raw", key as ArrayBuffer, { name: "HMAC", hash: "SHA-256" }, false, ["sign"]);
  return crypto.subtle.sign("HMAC", k, enc.encode(data));
}
const rfc3986 = (s: string) => encodeURIComponent(s).replace(/[!'()*]/g, (c) => "%" + c.charCodeAt(0).toString(16).toUpperCase());

async function r2Imzala(method: "GET" | "PUT" | "HEAD", bucket: string, key: string, ttl: number, ek: Record<string, string> = {}) {
  const account = process.env.R2_ACCOUNT_ID!;
  const access = process.env.R2_ACCESS_KEY_ID!;
  const secret = process.env.R2_SECRET_ACCESS_KEY!;
  const host = `${account}.r2.cloudflarestorage.com`;
  const now = new Date();
  const amzDate = now.toISOString().replace(/[-:]/g, "").replace(/\.\d{3}/, "");
  const day = amzDate.slice(0, 8);
  const scope = `${day}/auto/s3/aws4_request`;
  const uri = `/${bucket}/${key.split("/").map(rfc3986).join("/")}`;
  const q: Record<string, string> = {
    "X-Amz-Algorithm": "AWS4-HMAC-SHA256",
    "X-Amz-Credential": `${access}/${scope}`,
    "X-Amz-Date": amzDate,
    "X-Amz-Expires": String(Math.min(Math.max(ttl, 1), 604800)),
    "X-Amz-SignedHeaders": "host",
    ...ek,
  };
  const qs = Object.keys(q)
    .sort()
    .map((k) => `${rfc3986(k)}=${rfc3986(q[k])}`)
    .join("&");
  const canonical = [method, uri, qs, `host:${host}\n`, "host", "UNSIGNED-PAYLOAD"].join("\n");
  const toSign = ["AWS4-HMAC-SHA256", amzDate, scope, hex(await crypto.subtle.digest("SHA-256", enc.encode(canonical)))].join("\n");
  let k = await hmac(enc.encode("AWS4" + secret), day);
  k = await hmac(k, "auto");
  k = await hmac(k, "s3");
  k = await hmac(k, "aws4_request");
  const sig = hex(await hmac(k, toSign));
  return `https://${host}${uri}?${qs}&X-Amz-Signature=${sig}`;
}

/* ------------------------------------------------------------------ */
/* Ortak arayüz                                                        */
/* ------------------------------------------------------------------ */

export type YuklemeHedefi = { provider: Saglayici; bucket: string; key: string; method: "PUT"; url: string; headers: Record<string, string> };

export async function yuklemeAdresi(bucket: string, key: string, mime: string): Promise<YuklemeHedefi> {
  const provider = aktifSaglayici();
  if (provider === "r2") {
    const url = await r2Imzala("PUT", bucket, key, 900);
    return { provider, bucket, key, method: "PUT", url, headers: mime ? { "content-type": mime } : {} };
  }
  const s = await sbYukleme(bucket, key);
  return { provider, bucket, key, ...s };
}

export async function indirmeAdresi(provider: Saglayici, bucket: string, key: string, opts: { ttl?: number; dosyaAdi?: string } = {}): Promise<string> {
  const ttl = opts.ttl ?? 300;
  if (provider === "r2") {
    return r2Imzala("GET", bucket, key, ttl, opts.dosyaAdi ? { "response-content-disposition": `attachment; filename*=UTF-8''${rfc3986(opts.dosyaAdi)}` } : {});
  }
  return sbIndirme(bucket, key, ttl, opts.dosyaAdi);
}

/** Dosya depoda gerçekten var mı ve boyutu ne? (yükleme doğrulaması) */
export async function nesneBilgisi(provider: Saglayici, bucket: string, key: string): Promise<{ size: number; mime: string | null } | null> {
  if (provider === "r2") {
    const url = await r2Imzala("HEAD", bucket, key, 60);
    const res = await fetch(url, { method: "HEAD", cache: "no-store" });
    if (!res.ok) return null;
    return { size: Number(res.headers.get("content-length")) || 0, mime: res.headers.get("content-type") };
  }
  return sbBilgi(bucket, key);
}

/* ------------------------------------------------------------------ */
/* Aktarım / yedek: Supabase → R2 kopyası (7. aşama)                    */
/* Kaynak asla silinmez. Kopya; boyut ve mümkünse ETag (MD5) eşleşince   */
/* doğrulanmış sayılır. Dosya Worker belleğine alınmadan akış olarak     */
/* aktarılır (Cloudflare'de FixedLengthStream); yerel geliştirmede       */
/* tamponlanır.                                                          */
/* ------------------------------------------------------------------ */

export type KopyaSonucu = { yontem: "boyut+etag" | "boyut"; etag: string | null; boyut: number };

const etagNorm = (e: string | null | undefined) => String(e || "").replace(/"/g, "").trim().toLowerCase();

export async function r2Kopyala(o: {
  kaynakKova: string;
  kaynakKey: string;
  boyut: number | null;
  mime: string | null;
  kaynakEtag: string | null;
  hedefKova: string;
  hedefKey: string;
}): Promise<KopyaSonucu> {
  if (!r2Hazir()) throw new Error("R2 yapılandırılmamış.");
  const kaynak = await fetch(`${SUPA_URL}/storage/v1/object/authenticated/${o.kaynakKova}/${encPath(o.kaynakKey)}`, {
    headers: serviceHeaders(),
    cache: "no-store",
  });
  if (!kaynak.ok || !kaynak.body) throw new Error(`Kaynak dosya okunamadı (${kaynak.status}).`);
  const uzunluk = Number(kaynak.headers.get("content-length")) || o.boyut || 0;
  const FLS = (globalThis as { FixedLengthStream?: new (n: number) => TransformStream<Uint8Array, Uint8Array> }).FixedLengthStream;
  let govde: BodyInit;
  if (FLS && uzunluk > 0) {
    const { readable, writable } = new FLS(uzunluk);
    void kaynak.body.pipeTo(writable).catch(() => {});
    govde = readable;
  } else {
    govde = await kaynak.arrayBuffer();
  }
  const put = await fetch(await r2Imzala("PUT", o.hedefKova, o.hedefKey, 900), {
    method: "PUT",
    body: govde,
    headers: o.mime ? { "content-type": o.mime } : {},
  });
  if (!put.ok) throw new Error(`R2'ye yazılamadı (${put.status}).`);
  const head = await fetch(await r2Imzala("HEAD", o.hedefKova, o.hedefKey, 60), { method: "HEAD", cache: "no-store" });
  if (!head.ok) throw new Error(`Kopya doğrulanamadı (${head.status}).`);
  const hedefBoyut = Number(head.headers.get("content-length"));
  const beklenen = o.boyut || uzunluk;
  if (beklenen > 0 && hedefBoyut !== beklenen) throw new Error(`Boyut uyuşmuyor (${hedefBoyut} ≠ ${beklenen}).`);
  const hedefEtag = etagNorm(head.headers.get("etag"));
  const kaynakEtag = etagNorm(o.kaynakEtag);
  // Çok parçalı yüklemelerde ETag MD5 değildir ("...-N"); o durumda yalnızca boyut karşılaştırılır
  if (kaynakEtag && hedefEtag && !kaynakEtag.includes("-") && !hedefEtag.includes("-")) {
    if (kaynakEtag !== hedefEtag) throw new Error("İçerik özeti (ETag) uyuşmuyor.");
    return { yontem: "boyut+etag", etag: hedefEtag, boyut: hedefBoyut };
  }
  return { yontem: "boyut", etag: hedefEtag || null, boyut: hedefBoyut };
}

/** "depo://<sağlayıcı>/<bucket>/<anahtar>" referansını çözer (sipariş / yayın kayıtlarında saklanır) */
export function depoRef(ref: string): { provider: Saglayici; bucket: string; key: string } | null {
  const m = /^depo:\/\/(supabase|r2)\/([a-z0-9-]+)\/(.+)$/.exec(ref || "");
  if (!m || m[3].includes("..")) return null;
  return { provider: m[1] as Saglayici, bucket: m[2], key: m[3] };
}
