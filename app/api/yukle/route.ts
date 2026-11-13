/**
 * app/api/yukle/route.ts
 * Sipariş / yayın dosyaları için tek kullanımlık, imzalı yükleme adresi üretir.
 * - Giriş zorunludur; dosyalar kullanıcının kendi klasörüne yüklenir: site-media/siparis/<kullanıcı>/...
 * - Dosya türü (uzantı) ve boyutu sunucuda kontrol edilir.
 * - Tarayıcı dosyayı doğrudan Supabase Storage'a yükler; gizli anahtar tarayıcıya gitmez.
 */
import { randomBytes } from "crypto";
import { SUPA_URL, clean, fail, getUser, serverReady, serviceHeaders } from "../../../lib/server/supa";

const BUCKET = "site-media";
const MB = 1024 * 1024;

/** İzin verilen uzantılar ve en büyük boyutları. */
const RULES: Record<string, number> = {
  wav: 50 * MB, mp3: 50 * MB, aiff: 50 * MB, aif: 50 * MB, flac: 50 * MB, m4a: 50 * MB, ogg: 50 * MB,
  zip: 50 * MB,
  jpg: 20 * MB, jpeg: 20 * MB, png: 20 * MB, webp: 20 * MB,
  pdf: 20 * MB,
};

const safeName = (n: string) =>
  n.normalize("NFKD").replace(/[̀-ͯ]/g, "").replace(/[^\w.\-]+/g, "-").replace(/-+/g, "-").slice(-80) || "dosya";

export async function POST(req: Request) {
  if (!serverReady()) return fail("Dosya yükleme sistemi henüz kurulmamış (sunucu anahtarı eksik).", 503);
  const user = await getUser(req);
  if (!user) return fail("Dosya yüklemek için giriş yapmalısın.", 401, { needLogin: true });

  let b: Record<string, unknown> = {};
  try {
    b = await req.json();
  } catch {
    return fail("Geçersiz istek.");
  }
  const name = clean(b.name, 200);
  const size = Number(b.size);
  const ext = (name.split(".").pop() || "").toLowerCase();
  const max = RULES[ext];
  if (!name || !max) return fail(`“${name || "dosya"}” desteklenmeyen bir dosya türü. İzin verilenler: WAV, MP3, AIFF, FLAC, M4A, ZIP, JPG, PNG, WEBP, PDF.`);
  if (!(size > 0)) return fail(`“${name}” boş görünüyor.`);
  if (size > max) return fail(`“${name}” ${Math.round(max / MB)} MB sınırını aşıyor. Daha küçük bir dosya veya ZIP yükle.`);

  const day = new Date().toISOString().slice(0, 10).replace(/-/g, "");
  const path = `siparis/${user.id}/${day}/${randomBytes(6).toString("hex")}-${safeName(name)}`;

  const res = await fetch(`${SUPA_URL}/storage/v1/object/upload/sign/${BUCKET}/${path}`, {
    method: "POST",
    headers: { ...serviceHeaders(), "content-type": "application/json" },
    body: "{}",
    cache: "no-store",
  });
  const j = (await res.json().catch(() => ({}))) as { url?: string; signedURL?: string; error?: string; message?: string };
  const signed = j.url || j.signedURL || "";
  const token = signed.includes("token=") ? new URL(signed, SUPA_URL).searchParams.get("token") : null;
  if (!res.ok || !token) {
    return fail("Yükleme adresi oluşturulamadı" + (j.message || j.error ? `: ${j.message || j.error}` : "."), 502);
  }
  return Response.json({
    ok: true,
    path,
    token,
    publicUrl: `${SUPA_URL}/storage/v1/object/public/${BUCKET}/${path}`,
  });
}
