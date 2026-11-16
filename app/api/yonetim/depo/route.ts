/**
 * app/api/yonetim/depo/route.ts — Depolama ve yedek (7. aşama). Yalnızca CEO.
 *
 * POST { action: "durum" }                          → aktif depo, eksik ayar ADLARI, depolar (gizlilik, dosya sayısı, boyut), kopya kayıtları
 * POST { action: "butunluk" }                       → kayıtlarda geçen özel dosyalar depoda var mı, boyutları tutuyor mu
 * POST { action: "kopyala", amac, yeniden? }         → Supabase → R2 kopyası (aktarim: aynı adlı R2 deposu, yedek: hity7-backups)
 *                                                      8 dosyalık parti (Workers alt istek sınırı). Kaynak ASLA silinmez;
 *                                                      kayıtların hangi depoyu gösterdiği değişmez.
 * Gizli anahtar değerleri hiçbir yanıtta veya kayıtta yer almaz.
 */
import { audit, fail, getStaff, rpc, serverReady } from "../../../../lib/server/supa";
import { DEPO, aktifSaglayici, depoEksikleri, r2Hazir, r2Kopyala } from "../../../../lib/server/depo";

const PARTI = 8;

const AMAC: Record<string, string> = {
  "hity7-uploads": "Sipariş ve destek dosyaları (özel)",
  "hity7-deliveries": "Teslimat dosyaları (özel)",
  "site-media": "Site görselleri (herkese açık)",
  "hity7-backups": "Yedek",
};

const hata = (text: string) => /"message":"([^"]+)"/.exec(text)?.[1]?.replace(/^YETKISIZ:?\s*/, "") || "İşlem yapılamadı.";

type Ozet = { storage: boolean; kovalar: { ad: string; ozel: boolean; adet: number; boyut: number }[]; kopyalar: { amac: string; durum: string; adet: number }[] };
type Nesne = { kova: string; anahtar: string; boyut: number | null; etag: string | null; mime: string | null };

export async function POST(req: Request) {
  if (!serverReady()) return fail("Depolama yönetimi için sunucu ayarı eksik: SUPABASE_SECRET_KEY.", 503);
  const staff = await getStaff(req);
  if (!staff || staff.role !== "ceo") return fail("Depolama işlemlerini yalnızca CEO yapabilir.", 403);
  let b: Record<string, unknown> = {};
  try {
    b = await req.json();
  } catch {
    return fail("Geçersiz istek.");
  }

  if (b.action === "durum") {
    const r = await rpc<Ozet>("h7_depo_ozet", {});
    const ozet = r.ok ? (r.body as Ozet) : null;
    const varOlan = new Map((ozet?.kovalar || []).map((k) => [k.ad, k]));
    const adlar = Array.from(new Set([...Object.keys(AMAC), ...(ozet?.kovalar || []).map((k) => k.ad)]));
    return Response.json({
      ok: true,
      saglayici: aktifSaglayici(),
      eksikler: depoEksikleri(),
      r2: { hazir: r2Hazir(), aktif: aktifSaglayici() === "r2" },
      kovalar: adlar.map((ad) => {
        const k = varOlan.get(ad);
        return {
          ad,
          amac: AMAC[ad] || "Diğer",
          var: ozet ? !!k : null,
          ozel: k ? k.ozel : null,
          adet: k ? Number(k.adet) : null,
          boyut: k ? Number(k.boyut) : null,
          kesik: false,
        };
      }),
      kopyalar: ozet?.kopyalar || [],
      kopyaTablosu: r.ok,
    });
  }

  if (b.action === "butunluk") {
    const r = await rpc("h7_depo_butunluk", {});
    if (!r.ok) return fail(r.status === 404 ? "Bütünlük kontrolü henüz kurulmamış (veritabanı: migration 11)." : hata(r.text), 503);
    return Response.json({ ok: true, ...(r.body as object) });
  }

  if (b.action === "kopyala") {
    if (!r2Hazir()) return fail("R2 yapılandırılmamış. Eksik: R2_ACCOUNT_ID, R2_ACCESS_KEY_ID, R2_SECRET_ACCESS_KEY.", 503);
    const amac = b.amac === "yedek" ? "yedek" : "aktarim";
    const liste = await rpc<Nesne[]>("h7_depo_kopyalanacak", { p_amac: amac, p_limit: PARTI, p_yeniden: b.yeniden === true });
    if (!liste.ok) return fail(liste.status === 404 ? "Aktarım kayıtları henüz kurulmamış (veritabanı: migration 11)." : hata(liste.text), 503);
    const nesneler = Array.isArray(liste.body) ? (liste.body as Nesne[]) : [];
    const kayitlar: Record<string, unknown>[] = [];
    let dogrulandi = 0;
    let hatali = 0;
    for (const n of nesneler) {
      const hedefKova = amac === "yedek" ? DEPO.yedek : n.kova;
      const hedefAnahtar = amac === "yedek" ? `${n.kova}/${n.anahtar}` : n.anahtar;
      try {
        const s = await r2Kopyala({ kaynakKova: n.kova, kaynakKey: n.anahtar, boyut: n.boyut, mime: n.mime, kaynakEtag: n.etag, hedefKova, hedefKey: hedefAnahtar });
        kayitlar.push({ amac, kova: n.kova, anahtar: n.anahtar, hedef_kova: hedefKova, hedef_anahtar: hedefAnahtar, boyut: s.boyut, etag: s.etag, durum: "dogrulandi", yontem: s.yontem });
        dogrulandi += 1;
      } catch (e) {
        kayitlar.push({ amac, kova: n.kova, anahtar: n.anahtar, hedef_kova: hedefKova, hedef_anahtar: hedefAnahtar, boyut: n.boyut, durum: "hata", hata: e instanceof Error ? e.message.slice(0, 300) : "bilinmeyen hata" });
        hatali += 1;
      }
    }
    if (kayitlar.length) {
      const k = await rpc("h7_depo_kopya_kaydet", { p_kayitlar: kayitlar });
      if (!k.ok) return fail("Kopyalar yapıldı ama sonuç kaydedilemedi; tekrar çalıştırınca doğrulanıp kaydedilir.", 502);
    }
    await audit(staff.id, `depo.${amac}`, `${nesneler.length} dosya`, { dogrulandi, hata: hatali });
    return Response.json({ ok: true, kopyalandi: dogrulandi, dogrulandi, hata: hatali, atlandi: 0, kalan: nesneler.length === PARTI });
  }

  return fail("Bilinmeyen işlem.");
}
