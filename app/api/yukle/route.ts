/**
 * app/api/yukle/route.ts
 * Dosya yükleme (18. aşama). Tarayıcı dosyayı doğrudan ÖZEL depoya, buradan aldığı tek kullanımlık imzalı adresle
 * yükler; dosya sunucudan (Worker) geçmez, gizli anahtar tarayıcıya gitmez. Dosyalar herkese açık değildir.
 *
 * POST { action: "adres", amac, hizmet?, name, size, mime?, siparisId? } → { provider, bucket, key, method, url, headers, maxSize }
 * POST { action: "dogrula", provider, bucket, key, size }                  → dosya depoda var mı, boyutu doğru mu
 *
 * amac / hizmet ve izin verilen dosyalar (tür ve boyut sunucuda denetlenir):
 *   siparis · remake | mix : MP3, WAV, ZIP
 *   siparis · yayin        : WAV, FLAC (ses) · JPG, PNG (kapak)
 *   siparis · genel        : diğer formlar için eski kurallar (ses, ZIP, görsel, PDF)
 *   destek                 : JPG, PNG, WEBP · MP4, MOV · MP3, WAV, FLAC
 *   teslim (yalnızca yetkili personel) : MP3, WAV, ZIP, proje dosyaları
 */
import { randomBytes } from "crypto";
import { clean, dogrulamaGerekli, fail, getStaff, getUser } from "../../../lib/server/supa";
import { DEPO, aktifSaglayici, depoEksikleri, enBuyukBoyut, nesneBilgisi, yuklemeAdresi, type Saglayici } from "../../../lib/server/depo";

const MB = 1024 * 1024;

/** Uzantı → kabul edilen MIME türleri (boş / octet-stream bazı tarayıcılarda normaldir) */
const MIME: Record<string, string[]> = {
  mp3: ["audio/mpeg", "audio/mp3", "audio/mpeg3", "audio/x-mpeg-3"],
  wav: ["audio/wav", "audio/x-wav", "audio/wave", "audio/vnd.wave"],
  flac: ["audio/flac", "audio/x-flac"],
  aiff: ["audio/aiff", "audio/x-aiff"], aif: ["audio/aiff", "audio/x-aiff"],
  m4a: ["audio/mp4", "audio/x-m4a", "audio/m4a"], ogg: ["audio/ogg"],
  zip: ["application/zip", "application/x-zip-compressed", "application/x-zip", "multipart/x-zip"],
  rar: ["application/vnd.rar", "application/x-rar-compressed"], "7z": ["application/x-7z-compressed"],
  jpg: ["image/jpeg"], jpeg: ["image/jpeg"], png: ["image/png"], webp: ["image/webp"],
  mp4: ["video/mp4"], mov: ["video/quicktime"],
  pdf: ["application/pdf"],
  // Proje dosyaları (Ableton, FL Studio, Pro Tools, Reaper, Cubase)
  als: [], flp: [], ptx: [], rpp: [], cpr: [],
};

type Kural = { uzanti: string[]; maxMB: number; ad: string };
const KURALLAR: Record<string, Kural> = {
  "siparis:remake": { uzanti: ["mp3", "wav", "zip"], maxMB: 50, ad: "MP3, WAV, ZIP" },
  "siparis:mix": { uzanti: ["mp3", "wav", "zip"], maxMB: 50, ad: "MP3, WAV, ZIP" },
  "siparis:yayin": { uzanti: ["wav", "flac", "jpg", "jpeg", "png"], maxMB: 50, ad: "WAV, FLAC (ses) · JPG, PNG (kapak)" },
  "siparis:genel": { uzanti: ["wav", "mp3", "aiff", "aif", "flac", "m4a", "ogg", "zip", "jpg", "jpeg", "png", "webp", "pdf"], maxMB: 50, ad: "WAV, MP3, AIFF, FLAC, M4A, ZIP, JPG, PNG, WEBP, PDF" },
  destek: { uzanti: ["jpg", "jpeg", "png", "webp", "mp4", "mov", "mp3", "wav", "flac"], maxMB: 50, ad: "JPG, PNG, WEBP, MP4, MOV, MP3, WAV, FLAC" },
  teslim: { uzanti: ["mp3", "wav", "zip", "rar", "7z", "als", "flp", "ptx", "rpp", "cpr", "flac", "aiff", "aif"], maxMB: 2048, ad: "MP3, WAV, ZIP ve proje dosyaları" },
};

const guvenliAd = (n: string) =>
  n.normalize("NFKD").replace(/[̀-ͯ]/g, "").replace(/[^\w.\-]+/g, "-").replace(/-+/g, "-").slice(-80) || "dosya";

export async function POST(req: Request) {
  let b: Record<string, unknown> = {};
  try {
    b = await req.json();
  } catch {
    return fail("Geçersiz istek.");
  }

  const eksik = depoEksikleri();
  if (eksik.length) {
    // Hangi anahtarın eksik olduğu açıkça söylenir (değerler asla gösterilmez)
    return fail(`Dosya yükleme sistemi henüz kurulmamış (eksik sunucu ayarı: ${eksik.join(", ")}).`, 503, { eksik });
  }

  const user = await getUser(req);
  if (!user) return fail("Dosya yüklemek için giriş yapmalısın.", 401, { needLogin: true });
  if (!user.verified) return dogrulamaGerekli();

  /* ---- Yükleme sonrası doğrulama: dosya depoda var mı, boyutu bildirilenle aynı mı? ---- */
  if (b.action === "dogrula") {
    const provider = (b.provider === "r2" ? "r2" : "supabase") as Saglayici;
    const bucket = clean(b.bucket, 40);
    const key = clean(b.key, 400);
    const size = Number(b.size);
    if (!Object.values(DEPO).includes(bucket as (typeof DEPO)[keyof typeof DEPO]) || !key || key.includes("..")) return fail("Dosya bilgisi geçersiz.");
    // Yalnızca kendi klasörü (personel: teslimat deposu)
    const kendi = key.startsWith(`siparis/${user.id}/`) || key.startsWith(`destek/${user.id}/`);
    if (!kendi && !(bucket === DEPO.teslimat && (await getStaff(req)))) return fail("Bu dosyaya erişimin yok.", 403);
    const info = await nesneBilgisi(provider, bucket, key);
    if (!info) return fail("Dosya depoda bulunamadı. Yükleme tamamlanmamış olabilir; tekrar dene.", 404);
    if (Number.isFinite(size) && size > 0 && info.size && info.size !== size) return fail("Yüklenen dosyanın boyutu eşleşmiyor. Tekrar yükle.", 409);
    return Response.json({ ok: true, size: info.size, mime: info.mime });
  }

  /* ---- Yükleme adresi ---- */
  const amac = clean(b.amac, 20) || "siparis";
  const hizmet = clean(b.hizmet, 20) || "genel";
  const anahtar = amac === "siparis" ? `siparis:${["remake", "mix", "yayin"].includes(hizmet) ? hizmet : "genel"}` : amac;
  const kural = KURALLAR[anahtar];
  if (!kural) return fail("Yükleme türü geçersiz.");

  let bucket: string = DEPO.yukleme;
  let klasor = `${amac === "destek" ? "destek" : "siparis"}/${user.id}`;
  if (amac === "teslim") {
    const staff = (await getStaff(req, "deliveries")) || (await getStaff(req, "orders"));
    if (!staff) return fail("Teslimat dosyası yükleme yetkin yok.", 403);
    const siparisId = Number(b.siparisId);
    if (!Number.isInteger(siparisId) || siparisId <= 0) return fail("Sipariş seçimi geçersiz.");
    bucket = DEPO.teslimat;
    klasor = `teslim/${siparisId}`;
  }

  const name = clean(b.name, 200);
  const size = Number(b.size);
  const mime = clean(b.mime, 100).toLowerCase();
  const ext = (name.split(".").pop() || "").toLowerCase();
  if (!name || !kural.uzanti.includes(ext)) {
    return fail(`“${name || "dosya"}” bu alana yüklenemez. İzin verilen dosyalar: ${kural.ad}.`, 415, { izinli: kural.ad });
  }
  const izinliMime = MIME[ext] || [];
  if (mime && mime !== "application/octet-stream" && izinliMime.length && !izinliMime.includes(mime)) {
    return fail(`“${name}” dosyasının türü (${mime}) uzantısıyla uyuşmuyor. Dosyayı kontrol edip tekrar dene.`, 415);
  }
  const provider = aktifSaglayici();
  const sinir = Math.min(kural.maxMB * MB, enBuyukBoyut(provider));
  if (!(size > 0)) return fail(`“${name}” boş görünüyor.`);
  if (size > sinir) {
    return fail(`“${name}” ${Math.round(sinir / MB)} MB sınırını aşıyor. Daha küçük bir dosya veya ZIP yükle.`, 413, { maxSize: sinir });
  }

  const gun = new Date().toISOString().slice(0, 10).replace(/-/g, "");
  const key = `${klasor}/${gun}/${randomBytes(9).toString("hex")}-${guvenliAd(name)}`;
  try {
    const hedef = await yuklemeAdresi(bucket, key, mime || izinliMime[0] || "application/octet-stream");
    return Response.json({ ok: true, ...hedef, maxSize: sinir });
  } catch (e) {
    const m = e instanceof Error ? e.message : "";
    // Özel depo henüz oluşturulmadıysa açıkça söyle
    if (/bucket/i.test(m) && /not.?found/i.test(m)) {
      return fail(`Dosya deposu (${bucket}) henüz oluşturulmamış. Yönetim veritabanı kurulumunu (migration 10) tamamlamalı.`, 503);
    }
    return fail("Yükleme adresi oluşturulamadı" + (m ? `: ${m.slice(0, 160)}` : "."), 502);
  }
}
