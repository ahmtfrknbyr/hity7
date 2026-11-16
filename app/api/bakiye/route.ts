/**
 * app/api/bakiye/route.ts
 * Müşteri cüzdanı: bakiye + hareketler, PayTR ile yükleme başlatma, havale bildirimi.
 * Tüm işlemler giriş (Bearer token) ister. Tutarlar ve kayıtlar yalnızca sunucuda oluşur;
 * tarayıcı bakiyeyi hiçbir şekilde doğrudan değiştiremez (veritabanı tetikleyicisi de engeller).
 */
import { createHmac, randomBytes } from "crypto";
import { onizlemeKapali, onizlemeMi } from "../../../lib/server/onizleme";
import { audit, clean, db, dogrulamaGerekli, fail, getUser, rpc, serverReady } from "../../../lib/server/supa";
import { consentRecord } from "../../../lib/server/yasal";

type Tx = { id: number; kind: "topup" | "spend"; amount: number; status: string; provider: string | null; note: string | null; ref: string | null; created_at: string };

const MIN = 50;
const MAX = 50000;

async function summary(userId: string) {
  const r = await db<Tx[]>(
    `wallet_transactions?user_id=eq.${encodeURIComponent(userId)}&select=id,kind,amount,status,provider,note,ref,created_at&order=created_at.desc&limit=200`
  );
  const txs = Array.isArray(r.body) ? r.body : [];
  const pendingList = txs.filter((t) => t.status === "pending" && t.kind === "topup");
  const pending = pendingList.reduce((a, t) => a + Number(t.amount), 0);

  // Bakiye doğrudan veritabanında hesaplanır (hareket sayısından bağımsız doğru sonuç)
  const br = await rpc<number>("wallet_balance", { p_user: userId });
  let balance = br.ok ? Number(br.body) : NaN;
  if (!Number.isFinite(balance)) {
    const ok = txs.filter((t) => t.status === "ok");
    balance =
      ok.filter((t) => t.kind === "topup").reduce((a, t) => a + Number(t.amount), 0) -
      ok.filter((t) => t.kind === "spend").reduce((a, t) => a + Number(t.amount), 0);
  }
  const ok = txs.filter((t) => t.status === "ok");
  return {
    balance: Math.round(balance * 100) / 100,
    pending: Math.round(pending * 100) / 100,
    pendingCount: pendingList.length,
    totalTopup: Math.round(ok.filter((t) => t.kind === "topup").reduce((a, t) => a + Number(t.amount), 0) * 100) / 100,
    totalSpend: Math.round(ok.filter((t) => t.kind === "spend").reduce((a, t) => a + Number(t.amount), 0) * 100) / 100,
    transactions: txs.slice(0, 100),
  };
}

export async function POST(req: Request) {
  if (!serverReady()) return fail("Cüzdan sistemi henüz kurulmamış (sunucu anahtarı eksik).", 503);

  const user = await getUser(req);
  if (!user) return fail("Giriş gerekli.", 401, { needLogin: true });
  if (!user.verified) return dogrulamaGerekli();

  let b: Record<string, unknown> = {};
  try {
    b = await req.json();
  } catch {
    return fail("Geçersiz istek.");
  }

  // Önizleme ortamında yalnızca özet okunabilir; yükleme / ödeme başlatma / havale bildirimi kapalıdır
  if (onizlemeMi() && b.action !== "summary") return onizlemeKapali();

  if (b.action === "summary") {
    const methods = await db<{ kind: string; name: string; mode: string; iban: string; holder: string }[]>(
      "payment_providers?active=eq.true&select=kind,name,mode,iban,holder"
    );
    const list = Array.isArray(methods.body) ? methods.body : [];
    return Response.json({
      ok: true,
      ...(await summary(user.id)),
      limits: { min: MIN, max: MAX },
      methods: list.map((m) => ({
        kind: m.kind,
        name: m.name,
        test: m.mode !== "live",
        iban: m.kind === "havale" ? m.iban : "",
        holder: m.kind === "havale" ? m.holder : "",
      })),
    });
  }

  const amount = Math.round(Number(b.amount) * 100) / 100;
  if ((b.action === "paytr_start" || b.action === "havale_notice") && !(amount >= MIN && amount <= MAX)) {
    return fail(`Tutar ${MIN} TL ile ${MAX.toLocaleString("tr-TR")} TL arasında olmalı.`);
  }
  // Ön bilgilendirme formu + mesafeli satış sözleşmesi onayı (Mesafeli Sözleşmeler Yönetmeliği)
  if ((b.action === "paytr_start" || b.action === "havale_notice") && b.accept !== true) {
    return fail("Devam etmek için sözleşme onay kutusunu işaretlemelisin.", 400, { needAccept: true });
  }

  /* ---- Havale / EFT bildirimi: yönetici dekontu görüp onaylar ---- */
  if (b.action === "havale_notice") {
    // Aynı kullanıcının bekleyen havale bildirimi sayısını sınırla (kötüye kullanım / çift bildirim önlemi)
    const open = await db<{ id: number }[]>(
      `wallet_transactions?user_id=eq.${encodeURIComponent(user.id)}&provider=eq.havale&status=eq.pending&select=id&limit=5`
    );
    if (Array.isArray(open.body) && open.body.length >= 3) {
      return fail("Onay bekleyen 3 havale bildirimin var. Ekibimiz bunları kontrol ettikten sonra yeni bildirim gönderebilirsin.");
    }
    const note = clean(b.note, 300);
    const ref = "HVL" + randomBytes(5).toString("hex").toUpperCase();
    const ins = await db("wallet_transactions", {
      method: "POST",
      prefer: "return=minimal",
      body: JSON.stringify({ user_id: user.id, kind: "topup", amount, status: "pending", provider: "havale", ref, note: note || "Havale / EFT bildirimi" }),
    });
    if (!ins.ok) return fail("Bildirim kaydedilemedi.", 500);
    await audit(user.id, "cuzdan.havale_bildirimi", ref, { amount, sozlesme: await consentRecord(["on-bilgilendirme", "mesafeli-satis"]) });
    return Response.json({ ok: true, ref });
  }

  /* ---- PayTR iFrame (kredi / banka kartı) ----
   * Test modu: test_mode=1 ile PayTR test ödemesi açılır, kayıt paytr_payments'a "test" olarak yazılır ve
   *            ödeme başarılı olsa bile BAKİYEYE HİÇBİR ŞEY EKLENMEZ.
   * Canlı mod: test_mode=0; bakiye yalnızca imzası doğrulanmış "success" bildirimiyle ve tutar eşleşirse, TEK kez eklenir.
   */
  if (b.action === "paytr_start") {
    const provs = await db<{ id: string; mode: string }[]>("payment_providers?kind=eq.paytr&active=eq.true&select=id,mode&limit=1");
    const prov = Array.isArray(provs.body) ? provs.body[0] : undefined;
    if (!prov) return fail("Kartla ödeme şu an aktif değil. Havale / EFT ile yükleyebilirsin.");
    const sec = await db<{ data: { mid?: string; key?: string; salt?: string } }[]>(
      `provider_secrets?kind=eq.pay&ref_id=eq.${encodeURIComponent(prov.id)}&select=data`
    );
    const s = Array.isArray(sec.body) ? sec.body[0]?.data : undefined;
    if (!s?.mid || !s?.key || !s?.salt) return fail("Kartla ödeme yapılandırması eksik. Lütfen daha sonra tekrar dene.", 503);

    const oid = "H7" + Date.now().toString(36).toUpperCase() + randomBytes(3).toString("hex").toUpperCase(); // yalnızca harf/rakam
    // Müşterinin gerçek IP'si (PayTR zorunlu tutar): Cloudflare'de cf-connecting-ip, diğer ortamlarda x-real-ip / x-forwarded-for
    const ip =
      (req.headers.get("cf-connecting-ip") || req.headers.get("x-real-ip") || (req.headers.get("x-forwarded-for") || "").split(",")[0] || "").trim() ||
      "127.0.0.1";
    const kurus = String(Math.round(amount * 100));
    const basket = Buffer.from(JSON.stringify([["HITY7 Bakiye Yükleme", amount.toFixed(2), 1]])).toString("base64");
    const test = prov.mode === "live" ? "0" : "1";
    const noInst = "1",
      maxInst = "0",
      currency = "TL";
    const token = createHmac("sha256", s.key)
      .update(s.mid + ip + oid + user.email + kurus + basket + noInst + maxInst + currency + test + s.salt)
      .digest("base64");

    // Ödeme kaydı (test ve canlı ayrı). Canlıda ayrıca bekleyen bakiye hareketi açılır; bildirim bunu "ok" yapar.
    const pay = await db("paytr_payments", {
      method: "POST",
      prefer: "return=minimal",
      body: JSON.stringify({ merchant_oid: oid, user_id: user.id, amount, mode: test === "1" ? "test" : "live" }),
    });
    if (!pay.ok) {
      return fail(
        pay.status === 404 ? "Kartla ödeme altyapısı güncellemesi henüz kurulmamış (veritabanı: migration 10)." : "Ödeme kaydı oluşturulamadı.",
        503
      );
    }
    if (test === "0") {
      const ins = await db("wallet_transactions", {
        method: "POST",
        prefer: "return=minimal",
        body: JSON.stringify({ user_id: user.id, kind: "topup", amount, status: "pending", provider: "paytr", ref: oid, note: "PayTR ile bakiye yükleme" }),
      });
      if (!ins.ok) return fail("Kayıt oluşturulamadı.", 500);
    }

    const origin = new URL(req.url).origin;
    const form = new URLSearchParams({
      merchant_id: s.mid,
      user_ip: ip,
      merchant_oid: oid,
      email: user.email,
      payment_amount: kurus,
      paytr_token: token,
      user_basket: basket,
      debug_on: test === "1" ? "1" : "0",
      no_installment: noInst,
      max_installment: maxInst,
      currency,
      test_mode: test,
      user_name: (user.name || user.email || "Müşteri").slice(0, 60),
      user_address: "Türkiye",
      user_phone: "05000000000",
      lang: "tr",
      merchant_ok_url: `${origin}/bakiye?odeme=ok`,
      merchant_fail_url: `${origin}/bakiye?odeme=hata`,
      timeout_limit: "30",
    });
    let out: Record<string, string> = {};
    try {
      const res = await fetch("https://www.paytr.com/odeme/api/get-token", { method: "POST", body: form, cache: "no-store", signal: AbortSignal.timeout(20000) });
      out = await res.json().catch(() => ({}));
    } catch {
      out = { status: "failed", reason: "PayTR'a ulaşılamadı" };
    }
    if (out.status !== "success" || !out.token) {
      await rpc("h7_paytr_sonuc", { p_oid: oid, p_status: "failed", p_total_kurus: null, p_reason: "PayTR başlatılamadı" });
      await audit(user.id, "odeme.paytr.baslatilamadi", oid, { reason: out.reason || null, mod: test === "1" ? "test" : "canli" });
      return fail("Ödeme sayfası açılamadı: " + (out.reason || "bilinmeyen hata"), 502);
    }
    await audit(user.id, "odeme.paytr.baslatildi", oid, { amount, mod: test === "1" ? "test" : "canli", sozlesme: await consentRecord(["on-bilgilendirme", "mesafeli-satis"]) });
    return Response.json({ ok: true, iframe: `https://www.paytr.com/odeme/guvenli/${out.token}`, ref: oid, test: test === "1" });
  }

  return fail("Bilinmeyen işlem.");
}
