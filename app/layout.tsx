import type { Metadata } from "next";
import { Suspense } from "react";
import { connection } from "next/server";
import { Geist, Geist_Mono } from "next/font/google";
import "./globals.css";
import GlobalMenu from "../components/GlobalMenu";
import GlobalFooter from "../components/GlobalFooter";
import HityTracker from "../components/HityTracker";
import { DEFAULT_CONTENT, mergeSeo, type SeoContent } from "../lib/site-content";

const geistSans = Geist({
  variable: "--font-geist-sans",
  subsets: ["latin"],
});

const geistMono = Geist_Mono({
  variable: "--font-geist-mono",
  subsets: ["latin"],
});

/**
 * Sekme başlığı, açıklama, simge ve sosyal medya paylaşım bilgileri CEO panelinden (Site Yazıları → SEO) yönetilir
 * (16. aşama). Değer her istekte veritabanından okunur; böylece kaydedilen değişiklik bir sonraki sayfa açılışında
 * her cihazda görünür. Okunamazsa varsayılan başlık kullanılır; site hiçbir zaman bozulmaz.
 */
async function seoOku(): Promise<SeoContent> {
  const url = process.env.NEXT_PUBLIC_SUPABASE_URL;
  const key = process.env.NEXT_PUBLIC_SUPABASE_ANON_KEY || process.env.NEXT_PUBLIC_SUPABASE_PUBLISHABLE_KEY;
  if (!url || !key || url.includes(".invalid")) return DEFAULT_CONTENT.seo;
  try {
    const res = await fetch(`${url}/rest/v1/site_content?key=eq.seo&select=value`, {
      headers: key.startsWith("eyJ") ? { apikey: key, Authorization: `Bearer ${key}` } : { apikey: key },
      cache: "no-store",
      signal: AbortSignal.timeout(2500),
    });
    if (!res.ok) return DEFAULT_CONTENT.seo;
    const rows = (await res.json()) as { value: unknown }[];
    return mergeSeo(rows?.[0]?.value);
  } catch {
    return DEFAULT_CONTENT.seo;
  }
}

export async function generateMetadata(): Promise<Metadata> {
  const s = await seoOku();
  return {
    title: s.title,
    description: s.description,
    // Önizleme ortamı arama motorlarında görünmez
    ...(process.env.NEXT_PUBLIC_ONIZLEME === "1" ? { robots: { index: false, follow: false } } : {}),
    ...(s.favicon ? { icons: { icon: s.favicon } } : {}),
    openGraph: {
      title: s.ogTitle || s.title,
      description: s.ogDescription || s.description,
      ...(s.ogImage ? { images: [s.ogImage] } : {}),
      type: "website",
      locale: "tr_TR",
    },
    twitter: {
      card: s.ogImage ? "summary_large_image" : "summary",
      title: s.ogTitle || s.title,
      description: s.ogDescription || s.description,
      ...(s.ogImage ? { images: [s.ogImage] } : {}),
    },
  };
}

/** Başlık bilgisi istek anında okunduğu için sayfanın bilerek dinamik olduğunu belirtir (statik kabuk korunur). */
async function Baglanti() {
  await connection();
  return null;
}

export default function RootLayout({ children }: LayoutProps<"/">) {
  return (
    <html
      lang="tr"
      className={`${geistSans.variable} ${geistMono.variable} h-full antialiased`}
    >
      <body className="min-h-full flex flex-col">
        <GlobalMenu />
        <HityTracker />
        {children}
        <GlobalFooter />
        {process.env.NEXT_PUBLIC_ONIZLEME === "1" && (
          <div
            role="note"
            style={{
              position: "fixed",
              left: 12,
              bottom: 12,
              zIndex: 2147483000,
              maxWidth: "calc(100vw - 24px)",
              padding: "8px 12px",
              border: "2.5px solid #111",
              borderRadius: 14,
              background: "#f5c518",
              color: "#111",
              fontSize: 12,
              fontWeight: 800,
              lineHeight: 1.35,
              pointerEvents: "none",
            }}
          >
            ÖNİZLEME · test ortamı — ödeme ve bakiye kapalı
          </div>
        )}
        <Suspense>
          <Baglanti />
        </Suspense>
      </body>
    </html>
  );
}
