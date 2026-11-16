"use client";

/**
 * lib/dosya.ts
 * Özel depodaki dosyayı indirir: önce /api/dosya'dan yetki kontrolüyle kısa süreli imzalı bağlantı alınır,
 * ardından tarayıcı dosyayı indirir. Bağlantı 5 dakika geçerlidir; paylaşılsa bile kısa sürede geçersizleşir.
 */
import { getSupabase } from "./supabase";

export type DosyaIstegi =
  | { tur: "siparis"; siparisId: number; key: string }
  | { tur: "yayin"; yayinId: string; ref: string }
  | { tur: "teslim"; dosyaId: string; kod?: string }
  | { tur: "destek"; mesajId: string; key: string };

/** İmzalı bağlantıyı döndürür (hata olursa açıklayıcı mesajla Error fırlatır). */
export async function dosyaBaglantisi(istek: DosyaIstegi): Promise<string> {
  const { data } = await getSupabase().auth.getSession();
  const t = data.session?.access_token;
  if (!t) throw new Error("Dosyaya erişmek için giriş yapmalısın.");
  const res = await fetch("/api/dosya", {
    method: "POST",
    headers: { "content-type": "application/json", Authorization: `Bearer ${t}` },
    body: JSON.stringify(istek),
  });
  const j = (await res.json().catch(() => ({}))) as { url?: string; error?: string };
  if (!res.ok || !j.url) throw new Error(j.error || "Dosya bağlantısı alınamadı.");
  return j.url;
}

/** Dosyayı indirir (yeni sekme açmadan). */
export async function dosyaIndir(istek: DosyaIstegi): Promise<void> {
  const url = await dosyaBaglantisi(istek);
  const a = document.createElement("a");
  a.href = url;
  a.rel = "noopener";
  document.body.appendChild(a);
  a.click();
  a.remove();
}

/** Bayt → okunur boyut */
export function boyut(n: number): string {
  if (!(n > 0)) return "—";
  if (n >= 1024 * 1024 * 1024) return (n / 1024 / 1024 / 1024).toLocaleString("tr-TR", { maximumFractionDigits: 2 }) + " GB";
  if (n >= 1024 * 1024) return (n / 1024 / 1024).toLocaleString("tr-TR", { maximumFractionDigits: 1 }) + " MB";
  return Math.max(1, Math.round(n / 1024)).toLocaleString("tr-TR") + " KB";
}
