/**
 * app/api/odeme/paytr-bildirim/route.ts — PayTR Bildirim URL'si (callback)
 * PayTR mağaza panelindeki "Bildirim URL" alanına şu adres yazılır:
 *   https://hity7.net/api/odeme/paytr-bildirim
 * PayTR ödeme sonucunu buraya POST eder (merchant_oid, status, total_amount, hash, failed_reason_code/msg, test_mode...).
 *
 * 1) İmza: base64(HMAC-SHA256(merchant_oid + merchant_salt + status + total_amount, merchant_key)) — sabit zamanlı karşılaştırma.
 *    İmza geçersizse işlem yapılmaz ve "bad hash" (400) döner.
 * 2) Sonuç veritabanında TEK işlemde ve tekrarlanamaz biçimde işlenir (h7_paytr_sonuc):
 *    - test modundaki ödeme bakiyeyi hiçbir zaman değiştirmez,
 *    - canlı ödeme yalnızca "success" ve tutar eşleşirse bakiyeye bir kez eklenir,
 *    - aynı bildirim tekrar gelirse hiçbir şey değişmez.
 * 3) PayTR'ın istediği gibi doğrulanmış her bildirime düz metin "OK" döner (aksi hâlde PayTR tekrar dener).
 * Not: "Ödeme başarılı" sayfasına yönlendirme ödeme kanıtı DEĞİLDİR; bakiye yalnızca bu bildirimle değişir.
 */
import { createHmac, timingSafeEqual } from "crypto";
import { onizlemeMi } from "../../../../lib/server/onizleme";
import { SUPA_SERVICE, SUPA_URL, audit, db, rpc } from "../../../../lib/server/supa";

const OK = () => new Response("OK", { status: 200, headers: { "content-type": "text/plain" } });

export async function POST(req: Request) {
  // Önizleme ortamı PayTR'den bildirim kabul etmez (bakiyeye hiçbir şey eklenmez)
  if (onizlemeMi()) return new Response("preview", { status: 403 });
  if (!SUPA_URL || !SUPA_SERVICE) return new Response("config", { status: 503 });

  const form = await req.formData();
  const oid = String(form.get("merchant_oid") || "");
  const status = String(form.get("status") || "");
  const total = String(form.get("total_amount") || "");
  const hash = String(form.get("hash") || "");
  if (!oid || !status || !hash || !/^[A-Za-z0-9]{1,64}$/.test(oid) || !/^\d{1,12}$/.test(total)) return new Response("bad request", { status: 400 });

  // Kayıtlı PayTR anahtarlarıyla imzayı doğrula (anahtarlar yalnızca sunucuda, provider_secrets tablosunda)
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

  const reason = String(form.get("failed_reason_msg") || form.get("failed_reason_code") || "").slice(0, 200) || null;

  // Yeni akış: ödeme kaydı (test / canlı) üzerinden tek işlemde
  const r = await rpc<{ ok: boolean; neden?: string; tekrar?: boolean; status?: string; mode?: string }>("h7_paytr_sonuc", {
    p_oid: oid,
    p_status: status,
    p_total_kurus: Number(total),
    p_reason: reason,
  });
  const row = (Array.isArray(r.body) ? r.body[0] : r.body) as { ok?: boolean; neden?: string } | null;
  if (r.ok && row?.ok) return OK();

  // Geçiş dönemi: ödeme kaydı yoksa (migration 10'dan önce başlatılmış eski ödeme) veya fonksiyon henüz kurulmadıysa
  // eski bekleyen bakiye hareketi işlenir.
  if ((r.ok && row?.neden === "kayit_yok") || r.status === 404) {
    const txr = await db<{ id: number; user_id: string; amount: number; status: string; note: string | null }[]>(
      `wallet_transactions?ref=eq.${encodeURIComponent(oid)}&select=id,user_id,amount,status,note&limit=1`
    );
    const tx = Array.isArray(txr.body) ? txr.body[0] : undefined;
    if (!tx) {
      await audit(null, "odeme.paytr.kayit_yok", oid, { status, total });
      return OK();
    }
    if (tx.status !== "pending") return OK(); // tekrar gelen bildirim: hiçbir şey değiştirme
    // Eski sistemde test ödemeleri de bekleyen hareket açıyordu: test kaydı bakiyeye EKLENMEZ
    const eskiTest = /TEST/i.test(tx.note || "");
    const expectedKurus = Math.round(Number(tx.amount) * 100);
    let next: "ok" | "failed" = status === "success" && !eskiTest ? "ok" : "failed";
    let note: string | undefined = eskiTest ? "PayTR test ödemesi (bakiyeye eklenmez)" : undefined;
    if (next === "ok" && !(Number(total) >= expectedKurus)) {
      next = "failed";
      note = "Tutar uyuşmadı, yönetim kontrol etmeli";
    }
    await db(`wallet_transactions?id=eq.${tx.id}&status=eq.pending`, { method: "PATCH", body: JSON.stringify(note ? { status: next, note } : { status: next }) });
    await audit(tx.user_id, next === "ok" ? "odeme.paytr.basarili" : "odeme.paytr.basarisiz", oid, { amount: tx.amount, total_kurus: Number(total), reason: note || reason, eski: true });
    return OK();
  }

  // Veritabanı hatası: PayTR'a OK DÖNÜLMEZ; PayTR bildirimi tekrar gönderir (işlem tekrarlanamaz olduğu için güvenli)
  await audit(null, "odeme.paytr.isleme_hatasi", oid, { status, error: r.text.slice(0, 200) });
  return new Response("retry", { status: 500 });
}
