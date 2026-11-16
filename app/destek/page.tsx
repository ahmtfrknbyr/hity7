"use client";

import { useCallback, useEffect, useState } from "react";
import Link from "next/link";
import { getSupabase } from "../../lib/supabase";
import { uploadOrderFiles, type UploadedFile } from "../../lib/siparis";
import { EkListesi, EkSecici, type Ek } from "../../components/DestekEkleri";

type Msg = { id: string; sender: "customer" | "staff"; body: string; attachments?: Ek[]; created_at: string };
type Thread = { ticket: { no: string; subject: string; status: string; sahibi?: boolean }; messages: Msg[] };
type Talep = { no: string; subject: string; status: string; updated_at: string; okunmamis: number };

/** Durum değerleri değişmez; ekranda anlaşılır adlarla gösterilir */
const DURUM: Record<string, string> = { Yeni: "Açık", Yanıtlandı: "İşlemde", Kapandı: "Çözüldü" };

/** Ekleri giriş yapmış üyenin özel destek klasörüne yükler */
async function ekleriYukle(files: File[]): Promise<UploadedFile[]> {
  if (!files.length) return [];
  return uploadOrderFiles(files, { amac: "destek", kind: "destek" });
}

async function api(body: Record<string, unknown>) {
  const sb = getSupabase();
  const token = sb ? (await sb.auth.getSession()).data.session?.access_token : undefined;
  const res = await fetch("/api/destek", {
    method: "POST",
    headers: { "content-type": "application/json", ...(token ? { Authorization: `Bearer ${token}` } : {}) },
    body: JSON.stringify(body),
  });
  const json = await res.json().catch(() => ({}));
  return { ok: res.ok, json };
}

const CSS = `
.ds-root{flex:1;min-height:100vh;color:#111;font-family:Inter,system-ui,-apple-system,"Segoe UI",Roboto,Arial,sans-serif;background-color:#fff;background-image:radial-gradient(#d9d9d9 1.4px,transparent 1.5px);background-size:28px 28px;-webkit-font-smoothing:antialiased}
.ds-root *,.ds-root *::before,.ds-root *::after{box-sizing:border-box}
.ds-root :where(a){color:inherit}
.ds-root :where(button,input,textarea){font:inherit;color:inherit}
.ds-root :where(h1,h2,h3,p){margin:0}
.ds-root :focus-visible{outline:3px solid #111;outline-offset:3px}
.ds-hd{font-family:"Bricolage Grotesque","Helvetica Neue",Arial,sans-serif}
.ds-wrap{max-width:1240px;margin:0 auto;padding:0 24px 90px}

.ds-pill{display:inline-flex;align-items:center;gap:10px;border:2.5px solid #111;border-radius:999px;background:#fff;padding:6px 14px;font-size:12px;font-weight:700;letter-spacing:.14em}
.ds-pill i{width:9px;height:9px;border-radius:50%;border:2px solid #111;background:#f5c518;display:inline-block}

.ds-hero{display:grid;grid-template-columns:1fr 340px;gap:32px;align-items:end;padding:56px 0 44px}
.ds-hero h1{font-size:clamp(44px,7vw,84px);line-height:.95;letter-spacing:-.045em;font-weight:800;margin:22px 0 0}
.ds-hero h1 span{background:#f5c518;border:3px solid #111;border-radius:18px;padding:0 .14em;display:inline-block;transform:rotate(-1.5deg)}
.ds-hero p{max-width:520px;margin-top:20px;color:#686868;font-size:16px;line-height:1.75}
.ds-facts{background:#111;color:#fff;border:3px solid #111;border-radius:28px;padding:22px;box-shadow:0 8px 0 #f5c518}
.ds-facts div{display:flex;justify-content:space-between;gap:12px;padding:12px 0;border-bottom:2px dashed #333;font-size:13px}
.ds-facts div:last-child{border-bottom:0;padding-bottom:0}
.ds-facts div:first-child{padding-top:0}
.ds-facts b{color:#f5c518;font-weight:800}

.ds-grid{display:grid;grid-template-columns:1fr 1fr;gap:28px;align-items:start}
.ds-card{background:#fff;border:3px solid #111;border-radius:32px;padding:32px;box-shadow:0 10px 0 #111}
.ds-step{display:flex;align-items:center;gap:14px;margin-bottom:6px}
.ds-num{display:grid;place-items:center;width:44px;height:44px;flex:none;border-radius:50%;border:2.5px solid #111;background:#f5c518;font-weight:800;font-size:14px}
.ds-step h2{font-size:28px;font-weight:800;letter-spacing:-.03em}
.ds-desc{color:#686868;font-size:14px;line-height:1.6;margin:6px 0 4px}

.ds-lab{display:block;font-size:11px;font-weight:800;letter-spacing:.12em;margin:18px 0 8px}
.ds-in{width:100%;border:2.5px solid #111;border-radius:16px;background:#fff;padding:14px 16px;font-size:15px;outline:none}
.ds-in:focus{background:#fffdf2;box-shadow:0 0 0 4px #f5c518}
textarea.ds-in{resize:vertical;min-height:120px;line-height:1.6}
.ds-row{display:grid;grid-template-columns:1fr 1fr;gap:14px}

.ds-btn{width:100%;margin-top:22px;border:2.5px solid #111;border-radius:999px;background:#f5c518;padding:16px;font-size:14px;font-weight:800;letter-spacing:.04em;cursor:pointer;box-shadow:0 4px 0 #111;transition:transform .1s,box-shadow .1s,background .2s}
.ds-btn:hover{transform:translateY(-1px);box-shadow:0 6px 0 #111;background:#e5b600}
.ds-btn:active{transform:translateY(3px);box-shadow:0 1px 0 #111}
.ds-btn:disabled{opacity:.55;cursor:wait}
.ds-btn.dark{background:#111;color:#fff;box-shadow:0 4px 0 #f5c518}
.ds-btn.dark:hover{background:#242424}

.ds-msg{margin-top:16px;border:2.5px solid #111;border-radius:16px;background:#fff6cf;padding:12px 14px;font-size:13px;line-height:1.6;font-weight:600}
.ds-ok{margin-top:20px;border:3px solid #111;border-radius:24px;background:#f5c518;padding:22px;font-size:14px;line-height:1.8}
.ds-ok strong.no{display:inline-block;margin:4px 0;background:#fff;border:2.5px solid #111;border-radius:12px;padding:2px 10px;font-size:20px;letter-spacing:.02em}
.ds-link{display:inline-block;margin-top:12px;background:none;border:0;padding:0;text-decoration:underline;text-underline-offset:3px;cursor:pointer;font-size:13px;font-weight:700}

.ds-thread{margin-top:26px;border-top:2.5px dashed #111;padding-top:20px}
.ds-meta{display:flex;flex-wrap:wrap;align-items:center;gap:8px;margin-bottom:16px;font-size:12px;font-weight:700}
.ds-tag{border:2px solid #111;border-radius:999px;padding:3px 10px;background:#fff}
.ds-tag.st{background:#f5c518}
.ds-bubble{max-width:88%;padding:12px 16px;margin-bottom:10px;border:2.5px solid #111;border-radius:20px 20px 20px 6px;background:#f5f5f5;font-size:14px;line-height:1.6}
.ds-bubble p{white-space:pre-wrap;overflow-wrap:anywhere}
.ds-bubble small{display:block;margin-top:6px;font-size:11px;color:#686868;font-weight:600}
.ds-bubble.staff{margin-left:auto;background:#111;color:#fff;border-radius:20px 20px 6px 20px}
.ds-bubble.staff small{color:#f5c518}
.ds-reply{margin-top:14px}

.ds-foot{border-top:3px solid #111;margin-top:80px;padding-top:24px;display:flex;justify-content:space-between;align-items:center;flex-wrap:wrap;gap:14px;font-size:11px;font-weight:800;letter-spacing:.12em;color:#686868}
.ds-foot .lg{font-size:22px;font-weight:900;letter-spacing:-1px;color:#111;display:inline-flex;align-items:baseline;gap:3px;text-decoration:none}
.ds-foot .lg i{width:8px;height:8px;border-radius:50%;background:#f5c518;border:2px solid #111;display:inline-block}

@media (max-width:960px){.ds-hero{grid-template-columns:1fr}.ds-grid{grid-template-columns:1fr}}
@media (max-width:560px){.ds-wrap{padding:0 16px 70px}.ds-hero{padding:36px 0 32px}.ds-card{padding:22px 18px;border-radius:26px}.ds-row{grid-template-columns:1fr;gap:0}.ds-step h2{font-size:24px}}
`;

export default function DestekPage() {
  const [name, setName] = useState("");
  const [contact, setContact] = useState("");
  const [subject, setSubject] = useState("");
  const [code, setCode] = useState("");
  const [message, setMessage] = useState("");
  const [notice, setNotice] = useState("");
  const [busy, setBusy] = useState(false);
  const [createdNo, setCreatedNo] = useState("");

  const [qNo, setQNo] = useState("");
  const [qContact, setQContact] = useState("");
  const [thread, setThread] = useState<Thread | null>(null);
  const [qNotice, setQNotice] = useState("");
  const [reply, setReply] = useState("");
  const [girisli, setGirisli] = useState(false);
  const [ekler, setEkler] = useState<File[]>([]);
  const [yanitEkler, setYanitEkler] = useState<File[]>([]);
  const [talepler, setTalepler] = useState<Talep[]>([]);

  const taleplerimiOku = useCallback(async () => {
    const r = await api({ action: "taleplerim" });
    if (r.ok) setTalepler(r.json.talepler || []);
  }, []);

  // Giriş yapmış üyenin adını ve e-postasını forma önceden yaz; taleplerini listele
  useEffect(() => {
    let sb: ReturnType<typeof getSupabase> | null = null;
    try { sb = getSupabase(); } catch { return; }
    sb?.auth.getSession().then(({ data }) => {
      const u = data.session?.user;
      if (!u) return;
      setGirisli(true);
      void taleplerimiOku();
      const full = (u.user_metadata?.full_name as string | undefined) || "";
      if (full) setName(n => n || full);
      if (u.email) {
        setContact(c => c || u.email!);
        setQContact(c => c || u.email!);
      }
    });
  }, [taleplerimiOku]);

  async function create() {
    setNotice("");
    if (!name.trim() || !contact.trim() || !subject.trim() || !message.trim()) {
      setNotice("Lütfen ad, iletişim, konu ve mesaj alanlarını doldur.");
      return;
    }
    setBusy(true);
    try {
      const yuklenen = await ekleriYukle(ekler);
      const r = await api({ action: "create", name, contact, subject, message, code, ekler: yuklenen });
      if (!r.ok) {
        setBusy(false);
        return setNotice(r.json.error || "Mesaj gönderilemedi.");
      }
      setCreatedNo(r.json.no);
      setQNo(r.json.no);
      setQContact(contact);
      setSubject("");
      setMessage("");
      setCode("");
      setEkler([]);
      void taleplerimiOku();
    } catch (e) {
      setNotice(e instanceof Error ? e.message : "Dosya yüklenemedi.");
    }
    setBusy(false);
  }

  const lookup = useCallback(async (no = qNo, sessiz = false) => {
    if (!sessiz) setQNotice("");
    const r = await api({ action: "lookup", no, contact: qContact });
    if (!r.ok) {
      if (!sessiz) {
        setThread(null);
        setQNotice(r.json.error || "Talep bulunamadı.");
      }
      return;
    }
    setThread(r.json as Thread);
  }, [qNo, qContact]);

  // Açık konuşma her 15 saniyede bir yenilenir (yeni mesajlar otomatik görünür)
  useEffect(() => {
    if (!thread) return;
    const no = thread.ticket.no;
    const t = setInterval(() => {
      if (document.visibilityState === "visible") void lookup(no, true);
    }, 15000);
    return () => clearInterval(t);
  }, [thread, lookup]);

  async function sendReply() {
    if (!reply.trim() && !yanitEkler.length) return;
    setBusy(true);
    try {
      const yuklenen = await ekleriYukle(yanitEkler);
      const r = await api({ action: "reply", no: thread?.ticket.no || qNo, contact: qContact, message: reply, ekler: yuklenen });
      if (!r.ok) {
        setBusy(false);
        return setQNotice(r.json.error || "Gönderilemedi.");
      }
      setReply("");
      setYanitEkler([]);
      setThread(r.json as Thread);
    } catch (e) {
      setQNotice(e instanceof Error ? e.message : "Dosya yüklenemedi.");
    }
    setBusy(false);
  }

  return (
    <main className="ds-root">
      <link rel="preconnect" href="https://fonts.googleapis.com" />
      <link rel="preconnect" href="https://fonts.gstatic.com" crossOrigin="" />
      <link
        href="https://fonts.googleapis.com/css2?family=Bricolage+Grotesque:opsz,wght@12..96,700;12..96,800&family=Inter:wght@400;500;600;700;800&display=swap"
        rel="stylesheet"
      />
      <style dangerouslySetInnerHTML={{ __html: CSS }} />

      <div className="ds-wrap">
        <section className="ds-hero">
          <div>
            <span className="ds-pill"><i /> HITY7 / DESTEK</span>
            <h1 className="ds-hd">YARDIM<br /><span>AL.</span></h1>
            <p>Sorununu ya da önerini yaz, ekibimiz en kısa sürede dönsün. Sipariş kodun varsa ekle, işin hızlansın.</p>
          </div>
          <div className="ds-facts">
            <div><span>Takip</span><b>Talep numarasıyla</b></div>
            <div><span>Yanıtlar</span><b>Bu sayfada</b></div>
            <div><span>Sipariş kodu</span><b>Varsa ekle</b></div>
          </div>
        </section>

        <div className="ds-grid">
          <section className="ds-card">
            <div className="ds-step">
              <span className="ds-num">01</span>
              <h2 className="ds-hd">Mesaj gönder</h2>
            </div>
            <p className="ds-desc">Formu doldur, sana bir talep numarası verelim.</p>

            {createdNo ? (
              <div className="ds-ok">
                <strong>Mesajın alındı ✓</strong><br />
                Talep numaran:<br />
                <strong className="no">{createdNo}</strong><br />
                Yanıtı yandaki bölümden bu numarayla görebilirsin.<br />
                <button className="ds-link" onClick={() => setCreatedNo("")}>Yeni mesaj yaz</button>
              </div>
            ) : (
              <>
                <div className="ds-row">
                  <div>
                    <label className="ds-lab" htmlFor="n">ADIN SOYADIN</label>
                    <input className="ds-in" id="n" value={name} onChange={e => setName(e.target.value)} placeholder="Adın Soyadın" />
                  </div>
                  <div>
                    <label className="ds-lab" htmlFor="c">E-POSTA VEYA TELEFON</label>
                    <input className="ds-in" id="c" value={contact} onChange={e => setContact(e.target.value)} placeholder="Sana ulaşabilmemiz için" />
                  </div>
                </div>
                <div className="ds-row">
                  <div>
                    <label className="ds-lab" htmlFor="s">KONU</label>
                    <input className="ds-in" id="s" value={subject} onChange={e => setSubject(e.target.value)} placeholder="Kısaca konu" />
                  </div>
                  <div>
                    <label className="ds-lab" htmlFor="k">SİPARİŞ KODU (VARSA)</label>
                    <input className="ds-in" id="k" value={code} onChange={e => setCode(e.target.value)} placeholder="Örn. 7777-3-48213" />
                  </div>
                </div>
                <label className="ds-lab" htmlFor="m">MESAJIN</label>
                <textarea className="ds-in" id="m" rows={5} value={message} onChange={e => setMessage(e.target.value)} placeholder="Nasıl yardımcı olabiliriz?" />
                {girisli ? (
                  <EkSecici dosyalar={ekler} onChange={setEkler} />
                ) : (
                  <p className="ds-desc" style={{ marginTop: 10 }}>Fotoğraf, video veya şarkı dosyası eklemek için <a href="/giris?next=/destek" style={{ fontWeight: 800, textDecoration: "underline" }}>giriş yap</a>.</p>
                )}
                <button className="ds-btn" onClick={create} disabled={busy}>{busy ? "GÖNDERİLİYOR…" : "MESAJI GÖNDER ↗"}</button>
                {notice && <p className="ds-msg">{notice}</p>}
              </>
            )}
          </section>

          <section className="ds-card">
            <div className="ds-step">
              <span className="ds-num">02</span>
              <h2 className="ds-hd">Yanıtı gör</h2>
            </div>
            <p className="ds-desc">Talep numaran ve mesajda yazdığın iletişim bilgisiyle sorgula.</p>

            {girisli && talepler.length > 0 && (
              <div style={{ marginTop: 14, display: "grid", gap: 8 }}>
                <span className="ds-lab" style={{ margin: 0 }}>TALEPLERİM</span>
                {talepler.map((t) => (
                  <button
                    key={t.no}
                    type="button"
                    onClick={() => { setQNo(t.no); void lookup(t.no); }}
                    style={{ textAlign: "left", border: "2.5px solid #111", borderRadius: 16, padding: "10px 12px", background: thread?.ticket.no === t.no ? "#fff6cf" : "#fff", cursor: "pointer", display: "flex", justifyContent: "space-between", gap: 10 }}
                  >
                    <span style={{ fontSize: 13, fontWeight: 700 }}>
                      {t.no} · {t.subject}
                      <br />
                      <small style={{ color: "#686868", fontWeight: 600 }}>{DURUM[t.status] || t.status}</small>
                    </span>
                    {t.okunmamis > 0 && <span className="ds-tag st" style={{ alignSelf: "center", whiteSpace: "nowrap" }}>{t.okunmamis} yeni</span>}
                  </button>
                ))}
              </div>
            )}

            <div className="ds-row">
              <div>
                <label className="ds-lab" htmlFor="qn">TALEP NUMARASI</label>
                <input className="ds-in" id="qn" value={qNo} onChange={e => setQNo(e.target.value)} placeholder="Örn. T-0001" />
              </div>
              <div>
                <label className="ds-lab" htmlFor="qc">E-POSTA / TELEFON</label>
                <input className="ds-in" id="qc" value={qContact} onChange={e => setQContact(e.target.value)} placeholder="Mesajda yazdığın" />
              </div>
            </div>
            <button className="ds-btn dark" onClick={() => lookup()}>SORGULA</button>
            {qNotice && <p className="ds-msg">{qNotice}</p>}

            {thread && (
              <div className="ds-thread">
                <div className="ds-meta">
                  <span className="ds-tag">{thread.ticket.no}</span>
                  <span>{thread.ticket.subject}</span>
                  <span className="ds-tag st">{DURUM[thread.ticket.status] || thread.ticket.status}</span>
                </div>
                {thread.messages.map((m, i) => (
                  <div key={m.id || i} className={`ds-bubble ${m.sender}`}>
                    <p>{m.body}</p>
                    {m.attachments && m.attachments.length > 0 && m.id && <EkListesi mesajId={m.id} ekler={m.attachments} karanlik={m.sender === "staff"} />}
                    <small>{m.sender === "staff" ? "HITY7 Ekibi" : "Sen"} · {new Date(m.created_at).toLocaleString("tr-TR")}</small>
                  </div>
                ))}
                {thread.ticket.status !== "Kapandı" && (
                  <div className="ds-reply">
                    <textarea className="ds-in" rows={3} value={reply} onChange={e => setReply(e.target.value)} placeholder="Yanıtını yaz…" />
                    {thread.ticket.sahibi && <EkSecici dosyalar={yanitEkler} onChange={setYanitEkler} />}
                    <button className="ds-btn" onClick={sendReply} disabled={busy}>{busy ? "GÖNDERİLİYOR…" : "YANIT GÖNDER ↗"}</button>
                  </div>
                )}
              </div>
            )}
          </section>
        </div>

        <footer className="ds-foot">
          <Link href="/" className="lg">HITY7<i /></Link>
          <span>DIGITAL CULTURE / 2026</span>
          <span>CREATE YOUR IMPACT.</span>
        </footer>
      </div>
    </main>
  );
}
