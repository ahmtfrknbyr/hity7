/**
 * app/api/siparis/route.ts
 * Sitedeki tüm sipariş formlarının veritabanına kaydı (sepet yok: her hizmet doğrudan sipariş).
 * Fiyat DAİMA sunucuda / veritabanında hesaplanır ve tutar TEK işlemde bakiyeden düşülür (yetersizse sipariş oluşmaz):
 *   - influencer (bireysel seçim) → h7_influencer_siparis  (kademeli indirim + sipariş anı maliyet kaydı)
 *   - paket (hazır influencer paketi) → h7_paket_siparis   (süreli kampanya fiyatı sipariş anında doğrulanır)
 *   - yayin, mix, remake, smm → place_order
 * beklenenTutar: müşterinin onay ekranında gördüğü tutar. Sunucunun hesabı farklıysa sipariş oluşmaz (409 FIYAT_DEGISTI).
 */
import { audit, clean, db, dogrulamaGerekli, fail, getRole, getUser, rpc, serverReady, SUPA_URL } from "../../../lib/server/supa";
import { dispatchSmmOrder } from "../../../lib/server/smm";
import { consentRecord } from "../../../lib/server/yasal";
import { siparisIzni } from "../../../lib/server/erisim";
import { hizmetOfSiparis } from "../../../lib/erisim";
import { DEFAULT_CONTENT, mergePricing, mergeUpsell, type ProducerItem } from "../../../lib/site-content";
import { CAMPAIGN_TYPES, INFLUENCER_MAX, TIKTOK, TIKTOK_MIN, accountKey, minInfluencers } from "../../../lib/influencer-kural";

const SERVICE_NAMES: Record<string, string> = {
  influencer: "Influencer Marketing",
  paket: "Influencer Marketing",
  yayin: "Dijital Yayın",
  mix: "Mix & Mastering",
  remake: "Remake Beat",
  smm: "SMM Panel",
};

/** Özel depoya (hity7-uploads) yüklenmiş dosya: yalnızca bu kullanıcının klasöründeki anahtarlar kabul edilir */
const OZEL_DEPO = "hity7-uploads";

/** Veritabanı hatasını müşteriye anlaşılır bir yanıta çevirir (ham hata metni gösterilmez). */
function rpcHatasi(text: string): { status: number; error: string; extra?: Record<string, unknown> } | null {
  const m = (k: string) => text.includes(k);
  if (m("FIYAT_DEGISTI")) {
    let yeni: unknown = null;
    try {
      const j = JSON.parse(text) as { details?: string };
      yeni = j.details ? JSON.parse(j.details) : null;
    } catch {
      /* ayrıntı okunamadı */
    }
    return { status: 409, error: "Fiyat değişti. Güncel tutarı kontrol edip yeniden onayla.", extra: { fiyatDegisti: true, guncel: yeni } };
  }
  if (m("HIZMET_KAPALI")) return { status: 403, error: "Bu hizmet şu an sipariş almıyor." };
  if (m("MIN_INFLUENCER")) return { status: 400, error: `TikTok kampanyası için en az ${TIKTOK_MIN} influencer seçmelisin.`, extra: { minInfluencers: TIKTOK_MIN } };
  if (m("INFLUENCER_YOK")) return { status: 409, error: "Seçilen influencerlardan biri artık satışta değil. Sayfayı yenile." };
  if (m("FIYAT_YOK")) return { status: 409, error: "Seçilen influencerlardan birinin fiyatı henüz belirlenmemiş." };
  if (m("PAKET_YOK")) return { status: 410, error: "Bu paket artık satışta değil. Sayfayı yenile." };
  if (m("SIPARIS_GECERSIZ")) return { status: 400, error: "Sipariş bilgileri geçersiz. Sayfayı yenileyip tekrar dene." };
  return null;
}

const REMAKE_NAMES: Record<string, string> = {
  free: "FREE BEAT",
  birebir: "BİREBİR REMAKE",
  modern: "MODERN REMAKE",
  ozgun: "ÖZGÜN REMAKE",
};

const FORMAT_NAMES: Record<string, string> = { single: "Tekli (Single)", ep: "EP", album: "Albüm" };

type FileRef = { name: string; url: string; kind: string; key?: string; depo?: string; provider?: string; size?: number };

async function siteValue(key: string): Promise<unknown> {
  const r = await db<{ value: unknown }[]>(`site_content?key=eq.${encodeURIComponent(key)}&select=value`);
  return Array.isArray(r.body) ? r.body[0]?.value : undefined;
}

const yesNo = (v: unknown) => (v === true || v === "yes" || v === "evet" ? "Evet" : "Hayır");

export async function POST(req: Request) {
  if (!serverReady()) return fail("Sipariş sistemi henüz kurulmamış (sunucu anahtarı eksik).", 503);

  // Sipariş için giriş zorunlu
  const user = await getUser(req);
  if (!user) return fail("Sipariş vermek için giriş yapmalısın.", 401, { needLogin: true });
  if (!user.verified) return dogrulamaGerekli();

  let b: Record<string, unknown> = {};
  try {
    b = await req.json();
  } catch {
    return fail("Geçersiz istek.");
  }
  const type = String(b.type || "");
  if (!SERVICE_NAMES[type]) return fail("Bilinmeyen sipariş türü.");

  // Hizmet görünürlük / sipariş izni ve site yayın durumu (CEO panelinden yönetilir; rol veritabanından okunur)
  const rol = await getRole(user.id, req.headers.get("authorization") || undefined);
  if (!rol) return fail("Hesabın sipariş vermeye kapalı. Destek ile iletişime geç.", 403);
  const izin = await siparisIzni(hizmetOfSiparis(type)!, rol);
  if (!izin.ok) return fail(izin.error, izin.status, { hizmetKapali: izin.status === 403, bakim: izin.status === 503 });

  // Müşterinin onay ekranında gördüğü tutar (varsa). Sunucu hesabıyla eşleşmezse sipariş oluşmaz.
  const beklenen = b.beklenenTutar === undefined || b.beklenenTutar === null ? null : Math.round(Number(b.beklenenTutar) * 100) / 100;
  if (beklenen !== null && !(Number.isFinite(beklenen) && beklenen >= 0)) return fail("Onaylanan tutar geçersiz. Sayfayı yenile.");

  // Tekrar koruması: aynı istek kimliği ikinci kez gelirse veritabanı yeni sipariş oluşturmaz, bakiye ikinci kez düşmez
  const istekId = clean(b.istekId, 64);
  if (istekId && !/^[A-Za-z0-9-]{8,64}$/.test(istekId)) return fail("İstek kimliği geçersiz. Sayfayı yenileyip tekrar dene.");

  // Ön bilgilendirme + mesafeli satış + hizmet sözleşmesi onayı ve hemen ifa talebi (Mesafeli Sözleşmeler Yönetmeliği)
  if (b.accept !== true) return fail("Siparişi oluşturmak için sözleşme onay kutusunu işaretlemelisin.", 400, { needAccept: true });

  // Ad / iletişim formda yoksa hesap bilgileri kullanılır
  const name = clean(b.name, 120) || user.name || user.email.split("@")[0] || "Müşteri";
  const contact = clean(b.contact, 160) || user.email;
  if (!name || !contact) return fail("Ad ve iletişim bilgisi gerekli.");

  // Formdan gelen ayrıntı satırları (yalnızca metin olarak saklanır)
  const details: [string, string][] = (Array.isArray(b.details) ? b.details : [])
    .slice(0, 60)
    .filter((r): r is unknown[] => Array.isArray(r) && r.length >= 2)
    .map((r) => [clean(r[0], 60), clean(r[1], 1500)] as [string, string])
    .filter(([k, v]) => k && v);
  details.push(["İletişim", contact]);

  // Yüklenen dosyalar: yalnızca bu kullanıcının kendi klasöründeki dosyalar kabul edilir.
  //  - Yeni: özel depo (hity7-uploads) anahtarı → dosya herkese açık değildir; indirme kısa süreli imzalı bağlantıyla
  //  - Eski: site-media herkese açık adresi (geçiş dönemindeki yarım kalmış formlar için)
  const okPrefix = `${SUPA_URL}/storage/v1/object/public/site-media/siparis/${user.id}/`;
  const keyPrefix = `siparis/${user.id}/`;
  const files: FileRef[] = (Array.isArray(b.files) ? b.files : [])
    .slice(0, 60)
    .map((f) => {
      const o = (f || {}) as { name?: string; url?: string; kind?: string; key?: string; size?: number; provider?: string };
      const key = clean(o.key, 400);
      return {
        name: clean(o.name, 160),
        url: clean(o.url, 700),
        kind: clean(o.kind, 30),
        ...(key ? { key, depo: OZEL_DEPO, provider: o.provider === "r2" ? "r2" : "supabase", size: Number(o.size) || undefined } : {}),
      };
    })
    .filter((f) => (f.key ? f.key.startsWith(keyPrefix) && !f.key.includes("..") : f.url.startsWith(okPrefix) && !f.url.includes("..")));

  let amount = 0;
  let title = SERVICE_NAMES[type];
  const payload: Record<string, unknown> = {};
  let release: Record<string, unknown> | null = null;
  let releaseTracks: Record<string, unknown>[] = [];

  /* ---------------- INFLUENCER ---------------- */
  if (type === "influencer") {
    const link = clean(b.link, 500);
    if (!/^https?:\/\/\S+\.\S+/i.test(link)) return fail("Geçerli bir içerik linki gerekli.");
    const kinds = Array.from(new Set((Array.isArray(b.campaignTypes) ? b.campaignTypes : []).map((x) => clean(x, 40)))).filter((x) =>
      (CAMPAIGN_TYPES as readonly string[]).includes(x)
    );
    if (!kinds.length) return fail("Paylaşım türü seçilmeli.");
    const rawIds = (Array.isArray(b.influencerIds) ? b.influencerIds : []).map((x) => clean(x, 60));
    if (rawIds.length > INFLUENCER_MAX) return fail(`Bir kampanyada en fazla ${INFLUENCER_MAX} influencer seçilebilir.`);
    const ids = Array.from(new Set(rawIds));
    if (ids.length !== rawIds.length) return fail("Aynı influencer iki kez seçilemez.");
    if (!ids.length || ids.some((i) => !/^[0-9a-f-]{36}$/i.test(i))) return fail("Influencer seçimi geçersiz.");
    const inf = await db<{ id: string; name: string; price: number; username: string | null; tiktok: string | null }[]>(
      `influencers?id=in.(${ids.join(",")})&active=eq.true&select=id,name,price,username,tiktok`
    );
    const rows = Array.isArray(inf.body) ? inf.body : [];
    if (!inf.ok || rows.length !== ids.length) return fail("Seçilen influencerlardan biri artık satışta değil. Sayfayı yenile.");
    // Aynı hesap (aynı TikTok kullanıcı adı) panelde iki kez eklenmiş olsa bile kampanyada iki kez yer alamaz
    const accounts = new Set<string>();
    for (const r of rows) {
      const k = accountKey(r);
      if (accounts.has(k)) return fail(`Aynı hesap iki kez seçilemez (${k.startsWith("@") ? k : r.name}).`, 400, { duplicateAccount: true });
      accounts.add(k);
    }
    // TikTok kampanyası ("Influencerları Kendin Seç"): en az 5 farklı hesap (arayüzle ve veritabanıyla aynı kural)
    const need = minInfluencers(kinds);
    if (accounts.size < need) {
      return fail(
        kinds.includes(TIKTOK)
          ? `TikTok kampanyası için en az ${TIKTOK_MIN} farklı influencer seçmelisin (seçilen: ${accounts.size}).`
          : "En az bir influencer seçmelisin.",
        400,
        { minInfluencers: need, selected: accounts.size }
      );
    }
    const brief = clean(b.brief, 1500);
    details.unshift(
      ["Paylaşım türü", kinds.join(" + ")],
      ["İçerik linki", link],
      ["Influencer sayısı", `${accounts.size} farklı hesap`],
      ["Influencerlar", rows.map((r) => r.name).join(", ")]
    );
    if (brief) details.push(["Kampanya notu", brief]);

    // Tutar, kademeli indirim ve sipariş anı maliyet kaydı veritabanında hesaplanır (tek işlem)
    const placed = await rpc("h7_influencer_siparis", {
      p_user: user.id,
      p_name: name,
      p_influencers: ids,
      p_types: kinds,
      p_payload: {
        files,
        details,
        link,
        ...(brief ? { brief } : {}),
        onay: await consentRecord(["kullanim-kosullari", "on-bilgilendirme", "mesafeli-satis"], { hemenIfa: true }),
      },
      p_istek: istekId ? `influencer:${istekId}` : null,
      p_beklenen: beklenen,
    });
    return await sonuclandir(placed, user.id, type, istekId);
  }

  /* ---------------- HAZIR INFLUENCER PAKETİ ---------------- */
  if (type === "paket") {
    const paketId = clean(b.paketId, 40);
    if (!/^[0-9a-f-]{36}$/i.test(paketId)) return fail("Paket seçimi geçersiz.");
    const link = clean(b.link, 500);
    if (!/^https?:\/\/\S+\.\S+/i.test(link)) return fail("Geçerli bir içerik linki gerekli.");
    const brief = clean(b.brief, 1500);
    details.unshift(["İçerik linki", link]);
    if (brief) details.push(["Kampanya notu", brief]);
    // Bireysel influencer indirimleri paketlere UYGULANMAZ; fiyat = CEO'nun belirlediği fiyat veya geçerli kampanya fiyatı
    const placed = await rpc("h7_paket_siparis", {
      p_user: user.id,
      p_name: name,
      p_paket: paketId,
      p_payload: {
        files,
        details,
        link,
        ...(brief ? { brief } : {}),
        onay: await consentRecord(["kullanim-kosullari", "on-bilgilendirme", "mesafeli-satis"], { hemenIfa: true }),
      },
      p_istek: istekId ? `paket:${istekId}` : null,
      p_beklenen: beklenen,
    });
    return await sonuclandir(placed, user.id, type, istekId);
  }

  /* ---------------- DİJİTAL YAYIN ---------------- */
  if (type === "yayin") {
    const format = clean(b.format, 10);
    if (!FORMAT_NAMES[format]) return fail("Yayın türü geçersiz.");
    const artist = clean(b.artist, 120);
    const rTitle = clean(b.releaseName, 160);
    if (!artist || !rTitle) return fail("Sanatçı adı ve yayın adı gerekli.");
    const rawTracks = (Array.isArray(b.tracks) ? b.tracks : []).slice(0, 40) as Record<string, unknown>[];
    const count = rawTracks.length;
    if (format === "single" && count !== 1) return fail("Tekli yayında 1 şarkı olmalı.");
    if (format === "ep" && (count < 2 || count > 6)) return fail("EP 2–6 şarkıdan oluşmalı.");
    if (format === "album" && (count < 7 || count > 40)) return fail("Albüm 7–40 şarkıdan oluşmalı.");
    const cover = files.find((f) => f.kind === "cover");
    if (!cover || !/\.(jpe?g|png)$/i.test(cover.name)) return fail("Kapak görseli (JPG veya PNG) yüklenmeli.");
    // Özel depodaki dosyanın kalıcı referansı (panel bunu kısa süreli imzalı bağlantıya çevirir)
    const ref = (f: FileRef | undefined) => (f ? (f.key ? `depo://${f.provider || "supabase"}/${f.depo || OZEL_DEPO}/${f.key}` : f.url) : "");

    releaseTracks = rawTracks.map((t, i) => {
      const audio = files.find((f) => f.kind === `track-${i + 1}`);
      return {
        position: i + 1,
        title: clean(t.title, 160),
        audio_url: ref(audio),
        audio_name: audio?.name || "",
        songwriter: clean(t.songwriter, 160),
        composer: clean(t.composer, 160),
        language: clean(t.language, 40) || "Türkçe",
        explicit: t.explicit === "yes" || t.explicit === true,
        instrumental: t.instrumental === "yes" || t.instrumental === true,
      };
    });
    const missing = releaseTracks.findIndex((t) => !t.title || !t.audio_url);
    if (missing >= 0) return fail(`Şarkı ${missing + 1}: ad ve master ses dosyası gerekli.`);

    const releaseDate = clean(b.releaseDate, 10);
    const date = /^\d{4}-\d{2}-\d{2}$/.test(releaseDate) ? releaseDate : null;
    const stores = (Array.isArray(b.stores) ? b.stores : []).map((s) => clean(s, 40)).filter(Boolean).slice(0, 20);
    if (!stores.length) return fail("En az bir dağıtım platformu seçilmeli.");

    const pricing = mergePricing(await siteValue("pricing"));
    amount = Number(pricing.yayin[format as keyof typeof pricing.yayin]) || 0;
    title = `Dijital yayın · ${FORMAT_NAMES[format]} · ${rTitle}`;
    release = {
      user_id: user.id,
      format,
      title: rTitle,
      artist,
      release_date: date,
      genre: clean(b.genre, 60),
      language: clean(b.language, 40),
      country: clean(b.country, 60),
      explicit: b.explicit === "yes",
      release_type: b.releaseType === "cover" ? "cover" : "original",
      cover_url: ref(cover),
      stores,
      status: "Başvuru alındı",
      meta: {
        artistExists: b.artistExists === "no" ? "no" : "yes",
        links: {
          spotify: clean(b.spotify, 300),
          appleMusic: clean(b.appleMusic, 300),
          youtube: clean(b.youtube, 300),
          instagram: clean(b.instagram, 300),
        },
        songwriter: clean(b.songwriter, 160),
        composer: clean(b.composer, 160),
        producer: clean(b.producer, 160),
        notes: clean(b.notes, 1500),
      },
    };
    details.unshift(
      ["Yayın türü", FORMAT_NAMES[format]],
      ["Sanatçı", artist],
      ["Yayın adı", rTitle],
      ["Şarkı sayısı", String(count)],
      ["Çıkış tarihi", date || "Belirtilmedi"],
      ["Tür / dil", [clean(b.genre, 60), clean(b.language, 40)].filter(Boolean).join(" / ") || "—"],
      ["Açık içerik", yesNo(b.explicit)],
      ["Platformlar", stores.join(", ")]
    );
    if (amount === 0) details.push(["Ücret", "Yayın ücreti henüz belirlenmedi; ekibimiz bilgilendirecek."]);
    payload.release = { format, artist, title: rTitle, tracks: releaseTracks.map((t) => t.title) };
  }

  /* ---------------- MIX & MASTERING ---------------- */
  if (type === "mix") {
    const stems = b.service === "stems";
    const pid = clean(b.producerId, 40);
    const raw = await siteValue("producers");
    const list = (Array.isArray(raw) ? raw : DEFAULT_CONTENT.producers) as ProducerItem[];
    const p = list.find((x) => x.id === pid && x.active !== false);
    if (!p) return fail("Seçilen prodüktör bulunamadı. Sayfayı yenile.");
    const work = files.filter((f) => f.kind !== "reference");
    if (!work.length) return fail("Lütfen vokal ve beat dosyalarını yükle.");
    amount = Number(stems ? p.stemsPrice : p.mixPrice) || 0;
    if (!(amount > 0)) return fail("Bu prodüktörün fiyatı henüz belirlenmemiş.");
    title = `${stems ? "Stems Mix & Mastering" : "Mix & Mastering"} · ${p.name}`;
    payload.producerId = p.id;
    payload.service = stems ? "stems" : "mix";
    details.unshift(["Hizmet", stems ? "Stems Mix & Mastering" : "Mix & Mastering"], ["Prodüktör", p.name]);
    const ek = await ekHizmet("mix", b.addonId);
    if ("error" in ek) return fail(ek.error);
    if (ek.addon) {
      amount += ek.addon.price;
      title += ` + ${ek.addon.name}`;
      payload.addon = { id: ek.addon.id, name: ek.addon.name, price: ek.addon.price };
      details.push(["Ek hizmet", `${ek.addon.name} (${ek.addon.price.toLocaleString("tr-TR")} TL)`]);
    }
  }

  /* ---------------- REMAKE BEAT ---------------- */
  if (type === "remake") {
    const opt = clean(b.optionId, 20);
    if (!REMAKE_NAMES[opt]) return fail("Seçenek geçersiz.");
    const pricing = mergePricing(await siteValue("pricing"));
    amount = Number(pricing.remake[opt as keyof typeof pricing.remake]) || 0;
    const song = clean(b.songName, 160);
    if (!song) return fail("Şarkı / referans adı gerekli.");
    title = `Remake Beat · ${REMAKE_NAMES[opt]} · ${song}`;
    payload.optionId = opt;
    details.unshift(["Seçenek", REMAKE_NAMES[opt]], ["Şarkı / referans", song]);
    const artist = clean(b.artistName, 120);
    if (artist) details.splice(2, 0, ["Sanatçı", artist]);
    const ek = await ekHizmet("remake", b.addonId);
    if ("error" in ek) return fail(ek.error);
    if (ek.addon) {
      amount += ek.addon.price;
      title += ` + ${ek.addon.name}`;
      payload.addon = { id: ek.addon.id, name: ek.addon.name, price: ek.addon.price };
      details.push(["Ek hizmet", `${ek.addon.name} (${ek.addon.price.toLocaleString("tr-TR")} TL)`]);
    }
  }

  /* ---------------- SMM ---------------- */
  if (type === "smm") {
    const sid = Number(b.serviceId);
    const qty = Math.floor(Number(b.quantity));
    const target = clean(b.target, 500);
    if (!Number.isFinite(sid)) return fail("Hizmet seçimi geçersiz.");
    if (!/^https?:\/\/\S+\.\S+/i.test(target)) return fail("Geçerli bir bağlantı gerekli (https:// ile).");
    const r = await db<{ id: number; code: string; name: string; price: number; min_qty: number; max_qty: number }[]>(
      `smm_catalog?id=eq.${sid}&select=id,code,name,price,min_qty,max_qty`
    );
    const s = Array.isArray(r.body) ? r.body[0] : undefined;
    if (!r.ok || !s) return fail("Bu hizmet artık satışta değil. Sayfayı yenile.");
    const min = Number(s.min_qty) || 1;
    const max = Number(s.max_qty) || 10000000;
    if (!(qty >= min && qty <= max)) return fail(`Miktar ${min.toLocaleString("tr-TR")} ile ${max.toLocaleString("tr-TR")} arasında olmalı.`);
    amount = Math.round((Number(s.price) * qty) / 10) / 100; // fiyat 1.000 adet başına
    if (!(amount > 0)) return fail("Bu hizmetin fiyatı geçersiz. Sayfayı yenile.");
    title = `${s.name} · ${qty.toLocaleString("tr-TR")} adet`;
    payload.serviceCode = s.code;
    payload.target = target;
    payload.quantity = qty;
    details.unshift(["Hizmet", `${s.name} (${s.code})`], ["Bağlantı", target], ["Miktar", qty.toLocaleString("tr-TR")]);
  }

  payload.files = files;
  payload.details = details;
  payload.onay = await consentRecord(["kullanim-kosullari", "on-bilgilendirme", "mesafeli-satis"], { hemenIfa: true });
  amount = Math.round(amount * 100) / 100;

  // Müşterinin onayladığı tutar güncel fiyatla aynı değilse sipariş oluşmaz (fiyat bu arada değişmiş olabilir)
  if (beklenen !== null && beklenen !== amount) {
    return fail("Fiyat değişti. Güncel tutarı kontrol edip yeniden onayla.", 409, { fiyatDegisti: true, guncel: { toplam: amount } });
  }

  // Siparişi oluştur ve tutarı bakiyeden düş (tek işlemde, veritabanında)
  const placed = await rpc("place_order", {
    p_user: user.id,
    p_name: name,
    p_type: type,
    p_service: SERVICE_NAMES[type],
    p_title: title,
    p_amount: amount,
    p_payload: payload,
    // Tür ön ekiyle: aynı kimlik farklı bir hizmette yanlışlıkla kullanılsa bile o sipariş sayılmaz
    ...(istekId ? { p_istek: `${type}:${istekId}` } : {}),
  });
  if (!placed.ok) {
    if (placed.text.includes("YETERSIZ_BAKIYE")) {
      const bal = await rpc<number>("wallet_balance", { p_user: user.id });
      const balance = bal.ok ? Number(bal.body) || 0 : 0;
      return fail("Bakiyen yetersiz.", 402, { needTopup: true, balance, amount, missing: Math.max(0, Math.round((amount - balance) * 100) / 100) });
    }
    if (placed.text.includes("place_order")) return fail("Bakiye sistemi henüz kurulmamış (veritabanı fonksiyonu eksik).", 503);
    return fail("Sipariş kaydedilemedi. Lütfen tekrar dene.", 500);
  }
  const row = (Array.isArray(placed.body) ? placed.body[0] : placed.body) as { code?: string; balance?: number; tekrar?: boolean } | null;
  if (!row?.code) return fail("Sipariş kaydedilemedi. Lütfen tekrar dene.", 500);
  const code = row.code;
  const repeat = row.tekrar === true; // bu istek daha önce işlenmiş: yeni sipariş yok, bakiye düşmedi

  const or = await db<{ id: number; status: string }[]>(`orders?code=eq.${encodeURIComponent(code)}&select=id,status&limit=1`);
  const order = Array.isArray(or.body) ? or.body[0] : undefined;
  let status = order?.status || "Alındı";
  let warning = "";

  // Tekrar istekte yayın kaydı ikinci kez oluşturulmaz (ilk denemede yazılamadıysa şimdi yazılır)
  let releaseExists = false;
  if (repeat && type === "yayin" && order) {
    const ex = await db<{ id: string }[]>(`releases?order_id=eq.${order.id}&select=id&limit=1`);
    releaseExists = ex.ok && Array.isArray(ex.body) && ex.body.length > 0;
  }

  // Dijital yayın: yayın ve şarkı kayıtları (ISRC / UPC'yi yönetim atar)
  if (type === "yayin" && release && order && !releaseExists) {
    const ins = await db<{ id: string }[]>("releases", {
      method: "POST",
      prefer: "return=representation",
      body: JSON.stringify({ ...release, order_id: order.id }),
    });
    const rel = Array.isArray(ins.body) ? ins.body[0] : undefined;
    if (ins.ok && rel) {
      const tr = await db("release_tracks", {
        method: "POST",
        prefer: "return=minimal",
        body: JSON.stringify(releaseTracks.map((t) => ({ ...t, release_id: rel.id }))),
      });
      if (!tr.ok) await audit(user.id, "yayin.sarki_kayit_hatasi", code, { error: tr.text.slice(0, 300) });
    } else {
      await audit(user.id, "yayin.kayit_hatasi", code, { error: ins.text.slice(0, 300) });
    }
  }

  // SMM: sağlayıcı tanımlı ve aktifse otomatik gönder; değilse yönetim elle işler.
  // dispatchSmmOrder tekrar çağrılsa da siparişi sağlayıcıya ikinci kez göndermez (provider_order_id kontrolü).
  if (type === "smm" && order) {
    const d = await dispatchSmmOrder(order.id, null);
    if (d.ok) status = "İşlemde";
    else warning = "Siparişin alındı; ekibimiz en kısa sürede işleme alacak.";
  }

  await audit(user.id, repeat ? "siparis.tekrar_istek" : "siparis.olusturuldu", code, { type, amount, ...(istekId ? { istekId } : {}) });
  return Response.json({ ok: true, code, amount, balance: Number(row.balance) || 0, status, repeat, ...(warning ? { warning } : {}) });
}

/**
 * Influencer ve paket siparişlerinde veritabanı fonksiyonunun sonucunu yanıta çevirir.
 * Hata olursa sipariş oluşmamıştır ve bakiyeden hiçbir şey düşmemiştir (tek işlem).
 */
async function sonuclandir(
  placed: Awaited<ReturnType<typeof rpc>>,
  userId: string,
  type: string,
  istekId: string
): Promise<Response> {
  if (!placed.ok) {
    if (placed.text.includes("YETERSIZ_BAKIYE")) {
      const bal = await rpc<number>("wallet_balance", { p_user: userId });
      const balance = bal.ok ? Number(bal.body) || 0 : 0;
      let amount = 0;
      try {
        const d = JSON.parse(JSON.parse(placed.text).details || "") as unknown;
        if (typeof d === "string") amount = Number(/tutar=([\d.]+)/.exec(d)?.[1]) || 0;
      } catch {
        amount = Number(/tutar=([\d.]+)/.exec(placed.text)?.[1]) || 0;
      }
      return fail("Bakiyen yetersiz.", 402, { needTopup: true, balance, amount, missing: Math.max(0, Math.round((amount - balance) * 100) / 100) });
    }
    const h = rpcHatasi(placed.text);
    if (h) return fail(h.error, h.status, h.extra || {});
    if (placed.status === 404 || placed.text.includes("h7_influencer_siparis") || placed.text.includes("h7_paket_siparis")) {
      return fail("Sipariş sistemi henüz kurulmamış (veritabanı fonksiyonu eksik).", 503);
    }
    await audit(userId, "siparis.hata", type, { error: placed.text.slice(0, 300) });
    return fail("Sipariş kaydedilemedi. Lütfen tekrar dene.", 500);
  }
  const row = (Array.isArray(placed.body) ? placed.body[0] : placed.body) as {
    code?: string;
    balance?: number;
    tekrar?: boolean;
    amount?: number;
    brut?: number;
    oran?: number;
    indirim?: number;
    normal?: number;
  } | null;
  if (!row?.code) return fail("Sipariş kaydedilemedi. Lütfen tekrar dene.", 500);
  const repeat = row.tekrar === true;
  await audit(userId, repeat ? "siparis.tekrar_istek" : "siparis.olusturuldu", row.code, {
    type,
    amount: row.amount,
    ...(row.oran ? { indirimOrani: row.oran } : {}),
    ...(istekId ? { istekId } : {}),
  });
  return Response.json({
    ok: true,
    code: row.code,
    amount: Number(row.amount) || 0,
    balance: Number(row.balance) || 0,
    status: "Alındı",
    repeat,
    ...(row.brut !== undefined ? { brut: Number(row.brut), oran: Number(row.oran) || 0, indirim: Number(row.indirim) || 0 } : {}),
    ...(row.normal !== undefined ? { normal: Number(row.normal) } : {}),
  });
}

/** Remake / Mix siparişine eklenen ek hizmet (upsell). Fiyat CEO panelindeki güncel kayıttan okunur. */
async function ekHizmet(service: "remake" | "mix", addonId: unknown): Promise<{ addon: { id: string; name: string; price: number } | null } | { error: string }> {
  const id = clean(addonId, 40);
  if (!id) return { addon: null };
  const up = mergeUpsell(await siteValue("upsell"));
  const offer = up.offers[service];
  if (!offer?.enabled || !offer.addonIds.includes(id)) return { error: "Seçilen ek hizmet artık sunulmuyor. Sayfayı yenile." };
  const a = up.addons.find((x) => x.id === id && x.active);
  if (!a) return { error: "Seçilen ek hizmet artık sunulmuyor. Sayfayı yenile." };
  return { addon: { id: a.id, name: a.name, price: Math.round(Number(a.price) * 100) / 100 } };
}
