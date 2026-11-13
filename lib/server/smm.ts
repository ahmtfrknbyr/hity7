/**
 * lib/server/smm.ts
 * Harici SMM sağlayıcıları (standart "API v2": key + action) ile sunucu tarafı iletişim.
 * - API anahtarları yalnızca provider_secrets tablosundan, gizli anahtarla okunur; tarayıcıya gitmez.
 * - Sağlayıcı tanımlı / aktif değilse sipariş GÖNDERİLMEZ (sahte sipariş oluşturulmaz); sipariş yönetimin
 *   elle işlemesi için "Alındı" durumunda bekler.
 * - Her başarısız çağrı smm_logs tablosuna yazılır.
 */
import { audit, db, safeUrl } from "./supa";

type Json = Record<string, unknown>;

export type SmmState = {
  provider_id?: string;
  provider_name?: string;
  service_id?: string;
  provider_order_id?: string;
  status?: string; // sağlayıcının bildirdiği durum (Pending, In progress, Completed, Partial, Canceled…)
  remains?: string | number | null;
  start_count?: string | number | null;
  charge?: string | number | null;
  currency?: string | null;
  error?: string | null;
  sent_at?: string;
  last_check?: string;
  attention?: boolean; // yönetimin bakması gereken durum (iptal / kısmi / hata)
};

export async function smmCall(url: string, key: string, params: Record<string, string>): Promise<unknown> {
  const u = safeUrl(url);
  if (!u) throw new Error("Sağlayıcı adresi güvenli değil (yalnızca https).");
  const res = await fetch(u.toString(), {
    method: "POST",
    headers: { "content-type": "application/x-www-form-urlencoded" },
    body: new URLSearchParams({ key, ...params }).toString(),
    signal: AbortSignal.timeout(25000),
    cache: "no-store",
  });
  if (!res.ok) throw new Error(`Sağlayıcı HTTP ${res.status} döndürdü.`);
  const json = await res.json().catch(() => {
    throw new Error("Sağlayıcı yanıtı okunamadı.");
  });
  if (json && typeof json === "object" && !Array.isArray(json) && "error" in (json as Json)) {
    throw new Error(String((json as Json).error));
  }
  return json;
}

export async function smmLog(level: "error" | "info", event: string, message: string, extra: { provider_id?: string | null; order_id?: number | null; details?: Json } = {}) {
  try {
    await db("smm_logs", {
      method: "POST",
      prefer: "return=minimal",
      body: JSON.stringify({ level, event, message: message.slice(0, 500), provider_id: extra.provider_id ?? null, order_id: extra.order_id ?? null, details: extra.details ?? {} }),
    });
  } catch {
    /* log tablosu yoksa sessizce geç */
  }
}

type Provider = { id: string; name: string; api_url: string; active: boolean };

export async function getProvider(id: string): Promise<(Provider & { key: string }) | null> {
  const p = await db<Provider[]>(`smm_providers?id=eq.${encodeURIComponent(id)}&select=id,name,api_url,active`);
  const row = Array.isArray(p.body) ? p.body[0] : undefined;
  if (!row) return null;
  const s = await db<{ data: { key?: string } }[]>(`provider_secrets?kind=eq.smm&ref_id=eq.${encodeURIComponent(id)}&select=data`);
  const key = Array.isArray(s.body) ? s.body[0]?.data?.key : undefined;
  if (!key) return null;
  return { ...row, key: String(key) };
}

type OrderLite = { id: number; code: string | null; status: string; payload: Json | null };

async function saveState(order: OrderLite, state: SmmState, status?: string) {
  const payload = { ...(order.payload || {}), smm: { ...((order.payload?.smm as SmmState) || {}), ...state } };
  const patch: Json = { payload };
  if (status) patch.status = status;
  await db(`orders?id=eq.${order.id}`, { method: "PATCH", prefer: "return=minimal", body: JSON.stringify(patch) });
  return payload.smm as SmmState;
}

/**
 * Siparişi sağlayıcıya gönderir. Zaten gönderilmişse tekrar göndermez (çift sipariş önlemi).
 * Dönen ok=false durumunda sipariş "Alındı" olarak kalır ve yönetim elle işleyebilir.
 */
export async function dispatchSmmOrder(orderId: number, actor: string | null): Promise<{ ok: boolean; message: string; state?: SmmState }> {
  const r = await db<OrderLite[]>(`orders?id=eq.${orderId}&select=id,code,status,payload`);
  const order = Array.isArray(r.body) ? r.body[0] : undefined;
  if (!order) return { ok: false, message: "Sipariş bulunamadı." };
  const p = order.payload || {};
  const prev = (p.smm as SmmState) || {};
  if (prev.provider_order_id) return { ok: true, message: `Sipariş zaten sağlayıcıya gönderilmiş (#${prev.provider_order_id}).`, state: prev };
  if (order.status === "İptal Edildi" || order.status === "İptal") return { ok: false, message: "İptal edilmiş sipariş gönderilemez." };

  const code = String(p.serviceCode || "");
  const target = String(p.target || "");
  const qty = Math.floor(Number(p.quantity));
  if (!code || !target || !(qty > 0)) return { ok: false, message: "Siparişte hizmet kodu, bağlantı veya miktar eksik." };

  const sv = await db<{ provider_id: string | null; service_id: string | null; source: string }[]>(
    `smm_services?code=eq.${encodeURIComponent(code)}&select=provider_id,service_id,source&limit=1`
  );
  const svc = Array.isArray(sv.body) ? sv.body[0] : undefined;
  if (!svc) return { ok: false, message: "Hizmet artık kayıtlı değil; elle işlenmeli." };
  if (svc.source === "manual" || !svc.provider_id || !svc.service_id) {
    return { ok: false, message: "Bu manuel bir hizmet; sağlayıcıya otomatik gönderilmez, elle işlenmeli." };
  }

  const prov = await getProvider(svc.provider_id);
  if (!prov) return { ok: false, message: "Sağlayıcı veya API anahtarı bulunamadı; elle işlenmeli." };
  if (!prov.active) return { ok: false, message: `“${prov.name}” sağlayıcısı kapalı; sipariş gönderilmedi.` };

  try {
    const out = (await smmCall(prov.api_url, prov.key, { action: "add", service: svc.service_id, link: target, quantity: String(qty) })) as Json;
    const providerOrder = out && (out.order ?? out.order_id);
    if (providerOrder === undefined || providerOrder === null || providerOrder === "") throw new Error("Sağlayıcı sipariş numarası döndürmedi.");
    const state = await saveState(
      order,
      {
        provider_id: prov.id,
        provider_name: prov.name,
        service_id: String(svc.service_id),
        provider_order_id: String(providerOrder),
        status: "Gönderildi",
        error: null,
        attention: false,
        sent_at: new Date().toISOString(),
      },
      "İşlemde"
    );
    await audit(actor, "smm.siparis_gonderildi", order.code || String(order.id), { provider: prov.name, provider_order_id: String(providerOrder) });
    return { ok: true, message: `Sağlayıcıya gönderildi (#${providerOrder}).`, state };
  } catch (e) {
    const msg = e instanceof Error ? e.message : "Bilinmeyen hata";
    const state = await saveState(order, { provider_id: prov.id, provider_name: prov.name, service_id: String(svc.service_id), error: msg, attention: true, last_check: new Date().toISOString() });
    await smmLog("error", "add", msg, { provider_id: prov.id, order_id: order.id, details: { code, qty } });
    return { ok: false, message: `Sağlayıcı hatası: ${msg}`, state };
  }
}

const DONE = new Set(["completed"]);
const RUNNING = new Set(["pending", "in progress", "processing", "inprogress"]);

/** Sağlayıcıdan güncel durumu çeker; tamamlandıysa siparişi "Tamamlandı" yapar. */
export async function refreshSmmOrder(orderId: number, actor: string | null): Promise<{ ok: boolean; message: string; state?: SmmState }> {
  const r = await db<OrderLite[]>(`orders?id=eq.${orderId}&select=id,code,status,payload`);
  const order = Array.isArray(r.body) ? r.body[0] : undefined;
  if (!order) return { ok: false, message: "Sipariş bulunamadı." };
  const prev = (order.payload?.smm as SmmState) || {};
  if (!prev.provider_id || !prev.provider_order_id) return { ok: false, message: "Bu sipariş henüz sağlayıcıya gönderilmemiş." };
  const prov = await getProvider(prev.provider_id);
  if (!prov) return { ok: false, message: "Sağlayıcı veya API anahtarı bulunamadı." };
  try {
    const out = (await smmCall(prov.api_url, prov.key, { action: "status", order: prev.provider_order_id })) as Json;
    const st = String(out.status || "").trim();
    const low = st.toLowerCase();
    const attention = low === "partial" || low === "canceled" || low === "cancelled" || low === "refunded";
    let next: string | undefined;
    if (DONE.has(low) && order.status !== "Tamamlandı") next = "Tamamlandı";
    else if (RUNNING.has(low) && (order.status === "Alındı" || order.status === "Beklemede")) next = "İşlemde";
    const state = await saveState(
      order,
      {
        status: st || prev.status,
        remains: (out.remains as string) ?? null,
        start_count: (out.start_count as string) ?? null,
        charge: (out.charge as string) ?? null,
        currency: (out.currency as string) ?? null,
        error: null,
        attention,
        last_check: new Date().toISOString(),
      },
      next
    );
    if (next) await audit(actor, "smm.durum_guncellendi", order.code || String(order.id), { provider_status: st, status: next });
    return { ok: true, message: `Sağlayıcı durumu: ${st || "bilinmiyor"}${attention ? " — yönetim kontrol etmeli" : ""}`, state };
  } catch (e) {
    const msg = e instanceof Error ? e.message : "Bilinmeyen hata";
    await saveState(order, { error: msg, last_check: new Date().toISOString() });
    await smmLog("error", "status", msg, { provider_id: prov.id, order_id: order.id });
    return { ok: false, message: `Durum sorgulanamadı: ${msg}` };
  }
}
