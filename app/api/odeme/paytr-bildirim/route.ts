/**
 * app/api/odeme/paytr-bildirim/route.ts
 * PayTR mağaza panelindeki "Bildirim URL" alanına şu adres yazılır:
 *   https://SITEN.com/api/odeme/paytr-bildirim
 * PayTR ödeme sonucunu buraya POST eder. İmza (hash) doğrulanır; geçerliyse cüzdandaki bekleyen yükleme
 * (ref = merchant_oid) "ok" veya "failed" yapılır. Tutar, bekleyen kayıtla karşılaştırılır.
 * Aynı bildirim tekrar gelirse yalnızca hâlâ "pending" olan kayıt güncellendiği için çift yükleme olmaz.
 * PayTR'ın istediği gibi doğrulanan her bildirime düz "OK" yanıtı döner.
 */
import { createHmac, timingSafeEqual } from "crypto";
import { SUPA_SERVICE, SUPA_URL, audit, db } from "../../../../lib/server/supa";

export async function POST(req: Request) {
  if (!SUPA_URL || !SUPA_SERVICE) return new Response("config", { status: 503 });

  const form = await req.formData();
  const oid = String(form.get("merchant_oid") || "");
  const status = String(form.get("status") || "");
  const total = String(form.get("total_amount") || "");
  const hash = String(form.get("hash") || "");
  if (!oid || !status || !hash || !/^[A-Za-z0-9]{1,64}$/.test(oid)) return new Response("bad request", { status: 400 });

  // Kayıtlı PayTR anahtarlarıyla imzayı doğrula
  const provs = await db<{ id: string }[]>("payment_providers?kind=eq.paytr&select=id");
  const ids = (Array.isArray(provs.body) ? provs.body : []).map((p) => p.id);
  let valid = false;
  for (const id of ids) {
    const s = await db<{ data: { key?: string; salt?: string } }[]>(`provider_secrets?kind=eq.pay&ref_id=eq.${encodeURIComponent(id)}&select=data`);
    const data = Array.isArray(s.body) ? s.body[0]?.data : undefined;
    if (!data?.key || !data?.salt) continue;
    const expected = createHmac("sha256", data.key).update(oid + data.salt + status + total).digest("base64");
    const a = Buffer.from(expected);
    const b = Buffer.from(hash);
    if (a.length === b.length && timingSafeEqual(a, b)) {
      valid = true;
      break;
    }
  }
  if (!valid) {
    await audit(null, "odeme.paytr.gecersiz_imza", oid, { status });
    return new Response("bad hash", { status: 400 });
  }

  // Bekleyen kaydı bul ve tutarı karşılaştır (kuruş)
  const txr = await db<{ id: number; user_id: string; amount: number; status: string }[]>(
    `wallet_transactions?ref=eq.${encodeURIComponent(oid)}&select=id,user_id,amount,status&limit=1`
  );
  const tx = Array.isArray(txr.body) ? txr.body[0] : undefined;
  if (!tx) {
    await audit(null, "odeme.paytr.kayit_yok", oid, { status, total });
    return new Response("OK", { status: 200, headers: { "content-type": "text/plain" } });
  }
  if (tx.status !== "pending") {
    // Tekrar gelen bildirim: hiçbir şey değiştirme
    return new Response("OK", { status: 200, headers: { "content-type": "text/plain" } });
  }

  const expectedKurus = Math.round(Number(tx.amount) * 100);
  const paidKurus = Number(total);
  let next: "ok" | "failed" = status === "success" ? "ok" : "failed";
  let note: string | undefined;
  if (next === "ok" && !(Number.isFinite(paidKurus) && paidKurus >= expectedKurus)) {
    next = "failed";
    note = "Tutar uyuşmadı, yönetim kontrol etmeli";
  }

  await db(`wallet_transactions?id=eq.${tx.id}&status=eq.pending`, {
    method: "PATCH",
    body: JSON.stringify(note ? { status: next, note } : { status: next }),
  });
  await audit(tx.user_id, next === "ok" ? "odeme.paytr.basarili" : "odeme.paytr.basarisiz", oid, {
    amount: tx.amount,
    total_kurus: paidKurus,
    reason: note || form.get("failed_reason_msg") || null,
  });

  return new Response("OK", { status: 200, headers: { "content-type": "text/plain" } });
}
