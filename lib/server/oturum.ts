/**
 * lib/server/oturum.ts
 * Sunucunun sayfa isteğinde kullanıcının rolünü bilebilmesi için imzalı oturum çerezi (h7_oturum).
 * - Supabase oturumu tarayıcıda (localStorage) tutulduğu için sunucu sayfa isteğinde kimliği göremez.
 *   Giriş yapan tarayıcı /api/oturum'a erişim anahtarını gönderir; sunucu kimliği ve rolü VERİTABANINDAN doğrular
 *   ve bu çerezi yazar (HttpOnly: JavaScript okuyamaz, Secure, SameSite=Lax, 12 saat).
 * - Çerez yalnızca sayfa görünürlüğü / bakım modu kararlarında kullanılır. Para, sipariş ve yönetim işlemleri
 *   her zaman ayrıca veritabanındaki rolle doğrulanır (çerez tek başına hiçbir yetki vermez).
 * - İmza anahtarı: HITY7_OTURUM_ANAHTARI (varsa), yoksa sunucu gizli anahtarından türetilir. Web Crypto kullanır
 *   (Cloudflare Workers ve Node.js'te aynı çalışır).
 */

export const OTURUM_CEREZI = "h7_oturum";
export const OTURUM_SURESI_SN = 12 * 60 * 60;

export type OturumBilgisi = { u: string; r: string; e: number };

const enc = new TextEncoder();

function anahtarKaynagi(): string {
  return process.env.HITY7_OTURUM_ANAHTARI || process.env.SUPABASE_SECRET_KEY || process.env.SUPABASE_SERVICE_ROLE_KEY || "";
}

function b64url(bytes: Uint8Array): string {
  let s = "";
  for (const b of bytes) s += String.fromCharCode(b);
  return btoa(s).replace(/\+/g, "-").replace(/\//g, "_").replace(/=+$/, "");
}

function b64urlDecode(s: string): Uint8Array<ArrayBuffer> {
  const pad = s.replace(/-/g, "+").replace(/_/g, "/") + "===".slice((s.length + 3) % 4);
  const bin = atob(pad);
  const out = new Uint8Array(new ArrayBuffer(bin.length));
  for (let i = 0; i < bin.length; i++) out[i] = bin.charCodeAt(i);
  return out;
}

async function hmacKey(): Promise<CryptoKey | null> {
  const src = anahtarKaynagi();
  if (!src) return null;
  // Gizli anahtar doğrudan kullanılmaz: amaca özel bir alt anahtar türetilir
  const digest = await crypto.subtle.digest("SHA-256", enc.encode("hity7:oturum-cerezi:v1:" + src));
  return crypto.subtle.importKey("raw", digest, { name: "HMAC", hash: "SHA-256" }, false, ["sign", "verify"]);
}

/** İmzalama mümkün mü? (anahtar tanımlı değilse çerez yazılamaz; site herkesi ziyaretçi sayar) */
export const oturumImzalanabilir = () => !!anahtarKaynagi();

export async function oturumImzala(bilgi: OturumBilgisi): Promise<string | null> {
  const key = await hmacKey();
  if (!key) return null;
  const govde = b64url(enc.encode(JSON.stringify(bilgi)));
  const imza = new Uint8Array(await crypto.subtle.sign("HMAC", key, enc.encode(govde)));
  return `${govde}.${b64url(imza)}`;
}

/** Çerezi doğrular; geçerli ve süresi dolmamışsa içeriği döndürür. */
export async function oturumCoz(deger: string | undefined | null): Promise<OturumBilgisi | null> {
  if (!deger || deger.length > 600) return null;
  const [govde, imza] = deger.split(".");
  if (!govde || !imza) return null;
  const key = await hmacKey();
  if (!key) return null;
  let gecerli = false;
  try {
    gecerli = await crypto.subtle.verify("HMAC", key, b64urlDecode(imza), enc.encode(govde));
  } catch {
    return null;
  }
  if (!gecerli) return null;
  try {
    const b = JSON.parse(new TextDecoder().decode(b64urlDecode(govde))) as OturumBilgisi;
    if (!b || typeof b.u !== "string" || typeof b.r !== "string" || typeof b.e !== "number") return null;
    if (b.e * 1000 < Date.now()) return null;
    return b;
  } catch {
    return null;
  }
}

export function cerezBasligi(deger: string, maxAge: number, secure: boolean): string {
  return [`${OTURUM_CEREZI}=${deger}`, "Path=/", `Max-Age=${maxAge}`, "HttpOnly", "SameSite=Lax", secure ? "Secure" : ""]
    .filter(Boolean)
    .join("; ");
}
