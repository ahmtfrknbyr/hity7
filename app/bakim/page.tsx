"use client";

/**
 * app/bakim/page.tsx
 * Site kapalıyken (CEO panelinde "Site Yayında" kapalı) ziyaretçi ve üyelerin gördüğü ekran.
 * Proxy, kapalı sitede istenen her sayfayı buraya yönlendirir. Yöneticiler giriş yapınca siteyi görür.
 */
import { useSiteContent } from "../../lib/use-site-content";

const CSS = `
.bk-root{min-height:calc(100vh - 71px);display:grid;place-items:center;padding:24px 16px;background-color:#fff;background-image:radial-gradient(#d9d9d9 1.4px,transparent 1.5px);background-size:28px 28px;font-family:Inter,"Helvetica Neue",Arial,sans-serif;color:#111}
.bk-kart{max-width:480px;width:100%;background:#fff;border:3px solid #111;border-radius:32px;padding:32px;box-shadow:0 10px 0 #111;text-align:center}
.bk-kart span{display:inline-block;border:2.5px solid #111;border-radius:999px;background:#f5c518;padding:5px 14px;font-size:11px;font-weight:800;letter-spacing:.14em}
.bk-kart h1{font-size:36px;line-height:1;letter-spacing:-.04em;font-weight:900;margin:18px 0 10px}
.bk-kart p{color:#686868;font-size:15px;line-height:1.6;margin:0}
.bk-kart a{color:#111;font-weight:800}
.bk-alt{margin-top:18px!important;font-size:12.5px!important}
`;

export default function BakimPage() {
  const g = useSiteContent().general;
  return (
    <main className="bk-root">
      <style dangerouslySetInnerHTML={{ __html: CSS }} />
      <div className="bk-kart" role="alert">
        <span>{g.siteName || "HITY7"} / BAKIM</span>
        <h1>Kısa bir ara veriyoruz.</h1>
        <p>
          Sitemizde bakım çalışması yapıyoruz, çok yakında geri döneceğiz.
          {g.contactEmail ? (
            <>
              {" "}Acil durumlar için: <a href={`mailto:${g.contactEmail}`}>{g.contactEmail}</a>
            </>
          ) : null}
        </p>
        <p className="bk-alt">
          Yönetici misin? <a href="/giris?next=/">Giriş yap</a>
        </p>
      </div>
    </main>
  );
}
