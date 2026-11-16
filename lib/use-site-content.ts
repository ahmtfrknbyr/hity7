"use client";

/**
 * lib/use-site-content.ts
 * İstemci sayfalarında site içeriğini (yazılar, hizmetler, prodüktörler, fiyatlar, duyuru, bakım modu, şirket bilgileri) okur.
 * Kullanım: const content = useSiteContent();
 * Aynı sayfadaki tüm bileşenler (menü, sayfa, site altı) tek bir isteği paylaşır.
 * Veritabanına ulaşılamazsa varsayılan içerik döner; site hiçbir zaman bozulmaz.
 */
import { useEffect, useState } from "react";
import { DEFAULT_CONTENT, fetchLegalContent, fetchSiteContent, mergeFooter, mergeHome, mergeNav, type LegalContent, type SiteContent } from "./site-content";

/** CEO panelindeki "Önizle" düğmesinin yazdığı taslak (yalnızca o tarayıcıda, adres ?onizleme=1 iken, 2 saat) */
export const ONIZLEME_ANAHTARI = "h7_onizleme";
export type OnizlemeIcerik = SiteContent & { _onizleme?: boolean };

function onizlemeUygula(c: SiteContent): OnizlemeIcerik {
  try {
    if (!new URLSearchParams(window.location.search).has("onizleme")) return c;
    const raw = window.localStorage.getItem(ONIZLEME_ANAHTARI);
    if (!raw) return c;
    const d = JSON.parse(raw) as { at?: number; home?: unknown; nav?: unknown; footer?: unknown };
    if (!d || !(Date.now() - Number(d.at) < 2 * 3600_000)) return c;
    return { ...c, home: mergeHome(d.home), nav: mergeNav(d.nav), footer: mergeFooter(d.footer), _onizleme: true };
  } catch {
    return c;
  }
}

const TTL = 15000;
let shared: { at: number; promise: Promise<SiteContent> } | null = null;

function loadShared(): Promise<SiteContent> {
  const now = Date.now();
  if (!shared || now - shared.at > TTL) shared = { at: now, promise: fetchSiteContent() };
  return shared.promise;
}

export function useSiteContent(): OnizlemeIcerik {
  const [content, setContent] = useState<OnizlemeIcerik>(DEFAULT_CONTENT);
  useEffect(() => {
    let alive = true;
    const load = () => {
      loadShared().then((c) => {
        if (alive) setContent(onizlemeUygula(c));
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
