/**
 * app/api/teslim/route.ts — HITY7 Teslimat Merkezi (müşteri tarafı)
 * Müşteri yalnızca KENDİ siparişlerinin teslimatlarını görür. Dosya indirme /api/dosya üzerinden, kısa süreli
 * imzalı bağlantıyla yapılır (bu uç dosya adresi vermez).
 *
 * POST { action: "liste" }                         → teslimatlarım
 * POST { action: "detay", kod }                    → teslimat ayrıntısı (sürümler ve dosyalar)
 * POST { action: "onay" | "revizyon", kod, not? }  → teslimatı onayla / revizyon iste
 */
import { clean, db, fail, getUser, rpc, serverReady } from "../../../lib/server/supa";

type Teslimat = {
  id: string;
  code: string;
  status: string;
  access_enabled: boolean;
  current_version: number;
  published_version?: number;
  note: string | null;
  delivered_at: string | null;
  created_at: string;
  updated_at: string;
  orders: { id: number; code: string; type: string; service: string; title: string; status: string } | null;
};

export async function POST(req: Request) {
  if (!serverReady()) return fail("Teslimat sistemi henüz kurulmamış (eksik sunucu ayarı: SUPABASE_SECRET_KEY).", 503);
  const user = await getUser(req);
  if (!user) return fail("Teslimatlarını görmek için giriş yapmalısın.", 401, { needLogin: true });
  let b: Record<string, unknown> = {};
  try {
    b = await req.json();
  } catch {
    return fail("Geçersiz istek.");
  }

  if (b.action === "liste") {
    const r = await db<Teslimat[]>(
      `deliveries?user_id=eq.${user.id}&access_enabled=eq.true&select=id,code,status,access_enabled,current_version,published_version,note,delivered_at,created_at,updated_at,orders(id,code,type,service,title,status)&order=updated_at.desc&limit=100`
    );
    if (!r.ok) return fail(r.status === 404 ? "Teslimat merkezi henüz kurulmamış (veritabanı: migration 10)." : "Teslimatlar okunamadı.", r.status === 404 ? 503 : 500);
    return Response.json({ ok: true, teslimatlar: (r.body || []).map((t) => ({ ...t, id: undefined })) });
  }

  const kod = clean(b.kod, 40);
  if (!/^[A-Za-z0-9]{16,40}$/.test(kod)) return fail("Teslimat bağlantısı geçersiz.", 404);

  if (b.action === "detay") {
    const r = await db<Teslimat[]>(
      `deliveries?code=eq.${kod}&select=id,code,status,access_enabled,current_version,published_version,note,delivered_at,created_at,updated_at,orders(id,code,type,service,title,status),user_id`
    );
    const t = Array.isArray(r.body) ? (r.body[0] as Teslimat & { user_id: string }) : undefined;
    // Başkasının teslimatı veya kapatılmış bağlantı: varlığı bile söylenmez
    if (!t || t.user_id !== user.id || !t.access_enabled) return fail("Teslimat bulunamadı veya bağlantı kapatılmış.", 404);
    const fr = await db<{ id: string; version: number; name: string; size: number; mime: string | null; created_at: string }[]>(
      `delivery_files?delivery_id=eq.${t.id}&select=id,version,name,size,mime,created_at&order=version.desc,created_at.asc`
    );
    return Response.json({
      ok: true,
      teslimat: { ...t, id: undefined, user_id: undefined },
      // Müşteri yalnızca YAYINLANMIŞ sürümlerin dosyalarını görür (hazırlanan / yeni yüklenen taslak sürüm görünmez)
      dosyalar: (fr.body || []).filter((f) => f.version <= (t.published_version || 0)),
    });
  }

  if (b.action === "onay" || b.action === "revizyon") {
    const r = await rpc("h7_teslimat_musteri", { p_kod: kod, p_user: user.id, p_islem: b.action, p_not: clean(b.not, 1500) || null });
    if (!r.ok) {
      if (r.text.includes("TESLIMAT_YOK")) return fail("Teslimat bulunamadı veya bağlantı kapatılmış.", 404);
      const m = /"message":"([^"]+)"/.exec(r.text)?.[1];
      return fail(m && !m.includes("YETKISIZ") ? m : "İşlem yapılamadı. Lütfen tekrar dene.", 400);
    }
    return Response.json({ ok: true, ...(r.body as object) });
  }

  return fail("Bilinmeyen işlem.");
}
