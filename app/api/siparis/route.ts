/**
 * app/api/siparis/route.ts
 * Sitedeki tüm sipariş formlarının veritabanına kaydı. Fiyat DAİMA sunucuda hesaplanır ve tutar
 * place_order veritabanı fonksiyonuyla TEK işlemde bakiyeden düşülür (yetersizse sipariş oluşmaz).
 * Türler: influencer, yayin, mix, remake, smm
 */
import { audit, clean, db, fail, getUser, rpc, serverReady, SUPA_URL } from "../../../lib/server/supa";
import { dispatchSmmOrder } from "../../../lib/server/smm";
import { consentRecord } from "../../../lib/server/yasal";
import { DEFAULT_CONTENT, mergePricing, type ProducerItem } from "../../../lib/site-content";
import { CAMPAIGN_TYPES, INFLUENCER_MAX, TIKTOK, TIKTOK_MIN, accountKey, minInfluencers } from "../../../lib/influencer-kural";

const SERVICE_NAMES: Record<string, string> = {
  influencer: "Influencer Marketing",
  yayin: "Dijital Yayın",
  mix: "Mix & Mastering",
  remake: "Remake Beat",
  smm: "SMM Panel",
};

const REMAKE_NAMES: Record<string, string> = {
  free: "FREE BEAT",
  birebir: "BİREBİR REMAKE",
  modern: "MODERN REMAKE",
  ozgun: "ÖZGÜN REMAKE",
};

const FORMAT_NAMES: Record<string, string> = { single: "Tekli (Single)", ep: "EP", album: "Albüm" };

type FileRef = { name: string; url: string; kind: string };

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

  let b: Record<string, unknown> = {};
  try {
    b = await req.json();
  } catch {
    return fail("Geçersiz istek.");
  }
  const type = String(b.type || "");
  if (!SERVICE_NAMES[type]) return fail("Bilinmeyen sipariş türü.");

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

  // Yüklenen dosyalar: yalnızca bu kullanıcının kendi klasöründeki adresler kabul edilir
  const okPrefix = `${SUPA_URL}/storage/v1/object/public/site-media/siparis/${user.id}/`;
  const files: FileRef[] = (Array.isArray(b.files) ? b.files : [])
    .slice(0, 60)
    .map((f) => {
      const o = (f || {}) as { name?: string; url?: string; kind?: string };
      return { name: clean(o.name, 160), url: clean(o.url, 700), kind: clean(o.kind, 30) };
    })
    .filter((f) => f.url.startsWith(okPrefix) && !f.url.includes(".."));

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
    // TikTok kampanyası: en az 30 farklı hesap (arayüzle aynı kural)
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
    // Fiyat, sayfada gösterildiği gibi seçilen influencerların toplamıdır
    amount = rows.reduce((s, r) => s + Number(r.price || 0), 0);
    title = `Influencer kampanyası · ${rows.length} influencer`;
    payload.influencers = ids;
    payload.campaignTypes = kinds;
    const brief = clean(b.brief, 1500);
    details.unshift(
      ["Paylaşım türü", kinds.join(" + ")],
      ["İçerik linki", link],
      ["Influencer sayısı", `${accounts.size} farklı hesap`],
      ["Influencerlar", rows.map((r) => r.name).join(", ")]
    );
    if (brief) details.push(["Kampanya notu", brief]);
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

    releaseTracks = rawTracks.map((t, i) => {
      const audio = files.find((f) => f.kind === `track-${i + 1}`);
      return {
        position: i + 1,
        title: clean(t.title, 160),
        audio_url: audio?.url || "",
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
      cover_url: cover.url,
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
