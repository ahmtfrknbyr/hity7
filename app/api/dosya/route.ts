/**
 * app/api/dosya/route.ts
 * Özel depodaki bir dosya için KISA SÜRELİ imzalı indirme bağlantısı (varsayılan 5 dakika).
 * Bağlantı yalnızca yetki kontrolünden sonra üretilir; depolar herkese açık değildir ve anahtarlar tarayıcıya gitmez.
 *
 * POST { tur: "siparis", siparisId, key }        → siparişin sahibi veya "orders" yetkili personel
 * POST { tur: "yayin",   yayinId,   ref }        → yayının sahibi veya "releases" yetkili personel
 * POST { tur: "teslim",  kod?, teslimatId?, dosyaId } → teslimatın sahibi (bağlantı açıksa) veya "deliveries"/"orders" yetkili personel
 *                                                   Her indirme teslimat geçmişine yazılır.
 * POST { tur: "destek",  mesajId, key }          → talebin sahibi veya "support" yetkili personel
 */
import { audit, clean, db, fail, getRole, getUser, roleCan, serverReady, type Role } from "../../../lib/server/supa";
import { DEPO, depoRef, indirmeAdresi, type Saglayici } from "../../../lib/server/depo";

type Dosya = { name?: string; key?: string; depo?: string; provider?: string; url?: string };

async function personel(req: Request, userId: string, tablar: string[]): Promise<Role | null> {
  const auth = req.headers.get("authorization") || undefined;
  const rol = await getRole(userId, auth);
  if (!rol || rol === "member") return null;
  for (const t of tablar) if (await roleCan(rol, t, auth, userId)) return rol;
  return null;
}

const bagla = async (provider: Saglayici, bucket: string, key: string, ad: string) =>
  Response.json({ ok: true, url: await indirmeAdresi(provider, bucket, key, { ttl: 300, dosyaAdi: ad }), sure: 300 });

export async function POST(req: Request) {
  if (!serverReady()) return fail("Dosya sistemi henüz kurulmamış (eksik sunucu ayarı: SUPABASE_SECRET_KEY).", 503);
  const user = await getUser(req);
  if (!user) return fail("Dosyaya erişmek için giriş yapmalısın.", 401, { needLogin: true });
  let b: Record<string, unknown> = {};
  try {
    b = await req.json();
  } catch {
    return fail("Geçersiz istek.");
  }
  const tur = clean(b.tur, 20);

  try {
    /* ---------- Sipariş dosyası (müşterinin yüklediği) ---------- */
    if (tur === "siparis") {
      const siparisId = Number(b.siparisId);
      const key = clean(b.key, 400);
      if (!Number.isInteger(siparisId) || !key) return fail("Dosya bilgisi geçersiz.");
      const r = await db<{ user_id: string; code: string; payload: { files?: Dosya[] } }[]>(`orders?id=eq.${siparisId}&select=user_id,code,payload`);
      const o = Array.isArray(r.body) ? r.body[0] : undefined;
      if (!o) return fail("Sipariş bulunamadı.", 404);
      const f = (o.payload?.files || []).find((x) => x.key === key);
      if (!f) return fail("Dosya bu siparişe ait değil.", 404);
      if (o.user_id !== user.id && !(await personel(req, user.id, ["orders"]))) return fail("Bu dosyaya erişimin yok.", 403);
      return await bagla(f.provider === "r2" ? "r2" : "supabase", f.depo || DEPO.yukleme, key, f.name || "dosya");
    }

    /* ---------- Dijital yayın dosyası (kapak / master) ---------- */
    if (tur === "yayin") {
      const yayinId = clean(b.yayinId, 40);
      const ref = clean(b.ref, 500);
      const d = depoRef(ref);
      if (!yayinId || !d) return fail("Dosya bilgisi geçersiz.");
      const r = await db<{ user_id: string; cover_url: string | null; release_tracks: { audio_url: string | null; audio_name: string | null }[] }[]>(
        `releases?id=eq.${encodeURIComponent(yayinId)}&select=user_id,cover_url,release_tracks(audio_url,audio_name)`
      );
      const rel = Array.isArray(r.body) ? r.body[0] : undefined;
      if (!rel) return fail("Yayın bulunamadı.", 404);
      const ait = rel.cover_url === ref || (rel.release_tracks || []).some((t) => t.audio_url === ref);
      if (!ait) return fail("Dosya bu yayına ait değil.", 404);
      if (rel.user_id !== user.id && !(await personel(req, user.id, ["releases"]))) return fail("Bu dosyaya erişimin yok.", 403);
      const ad = (rel.release_tracks || []).find((t) => t.audio_url === ref)?.audio_name || d.key.split("/").pop() || "dosya";
      return await bagla(d.provider, d.bucket, d.key, ad);
    }

    /* ---------- Teslimat dosyası ---------- */
    if (tur === "teslim") {
      const dosyaId = clean(b.dosyaId, 40);
      if (!/^[0-9a-f-]{36}$/i.test(dosyaId)) return fail("Dosya bilgisi geçersiz.");
      const r = await db<{ id: string; version: number; name: string; storage_provider: Saglayici; storage_bucket: string; storage_key: string; deliveries: { id: string; code: string; user_id: string; access_enabled: boolean; published_version: number } }[]>(
        `delivery_files?id=eq.${dosyaId}&select=id,version,name,storage_provider,storage_bucket,storage_key,deliveries(id,code,user_id,access_enabled,published_version)`
      );
      const f = Array.isArray(r.body) ? r.body[0] : undefined;
      if (!f?.deliveries) return fail("Dosya bulunamadı.", 404);
      const d = f.deliveries;
      const kod = clean(b.kod, 40);
      // Müşteri yalnızca yayınlanmış sürümlerin dosyalarını indirebilir
      const sahip = d.user_id === user.id && d.access_enabled && f.version <= (d.published_version || 0) && (!kod || kod === d.code);
      const yetkili = !sahip && (await personel(req, user.id, ["deliveries", "orders"]));
      if (!sahip && !yetkili) {
        await db("delivery_events", { method: "POST", prefer: "return=minimal", body: JSON.stringify({ delivery_id: d.id, kind: "erisim_reddi", file_id: f.id, actor_id: user.id }) });
        return fail("Bu teslimata erişimin yok veya bağlantı kapatılmış.", 403);
      }
      await db("delivery_events", { method: "POST", prefer: "return=minimal", body: JSON.stringify({ delivery_id: d.id, kind: "indirme", file_id: f.id, actor_id: user.id }) });
      return await bagla(f.storage_provider, f.storage_bucket, f.storage_key, f.name);
    }

    /* ---------- Destek mesajı eki ---------- */
    if (tur === "destek") {
      const mesajId = clean(b.mesajId, 40);
      const key = clean(b.key, 400);
      // Destek ekleri yalnızca destek klasöründen verilir (başka bir depoya / klasöre işaret eden kayıt reddedilir)
      if (!/^[0-9a-f-]{36}$/i.test(mesajId) || !key.startsWith("destek/") || key.includes("..")) return fail("Dosya bilgisi geçersiz.");
      const r = await db<{ attachments: Dosya[]; support_tickets: { user_id: string | null } }[]>(
        `support_messages?id=eq.${mesajId}&select=attachments,support_tickets(user_id)`
      );
      const m = Array.isArray(r.body) ? r.body[0] : undefined;
      if (!m) return fail("Mesaj bulunamadı.", 404);
      const f = (m.attachments || []).find((x) => x.key === key);
      if (!f) return fail("Dosya bu mesaja ait değil.", 404);
      if (m.support_tickets?.user_id !== user.id && !(await personel(req, user.id, ["support"]))) return fail("Bu dosyaya erişimin yok.", 403);
      return await bagla(f.provider === "r2" ? "r2" : "supabase", DEPO.yukleme, key, f.name || "dosya");
    }
  } catch (e) {
    await audit(user.id, "dosya.indirme_hatasi", tur, { error: e instanceof Error ? e.message.slice(0, 200) : "?" });
    return fail("İndirme bağlantısı oluşturulamadı. Lütfen tekrar dene.", 502);
  }
  return fail("Bilinmeyen dosya türü.");
}
