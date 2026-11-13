"use client";

/**
 * components/SiteMenu.tsx
 * Tüm sayfalarda aynı görünen ortak site menüsü (kendi stiliyle, projedeki CSS'e bağlı değildir).
 * Menü bağlantıları yalnızca giriş yapmış üyelere gösterilir; ziyaretçiler sadece logo + Giriş / Üye Ol görür.
 * Sepet düğmesi (components/Sepet.tsx) herkese, sağ üstte ürün sayısıyla görünür.
 * Kullanım: <SiteMenu active="/remake-beat" />   (koyu sayfalarda: <SiteMenu active="..." dark />)
 */
import { useEffect, useState } from "react";
import Link from "next/link";
import BakiyeChip from "./BakiyeChip";
import SepetButonu from "./Sepet";
import { getSupabase } from "../lib/supabase";

const LINKS: [string, string][] = [
  ["/smm-panel", "SMM PANEL"],
  ["/influencer-marketing", "INFLUENCER"],
  ["/remake-beat", "REMAKE BEAT"],
  ["/mix-mastering", "MIX & MASTERING"],
  ["/dijital-yayin", "DİJİTAL YAYIN"],
  ["/destek", "DESTEK"],
];

const CSS = `
.sm-bar{position:sticky;top:0;z-index:50;background:rgba(255,255,255,.95);backdrop-filter:blur(8px);border-bottom:3px solid #111;font-family:Inter,"Helvetica Neue",Arial,sans-serif;-webkit-font-smoothing:antialiased}
.sm-bar.dark{background:rgba(9,9,9,.95);border-bottom-color:#f5c518}
.sm-bar *,.sm-bar *::before,.sm-bar *::after{box-sizing:border-box}
.sm-in{max-width:1360px;margin:0 auto;height:68px;padding:0 24px;display:flex;align-items:center;justify-content:space-between;gap:16px}
.sm-logo{font-size:26px;font-weight:900;letter-spacing:-1.5px;color:#111;text-decoration:none;display:inline-flex;align-items:baseline;gap:3px}
.dark .sm-logo{color:#fff}
.sm-dot{width:9px;height:9px;border-radius:50%;background:#f5c518;border:2px solid #111;display:inline-block}
.dark .sm-dot{border-color:#fff}
.sm-nav{display:flex;gap:20px}
.sm-nav a{font-size:11px;font-weight:800;letter-spacing:1px;color:#686868;text-decoration:none;padding:6px 0;white-space:nowrap}
.dark .sm-nav a{color:#aaa}
.sm-nav a.on,.sm-nav a:hover{color:#111;box-shadow:0 3px 0 #f5c518}
.dark .sm-nav a.on,.dark .sm-nav a:hover{color:#fff}
.sm-right{display:flex;align-items:center;gap:10px}
.sm-acc{border:2.5px solid #111;border-radius:999px;padding:8px 16px;font-size:11px;font-weight:800;letter-spacing:.8px;background:#fff;color:#111;text-decoration:none;white-space:nowrap}
.sm-acc:hover{background:#f5c518}
.sm-acc.yel{background:#f5c518;box-shadow:0 3px 0 #111}
.sm-acc.yel:hover{background:#e5b600}
.dark .sm-acc{border-color:#fff;background:transparent;color:#fff}
.dark .sm-acc:hover{background:#fff;color:#111}
.dark .sm-acc.yel{background:#f5c518;border-color:#f5c518;color:#111;box-shadow:none}
.sm-burger{display:none;width:44px;height:44px;border:2.5px solid #111;border-radius:14px;background:#fff;cursor:pointer;font-size:20px;line-height:1;color:#111}
.dark .sm-burger{background:#111;border-color:#f5c518;color:#f5c518}
.sm-drawer{display:none;border-top:2px solid #111;background:#fff;padding:10px 16px 16px}
.dark .sm-drawer{background:#090909;border-top-color:#f5c518}
.sm-drawer a{display:block;padding:14px 6px;font-size:13px;font-weight:800;letter-spacing:1px;color:#111;text-decoration:none;border-bottom:2px dashed #ddd}
.dark .sm-drawer a{color:#fff;border-bottom-color:#333}
.sm-drawer a.on{color:#111;background:#f5c518;border-radius:12px;padding-left:12px;border-bottom-color:transparent}
@media (max-width:1180px){.sm-nav{display:none}.sm-burger{display:block}.sm-drawer.open{display:block}.sm-in .sm-acc.member{display:none}}
@media (max-width:560px){.sm-in{padding:0 14px}.sm-logo{font-size:22px}.sm-right{gap:6px}.sm-acc{padding:7px 12px;font-size:10px}}
`;

type Auth = "load" | "in" | "out";

/**
 * Şifre sıfırlama e-postasındaki bağlantı, Supabase'de izin verilen adresler listesinde /sifre-yenile yoksa
 * ana sayfaya düşer. Sayfa açılırken (Supabase adresi temizlemeden önce) bunu yakalayıp şifre sayfasına yönlendiririz.
 */
const RECOVERY_LINK = typeof window !== "undefined" && /(^#|&)type=recovery(&|$)/.test(window.location.hash);

function client() {
  try {
    return getSupabase();
  } catch {
    return null; // Supabase ayarları yoksa ziyaretçi gibi davran
  }
}

function useAuth(): Auth {
  const [auth, setAuth] = useState<Auth>(() => (client() ? "load" : "out"));
  useEffect(() => {
    const sb = client();
    if (!sb) return;
    sb.auth.getSession().then(({ data }) => setAuth(data.session ? "in" : "out"));
    const { data } = sb.auth.onAuthStateChange((event, session) => {
      setAuth(session ? "in" : "out");
      if (session && (event === "PASSWORD_RECOVERY" || RECOVERY_LINK) && window.location.pathname !== "/sifre-yenile") {
        window.location.replace("/sifre-yenile");
      }
    });
    return () => data.subscription.unsubscribe();
  }, []);
  return auth;
}

export default function SiteMenu({ active = "", dark = false }: { active?: string; dark?: boolean }) {
  const [open, setOpen] = useState(false);
  const auth = useAuth();
  const member = auth === "in";

  return (
    <header className={`sm-bar ${dark ? "dark" : ""}`}>
      <style dangerouslySetInnerHTML={{ __html: CSS }} />
      <div className="sm-in">
        <Link href="/" className="sm-logo">HITY7<span className="sm-dot" /></Link>

        {member && (
          <nav className="sm-nav" aria-label="Site menüsü">
            {LINKS.map(([href, label]) => (
              <a key={href} href={href} className={active === href ? "on" : ""}>{label}</a>
            ))}
          </nav>
        )}

        <div className="sm-right">
          <SepetButonu dark={dark} />
          {member && (
            <>
              <BakiyeChip dark={dark} hideWhenOut />
              <a href="/panel" className="sm-acc member">HESABIM ↗</a>
              <button type="button" className="sm-burger" aria-label={open ? "Menüyü kapat" : "Menüyü aç"} aria-expanded={open} onClick={() => setOpen(o => !o)}>{open ? "✕" : "☰"}</button>
            </>
          )}
          {auth === "out" && (
            <>
              <a href="/giris" className="sm-acc">GİRİŞ YAP</a>
              <a href="/giris?tab=kayit" className="sm-acc yel">ÜYE OL ↗</a>
            </>
          )}
        </div>
      </div>

      {member && (
        <div className={`sm-drawer ${open ? "open" : ""}`}>
          <Link href="/" className={active === "/" ? "on" : ""}>ANA SAYFA</Link>
          {LINKS.map(([href, label]) => (
            <a key={href} href={href} className={active === href ? "on" : ""}>{label}</a>
          ))}
          <a href="/panel" className={active === "/panel" ? "on" : ""}>HESABIM</a>
        </div>
      )}
    </header>
  );
}
