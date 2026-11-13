"use client";

/**
 * components/GlobalMenu.tsx
 * Kök layout'ta tüm sayfalara otomatik eklenen:
 *  - sabit (sticky) site menüsü (aktif sayfa adres çubuğundan bulunur)
 *  - yönetim panelinden açılan duyuru şeridi (Site Yazıları → Duyuru)
 *  - bakım modu ekranı (Ayarlar → Bakım modu). Yöneticiler siteyi bakımda da görür.
 * HIDE_ON listesindeki sayfalarda (yönetim paneli) gösterilmez.
 */
import { useEffect, useState } from "react";
import { usePathname } from "next/navigation";
import SiteMenu from "./SiteMenu";
import { useSiteContent } from "../lib/use-site-content";
import { getSupabase } from "../lib/supabase";

const HIDE_ON = ["/ceo"];
/** Bakım modunda da açık kalan sayfalar (giriş yapabilmek için) */
const MAINTENANCE_EXEMPT = ["/ceo", "/giris", "/kayit"];

const CSS = `
.h7-duyuru{background:#f5c518;border-bottom:3px solid #111;color:#111;font-family:Inter,"Helvetica Neue",Arial,sans-serif;font-size:13px;font-weight:700;text-align:center;padding:9px 16px;line-height:1.45}
.h7-bakim{position:fixed;inset:71px 0 0 0;z-index:45;display:grid;place-items:center;padding:24px 16px;background-color:#fff;background-image:radial-gradient(#d9d9d9 1.4px,transparent 1.5px);background-size:28px 28px;font-family:Inter,"Helvetica Neue",Arial,sans-serif;color:#111}
.h7-bakim-kart{max-width:480px;width:100%;background:#fff;border:3px solid #111;border-radius:32px;padding:32px;box-shadow:0 10px 0 #111;text-align:center}
.h7-bakim-kart span{display:inline-block;border:2.5px solid #111;border-radius:999px;background:#f5c518;padding:5px 14px;font-size:11px;font-weight:800;letter-spacing:.14em}
.h7-bakim-kart h1{font-size:36px;line-height:1;letter-spacing:-.04em;font-weight:900;margin:18px 0 10px}
.h7-bakim-kart p{color:#686868;font-size:15px;line-height:1.6;margin:0}
.h7-bakim-kart a{color:#111;font-weight:800}
`;

export default function GlobalMenu() {
  const path = usePathname() || "/";
  const content = useSiteContent();
  const g = content.general;
  const [staff, setStaff] = useState(false);

  // Bakım modunda yöneticiler siteyi görmeye devam eder
  useEffect(() => {
    if (!g.maintenance) return;
    let alive = true;
    (async () => {
      try {
        const sb = getSupabase();
        const { data } = await sb.auth.getSession();
        const uid = data.session?.user.id;
        if (!uid) return;
        const { data: p } = await sb.from("profiles").select("role,banned").eq("id", uid).maybeSingle();
        const row = p as { role?: string; banned?: boolean } | null;
        if (alive && row && !row.banned && ["ceo", "admin", "mod", "amele"].includes(String(row.role))) setStaff(true);
      } catch {
        /* sessizce geç */
      }
    })();
    return () => {
      alive = false;
    };
  }, [g.maintenance]);

  if (HIDE_ON.some((p) => path === p || path.startsWith(p + "/"))) return null;
  const active = "/" + (path.split("/")[1] || "");
  const inMaintenance = !!g.maintenance && !staff && !MAINTENANCE_EXEMPT.some((p) => path === p || path.startsWith(p + "/"));
  const announcement = g.announcementEnabled ? String(g.announcementText || "").trim() : "";

  return (
    <>
      <SiteMenu active={active} />
      {announcement || inMaintenance || (g.maintenance && staff) ? <style dangerouslySetInnerHTML={{ __html: CSS }} /> : null}
      {g.maintenance && staff && (
        <div className="h7-duyuru" role="status">Bakım modu AÇIK — ziyaretçiler siteyi göremiyor, sen yönetici olarak görüyorsun.</div>
      )}
      {announcement && !inMaintenance && (
        <div className="h7-duyuru" role="status">{announcement}</div>
      )}
      {inMaintenance && (
        <div className="h7-bakim" role="alert">
          <div className="h7-bakim-kart">
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
          </div>
        </div>
      )}
    </>
  );
}
