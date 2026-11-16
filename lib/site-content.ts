/**
 * Sitenin düzenlenebilir içeriği.
 * Admin panelinde yapılan değişiklikler Supabase'teki "site_content" tablosuna kaydedilir.
 * Site sayfaları içeriği fetchSiteContent() ile (sunucu / istemci) ya da
 * lib/use-site-content.ts içindeki useSiteContent() hook'u ile (istemci) okuyabilir.
 * Bu dosya React'e bağlı değildir; API route'larında da güvenle kullanılabilir.
 */
import { isLegalSlug, type LegalSlug } from "./yasal-belgeler";
import { mergeErisim, type ErisimAyar } from "./erisim";

export type GeneralContent = {
  siteName: string;
  slogan: string;
  announcementEnabled: boolean;
  announcementText: string;
  maintenance: boolean;
  contactEmail: string;
  instagram: string;
  tiktok: string;
  youtube: string;
  whatsapp: string;
};

/** Ana sayfadaki hizmet kartı (plak) */
export type HomeCard = { tag: string; title: string; desc: string; feats: [string, string, string]; button: string };
export type HomeCardId = "smm" | "influencer" | "remake" | "yayin";

export type HomeContent = {
  kicker: string;
  /** Büyük başlık. Son kelime sarı vurguyla gösterilir. */
  heroTitle: string;
  heroSub: string;
  ctaPrimary: string;
  ctaSecondary: string;
  cards: Record<HomeCardId, HomeCard>;
  finalTitle: string;
  finalButton: string;
  footerText: string;
};

/** Menü başlıkları (adresler değişmez; yalnızca görünen yazı) */
export type NavContent = {
  home: string;
  smm: string;
  influencer: string;
  remake: string;
  mix: string;
  yayin: string;
  destek: string;
  account: string;
};

/** Site altı yazıları ve bağlantı başlıkları */
export type FooterContent = {
  copyright: string;
  destek: string;
  legal: Partial<Record<LegalSlug, string>>;
};

/** Sekme başlığı, açıklama, simge ve sosyal medya paylaşım bilgileri */
export type SeoContent = {
  title: string;
  description: string;
  favicon: string;
  ogTitle: string;
  ogDescription: string;
  ogImage: string;
};

export type ServiceItem = {
  id: string;
  name: string;
  desc: string;
  price: string;
  href: string;
  active: boolean;
};

export type ProducerItem = {
  id: string;
  name: string;
  role: string;
  desc: string;
  mixPrice: number;
  stemsPrice: number;
  hity7: boolean;
  active: boolean;
};

/** Sunucunun sipariş tutarını hesaplarken kullandığı fiyatlar (TL). 0 = ücretsiz / henüz belirlenmedi. */
export type PricingContent = {
  remake: { free: number; birebir: number; modern: number; ozgun: number };
  yayin: { single: number; ep: number; album: number };
};

/** Yasal sayfalarda (KVKK, sözleşmeler) ve site altında görünen satıcı bilgileri. E-posta: general.contactEmail */
export type CompanyInfo = {
  title: string; // Şirket unvanı veya şahıs şirketinde ad soyad
  address: string;
  phone: string;
  taxOffice: string;
  taxNumber: string;
  mersis: string;
  kep: string;
};

/** Yönetim panelinde düzenlenen yasal metinler. Boş belge = varsayılan şablon (lib/yasal-metinler.ts). */
export type LegalContent = {
  docs: Partial<Record<LegalSlug, string>>;
  updatedAt: string; // YYYY-MM-DD
};

/** Sepetle satılabilen ana hizmetler (ek hizmet önerisi bu sayfalarda görünür). */
export type CartService = "remake" | "mix";
export const CART_SERVICES: CartService[] = ["remake", "mix"];

/** Ana hizmetin yanında satılan ek hizmet (upsell). Fiyat sunucuda bu kayıttan hesaplanır. */
export type AddonItem = {
  id: string;
  name: string;
  desc: string;
  price: number; // TL
  active: boolean;
};

/** Bir hizmet sayfasının sağ üstündeki öneri kartı. Birden fazla ek hizmet varsa müşteri birini seçer. */
export type UpsellOffer = {
  enabled: boolean;
  title: string;
  addonIds: string[];
};

export type UpsellContent = {
  addons: AddonItem[];
  offers: Record<CartService, UpsellOffer>;
};

export type SiteContent = {
  general: GeneralContent;
  home: HomeContent;
  services: ServiceItem[];
  producers: ProducerItem[];
  pricing: PricingContent;
  upsell: UpsellContent;
  company: CompanyInfo;
  legal: LegalContent;
  nav: NavContent;
  footer: FooterContent;
  seo: SeoContent;
  /** Hizmet görünürlüğü / sipariş izni (yalnızca CEO değiştirir) */
  erisim: ErisimAyar;
};

export const DEFAULT_CONTENT: SiteContent = {
  general: {
    siteName: "HITY7",
    slogan: "Müziğin Geleceğini Şekillendir",
    announcementEnabled: false,
    announcementText: "",
    maintenance: false,
    contactEmail: "",
    instagram: "",
    tiktok: "",
    youtube: "",
    whatsapp: "",
  },
  // Varsayılanlar ana sayfadaki mevcut yazılarla birebir aynıdır (CEO kaydedene kadar sitede hiçbir şey değişmez)
  home: {
    kicker: "MÜZİK TEKNOLOJİ PLATFORMU",
    heroTitle: "Müziğin Geleceğini Şekillendir.",
    heroSub: "Sanatını büyüt. Müziğini dünyaya duyur. Dijital gücünü HITY7 ile keşfet.",
    ctaPrimary: "Hizmetleri Keşfet",
    ctaSecondary: "Hemen Başla",
    cards: {
      smm: {
        tag: "PLAK 1 / 4 · SMM PANEL",
        title: "Dijital Gücünü Artır",
        desc: "Sosyal medya hesaplarını profesyonel araçlarla yönet, kampanyalarını tek noktadan takip et.",
        feats: ["Tek noktadan yönetim", "Kampanya takibi", "Profesyonel araçlar"],
        button: "SMM Paneli Keşfet",
      },
      influencer: {
        tag: "PLAK 2 / 4 · INFLUENCER MARKETING",
        title: "Doğru Kitleye Ulaş",
        desc: "Markanı ve müziğini doğru içerik üreticileriyle buluştur. Etkili kampanyalar oluştur.",
        feats: ["Doğru içerik üreticileri", "Etkili kampanyalar", "Dijital görünürlük"],
        button: "Kampanya Oluştur",
      },
      remake: {
        tag: "PLAK 3 / 4 · REMAKE BEAT",
        title: "Sesini Yeniden Yarat",
        desc: "Referans sound'unuzu yeniden tasarlayın. Müziğinize özel altyapılar ve profesyonel prodüksiyon.",
        feats: ["Referans sound'u yeniden tasarım", "Özel altyapılar", "Profesyonel prodüksiyon"],
        button: "Remake Beat'i Keşfet",
      },
      yayin: {
        tag: "PLAK 4 / 4 · DİJİTAL YAYIN",
        title: "Dijital Yayın",
        desc: "Müziğinizi dijital platformlarda yayınlayın. Yayın ve dağıtım sürecinizi tek merkezden yönetin.",
        feats: ["Dijital platformlarda yayın", "Dağıtım süreci", "Tek merkezden yönetim"],
        button: "Dijital Yayını Keşfet",
      },
    },
    finalTitle: "Müziğin Geleceğini Şekillendir.",
    finalButton: "Hemen Başla",
    footerText: "HITY7 © 2026 · Müziğin Geleceğini Şekillendir.",
  },
  nav: {
    home: "ANA SAYFA",
    smm: "SMM PANEL",
    influencer: "INFLUENCER",
    remake: "REMAKE BEAT",
    mix: "MIX & MASTERING",
    yayin: "DİJİTAL YAYIN",
    destek: "DESTEK",
    account: "HESABIM",
  },
  footer: { copyright: "", destek: "Destek", legal: {} },
  seo: {
    title: "HITY7 — Müziğin Geleceğini Şekillendir",
    description: "Influencer marketing, SMM panel, remake beat, mix & mastering ve dijital yayın hizmetleri tek platformda.",
    favicon: "",
    ogTitle: "",
    ogDescription: "",
    ogImage: "",
  },
  erisim: mergeErisim(null),
  services: [
    { id: "influencer", name: "Influencer Marketing", desc: "Şarkını doğru kitlelere ulaştır.", price: "Fiyat eklenecek", href: "/influencer-marketing", active: true },
    { id: "smm", name: "SMM Panel", desc: "Sosyal medya büyütme hizmetleri.", price: "Fiyat eklenecek", href: "/smm-panel", active: true },
    { id: "remake", name: "Remake Beat", desc: "Referans şarkından profesyonel remake beat.", price: "Fiyat eklenecek", href: "/remake-beat", active: true },
    { id: "yayin", name: "Dijital Yayın", desc: "Tüm platformlara dijital dağıtım.", price: "Fiyat eklenecek", href: "/dijital-yayin", active: true },
    { id: "mix", name: "Mix & Mastering", desc: "Profesyonel mix, mastering ve AI Mix önizleme.", price: "3.000 TL'den başlayan", href: "/mix-mastering", active: true },
  ],
  producers: [
    { id: "hity7", name: "HITY7 Prodüktörleri", role: "HITY7 Official Team", desc: "HITY7 bünyesindeki profesyonel mix ve mastering ekibi.", mixPrice: 3000, stemsPrice: 10000, hity7: true, active: true },
    { id: "producer1", name: "Prodüktör 01", role: "Rap / Trap / Drill", desc: "Rap, trap ve drill müzik üzerine uzmanlaşmış bağımsız prodüktör.", mixPrice: 4500, stemsPrice: 12000, hity7: false, active: true },
    { id: "producer2", name: "Prodüktör 02", role: "Melodik Rap / R&B / Pop", desc: "Melodik vokal ve modern müzik prodüksiyonu.", mixPrice: 5000, stemsPrice: 15000, hity7: false, active: true },
    { id: "producer3", name: "Prodüktör 03", role: "Hip-Hop / Boom Bap", desc: "Old school ve modern hip-hop mix çalışmaları.", mixPrice: 4000, stemsPrice: 11000, hity7: false, active: true },
  ],
  pricing: {
    remake: { free: 0, birebir: 3000, modern: 4000, ozgun: 5000 },
    yayin: { single: 0, ep: 0, album: 0 },
  },
  upsell: {
    addons: [
      { id: "mix-mastering", name: "Mix & Mastering", desc: "Beat'in vokallerinle birlikte HITY7 ekibi tarafından mixlenir ve masterlanır.", price: 3000, active: true },
      { id: "remake-birebir", name: "Birebir Remake", desc: "Referans parçaya yakın altyapı.", price: 3000, active: true },
      { id: "remake-modern", name: "Modern Remake", desc: "Güncel sound ve modern prodüksiyon.", price: 4000, active: true },
      { id: "remake-ozgun", name: "Özgün Remake", desc: "Özgün dokunuşlarla yeniden tasarlanan altyapı.", price: 5000, active: true },
    ],
    offers: {
      remake: { enabled: true, title: "Bu beat'e Mix & Mastering de eklemek ister misiniz?", addonIds: ["mix-mastering"] },
      mix: { enabled: true, title: "Şarkınıza özel Remake Beat de ister misiniz?", addonIds: ["remake-birebir", "remake-modern", "remake-ozgun"] },
    },
  },
  company: { title: "", address: "", phone: "", taxOffice: "", taxNumber: "", mersis: "", kep: "" },
  legal: { docs: {}, updatedAt: "" },
};

/** Veritabanındaki şirket bilgilerini güvenli şekilde birleştirir (yalnızca metin alanları). */
export function mergeCompany(v: unknown): CompanyInfo {
  const out: CompanyInfo = { ...DEFAULT_CONTENT.company };
  const src = (v && typeof v === "object" ? v : {}) as Record<string, unknown>;
  for (const k of Object.keys(out) as (keyof CompanyInfo)[]) {
    if (typeof src[k] === "string") out[k] = String(src[k]).slice(0, 300);
  }
  return out;
}

/** Veritabanındaki yasal metinleri birleştirir; bilinmeyen belge adlarını ve boş metinleri atar. */
export function mergeLegal(v: unknown): LegalContent {
  const src = (v && typeof v === "object" ? v : {}) as { docs?: Record<string, unknown>; updatedAt?: unknown };
  const docs: LegalContent["docs"] = {};
  for (const [k, text] of Object.entries(src.docs && typeof src.docs === "object" ? src.docs : {})) {
    if (isLegalSlug(k) && typeof text === "string" && text.trim()) docs[k] = text.slice(0, 60000);
  }
  const updatedAt = typeof src.updatedAt === "string" && /^\d{4}-\d{2}-\d{2}/.test(src.updatedAt) ? src.updatedAt.slice(0, 10) : "";
  return { docs, updatedAt };
}

const num = (v: unknown, fallback: number) => {
  const n = Number(v);
  return Number.isFinite(n) && n >= 0 ? Math.round(n * 100) / 100 : fallback;
};

/** Veritabanındaki fiyat kaydını güvenli şekilde varsayılanlarla birleştirir. */
export function mergePricing(v: unknown): PricingContent {
  const d = DEFAULT_CONTENT.pricing;
  const p = (v && typeof v === "object" ? v : {}) as { remake?: Record<string, unknown>; yayin?: Record<string, unknown> };
  return {
    remake: {
      free: num(p.remake?.free, d.remake.free),
      birebir: num(p.remake?.birebir, d.remake.birebir),
      modern: num(p.remake?.modern, d.remake.modern),
      ozgun: num(p.remake?.ozgun, d.remake.ozgun),
    },
    yayin: {
      single: num(p.yayin?.single, d.yayin.single),
      ep: num(p.yayin?.ep, d.yayin.ep),
      album: num(p.yayin?.album, d.yayin.album),
    },
  };
}

const ADDON_ID = /^[a-z0-9][a-z0-9-]{0,39}$/;

/**
 * Ek hizmet kaydını güvenli şekilde birleştirir: geçersiz kimlikleri, tekrarları ve olmayan önerileri atar.
 * Kayıt hiç yoksa varsayılanlar kullanılır; kayıt varsa (CEO boş liste kaydetmiş olsa bile) olduğu gibi alınır.
 */
export function mergeUpsell(v: unknown): UpsellContent {
  const d = DEFAULT_CONTENT.upsell;
  const src = (v && typeof v === "object" ? v : {}) as { addons?: unknown; offers?: Record<string, unknown> };
  const addons: AddonItem[] = [];
  if (Array.isArray(src.addons)) {
    for (const raw of src.addons.slice(0, 30)) {
      const a = (raw && typeof raw === "object" ? raw : {}) as Record<string, unknown>;
      const id = String(a.id ?? "");
      if (!ADDON_ID.test(id) || addons.some((x) => x.id === id)) continue;
      addons.push({
        id,
        name: String(a.name ?? "").slice(0, 80) || "Ek hizmet",
        desc: String(a.desc ?? "").slice(0, 240),
        price: num(a.price, 0),
        active: a.active !== false,
      });
    }
  } else {
    addons.push(...d.addons.map((a) => ({ ...a })));
  }
  const ids = new Set(addons.map((a) => a.id));
  const offers = {} as Record<CartService, UpsellOffer>;
  for (const s of CART_SERVICES) {
    const o = (src.offers?.[s] && typeof src.offers[s] === "object" ? src.offers[s] : null) as Partial<UpsellOffer> | null;
    const base = d.offers[s];
    const list = o && Array.isArray(o.addonIds) ? o.addonIds.map(String) : base.addonIds;
    offers[s] = {
      enabled: o ? o.enabled !== false : base.enabled,
      title: (o && typeof o.title === "string" ? o.title : base.title).slice(0, 160),
      addonIds: Array.from(new Set(list)).filter((id) => ids.has(id)).slice(0, 8),
    };
  }
  return { addons, offers };
}

const txt = (v: unknown, fallback: string, max = 400) => (typeof v === "string" ? v.slice(0, max) : fallback);

/** Ana sayfa içeriği: eski kayıtlar (yalnızca 4 alan) ve yeni alanlar varsayılanlarla birleştirilir. */
export function mergeHome(v: unknown): HomeContent {
  const d = DEFAULT_CONTENT.home;
  const s = (v && typeof v === "object" ? v : {}) as Record<string, unknown>;
  const cardsSrc = (s.cards && typeof s.cards === "object" ? s.cards : {}) as Record<string, Record<string, unknown> | undefined>;
  const cards = {} as Record<HomeCardId, HomeCard>;
  for (const id of Object.keys(d.cards) as HomeCardId[]) {
    const c = cardsSrc[id] || {};
    const f = Array.isArray(c.feats) ? c.feats : [];
    cards[id] = {
      tag: txt(c.tag, d.cards[id].tag, 80),
      title: txt(c.title, d.cards[id].title, 120),
      desc: txt(c.desc, d.cards[id].desc, 400),
      feats: [0, 1, 2].map((i) => txt(f[i], d.cards[id].feats[i], 80)) as [string, string, string],
      button: txt(c.button, d.cards[id].button, 60),
    };
  }
  return {
    kicker: txt(s.kicker, d.kicker, 80),
    heroTitle: txt(s.heroTitle, d.heroTitle, 160),
    heroSub: txt(s.heroSub, d.heroSub, 400),
    ctaPrimary: txt(s.ctaPrimary, d.ctaPrimary, 60),
    ctaSecondary: txt(s.ctaSecondary, d.ctaSecondary, 60),
    cards,
    finalTitle: txt(s.finalTitle, d.finalTitle, 160),
    finalButton: txt(s.finalButton, d.finalButton, 60),
    footerText: txt(s.footerText, d.footerText, 200),
  };
}

export function mergeNav(v: unknown): NavContent {
  const d = DEFAULT_CONTENT.nav;
  const s = (v && typeof v === "object" ? v : {}) as Record<string, unknown>;
  const out = { ...d };
  for (const k of Object.keys(d) as (keyof NavContent)[]) out[k] = txt(s[k], d[k], 40).trim() || d[k];
  return out;
}

export function mergeFooter(v: unknown): FooterContent {
  const s = (v && typeof v === "object" ? v : {}) as { copyright?: unknown; destek?: unknown; legal?: Record<string, unknown> };
  const legal: FooterContent["legal"] = {};
  for (const [k, val] of Object.entries(s.legal && typeof s.legal === "object" ? s.legal : {})) {
    if (isLegalSlug(k) && typeof val === "string" && val.trim()) legal[k] = val.slice(0, 60);
  }
  return { copyright: txt(s.copyright, "", 200), destek: txt(s.destek, "Destek", 40).trim() || "Destek", legal };
}

const httpsVeyaBos = (v: unknown) => (typeof v === "string" && (/^https:\/\//.test(v) || v.startsWith("/")) ? v.slice(0, 500) : "");

export function mergeSeo(v: unknown): SeoContent {
  const d = DEFAULT_CONTENT.seo;
  const s = (v && typeof v === "object" ? v : {}) as Record<string, unknown>;
  return {
    title: txt(s.title, d.title, 120).trim() || d.title,
    description: txt(s.description, d.description, 300).trim() || d.description,
    favicon: httpsVeyaBos(s.favicon),
    ogTitle: txt(s.ogTitle, "", 120),
    ogDescription: txt(s.ogDescription, "", 300),
    ogImage: httpsVeyaBos(s.ogImage),
  };
}

/** Veritabanından gelen satırları varsayılanlarla birleştirir. */
export function mergeContent(rows: { key: string; value: unknown }[] | null): SiteContent {
  const out: SiteContent = JSON.parse(JSON.stringify(DEFAULT_CONTENT));
  for (const row of rows || []) {
    if (row.key === "general" && row.value && typeof row.value === "object") {
      out.general = { ...out.general, ...(row.value as Partial<GeneralContent>) };
    } else if (row.key === "home") {
      out.home = mergeHome(row.value);
    } else if (row.key === "nav") {
      out.nav = mergeNav(row.value);
    } else if (row.key === "footer") {
      out.footer = mergeFooter(row.value);
    } else if (row.key === "seo") {
      out.seo = mergeSeo(row.value);
    } else if (row.key === "erisim") {
      out.erisim = mergeErisim(row.value);
    } else if (row.key === "services" && Array.isArray(row.value)) {
      out.services = row.value as ServiceItem[];
    } else if (row.key === "producers" && Array.isArray(row.value)) {
      out.producers = row.value as ProducerItem[];
    } else if (row.key === "pricing") {
      out.pricing = mergePricing(row.value);
    } else if (row.key === "upsell") {
      out.upsell = mergeUpsell(row.value);
    } else if (row.key === "company") {
      out.company = mergeCompany(row.value);
    } else if (row.key === "legal") {
      out.legal = mergeLegal(row.value);
    }
  }
  return out;
}

/** site_content tablosundan herkese açık anahtarla okuma. Hata olursa null döner. */
async function readSiteContent(query: string): Promise<{ key: string; value: unknown }[] | null> {
  const url = process.env.NEXT_PUBLIC_SUPABASE_URL;
  // Eski (anon) ve yeni (publishable) anahtar adlarının ikisi de desteklenir.
  const key = process.env.NEXT_PUBLIC_SUPABASE_ANON_KEY || process.env.NEXT_PUBLIC_SUPABASE_PUBLISHABLE_KEY;
  if (!url || !key || url.includes(".invalid")) return null;
  try {
    const res = await fetch(`${url}/rest/v1/site_content?${query}`, {
      // Yeni sb_ anahtarlar JWT değildir; yalnızca apikey başlığında gönderilir.
      headers: key.startsWith("eyJ") ? { apikey: key, Authorization: `Bearer ${key}` } : { apikey: key },
      cache: "no-store",
    });
    if (!res.ok) return null;
    const rows = await res.json();
    return Array.isArray(rows) ? rows : null;
  } catch {
    return null;
  }
}

/**
 * Sunucu veya istemci tarafında içeriği okur (ek paket gerektirmez).
 * Uzun yasal metinler burada okunmaz (her sayfada gereksiz yük olmasın); onlar fetchLegalContent() ile okunur.
 * Hata olursa varsayılan içeriği döndürür; site hiçbir zaman bozulmaz.
 */
export async function fetchSiteContent(): Promise<SiteContent> {
  const rows = await readSiteContent("select=key,value&key=neq.legal");
  return rows ? mergeContent(rows) : DEFAULT_CONTENT;
}

/** Yasal sayfaların yönetim panelinden düzenlenmiş metinleri (yoksa boş: varsayılan şablonlar kullanılır). */
export async function fetchLegalContent(): Promise<LegalContent> {
  const rows = await readSiteContent("select=key,value&key=eq.legal");
  return mergeLegal(rows?.[0]?.value);
}
