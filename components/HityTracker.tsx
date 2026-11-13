"use client";

import { useEffect } from "react";
import { usePathname } from "next/navigation";

/**
 * Ziyaretçi sayacı. app/layout.tsx içinde <body> içine <HityTracker /> olarak eklenir.
 * Kişisel veri toplamaz: sayfa yolu, yönlendiren site, cihaz tipi ve anonim oturum kodu.
 */
export default function HityTracker() {
  const pathname = usePathname();

  useEffect(() => {
    // Yönetim paneli (/ceo) ziyaretleri sayılmaz
    if (!pathname || pathname === "/ceo" || pathname.startsWith("/ceo/")) return;

    let sessionId = "";
    try {
      sessionId = sessionStorage.getItem("h7_sid") || "";
      if (!sessionId) {
        sessionId = Math.random().toString(36).slice(2) + Date.now().toString(36);
        sessionStorage.setItem("h7_sid", sessionId);
      }
    } catch {
      sessionId = "";
    }

    let referrer = "";
    try {
      if (document.referrer) {
        const host = new URL(document.referrer).host;
        if (host !== window.location.host) referrer = host;
      }
    } catch {
      referrer = "";
    }

    const body = JSON.stringify({ path: pathname, referrer, session_id: sessionId });
    try {
      if (navigator.sendBeacon) {
        navigator.sendBeacon("/api/track", new Blob([body], { type: "application/json" }));
      } else {
        fetch("/api/track", { method: "POST", body, keepalive: true, headers: { "Content-Type": "application/json" } });
      }
    } catch {
      /* sayaç hatası siteyi etkilemesin */
    }
  }, [pathname]);

  return null;
}
