/**
 * app/api/admin-secure/route.ts
 * Gizli anahtar gerektiren yönetim işlemleri:
 *   - SMM sağlayıcı ekle / servisleri çek / çıkar
 *   - SMM siparişini sağlayıcıya gönder / durumunu sorgula
 *   - Ödeme sağlayıcısı ekle / kontrol et / çıkar
 * Anahtarlar tarayıcıya geri GÖNDERİLMEZ; sadece sunucuda, provider_secrets tablosunda durur.
 * Her istek: oturum + rol + bölüm yetkisi (CEO/admin her şey; mod/personel role_permissions'a göre).
 */
import { audit, db, fail, getStaff, safeUrl, serverReady, SUPA_SERVICE } from "../../../lib/server/supa";
import { dispatchSmmOrder, refreshSmmOrder, smmCall, smmLog } from "../../../lib/server/smm";

type Json = Record<string, unknown>;

const mask = (s: string) => (s.length > 4 ? "••••••••" + s.slice(-4) : "••••");

async function refreshSmm(id: string, url: string, key: string) {
  const bal = (await smmCall(url, key, { action: "balance" })) as Json;
  const list = (await smmCall(url, key, { action: "services" })) as Json[];
  if (!Array.isArray(list)) throw new Error("Servis listesi okunamadı.");

  const rows = list.map((s) => ({
    provider_id: id,
    service_id: String(s.service ?? ""),
    name: String(s.name ?? "").slice(0, 300),
    category: String(s.category ?? "").slice(0, 200),
    rate: Number(s.rate) || 0,
    min_qty: Number(s.min) || 0,
    max_qty: Number(s.max) || 0,
  }));
  // Üzerine yazarak güncelle: "Satışta" seçimleri ve 7-2-NNN kodları korunur.
  for (let i = 0; i < rows.length; i += 500) {
    const r = await db("smm_services?on_conflict=provider_id,service_id", {
      method: "POST",
      prefer: "resolution=merge-duplicates,return=minimal",
      body: JSON.stringify(rows.slice(i, i + 500)),
    });
    if (!r.ok) throw new Error("Servisler kaydedilemedi.");
  }
  // Sağlayıcıda artık olmayan servisleri kaldır
  const keep = new Set(rows.map((r) => r.service_id));
  const old = await db<{ id: number; service_id: string }[]>(`smm_services?provider_id=eq.${id}&select=id,service_id&limit=20000`);
  const gone = (Array.isArray(old.body) ? old.body : []).filter((o) => !keep.has(o.service_id)).map((o) => o.id);
  for (let i = 0; i < gone.length; i += 200) {
    await db(`smm_services?id=in.(${gone.slice(i, i + 200).join(",")})`, { method: "DELETE" });
  }
  await db(`smm_providers?id=eq.${id}`, {
    method: "PATCH",
    body: JSON.stringify({
      balance: String(bal.balance ?? ""),
      currency: String(bal.currency ?? ""),
      service_count: rows.length,
      last_sync: new Date().toISOString(),
    }),
  });
  return rows.length;
}

async function getSecret(kind: "smm" | "pay", id: string): Promise<Json | null> {
  const r = await db<{ data: Json }[]>(`provider_secrets?kind=eq.${kind}&ref_id=eq.${encodeURIComponent(id)}&select=data`);
  return r.ok && Array.isArray(r.body) && r.body[0] ? r.body[0].data : null;
}

export async function POST(req: Request) {
  if (!SUPA_SERVICE) return fail("SUPABASE_SERVICE_ROLE_KEY_MISSING", 503);
  if (!serverReady()) return fail("Supabase ayarları eksik.", 503);

  let b: Json = {};
  try {
    b = await req.json();
  } catch {
    return fail("Geçersiz istek.");
  }
  const action = String(b.action || "");
  const needTab = action.startsWith("pay_") ? "payments" : action.startsWith("smm_order_") ? "orders" : action.startsWith("smm_") ? "smm" : "";
  if (!needTab) return fail("Bilinmeyen işlem.");

  // Gönderen gerçekten giriş yapmış ve bu bölüme yetkili bir yönetici mi?
  const staff = await getStaff(req, needTab);
  if (!staff) return fail("Bu işlem için yetkin yok.", 403);

  const str = (k: string, max = 500) => String(b[k] ?? "").trim().slice(0, max);
  const origin = new URL(req.url).origin;

  try {
    /* ---------------- SMM SAĞLAYICILARI ---------------- */
    if (action === "smm_add") {
      const name = str("name", 80);
      const key = str("key", 300);
      const u = safeUrl(str("url", 400));
      if (!name || !key || !u) return fail("Ad, https API adresi ve anahtar gerekli.");
      const markup = Math.max(0, Math.min(2000, Number(b.markup) || 200));

      // önce gerçekten bağlanabiliyor muyuz?
      await smmCall(u.toString(), key, { action: "balance" });

      const ins = await db<{ id: string }[]>("smm_providers", {
        method: "POST",
        prefer: "return=representation",
        body: JSON.stringify({ name, api_url: u.toString(), key_hint: mask(key), markup_pct: markup }),
      });
      const row = Array.isArray(ins.body) ? ins.body[0] : undefined;
      if (!ins.ok || !row) return fail("Sağlayıcı kaydedilemedi. Veritabanı kurulumu tamamlandı mı?", 500);
      await db("provider_secrets", { method: "POST", body: JSON.stringify({ kind: "smm", ref_id: row.id, data: { key } }) });
      const count = await refreshSmm(row.id, u.toString(), key);
      await audit(staff.id, "smm.saglayici_eklendi", name, { services: count });
      return Response.json({ ok: true, services: count });
    }

    if (action === "smm_sync") {
      const id = str("id", 60);
      const p = await db<{ api_url: string }[]>(`smm_providers?id=eq.${encodeURIComponent(id)}&select=api_url`);
      const url = Array.isArray(p.body) ? p.body[0]?.api_url : undefined;
      const secret = await getSecret("smm", id);
      if (!url || !secret) return fail("Sağlayıcı bulunamadı.", 404);
      try {
        const count = await refreshSmm(id, url, String(secret.key));
        return Response.json({ ok: true, services: count });
      } catch (e) {
        await smmLog("error", "sync", e instanceof Error ? e.message : "Bilinmeyen hata", { provider_id: id });
        throw e;
      }
    }

    if (action === "smm_delete") {
      const id = str("id", 60);
      await db(`provider_secrets?kind=eq.smm&ref_id=eq.${encodeURIComponent(id)}`, { method: "DELETE" });
      await db(`smm_providers?id=eq.${encodeURIComponent(id)}`, { method: "DELETE" });
      await audit(staff.id, "smm.saglayici_silindi", id);
      return Response.json({ ok: true });
    }

    /* ---------------- SMM SİPARİŞLERİ ---------------- */
    if (action === "smm_order_send") {
      const id = Math.floor(Number(b.orderId));
      if (!(id > 0)) return fail("Sipariş seçilmedi.");
      const r = await dispatchSmmOrder(id, staff.id);
      return Response.json({ ok: r.ok, message: r.message, state: r.state }, { status: r.ok ? 200 : 422 });
    }

    if (action === "smm_order_status") {
      const id = Math.floor(Number(b.orderId));
      if (!(id > 0)) return fail("Sipariş seçilmedi.");
      const r = await refreshSmmOrder(id, staff.id);
      return Response.json({ ok: r.ok, message: r.message, state: r.state }, { status: r.ok ? 200 : 422 });
    }

    if (action === "smm_order_status_all") {
      // İşlemdeki SMM siparişlerinin durumunu topluca sorgula (en fazla 40)
      const r = await db<{ id: number }[]>(`orders?type=eq.smm&status=in.(İşlemde,Alındı,Beklemede)&select=id&order=created_at.asc&limit=40`);
      const ids = (Array.isArray(r.body) ? r.body : []).map((x) => x.id);
      let done = 0,
        failed = 0;
      for (const id of ids) {
        const x = await refreshSmmOrder(id, staff.id);
        if (x.ok) done++;
        else failed++;
      }
      return Response.json({ ok: true, message: `${done} sipariş güncellendi${failed ? `, ${failed} sorgulanamadı` : ""}.` });
    }

    /* ---------------- ÖDEME SAĞLAYICILARI ---------------- */
    if (action === "pay_add") {
      const kind = str("kind", 30).toLowerCase();
      const names: Record<string, string> = { paytr: "PayTR", iyzico: "iyzico", stripe: "Stripe", shopier: "Shopier", papara: "Papara", havale: "Havale / EFT" };
      if (!names[kind]) return fail("Bilinmeyen sağlayıcı.");
      const mode = b.mode === "live" ? "live" : "test";

      if (kind === "havale") {
        const iban = str("iban", 60).replace(/\s+/g, "").toUpperCase();
        if (!/^TR\d{24}$/.test(iban)) return fail("IBAN geçersiz görünüyor (TR ile başlayan 26 karakter olmalı).");
        const ins = await db("payment_providers", {
          method: "POST",
          body: JSON.stringify({ kind, name: names[kind], mode: "live", iban, holder: str("holder", 100), last_check: "Dekont ile manuel onay" }),
        });
        if (!ins.ok) return fail("Kaydedilemedi. Veritabanı kurulumu tamamlandı mı?", 500);
        await audit(staff.id, "odeme.saglayici_eklendi", names[kind]);
        return Response.json({ ok: true });
      }

      // Not: Ödeme akışı şu an yalnızca PayTR için yazılı. Diğer sağlayıcıların anahtarı kaydedilir ama
      // sitede ödeme başlatılamaz (bekleyen entegrasyon — yanlışlıkla "çalışıyor" görünmesin diye kapalı eklenir).
      const mid = str("mid", 100),
        key = str("key", 300),
        salt = str("salt", 300);
      if (!mid || !key) return fail("Mağaza no ve anahtar gerekli.");
      if (kind === "paytr" && !salt) return fail("PayTR için Merchant Salt gerekli.");
      const ins = await db<{ id: string }[]>("payment_providers", {
        method: "POST",
        prefer: "return=representation",
        body: JSON.stringify({
          kind,
          name: names[kind],
          mode,
          // Ödeme akışı yalnızca PayTR için hazır; diğerleri kapalı eklenir.
          active: kind === "paytr",
          mid_hint: mid,
          key_hint: mask(key),
          salt_hint: salt ? mask(salt) : "",
          callback_url: `${origin}/api/odeme/${kind}-bildirim`,
          last_check: kind === "paytr" ? "Anahtarlar kaydedildi" : "Bekleyen entegrasyon: bu sağlayıcının ödeme akışı henüz yok",
        }),
      });
      const row = Array.isArray(ins.body) ? ins.body[0] : undefined;
      if (!ins.ok || !row) return fail("Kaydedilemedi. Veritabanı kurulumu tamamlandı mı?", 500);
      await db("provider_secrets", { method: "POST", body: JSON.stringify({ kind: "pay", ref_id: row.id, data: { mid, key, salt } }) });
      await audit(staff.id, "odeme.saglayici_eklendi", names[kind], { mode });
      return Response.json({ ok: true });
    }

    if (action === "pay_check") {
      const id = str("id", 60);
      const secret = await getSecret("pay", id);
      const msg = secret && secret.key ? "Anahtarlar sunucuda kayıtlı · " + new Date().toLocaleString("tr-TR") : "Anahtar bulunamadı";
      await db(`payment_providers?id=eq.${encodeURIComponent(id)}`, { method: "PATCH", body: JSON.stringify({ last_check: msg }) });
      return Response.json({ ok: !!secret, message: msg });
    }

    if (action === "pay_delete") {
      const id = str("id", 60);
      await db(`provider_secrets?kind=eq.pay&ref_id=eq.${encodeURIComponent(id)}`, { method: "DELETE" });
      await db(`payment_providers?id=eq.${encodeURIComponent(id)}`, { method: "DELETE" });
      await audit(staff.id, "odeme.saglayici_silindi", id);
      return Response.json({ ok: true });
    }

    return fail("Bilinmeyen işlem.");
  } catch (e) {
    return fail(e instanceof Error ? e.message : "Beklenmeyen hata.", 502);
  }
}
