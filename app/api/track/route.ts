/**
 * app/api/track/route.ts
 * Anonim ziyaretçi sayacı (kişisel veri toplamaz). Herkese açık anahtarla page_views tablosuna ekler;
 * tablo yalnızca eklemeye izin verir, okuma yetkisi sadece yönetimdedir (RLS).
 */
import { SUPA_ANON, SUPA_URL, anonDb } from "../../../lib/server/supa";

const BOT = /bot|crawl|spider|slurp|preview|facebookexternalhit|headless|lighthouse|monitor/i;

function parseUA(ua: string) {
  const device = /ipad|tablet/i.test(ua) ? "Tablet" : /mobi|android|iphone/i.test(ua) ? "Mobil" : "Masaüstü";
  const browser = /edg\//i.test(ua)
    ? "Edge"
    : /opr\/|opera/i.test(ua)
    ? "Opera"
    : /chrome|crios/i.test(ua)
    ? "Chrome"
    : /firefox|fxios/i.test(ua)
    ? "Firefox"
    : /safari/i.test(ua)
    ? "Safari"
    : "Diğer";
  return { device, browser };
}

export async function POST(req: Request) {
  if (!SUPA_URL || !SUPA_ANON) return new Response(null, { status: 204 });

  const ua = req.headers.get("user-agent") || "";
  if (!ua || BOT.test(ua)) return new Response(null, { status: 204 });

  let data: { path?: string; referrer?: string; session_id?: string } = {};
  try {
    data = JSON.parse(await req.text());
  } catch {
    return new Response(null, { status: 204 });
  }

  const path = String(data.path || "").slice(0, 200);
  if (!path.startsWith("/") || path.startsWith("/admin") || path.startsWith("/ceo") || path.startsWith("/api")) {
    return new Response(null, { status: 204 });
  }

  const { device, browser } = parseUA(ua);
  const country = (req.headers.get("x-vercel-ip-country") || req.headers.get("cf-ipcountry") || "").slice(0, 2);

  try {
    await anonDb("page_views", {
      method: "POST",
      headers: { Prefer: "return=minimal" },
      body: JSON.stringify({
        path,
        referrer: String(data.referrer || "").slice(0, 120),
        session_id: String(data.session_id || "").slice(0, 60),
        device,
        browser,
        country,
      }),
    });
  } catch {
    /* sayaç hatası siteyi etkilemesin */
  }
  return new Response(null, { status: 204 });
}
