/**
 * lib/yasal-belgeler.ts
 * Yasal sayfaların listesi (adres + başlık). Küçük tutulur: site altındaki bağlantılar her sayfada bunu kullanır.
 * Metinlerin kendisi lib/yasal-metinler.ts içindedir. Bu dosya React'e bağlı değildir.
 */

/** Varsayılan metinlerin sürümü (yönetim panelinden düzenlenince panelin kaydettiği tarih kullanılır). */
export const LEGAL_VERSION = "2026-11-10";

export const LEGAL_DOCS = [
  { slug: "kvkk", title: "KVKK Aydınlatma Metni", short: "KVKK Aydınlatma Metni" },
  { slug: "gizlilik-cerez", title: "Gizlilik ve Çerez Politikası", short: "Gizlilik ve Çerezler" },
  { slug: "on-bilgilendirme", title: "Ön Bilgilendirme Formu", short: "Ön Bilgilendirme Formu" },
  { slug: "mesafeli-satis", title: "Mesafeli Satış Sözleşmesi", short: "Mesafeli Satış Sözleşmesi" },
  { slug: "iade-iptal", title: "İade ve İptal Koşulları", short: "İade ve İptal" },
  { slug: "kullanim-kosullari", title: "Kullanım Koşulları ve Hizmet Sözleşmesi", short: "Kullanım Koşulları" },
] as const;

export type LegalSlug = (typeof LEGAL_DOCS)[number]["slug"];

export const isLegalSlug = (s: string): s is LegalSlug => LEGAL_DOCS.some((d) => d.slug === s);

export const legalHref = (slug: LegalSlug, hash = "") => `/yasal/${slug}${hash}`;
