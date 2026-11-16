/**
 * app/api/yonetim/teslimat/route.ts — Teslimatlar (CEO / yetkili personel)
 * Yetki: "deliveries" veya "orders" panel bölümü (veritabanı fonksiyonları yetkiyi ayrıca doğrular).
 *
 * POST { action: "liste", q? }                                  → Remake Beat / Mix & Mastering siparişleri + teslimat durumu
 * POST { action: "detay", teslimatId }                          → dosyalar (tüm sürümler) ve geçmiş (indirme, revizyon...)
 * POST { action: "ac", siparisId }                              → siparişe teslimat aç (tahmin edilemez kod)
 * POST { action: "dosya_ekle", teslimatId, yeniSurum, dosyalar } → yüklenmiş dosyaları DEPODA DOĞRULAYIP kaydet
 * POST { action: "yayinla", teslimatId, not? }                  → müşteriye teslim et (bildirim gönderilir)
 * POST { action: "baglanti", teslimatId, islem: kapat|ac|yenile } → bağlantıyı kapat / aç / yenile
 * Dosyalar tarayıcıdan doğrudan özel depoya (hity7-deliveries) yüklenir: /api/yukle { amac: "teslim", siparisId }.
 */
import { audit, clean, db, fail, getStaff, rpc, serverReady } from "../../../../lib/server/supa";
import { DEPO, nesneBilgisi, type Saglayici } from "../../../../lib/server/depo";
import { rastgeleKod } from "../../../../lib/server/kod";

const hata = (text: string) => {
  const m = /"message":"([^"]+)"/.exec(text)?.[1];
  return m ? m.replace(/^YETKISIZ:?\s*/, "") : "İşlem yapılamadı.";
};

export async function POST(req: Request) {
  if (!serverReady()) return fail("Teslimat sistemi henüz kurulmamış (eksik sunucu ayarı: SUPABASE_SECRET_KEY).", 503);
  const staff = (await getStaff(req, "deliveries")) || (await getStaff(req, "orders"));
  if (!staff) return fail("Bu işlem için yetkin yok.", 403);
  let b: Record<string, unknown> = {};
  try {
    b = await req.json();
  } catch {
    return fail("Geçersiz istek.");
  }

  if (b.action === "liste") {
    const q = clean(b.q, 80);
    let filtre = "type=in.(remake,mix)";
    if (q) {
      const s = q.replace(/[(),*]/g, " ").trim();
      if (s) filtre += `&or=(code.ilike.*${encodeURIComponent(s)}*,customer_name.ilike.*${encodeURIComponent(s)}*,title.ilike.*${encodeURIComponent(s)}*)`;
    }
    const r = await db<unknown[]>(
      `orders?${filtre}&select=id,code,customer_name,type,service,title,status,created_at,user_id,deliveries(id,code,status,access_enabled,current_version,published_version,delivered_at,updated_at)&order=created_at.desc&limit=200`
    );
    if (!r.ok) return fail(r.status === 400 && r.text.includes("deliveries") ? "Teslimat merkezi henüz kurulmamış (veritabanı: migration 10)." : "Siparişler okunamadı.", 503);
    return Response.json({ ok: true, siparisler: r.body });
  }

  const teslimatId = clean(b.teslimatId, 40);

  if (b.action === "detay") {
    if (!/^[0-9a-f-]{36}$/i.test(teslimatId)) return fail("Teslimat seçimi geçersiz.");
    const [f, e] = await Promise.all([
      db(`delivery_files?delivery_id=eq.${teslimatId}&select=id,version,name,size,mime,storage_provider,created_at,uploaded_by&order=version.desc,created_at.asc`),
      db(`delivery_events?delivery_id=eq.${teslimatId}&select=id,kind,file_id,actor_id,note,created_at&order=created_at.desc&limit=200`),
    ]);
    return Response.json({ ok: true, dosyalar: f.body || [], gecmis: e.body || [] });
  }

  if (b.action === "ac") {
    const siparisId = Number(b.siparisId);
    if (!Number.isInteger(siparisId) || siparisId <= 0) return fail("Sipariş seçimi geçersiz.");
    const r = await rpc("h7_teslimat_ac", { p_siparis: siparisId, p_kod: rastgeleKod(16), p_actor: staff.id });
    if (!r.ok) return fail(hata(r.text), 400);
    return Response.json({ ok: true, teslimat: r.body });
  }

  if (b.action === "dosya_ekle") {
    if (!/^[0-9a-f-]{36}$/i.test(teslimatId)) return fail("Teslimat seçimi geçersiz.");
    const t = await db<{ order_id: number }[]>(`deliveries?id=eq.${teslimatId}&select=order_id`);
    const teslimat = Array.isArray(t.body) ? t.body[0] : undefined;
    if (!teslimat) return fail("Teslimat bulunamadı.", 404);
    const ham = (Array.isArray(b.dosyalar) ? b.dosyalar : []).slice(0, 30) as Record<string, unknown>[];
    if (!ham.length) return fail("Dosya listesi boş.");
    const dogrulanan: Record<string, unknown>[] = [];
    for (const d of ham) {
      const provider = (d.provider === "r2" ? "r2" : "supabase") as Saglayici;
      const key = clean(d.key, 400);
      const name = clean(d.name, 200);
      const size = Number(d.size);
      // Yalnızca bu siparişin teslimat klasörü kabul edilir
      if (!key.startsWith(`teslim/${teslimat.order_id}/`) || key.includes("..") || !name) return fail("Dosya bu siparişin teslimat klasöründe değil.");
      const info = await nesneBilgisi(provider, DEPO.teslimat, key);
      if (!info) return fail(`“${name}” depoda bulunamadı. Yükleme tamamlanmamış olabilir; tekrar yükle.`, 409);
      if (size > 0 && info.size && info.size !== size) return fail(`“${name}” boyutu eşleşmiyor (bozuk yükleme). Tekrar yükle.`, 409);
      const sha = clean(d.sha256, 64).toLowerCase();
      dogrulanan.push({ name, size: info.size || size, mime: clean(d.mime, 100) || info.mime, provider, bucket: DEPO.teslimat, key, sha256: /^[0-9a-f]{64}$/.test(sha) ? sha : "" });
    }
    const r = await rpc("h7_teslimat_dosya_ekle", { p_teslimat: teslimatId, p_dosyalar: dogrulanan, p_yeni_surum: b.yeniSurum === true, p_actor: staff.id });
    if (!r.ok) return fail(hata(r.text), 400);
    return Response.json({ ok: true, ...(r.body as object) });
  }

  if (b.action === "yayinla") {
    if (!/^[0-9a-f-]{36}$/i.test(teslimatId)) return fail("Teslimat seçimi geçersiz.");
    const r = await rpc("h7_teslimat_yayinla", { p_teslimat: teslimatId, p_not: clean(b.not, 1500) || null, p_actor: staff.id });
    if (!r.ok) return fail(hata(r.text), 400);
    return Response.json({ ok: true, ...(r.body as object) });
  }

  if (b.action === "baglanti") {
    if (!/^[0-9a-f-]{36}$/i.test(teslimatId)) return fail("Teslimat seçimi geçersiz.");
    const islem = clean(b.islem, 10);
    if (!["kapat", "ac", "yenile"].includes(islem)) return fail("İşlem geçersiz.");
    const r = await rpc("h7_teslimat_baglanti", { p_teslimat: teslimatId, p_islem: islem, p_yeni_kod: islem === "yenile" ? rastgeleKod(16) : null, p_actor: staff.id });
    if (!r.ok) return fail(hata(r.text), 400);
    await audit(staff.id, `teslimat.baglanti_${islem}`, teslimatId);
    return Response.json({ ok: true, teslimat: r.body });
  }

  return fail("Bilinmeyen işlem.");
}
