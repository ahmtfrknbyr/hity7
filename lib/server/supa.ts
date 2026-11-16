/**
 * lib/server/supa.ts
 * API route'larının ortak Supabase yardımcıları. YALNIZCA sunucuda (app/api/**) kullanılır;
 * gizli anahtar (service role / secret key) asla tarayıcıya gönderilmez.
 *
 * Ortam değişkenleri (eski ve yeni Supabase anahtar adlarının ikisi de desteklenir):
 *   NEXT_PUBLIC_SUPABASE_URL
 *   NEXT_PUBLIC_SUPABASE_PUBLISHABLE_KEY  veya  NEXT_PUBLIC_SUPABASE_ANON_KEY
 *   SUPABASE_SECRET_KEY                    veya  SUPABASE_SERVICE_ROLE_KEY   (yalnızca sunucu)
 */

export const SUPA_URL = process.env.NEXT_PUBLIC_SUPABASE_URL || "";
export const SUPA_ANON = process.env.NEXT_PUBLIC_SUPABASE_ANON_KEY || process.env.NEXT_PUBLIC_SUPABASE_PUBLISHABLE_KEY || "";
export const SUPA_SERVICE = process.env.SUPABASE_SERVICE_ROLE_KEY || process.env.SUPABASE_SECRET_KEY || "";

/** Önizleme ortamında veritabanı adresi ".invalid" yer tutucusudur: hiç istek atılmaz (Cloudflare'de askıda kalmasın). */
const dbYok = () => SUPA_URL.includes(".invalid");

/** Sunucu tarafı işlemler için gerekli anahtarlar tanımlı mı? */
export const serverReady = () => !!(SUPA_URL && SUPA_ANON && SUPA_SERVICE);

export const fail = (error: string, status = 400, extra: Record<string, unknown> = {}) =>
  Response.json({ error, ...extra }, { status });

/** Kontrol karakterlerini atar, kırpar ve uzunluğu sınırlar. */
export const clean = (v: unknown, max: number) =>
  String(v ?? "").replace(/[\u0000-\u0008\u000b-\u001f\u007f]/g, " ").trim().slice(0, max);

/** Eski (JWT) anahtarlar Authorization başlığında da gönderilir; yeni sb_ anahtarlar yalnızca apikey başlığında. */
function keyHeaders(key: string): Record<string, string> {
  return key.startsWith("eyJ") ? { apikey: key, Authorization: `Bearer ${key}` } : { apikey: key };
}

/** Gizli anahtar başlıkları (Storage gibi diğer Supabase servisleri için). */
export const serviceHeaders = () => keyHeaders(SUPA_SERVICE);

export type DbResult<T = unknown> = { ok: boolean; status: number; body: T; text: string };

/** Gizli anahtarla PostgREST çağrısı (RLS'i atlar, yalnızca sunucuda). */
export async function db<T = unknown>(path: string, init: RequestInit & { prefer?: string } = {}): Promise<DbResult<T>> {
  const { prefer, headers, ...rest } = init;
  if (dbYok()) return { ok: false, status: 503, body: null as T, text: "" };
  const res = await fetch(`${SUPA_URL}/rest/v1/${path}`, {
    ...rest,
    headers: {
      ...keyHeaders(SUPA_SERVICE),
      "content-type": "application/json",
      ...(prefer ? { Prefer: prefer } : {}),
      ...(headers as Record<string, string> | undefined),
    },
    cache: "no-store",
  });
  const text = await res.text();
  let body: unknown = null;
  try {
    body = text ? JSON.parse(text) : null;
  } catch {
    body = text;
  }
  return { ok: res.ok, status: res.status, body: body as T, text };
}

/** Gizli anahtarla veritabanı fonksiyonu (RPC) çağırır. */
export function rpc<T = unknown>(fn: string, args: Record<string, unknown>) {
  return db<T>(`rpc/${fn}`, { method: "POST", body: JSON.stringify(args) });
}

/** Herkese açık anahtarla PostgREST çağrısı (RLS geçerli). */
export async function anonDb(path: string, init: RequestInit = {}) {
  if (dbYok()) return new Response(null, { status: 503 });
  const res = await fetch(`${SUPA_URL}/rest/v1/${path}`, {
    ...init,
    headers: { ...keyHeaders(SUPA_ANON), "content-type": "application/json", ...(init.headers as Record<string, string> | undefined) },
    cache: "no-store",
  });
  return res;
}

export type AuthUser = { id: string; email: string; name: string; verified: boolean };

/** İstekteki "Authorization: Bearer <oturum>" başlığından kullanıcıyı doğrular. */
export async function getUser(req: Request): Promise<AuthUser | null> {
  const auth = req.headers.get("authorization") || "";
  if (!auth.toLowerCase().startsWith("bearer ") || !SUPA_URL || !SUPA_ANON || dbYok()) return null;
  try {
    const res = await fetch(`${SUPA_URL}/auth/v1/user`, { headers: { apikey: SUPA_ANON, Authorization: auth }, cache: "no-store" });
    if (!res.ok) return null;
    const u = await res.json();
    if (!u?.id) return null;
    const meta = (u.user_metadata || {}) as Record<string, unknown>;
    // E-posta doğrulanmış mı? (Supabase "Confirm email" kapalıysa kayıt anında otomatik doğrulanmış sayılır.)
    return {
      id: String(u.id),
      email: String(u.email || ""),
      name: String(meta.full_name || meta.name || ""),
      verified: !!(u.email_confirmed_at || u.confirmed_at),
    };
  } catch {
    return null;
  }
}

/** Doğrulanmamış e-postayla sipariş / ödeme / dosya işlemi yapılamaz. */
export const DOGRULAMA_HATASI =
  "E-posta adresini doğrulaman gerekiyor. Gelen kutundaki (ve spam klasöründeki) doğrulama bağlantısına tıkla, sonra tekrar dene.";
export const dogrulamaGerekli = () => fail(DOGRULAMA_HATASI, 403, { needVerify: true });

export type Role = "ceo" | "admin" | "mod" | "amele" | "member";
export const ROLE_RANK: Record<Role, number> = { ceo: 100, admin: 80, mod: 50, amele: 30, member: 0 };

export type Staff = AuthUser & { role: Role };

/**
 * Okuma yardımcısı: gizli anahtar varsa onunla, yoksa kullanıcının kendi oturumuyla (RLS geçerli) okur.
 * Böylece yetki kontrolleri gizli anahtar tanımlanmamışken de doğru çalışır.
 */
async function readAs<T>(path: string, userAuth?: string): Promise<T | null> {
  if (SUPA_SERVICE) {
    const r = await db<T>(path);
    return r.ok ? r.body : null;
  }
  if (!userAuth || dbYok()) return null;
  const res = await fetch(`${SUPA_URL}/rest/v1/${path}`, { headers: { apikey: SUPA_ANON, Authorization: userAuth }, cache: "no-store" });
  return res.ok ? ((await res.json()) as T) : null;
}

/** Kullanıcının rolünü veritabanından okur. Engelli ise null. */
export async function getRole(userId: string, userAuth?: string): Promise<Role | null> {
  const rows = await readAs<{ role: string; banned: boolean }[]>(`profiles?id=eq.${encodeURIComponent(userId)}&select=role,banned`, userAuth);
  const p = Array.isArray(rows) ? rows[0] : null;
  if (!p || p.banned) return null;
  const role = String(p.role) as Role;
  return role in ROLE_RANK ? role : "member";
}

/**
 * Rol bu panel bölümüne erişebilir mi? CEO ve admin her şeye erişir. Moderatör / personel için CEO'nun o kişiye özel
 * tanımladığı yetki listesi (user_permission_sets) varsa yalnızca o liste, yoksa rol varsayılanları (role_permissions).
 * Veritabanındaki h7_yetki ile aynı kural.
 */
export async function roleCan(role: Role, tab: string, userAuth?: string, userId?: string): Promise<boolean> {
  if (role === "ceo" || role === "admin") return true;
  if (role !== "mod" && role !== "amele") return false;
  if (userId) {
    const own = await readAs<{ tabs: string[] }[]>(`user_permission_sets?user_id=eq.${encodeURIComponent(userId)}&select=tabs`, userAuth);
    if (Array.isArray(own) && own.length) return Array.isArray(own[0].tabs) && own[0].tabs.includes(tab);
  }
  const rows = await readAs<unknown[]>(`role_permissions?role=eq.${role}&tab=eq.${encodeURIComponent(tab)}&select=tab`, userAuth);
  return Array.isArray(rows) && rows.length > 0;
}

/** Oturumu ve yetkiyi birlikte doğrular. tab verilmezse herhangi bir yönetici rolü yeterlidir. */
export async function getStaff(req: Request, tab?: string): Promise<Staff | null> {
  const user = await getUser(req);
  if (!user) return null;
  const auth = req.headers.get("authorization") || undefined;
  const role = await getRole(user.id, auth);
  if (!role || role === "member") return null;
  if (tab && !(await roleCan(role, tab, auth, user.id))) return null;
  return { ...user, role };
}

/** Güvenlik / işlem kaydı (audit_log). Hata olursa ana işlemi bozmaz. */
export async function audit(actor: string | null, action: string, target: string, details: Record<string, unknown> = {}) {
  try {
    await db("audit_log", {
      method: "POST",
      prefer: "return=minimal",
      body: JSON.stringify({ actor_id: actor, action: action.slice(0, 80), target: target.slice(0, 200), details }),
    });
  } catch {
    /* kayıt hatası işlemi durdurmaz */
  }
}

/** İç ağa istek atılmasını engeller (SSRF). Yalnızca https ve genel adresler. */
export function safeUrl(raw: string): URL | null {
  try {
    const u = new URL(raw);
    if (u.protocol !== "https:") return null;
    const h = u.hostname.toLowerCase();
    if (h === "localhost" || h.endsWith(".local") || h.endsWith(".internal")) return null;
    if (/^(127\.|10\.|0\.|169\.254\.|192\.168\.|172\.(1[6-9]|2\d|3[01])\.)/.test(h)) return null;
    if (h.includes(":")) return null;
    return u;
  } catch {
    return null;
  }
}
