"use client";

import { useEffect, useState, useSyncExternalStore } from "react";
import { getSupabase } from "../../lib/supabase";
import { GIRIS_CSS } from "../../components/giris-stil";
import SozlesmeOnay from "../../components/SozlesmeOnay";
import { LEGAL_VERSION } from "../../lib/yasal-belgeler";

type Mode = "login" | "register" | "reset";

function safeNext(): string {
  try {
    const n = new URLSearchParams(window.location.search).get("next") || "";
    if (n.startsWith("/") && !n.startsWith("//")) return n;
  } catch {}
  return "/panel";
}

const noSubscribe = () => () => {};

/** Adres çubuğundaki ?tab= değeri (sunucuda boş; hydration uyumlu) */
function useTabParam(): string {
  return useSyncExternalStore(
    noSubscribe,
    () => new URLSearchParams(window.location.search).get("tab") || "",
    () => ""
  );
}

export default function GirisPage() {
  const tabParam = useTabParam();
  const [chosen, setChosen] = useState<Mode | null>(null);
  const mode: Mode = chosen ?? (tabParam === "kayit" ? "register" : tabParam === "sifre" ? "reset" : "login");
  const [name, setName] = useState("");
  const [email, setEmail] = useState("");
  const [password, setPassword] = useState("");
  const [onay, setOnay] = useState(false);
  const [msg, setMsg] = useState("");
  const [msgOk, setMsgOk] = useState(false);
  const [busy, setBusy] = useState(false);
  const [dogrulaBekle, setDogrulaBekle] = useState(false);

  useEffect(() => {
    let sb: ReturnType<typeof getSupabase>;
    try {
      sb = getSupabase();
    } catch {
      return;
    }
    sb.auth.getSession().then(({ data }) => {
      if (data.session) window.location.href = safeNext();
    });
  }, []);

  function switchMode(m: Mode) {
    setChosen(m);
    setMsg("");
    setMsgOk(false);
  }

  async function submit(e: React.FormEvent) {
    e.preventDefault();
    let sb: ReturnType<typeof getSupabase>;
    try {
      sb = getSupabase();
    } catch {
      return setMsg("Sistem henüz kurulmamış.");
    }
    const mail = email.trim().toLowerCase();
    setMsg("");
    setMsgOk(false);
    if (!/^\S+@\S+\.\S+$/.test(mail)) return setMsg("Lütfen geçerli bir e-posta yaz.");

    /* Şifremi unuttum: e-postaya sıfırlama bağlantısı */
    if (mode === "reset") {
      setBusy(true);
      const { error } = await sb.auth.resetPasswordForEmail(mail, { redirectTo: `${window.location.origin}/sifre-yenile` });
      setBusy(false);
      if (error) {
        const m = error.message.toLowerCase();
        if (error.status === 429 || m.includes("security purposes") || m.includes("rate limit")) {
          return setMsg("Çok sık denedin. Bir dakika bekleyip tekrar dene.");
        }
        return setMsg("Bağlantı gönderilemedi. Lütfen biraz sonra tekrar dene.");
      }
      setMsgOk(true);
      return setMsg("Bu e-postayla kayıtlı bir hesap varsa şifre sıfırlama bağlantısını gönderdik. Gelen kutunu ve spam klasörünü kontrol et.");
    }

    if (password.length < 8) return setMsg("Şifre en az 8 karakter olmalı.");
    if (mode === "register" && !name.trim()) return setMsg("Lütfen adını soyadını yaz.");
    if (mode === "register" && !onay) return setMsg("Üye olmak için Kullanım Koşulları’nı kabul etmelisin.");
    setBusy(true);
    if (mode === "register") {
      const { data, error } = await sb.auth.signUp({
        email: mail,
        password,
        options: {
          emailRedirectTo: `${window.location.origin}/giris`,
          data: { full_name: name.trim(), terms_version: LEGAL_VERSION, terms_accepted_at: new Date().toISOString() },
        },
      });
      setBusy(false);
      if (error) return setMsg(error.message.toLowerCase().includes("already") ? "Bu e-posta ile zaten üyelik var. Giriş yapmayı dene." : error.message);
      if (!data.session) {
        setMsgOk(true);
        setDogrulaBekle(true);
        return setMsg("Kayıt alındı. E-postana bir doğrulama bağlantısı gönderdik; bağlantıya tıkladıktan sonra giriş yapabilirsin. Gelmezse spam klasörüne bak.");
      }
    } else {
      const { error } = await sb.auth.signInWithPassword({ email: mail, password });
      setBusy(false);
      if (error) {
        if (error.message.toLowerCase().includes("not confirmed")) {
          setDogrulaBekle(true);
          return setMsg("E-postan henüz doğrulanmamış. Gelen kutundaki doğrulama bağlantısına tıkla; gelmediyse aşağıdan yeniden gönder.");
        }
        return setMsg("E-posta veya şifre hatalı.");
      }
    }
    window.location.href = safeNext();
  }

  async function tekrarGonder() {
    let sb: ReturnType<typeof getSupabase>;
    try {
      sb = getSupabase();
    } catch {
      return;
    }
    const mail = email.trim().toLowerCase();
    if (!/^\S+@\S+\.\S+$/.test(mail)) return setMsg("Önce e-posta adresini yaz.");
    setBusy(true);
    const { error } = await sb.auth.resend({ type: "signup", email: mail, options: { emailRedirectTo: `${window.location.origin}/giris` } });
    setBusy(false);
    if (error) {
      const m = error.message.toLowerCase();
      setMsgOk(false);
      return setMsg(error.status === 429 || m.includes("security purposes") || m.includes("rate limit") ? "Çok sık denedin. Bir dakika bekleyip tekrar dene." : "Doğrulama e-postası gönderilemedi. Lütfen biraz sonra tekrar dene.");
    }
    setMsgOk(true);
    setMsg("Doğrulama e-postasını yeniden gönderdik. Gelen kutunu ve spam klasörünü kontrol et.");
  }

  return (
    <main className="gr-root">
      <style dangerouslySetInnerHTML={{ __html: GIRIS_CSS }} />
      <div className="gr-main">
        <form className="gr-card" onSubmit={submit}>
          <span className="gr-pill">HITY7 / HESABIM</span>
          <h1>
            {mode === "login" ? <>HOŞ <span>GELDİN.</span></> : mode === "register" ? <>ÜYE <span>OL.</span></> : <>ŞİFRENİ <span>YENİLE.</span></>}
          </h1>
          <p className="gr-sub">
            {mode === "login"
              ? "Siparişlerini, bakiyeni ve yayınlarını tek yerden yönet."
              : mode === "register"
                ? "Sipariş vermek ve bakiye yüklemek için ücretsiz hesap oluştur."
                : "Hesabına kayıtlı e-postayı yaz; sana şifreni yenilemen için bir bağlantı gönderelim."}
          </p>

          <div className="gr-tabs">
            <button type="button" className={`gr-tab ${mode === "login" ? "on" : ""}`} onClick={() => switchMode("login")}>GİRİŞ YAP</button>
            <button type="button" className={`gr-tab ${mode === "register" ? "on" : ""}`} onClick={() => switchMode("register")}>ÜYE OL</button>
          </div>

          {mode === "register" && (
            <>
              <label className="gr-lab" htmlFor="gr-name">ADIN SOYADIN</label>
              <input id="gr-name" className="gr-in" value={name} onChange={e => setName(e.target.value)} autoComplete="name" placeholder="Adın Soyadın" />
            </>
          )}
          <label className="gr-lab" htmlFor="gr-mail">E-POSTA</label>
          <input id="gr-mail" className="gr-in" type="email" value={email} onChange={e => setEmail(e.target.value)} autoComplete="email" placeholder="ornek@mail.com" />
          {mode !== "reset" && (
            <>
              <label className="gr-lab" htmlFor="gr-pass">ŞİFRE</label>
              <input id="gr-pass" className="gr-in" type="password" value={password} onChange={e => setPassword(e.target.value)} autoComplete={mode === "login" ? "current-password" : "new-password"} placeholder="En az 8 karakter" />
            </>
          )}
          {mode === "login" && (
            <div className="gr-row">
              <button type="button" className="gr-link" onClick={() => switchMode("reset")}>Şifremi unuttum</button>
            </div>
          )}
          {mode === "register" && <SozlesmeOnay tur="kayit" checked={onay} onChange={setOnay} />}

          <button className="gr-btn" disabled={busy}>
            {busy ? "BEKLE…" : mode === "login" ? "GİRİŞ YAP ↗" : mode === "register" ? "HESAP OLUŞTUR ↗" : "BAĞLANTI GÖNDER ↗"}
          </button>
          {msg && <p className={`gr-msg ${msgOk ? "ok" : ""}`} role={msgOk ? "status" : "alert"}>{msg}</p>}
          {dogrulaBekle && mode !== "reset" && (
            <p className="gr-note">
              <button type="button" className="gr-link" disabled={busy} onClick={tekrarGonder}>Doğrulama e-postasını tekrar gönder</button>
            </p>
          )}
          {mode === "reset" ? (
            <p className="gr-note">
              <button type="button" className="gr-link" onClick={() => switchMode("login")}>← Girişe dön</button>
            </p>
          ) : (
            <p className="gr-note">Yönetim paneline giriş için <a href="/ceo"><b>/ceo</b></a> adresini kullan.</p>
          )}
        </form>
      </div>
    </main>
  );
}
