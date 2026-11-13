"use client";

/**
 * lib/use-site-content.ts
 * İstemci sayfalarında site içeriğini (yazılar, hizmetler, prodüktörler, fiyatlar, duyuru, bakım modu, şirket bilgileri) okur.
 * Kullanım: const content = useSiteContent();
 * Aynı sayfadaki tüm bileşenler (menü, sayfa, site altı) tek bir isteği paylaşır.
 * Veritabanına ulaşılamazsa varsayılan içerik döner; site hiçbir zaman bozulmaz.
 */
import { useEffect, useState } from "react";
import { DEFAULT_CONTENT, fetchLegalContent, fetchSiteContent, type LegalContent, type SiteContent } from "./site-content";

const TTL = 15000;
let shared: { at: number; promise: Promise<SiteContent> } | null = null;

function loadShared(): Promise<SiteContent> {
  const now = Date.now();
  if (!shared || now - shared.at > TTL) shared = { at: now, promise: fetchSiteContent() };
  return shared.promise;
}

export function useSiteContent(): SiteContent {
  const [content, setContent] = useState<SiteContent>(DEFAULT_CONTENT);
  useEffect(() => {
    let alive = true;
    const load = () => {
      loadShared().then((c) => {
        if (alive) setContent(c);
      });
    };
    load();
    // Fiyatlar değiştiğinde (ör. sepet ödemesinde sunucu "fiyat güncellendi" derse) yeniden okunur
    window.addEventListener("hity7:icerik", load);
    return () => {
      alive = false;
      window.removeEventListener("hity7:icerik", load);
    };
  }, []);
  return content;
}

/** İçeriği önbelleği atlayarak yeniden okutur; sayfadaki tüm useSiteContent kullanıcıları güncellenir. */
export function reloadSiteContent() {
  shared = null;
  try {
    window.dispatchEvent(new Event("hity7:icerik"));
  } catch {
    /* sunucu */
  }
}

/** Yasal sayfalar için: yönetim panelinden düzenlenmiş metinler. Yüklenene kadar null döner. */
export function useLegalContent(): LegalContent | null {
  const [legal, setLegal] = useState<LegalContent | null>(null);
  useEffect(() => {
    let alive = true;
    fetchLegalContent().then((l) => {
      if (alive) setLegal(l);
    });
    return () => {
      alive = false;
    };
  }, []);
  return legal;
}
