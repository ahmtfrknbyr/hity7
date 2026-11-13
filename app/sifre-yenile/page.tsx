"use client";

/**
 * app/sifre-yenile/page.tsx
 * "Şifremi unuttum" e-postasındaki bağlantı bu sayfayı açar. Supabase bağlantıdaki geçici oturumu otomatik kurar;
 * kullanıcı yeni şifresini belirler. Bağlantı geçersiz veya süresi dolmuşsa yenisi istenir.
 */
import { useEffect, useState } from "react";
import { useRouter } from "next/navigation";
import { getSupabase } from "../../lib/supabase";
import { GIRIS_CSS } from "../../components/giris-stil";

type State = "bekle" | "hazir" | "gecersiz" | "tamam";

function trError(message: string): string {
  const m = message.toLowerCase();
  if (m.includes("different from the old")) return "Yeni şifre eskisiyle aynı olamaz.";
  if (m.includes("at least") || m.includes("too short")) return "Şifre çok kısa. En az 8 karakter kullan.";
  if (m.includes("weak") || m.includes("pwned") || m.includes("easy to guess")) return "Bu şifre çok zayıf. Harf ve rakam karışık, daha uzun bir şifre dene.";
  if (m.includes("session") || m.includes("jwt") || m.includes("expired")) return "Bağlantının süresi dolmuş. Yeni bir bağlantı iste.";
  return "Şifre güncellenemedi. Lütfen tekrar dene.";
}

export default function SifreYenilePage() {
  const router = useRouter();
  const [state, setState] = useState<State>("bekle");
  const [password, setPassword] = useState("");
  const [again, setAgain] = useState("");
  const [msg, setMsg] = useState("");
  const [busy, setBusy] = useState(false);

  useEffect(() => {
    let alive = true;
    // Bağlantı hatalıysa Supabase adres çubuğuna hata bilgisi ekler
    const hashError = /error=|error_description=/.test(window.location.hash);
    let sb: ReturnType<typeof getSupabase>;
    try {
      sb = getSupabase();
    } catch {
      const t = setTimeout(() => {
        if (alive) setState("gecersiz");
      }, 0);
      return () => {
        alive = false;
        clearTimeout(t);
      };
    }
    // Bağlantıdaki oturum kurulunca (veya zaten giriş yapılmışsa) form açılır
    const { data } = sb.auth.onAuthStateChange((_event, session) => {
      if (!alive) return;
      if (session) setState((s) => (s === "tamam" ? s : "hazir"));
      else if (hashError) setState((s) => (s === "bekle" ? "gecersiz" : s));
    });
    // Birkaç saniye içinde oturum kurulamazsa bağlantı geçersizdir
    const timer = setTimeout(() => {
      if (alive) setState((s) => (s === "bekle" ? "gecersiz" : s));
    }, 6000);
    return () => {
      alive = false;
      clearTimeout(timer);
      data.subscription.unsubscribe();
    };
  }, []);

  async function submit(e: React.FormEvent) {
    e.preventDefault();
    setMsg("");
    if (password.length < 8) return setMsg("Şifre en az 8 karakter olmalı.");
    if (password !== again) return setMsg("İki şifre birbirinin aynısı olmalı.");
    setBusy(true);
    try {
      const { error } = await getSupabase().auth.updateUser({ password });
      setBusy(false);
      if (error) return setMsg(trError(error.message));
    } catch {
      setBusy(false);
      return setMsg("Bağlantı hatası. İnternetini kontrol edip tekrar dene.");
    }
    setState("tamam");
    setTimeout(() => router.push("/panel"), 1800);
  }

  return (
    <main className="gr-root">
      <style dangerouslySetInnerHTML={{ __html: GIRIS_CSS }} />
      <div className="gr-main">
        <form className="gr-card" onSubmit={submit}>
          <span className="gr-pill">HITY7 / HESABIM</span>
          <h1>
            YENİ <span>ŞİFRE.</span>
          </h1>

          {state === "bekle" && <p className="gr-sub" style={{ marginTop: 12 }}>Bağlantın kontrol ediliyor…</p>}

          {state === "gecersiz" && (
            <>
              <p className="gr-msg" role="alert">
                Bu bağlantı geçersiz veya süresi dolmuş. Şifre sıfırlama bağlantıları kısa süre geçerlidir ve yalnızca bir kez kullanılabilir.
              </p>
              <a className="gr-btn" href="/giris?tab=sifre" style={{ display: "block", textAlign: "center" }}>
                YENİ BAĞLANTI İSTE ↗
              </a>
            </>
          )}

          {state === "hazir" && (
            <>
              <p className="gr-sub">Hesabın için yeni bir şifre belirle. En az 8 karakter olmalı.</p>
              <label className="gr-lab" htmlFor="sy-pass">YENİ ŞİFRE</label>
              <input id="sy-pass" className="gr-in" type="password" value={password} onChange={(e) => setPassword(e.target.value)} autoComplete="new-password" placeholder="En az 8 karakter" />
              <label className="gr-lab" htmlFor="sy-again">YENİ ŞİFRE (TEKRAR)</label>
              <input id="sy-again" className="gr-in" type="password" value={again} onChange={(e) => setAgain(e.target.value)} autoComplete="new-password" placeholder="Aynı şifreyi tekrar yaz" />
              <button className="gr-btn" disabled={busy}>{busy ? "KAYDEDİLİYOR…" : "ŞİFREYİ KAYDET ↗"}</button>
              {msg && <p className="gr-msg" role="alert">{msg}</p>}
            </>
          )}

          {state === "tamam" && (
            <p className="gr-msg ok" role="status">
              Şifren güncellendi ✓ Hesabına yönlendiriliyorsun…
            </p>
          )}
        </form>
      </div>
    </main>
  );
}
