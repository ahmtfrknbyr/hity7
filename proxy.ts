/**
 * proxy.ts — HITY7 sunucu kapısı (Next.js 16 Proxy). Her sayfa ve API isteğinden önce sunucuda çalışır.
 *
 * 1) Site yayın kontrolü (9. aşama): CEO panelindeki "Site Yayında" anahtarı kapalıysa (general.maintenance)
 *    ziyaretçi ve üyeler bakım ekranını görür; müşteri API'leri 503 döner. CEO ve CEO'nun izin verdiği roller girer.
 * 2) Hizmet görünürlüğü (1. aşama): rolüne kapalı bir hizmet sayfası doğrudan adresle açılamaz.
 *
 * Rol, /api/oturum'un yazdığı imzalı h7_oturum çerezinden okunur. Ayarlar site_content'ten (herkese açık okuma)
 * 15 saniye önbellekle alınır. Sipariş ve para işlemleri ayrıca API'de ve veritabanında rolle doğrulanır;
 * bu kapı tek güvenlik katmanı değildir.
 */
import { NextResponse, type NextRequest } from "next/server";
import { OTURUM_CEREZI, oturumCoz } from "./lib/server/oturum";
import { bakimdaGirebilir, hizmetGorunur, hizmetOfPath, mergeErisim, type ErisimAyar } from "./lib/erisim";

type Ayarlar = { at: number; bakim: boolean; erisim: ErisimAyar };
const g = globalThis as unknown as { __h7Ayar?: Ayarlar };
const SURE = 15_000;

/** Bakımda da açık kalan sayfalar (giriş, yönetim paneli, yasal metinler, bakım ekranı) */
const SAYFA_MUAF = ["/ceo", "/giris", "/kayit", "/sifre-yenile", "/bakim", "/erisim-yok", "/yasal"];
/** Bakımda da çalışan API'ler: oturum, ödeme bildirimi (PayTR), saat, yönetim uçları (kendi içinde rol kontrolü yapar) */
const API_MUAF = ["/api/oturum", "/api/odeme/paytr-bildirim", "/api/zaman", "/api/admin-ai", "/api/admin-secure", "/api/durum", "/api/yonetim"];

const muaf = (path: string, list: string[]) => list.some((p) => path === p || path.startsWith(p + "/"));

async function ayarlar(): Promise<Ayarlar> {
  const simdi = Date.now();
  if (g.__h7Ayar && simdi - g.__h7Ayar.at < SURE) return g.__h7Ayar;
  const url = process.env.NEXT_PUBLIC_SUPABASE_URL;
  const key = process.env.NEXT_PUBLIC_SUPABASE_PUBLISHABLE_KEY || process.env.NEXT_PUBLIC_SUPABASE_ANON_KEY;
  if (!url || !key) return { at: simdi, bakim: false, erisim: mergeErisim(null) };
  try {
    const res = await fetch(`${url}/rest/v1/site_content?key=in.(general,erisim)&select=key,value`, {
      headers: key.startsWith("eyJ") ? { apikey: key, Authorization: `Bearer ${key}` } : { apikey: key },
      signal: AbortSignal.timeout(2500),
      cache: "no-store",
    });
    if (!res.ok) throw new Error(String(res.status));
    const rows = (await res.json()) as { key: string; value: Record<string, unknown> | null }[];
    const genel = rows.find((r) => r.key === "general")?.value || {};
    const yeni: Ayarlar = { at: simdi, bakim: genel.maintenance === true, erisim: mergeErisim(rows.find((r) => r.key === "erisim")?.value) };
    g.__h7Ayar = yeni;
    return yeni;
  } catch {
    // Ayar okunamazsa son bilinen ayar kullanılır (yoksa site açık kalır; sipariş izinleri yine veritabanında denetlenir)
    return g.__h7Ayar ? { ...g.__h7Ayar, at: simdi - SURE + 5_000 } : { at: simdi, bakim: false, erisim: mergeErisim(null) };
  }
}

export async function proxy(req: NextRequest) {
  const path = req.nextUrl.pathname;
  const api = path.startsWith("/api/");
  const oturum = await oturumCoz(req.cookies.get(OTURUM_CEREZI)?.value);
  const rol = oturum?.r && oturum.r !== "banned" ? oturum.r : null;
  const a = await ayarlar();

  // 1) Site kapalı (bakım)
  if (a.bakim && !bakimdaGirebilir(a.erisim, rol)) {
    if (api) {
      if (!muaf(path, API_MUAF)) {
        return NextResponse.json({ error: "Site şu an bakımda. Lütfen daha sonra tekrar dene.", bakim: true }, { status: 503, headers: { "retry-after": "600" } });
      }
    } else if (!muaf(path, SAYFA_MUAF)) {
      const u = req.nextUrl.clone();
      u.pathname = "/bakim";
      u.search = "";
      return NextResponse.rewrite(u);
    }
  }

  // 2) Rolüne kapalı hizmet sayfası
  if (!api) {
    const h = hizmetOfPath(path);
    if (h && !hizmetGorunur(a.erisim, h, rol)) {
      const u = req.nextUrl.clone();
      u.pathname = "/erisim-yok";
      u.search = "";
      return NextResponse.rewrite(u);
    }
  }
  return NextResponse.next();
}

export const config = {
  matcher: [
    // Statik dosyalar, görseller ve Next.js iç dosyaları hariç
    "/((?!_next/static|_next/image|favicon.ico|models/|.*\\.(?:png|jpg|jpeg|gif|webp|svg|ico|mp3|wav|mp4|glb|woff2?|txt|xml)$).*)",
  ],
};
