"use client";

/**
 * app/bakiye/page.tsx
 * Bakiye yükleme (HITY7 Wallet): giriş / üye ol, bakiye, PayTR ile kartla yükleme, havale bildirimi, son hareketler.
 * Görünüm sitenin ortak tasarımındadır (noktalı beyaz zemin, kalın siyah çerçeve, sarı vurgu); stil kendi içindedir.
 * Tutarlar ve kayıtlar yalnızca sunucuda (/api/bakiye) oluşur.
 */
import { useCallback, useEffect, useState } from "react";
import Link from "next/link";
import { getSupabase } from "../../lib/supabase";
import SozlesmeOnay from "../../components/SozlesmeOnay";
import { LEGAL_VERSION } from "../../lib/yasal-belgeler";

type Tx = { id: number; kind: "topup" | "spend"; amount: number; status: string; provider: string | null; note: string | null; created_at: string };
type Method = { kind: string; name: string; iban: string; holder: string };
type Sum = { balance: number; pending: number; transactions: Tx[]; methods: Method[] };

const tl = (n: number) => n.toLocaleString("tr-TR", { minimumFractionDigits: 2, maximumFractionDigits: 2 }) + " TL";
const emailOf = (v: string) => (v.trim().includes("@") ? v.trim().toLowerCase() : "");
const PROVIDER: Record<string, string> = { paytr: "Kart (PayTR)", havale: "Havale / EFT", admin: "Yönetim düzeltmesi", iade: "Sipariş iadesi" };

const CSS = `
.bk{min-height:100vh;color:#111;font-family:Inter,"Helvetica Neue",Arial,sans-serif;background-color:#fff;background-image:radial-gradient(#d9d9d9 1.4px,transparent 1.5px);background-size:28px 28px;-webkit-font-smoothing:antialiased}
.bk *,.bk *::before,.bk *::after{box-sizing:border-box}
.bk :where(a){color:inherit;text-decoration:none}
.bk :where(button,input){font:inherit;color:inherit}
.bk :where(h1,h2,p){margin:0}
.bk-wrap{max-width:1200px;margin:0 auto;padding:0 24px}
.bk-hero{padding:64px 0 36px}
.bk-pill{display:inline-block;border:2px solid #111;border-radius:999px;padding:6px 14px;font-size:11px;font-weight:800;letter-spacing:.14em;background:#fff}
.bk-hero h1{font-size:clamp(52px,9vw,112px);line-height:.9;letter-spacing:-.05em;font-weight:900;margin:22px 0 18px}
.bk-hero h1 span{background:#f5c518;padding:0 .12em;border:3px solid #111;border-radius:18px;display:inline-block;transform:rotate(-1.5deg)}
.bk-hero p{max-width:540px;color:#686868;font-size:16px;line-height:1.7}
.bk-load{padding:0 0 90px;font-size:12px;font-weight:800;letter-spacing:.14em;color:#686868}
.bk-grid{display:grid;grid-template-columns:minmax(0,1fr) minmax(0,1.35fr);gap:24px;align-items:start;padding-bottom:90px}
.bk-card{background:#fff;border:3px solid #111;border-radius:30px;padding:28px;box-shadow:0 9px 0 #111}
.bk-card h2{font-size:clamp(26px,3vw,34px);letter-spacing:-.04em;font-weight:900;margin:14px 0 6px}
.bk-wide{grid-column:1 / -1}
.bk-wallet{display:flex;flex-direction:column;min-height:270px;background:#111;color:#fff;border:3px solid #111;border-radius:30px;padding:28px;box-shadow:0 9px 0 #f5c518}
.bk-wallet small{font-size:11px;font-weight:800;letter-spacing:.14em;color:#f5c518}
.bk-wallet strong{display:block;margin:16px 0 8px;font-size:clamp(38px,5vw,56px);line-height:1;letter-spacing:-.04em;font-weight:900}
.bk-wallet p{color:#bdbdbd;font-size:13px;line-height:1.6}
.bk-wallet-links{display:flex;flex-wrap:wrap;gap:8px;margin-top:auto;padding-top:24px}
.bk-wallet-links a,.bk-wallet-links button{border:2px solid rgba(255,255,255,.4);border-radius:999px;background:transparent;color:#fff;padding:8px 14px;font-size:12px;font-weight:800;cursor:pointer;transition:background .2s,border-color .2s,color .2s}
.bk-wallet-links a:hover,.bk-wallet-links button:hover{background:#f5c518;border-color:#f5c518;color:#111}
.bk-lab{display:block;font-size:11px;font-weight:800;letter-spacing:.12em;margin:20px 0 8px}
.bk-in{width:100%;border:2.5px solid #111;border-radius:16px;background:#fff;padding:14px 16px;font-size:15px;outline:none}
.bk-in:focus{background:#fffdf2;box-shadow:0 0 0 4px #f5c518}
.bk-chips{display:flex;flex-wrap:wrap;gap:8px;margin-top:16px}
.bk-chip{border:2.5px solid #111;border-radius:999px;background:#fff;padding:10px 16px;font-size:13px;font-weight:800;cursor:pointer;transition:background .15s,box-shadow .15s,transform .15s}
.bk-chip:hover{background:#fffdf2}
.bk-chip.on{background:#f5c518;box-shadow:0 3px 0 #111;transform:translateY(-1px)}
.bk-methods{display:grid;grid-template-columns:repeat(auto-fit,minmax(170px,1fr));gap:10px}
.bk-method{display:flex;flex-direction:column;gap:3px;text-align:left;border:2.5px solid #111;border-radius:18px;background:#fff;padding:12px 14px;cursor:pointer;transition:background .15s,box-shadow .15s}
.bk-method b{font-size:14px}
.bk-method small{font-size:11.5px;color:#555}
.bk-method.on{background:#f5c518;box-shadow:0 4px 0 #111}
.bk-btn{width:100%;margin-top:20px;border:2.5px solid #111;border-radius:999px;background:#f5c518;padding:16px;font-size:14px;font-weight:800;letter-spacing:.04em;cursor:pointer;box-shadow:0 5px 0 #111;transition:transform .1s,box-shadow .1s,background .2s}
.bk-btn:hover{transform:translateY(-1px);box-shadow:0 6px 0 #111;background:#e5b600}
.bk-btn:active{transform:translateY(3px);box-shadow:0 1px 0 #111}
.bk-btn:disabled{opacity:.6;cursor:wait}
.bk-msg{margin-top:16px;border:2.5px solid #111;border-radius:16px;background:#fff6cf;padding:12px 14px;font-size:13px;line-height:1.6;font-weight:600}
.bk-hint{margin-top:8px;font-size:12px;color:#686868;line-height:1.6}
.bk-hv{margin-top:18px;background:#f5f5f5;border:2.5px solid #111;border-radius:20px;padding:16px}
.bk-hv-row{display:flex;flex-wrap:wrap;align-items:center;justify-content:space-between;gap:8px 12px;padding:6px 0;font-size:14px}
.bk-hv-row span{color:#686868;font-size:11px;font-weight:800;letter-spacing:.1em}
.bk-hv-row code{font-family:ui-monospace,SFMono-Regular,Menlo,Consolas,monospace;font-size:13px;font-weight:700;background:#fff;border:2px solid #111;border-radius:10px;padding:4px 8px;overflow-wrap:anywhere}
.bk-hv .bk-in{margin-top:10px}
.bk-pay{width:100%;height:640px;margin-top:18px;border:3px solid #111;border-radius:20px;background:#fff}
.bk-list{margin-top:10px}
.bk-row{display:flex;align-items:center;gap:12px;padding:14px 0;border-bottom:2px dashed #e5e5e5}
.bk-row:last-child{border-bottom:0}
.bk-ico{flex:none;display:grid;place-items:center;width:34px;height:34px;border:2.5px solid #111;border-radius:50%;background:#fff;font-weight:900}
.bk-ico.topup{background:#f5c518}
.bk-row-t{flex:1;min-width:0}
.bk-row-t b{display:block;font-size:14px}
.bk-row-t small{font-size:12px;color:#686868}
.bk-badge{border:2px solid #111;border-radius:999px;padding:4px 10px;font-size:11px;font-weight:800;white-space:nowrap}
.bk-badge.wait{background:#fff6cf}
.bk-badge.fail{background:#eee;color:#686868}
.bk-amt{white-space:nowrap;font-size:15px;font-weight:900}
.bk-amt.strike{text-decoration:line-through;opacity:.5}
.bk-auth{display:grid;place-items:center;padding:0 0 90px}
.bk-authcard{width:100%;max-width:460px}
.bk-sub{color:#686868;font-size:14px;line-height:1.6}
.bk-tabs{display:grid;grid-template-columns:1fr 1fr;gap:8px;margin:22px 0 4px;padding:5px;border:2.5px solid #111;border-radius:999px;background:#f5f5f5}
.bk-tab{border:0;background:transparent;border-radius:999px;padding:11px;font-size:12px;font-weight:800;letter-spacing:.08em;cursor:pointer}
.bk-tab.on{background:#f5c518;box-shadow:0 0 0 2.5px #111}
.bk-link{display:inline-block;margin-top:14px;background:none;border:0;padding:0;font-size:12px;font-weight:700;color:#111;cursor:pointer;text-decoration:underline;text-decoration-color:#f5c518;text-decoration-thickness:3px;text-underline-offset:3px}
.bk-foot{border-top:3px solid #111;background:#fff}
.bk-foot-in{display:flex;flex-wrap:wrap;align-items:center;justify-content:space-between;gap:12px;padding:26px 24px;font-size:11px;font-weight:700;letter-spacing:.1em;color:#686868}
.bk-logo{display:inline-flex;align-items:baseline;gap:3px;font-size:24px;font-weight:900;letter-spacing:-1.5px;color:#111}
.bk-dot{display:inline-block;width:9px;height:9px;border-radius:50%;background:#f5c518;border:2px solid #111}
@media (max-width:900px){.bk-grid{grid-template-columns:1fr}.bk-wallet{min-height:0}}
@media (max-width:560px){.bk-wrap{padding:0 16px}.bk-hero{padding:40px 0 26px}.bk-card,.bk-wallet{padding:22px 18px;border-radius:26px}.bk-pay{height:560px}.bk-row{flex-wrap:wrap}.bk-amt{margin-left:46px}}
@media (prefers-reduced-motion:reduce){.bk-btn,.bk-chip,.bk-method,.bk-wallet-links a,.bk-wallet-links button{transition:none}}
`;

/** Supabase bilgisi yoksa (ör. önizleme ortamı) sayfa çökmez; "sistem kurulmamış" ekranı gösterilir. */
function sbOrNull() {
  try {
    return getSupabase();
  } catch {
    return null;
  }
}

export default function BakiyePage() {
  const sb = sbOrNull();
  const [ready, setReady] = useState(false);
  const [logged, setLogged] = useState(false);
  const [mode, setMode] = useState<"login" | "register">("login");
  const [name, setName] = useState("");
  const [email, setEmail] = useState("");
  const [password, setPassword] = useState("");
  const [authMsg, setAuthMsg] = useState("");

  const [sum, setSum] = useState<Sum | null>(null);
  const [loadErr, setLoadErr] = useState("");
  const [amount, setAmount] = useState("500");
  const [msg, setMsg] = useState("");
  const [busy, setBusy] = useState(false);
  const [iframe, setIframe] = useState("");
  const [method, setMethod] = useState<"paytr" | "havale">("paytr");
  const [hnote, setHnote] = useState("");
  const [onay, setOnay] = useState(false);
  const [kayitOnay, setKayitOnay] = useState(false);

  const call = useCallback(
    async (body: Record<string, unknown>) => {
      const token = sb ? (await sb.auth.getSession()).data.session?.access_token : undefined;
      if (!token) return { ok: false, json: { error: "Giriş gerekli." } as Record<string, unknown> };
      const res = await fetch("/api/bakiye", {
        method: "POST",
        headers: { "content-type": "application/json", Authorization: `Bearer ${token}` },
        body: JSON.stringify(body),
      });
      return { ok: res.ok, json: (await res.json().catch(() => ({}))) as Record<string, unknown> };
    },
    [sb]
  );

  const refresh = useCallback(async () => {
    const r = await call({ action: "summary" });
    if (r.ok) {
      setSum(r.json as unknown as Sum);
      setLoadErr("");
    } else {
      // Sunucu kurulumu eksikse (ör. gizli anahtar yok) sebebi gösterilir; sahte bakiye / ödeme gösterilmez
      setLoadErr(String(r.json.error || "Cüzdan bilgisi şu an alınamıyor."));
    }
  }, [call]);

  useEffect(() => {
    if (!sb) return setReady(true);
    sb.auth.getSession().then(({ data }) => {
      setLogged(!!data.session);
      setReady(true);
      if (data.session) refresh();
    });
    const qs = new URLSearchParams(window.location.search);
    const need = Number(qs.get("tutar"));
    if (need > 0) { setAmount(String(Math.max(50, Math.ceil(need)))); setMsg("Siparişini tamamlamak için önce bakiye yüklemelisin."); }
    const p = qs.get("odeme");
    if (p === "ok") setMsg("Ödemen alındı. Bakiyen birkaç saniye içinde güncellenir.");
    if (p === "hata") setMsg("Ödeme tamamlanamadı. Tekrar deneyebilirsin.");
  }, [sb, refresh]);

  // Ödeme sonrası bakiyeyi birkaç kez yenile
  useEffect(() => {
    if (!msg.startsWith("Ödemen alındı") || !logged) return;
    const t = [2000, 5000, 10000].map(ms => setTimeout(refresh, ms));
    return () => t.forEach(clearTimeout);
  }, [msg, logged, refresh]);

  async function submitAuth(e: React.FormEvent) {
    e.preventDefault();
    if (!sb) return;
    setAuthMsg("");
    if (!emailOf(email)) return setAuthMsg("Lütfen geçerli bir e-posta yaz.");
    if (password.length < 8) return setAuthMsg("Şifre en az 8 karakter olmalı.");
    if (mode === "register") {
      if (!kayitOnay) return setAuthMsg("Üye olmak için Kullanım Koşulları’nı kabul etmelisin.");
      const { data, error } = await sb.auth.signUp({
        email: emailOf(email),
        password,
        options: { data: { full_name: name.trim(), terms_version: LEGAL_VERSION, terms_accepted_at: new Date().toISOString() } },
      });
      if (error) return setAuthMsg(error.message);
      if (!data.session) return setAuthMsg("Kayıt alındı. E-postanı doğrulayıp giriş yap.");
    } else {
      const { error } = await sb.auth.signInWithPassword({ email: emailOf(email), password });
      if (error) return setAuthMsg("E-posta veya şifre hatalı.");
    }
    setLogged(true);
    refresh();
  }

  async function startPaytr() {
    if (!onay) return setMsg("Devam etmek için sözleşme onay kutusunu işaretle.");
    setBusy(true);
    setMsg("");
    const r = await call({ action: "paytr_start", amount: Number(amount), accept: onay });
    setBusy(false);
    if (!r.ok) return setMsg(String(r.json.error || "Ödeme başlatılamadı."));
    setIframe(String(r.json.iframe));
  }

  async function sendHavale() {
    if (!onay) return setMsg("Devam etmek için sözleşme onay kutusunu işaretle.");
    setBusy(true);
    setMsg("");
    const r = await call({ action: "havale_notice", amount: Number(amount), note: hnote, accept: onay });
    setBusy(false);
    if (!r.ok) return setMsg(String(r.json.error || "Bildirim gönderilemedi."));
    setMsg("Havale bildirimin alındı. Ekibimiz kontrol edip bakiyeni yükleyecek.");
    setHnote("");
    refresh();
  }

  const havale = sum?.methods.find(m => m.kind === "havale");
  const hasPaytr = !!sum?.methods.find(m => m.kind === "paytr");

  const amt = Number(amount);
  const amtOk = amt >= 50 && amt <= 50000;

  return (
    <main className="bk">
      <style dangerouslySetInnerHTML={{ __html: CSS }} />

      <div className="bk-wrap">
        <section className="bk-hero">
          <span className="bk-pill">HITY7 / WALLET</span>
          <h1>
            BAKİYE <span>YÜKLE.</span>
          </h1>
          <p>Siparişlerin bakiyenden ödenir. Bakiyeni güvenle yükle, sepetteki siparişini tek adımda tamamla.</p>
        </section>

        {!ready ? (
          <p className="bk-load">YÜKLENİYOR…</p>
        ) : !sb ? (
          <p className="bk-msg">Sistem henüz kurulmamış.</p>
        ) : !logged ? (
          <div className="bk-auth">
            <form className="bk-card bk-authcard" onSubmit={submitAuth}>
              <span className="bk-pill">{mode === "login" ? "GİRİŞ YAP" : "ÜYE OL"}</span>
              <h2>{mode === "login" ? "Hesabına gir" : "Hesap oluştur"}</h2>
              <p className="bk-sub">Bakiye yüklemek ve sipariş vermek için HITY7 hesabınla devam et.</p>
              <div className="bk-tabs" role="tablist" aria-label="Giriş veya üyelik">
                <button
                  type="button"
                  role="tab"
                  aria-selected={mode === "login"}
                  className={`bk-tab ${mode === "login" ? "on" : ""}`}
                  onClick={() => { setMode("login"); setAuthMsg(""); }}
                >
                  GİRİŞ YAP
                </button>
                <button
                  type="button"
                  role="tab"
                  aria-selected={mode === "register"}
                  className={`bk-tab ${mode === "register" ? "on" : ""}`}
                  onClick={() => { setMode("register"); setAuthMsg(""); }}
                >
                  ÜYE OL
                </button>
              </div>
              {mode === "register" && (
                <>
                  <label className="bk-lab" htmlFor="bk-name">ADIN SOYADIN</label>
                  <input id="bk-name" className="bk-in" value={name} onChange={e => setName(e.target.value)} autoComplete="name" />
                </>
              )}
              <label className="bk-lab" htmlFor="bk-mail">E-POSTA</label>
              <input id="bk-mail" className="bk-in" type="email" value={email} onChange={e => setEmail(e.target.value)} autoComplete="email" />
              <label className="bk-lab" htmlFor="bk-pass">ŞİFRE</label>
              <input
                id="bk-pass"
                className="bk-in"
                type="password"
                value={password}
                onChange={e => setPassword(e.target.value)}
                autoComplete={mode === "login" ? "current-password" : "new-password"}
              />
              {mode === "register" && <SozlesmeOnay tur="kayit" checked={kayitOnay} onChange={setKayitOnay} />}
              <button className="bk-btn" type="submit">{mode === "login" ? "GİRİŞ YAP ↗" : "HESAP OLUŞTUR ↗"}</button>
              {authMsg && <p className="bk-msg" role="alert">{authMsg}</p>}
              {mode === "login" && <a className="bk-link" href="/giris?tab=sifre">Şifremi unuttum</a>}
            </form>
          </div>
        ) : (
          <div className="bk-grid">
            <section className="bk-wallet" aria-label="Bakiye">
              <small>KULLANILABİLİR BAKİYE</small>
              <strong>{sum ? tl(sum.balance) : loadErr ? "—" : "…"}</strong>
              {sum && sum.pending > 0 && <p>Onay bekleyen yükleme: {tl(sum.pending)}</p>}
              {!sum && loadErr && <p>Bakiye bilgisi şu an alınamıyor.</p>}
              <p>Siparişlerin bu bakiyeden ödenir.</p>
              <div className="bk-wallet-links">
                <a href="/panel?tab=wallet">Cüzdanım ↗</a>
                <a href="/panel?tab=orders">Siparişlerim ↗</a>
                <button type="button" onClick={() => sb.auth.signOut().then(() => { setLogged(false); setSum(null); })}>Çıkış yap</button>
              </div>
            </section>

            <section className="bk-card">
              <span className="bk-pill">BAKİYE YÜKLE</span>
              <h2>Tutar seç</h2>
              {!sum && loadErr && (
                <p className="bk-msg" role="alert">
                  Bakiye yükleme şu an kullanılamıyor: {loadErr} Lütfen daha sonra tekrar dene veya destek ile iletişime geç.
                </p>
              )}
              <div className="bk-chips">
                {[250, 500, 1000, 2500, 5000].map(v => (
                  <button key={v} type="button" className={`bk-chip ${Number(amount) === v ? "on" : ""}`} onClick={() => setAmount(String(v))}>
                    {v.toLocaleString("tr-TR")} TL
                  </button>
                ))}
              </div>
              <label className="bk-lab" htmlFor="bk-amount">DİĞER TUTAR (TL)</label>
              <input id="bk-amount" className="bk-in" type="number" min="50" max="50000" value={amount} onChange={e => setAmount(e.target.value)} />
              <p className="bk-hint">En az 50 TL, en fazla 50.000 TL yükleyebilirsin.</p>

              {sum && !hasPaytr && !havale && <p className="bk-msg">Şu an aktif bir ödeme yöntemi yok. Lütfen destek ile iletişime geç.</p>}
              {(hasPaytr || havale) && (
                <>
                  <span className="bk-lab">ÖDEME YÖNTEMİ</span>
                  <div className="bk-methods">
                    {hasPaytr && (
                      <button type="button" className={`bk-method ${method === "paytr" ? "on" : ""}`} onClick={() => setMethod("paytr")} aria-pressed={method === "paytr"}>
                        <b>Kart ile öde</b>
                        <small>PayTR güvenli ödeme sayfası</small>
                      </button>
                    )}
                    {havale && (
                      <button type="button" className={`bk-method ${method === "havale" ? "on" : ""}`} onClick={() => setMethod("havale")} aria-pressed={method === "havale"}>
                        <b>Havale / EFT</b>
                        <small>Dekont kontrolüyle onaylanır</small>
                      </button>
                    )}
                  </div>
                </>
              )}

              {(hasPaytr || havale) && !iframe && <SozlesmeOnay tur="bakiye" checked={onay} onChange={setOnay} />}

              {method === "paytr" && hasPaytr && !iframe && (
                <button className="bk-btn" disabled={busy} onClick={startPaytr}>
                  {busy ? "HAZIRLANIYOR…" : amtOk ? `${amt.toLocaleString("tr-TR")} TL · KARTLA ÖDE ↗` : "KARTLA ÖDE ↗"}
                </button>
              )}
              {iframe && <iframe src={iframe} title="Ödeme" className="bk-pay" allow="payment" />}
              {method === "havale" && havale && (
                <div className="bk-hv">
                  <div className="bk-hv-row">
                    <span>IBAN</span>
                    <code>{havale.iban}</code>
                  </div>
                  <div className="bk-hv-row">
                    <span>HESAP SAHİBİ</span>
                    <b>{havale.holder}</b>
                  </div>
                  <p className="bk-hint">Havaleyi yaptıktan sonra aşağıdaki düğmeye bas. Açıklamaya e-posta adresini yaz.</p>
                  <input className="bk-in" placeholder="Not (örn. gönderen adı)" value={hnote} onChange={e => setHnote(e.target.value)} />
                  <button className="bk-btn" disabled={busy} onClick={sendHavale}>{busy ? "GÖNDERİLİYOR…" : "HAVALE YAPTIM ↗"}</button>
                </div>
              )}
              {msg && <p className="bk-msg" role="status">{msg}</p>}
            </section>

            <section className="bk-card bk-wide">
              <span className="bk-pill">HAREKETLER</span>
              <h2>Son işlemler</h2>
              {!sum || sum.transactions.length === 0 ? (
                <p className="bk-hint">Henüz hareket yok.</p>
              ) : (
                <div className="bk-list">
                  {sum.transactions.map(t => (
                    <div className="bk-row" key={t.id}>
                      <span className={`bk-ico ${t.kind}`} aria-hidden="true">{t.kind === "topup" ? "+" : "−"}</span>
                      <div className="bk-row-t">
                        <b>
                          {t.kind === "topup" ? "Bakiye yükleme" : "Harcama"}
                          {t.provider ? ` · ${PROVIDER[t.provider] || t.provider}` : ""}
                        </b>
                        <small>{new Date(t.created_at).toLocaleString("tr-TR")}</small>
                      </div>
                      {t.status === "pending" && <span className="bk-badge wait">Onay bekliyor</span>}
                      {t.status === "failed" && <span className="bk-badge fail">Başarısız</span>}
                      <strong className={`bk-amt ${t.status === "failed" ? "strike" : ""}`}>
                        {t.kind === "topup" ? "+" : "−"} {tl(Number(t.amount))}
                      </strong>
                    </div>
                  ))}
                </div>
              )}
            </section>
          </div>
        )}
      </div>

      <footer className="bk-foot">
        <div className="bk-wrap bk-foot-in">
          <Link href="/" className="bk-logo">HITY7<span className="bk-dot" /></Link>
          <span>DIGITAL CULTURE / 2026</span>
          <span>CREATE YOUR IMPACT.</span>
        </div>
      </footer>
    </main>
  );
}
