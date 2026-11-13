/**
 * app/api/sepet/route.ts
 * Sepet ödemesi (Remake Beat, Mix & Mastering + ek hizmetler) ve sepetten çıkarılan dosyaların temizliği.
 *
 * Güvenlik kuralları
 *  - Giriş zorunlu. Fiyatlar DAİMA burada, Supabase'teki güncel içerikten (fiyatlar, prodüktörler, ek hizmetler)
 *    lib/sepet-hesap.ts kurallarıyla hesaplanır. Tarayıcıdan gelen fiyat kullanılmaz; yalnızca müşterinin ekranda
 *    gördüğü toplam karşılaştırılır (farklıysa 409: müşteri görmediği bir tutarla ücretlendirilmez).
 *  - Her ana hizmet ayrı bir sipariştir; ek hizmetleri AYNI siparişin içindedir (payload.items).
 *  - Bakiye kontrolü, bakiye düşümü ve sipariş(ler)in oluşturulması veritabanında TEK işlemde yapılır:
 *    h7_sepet_siparis (migration 06). Fonksiyon kurulmamışsa tek siparişlik sepet mevcut place_order ile yine tek
 *    işlemde ödenir; birden fazla siparişlik sepet için kurulum istenir (yarım ödeme yapılmaz).
 *  - Aynı sepet kimliği ikinci kez ödenmez. Sahte ödeme / bakiye işlemi yoktur: bakiye yetersizse sipariş oluşmaz.
 */
import { audit, clean, db, fail, getUser, rpc, serverReady, serviceHeaders, SUPA_URL, type AuthUser } from "../../../lib/server/supa";
import { consentRecord } from "../../../lib/server/yasal";
import { CART_SERVICES, mergeContent, type CartService, type SiteContent } from "../../../lib/site-content";
import { MAX_QTY, MIX_KINDS, REMAKE_OPTIONS, SERVICE_NAMES, addonFor, mainUnit, round2, tl } from "../../../lib/sepet-hesap";

type FileRef = { name: string; url: string; kind: string };
type OrderItem = { kind: "main" | "addon"; service: CartService; id: string; name: string; qty: number; unitPrice: number; total: number };
type OrderOut = { type: CartService; service: string; title: string; amount: number; payload: Record<string, unknown> };
type Built = { ok: true; order: OrderOut } | { ok: false; status: number; error: string; extra?: Record<string, unknown> };

const BUCKET_PREFIX = () => `${SUPA_URL}/storage/v1/object/public/site-media/`;
const SEPET_ID = /^[A-Za-z0-9-]{8,64}$/;

function cleanFiles(v: unknown, okPrefix: string): FileRef[] {
  return (Array.isArray(v) ? v : [])
    .slice(0, 60)
    .map((f) => {
      const o = (f || {}) as { name?: unknown; url?: unknown; kind?: unknown };
      return { name: clean(o.name, 160), url: clean(o.url, 700), kind: clean(o.kind, 30) };
    })
    .filter((f) => f.url.startsWith(okPrefix) && !f.url.includes(".."));
}

function cleanDetails(v: unknown): [string, string][] {
  return (Array.isArray(v) ? v : [])
    .slice(0, 30)
    .filter((r): r is unknown[] => Array.isArray(r) && r.length >= 2)
    .map((r) => [clean(r[0], 60), clean(r[1], 1500)] as [string, string])
    .filter(([k, val]) => k && val);
}

/** Bir sepet satırını (ana hizmet + ek hizmet) doğrular ve fiyatını içerikten hesaplar. */
function buildOrder(raw: unknown, content: SiteContent, user: AuthUser): Built {
  const it = (raw && typeof raw === "object" ? raw : {}) as Record<string, unknown>;
  const service = String(it.service || "") as CartService;
  if (!CART_SERVICES.includes(service)) return { ok: false, status: 400, error: "Sepette tanınmayan bir hizmet var. Sepeti yenile." };
  const name = SERVICE_NAMES[service];
  const qty = Math.floor(Number(it.qty));
  if (!(qty >= 1 && qty <= MAX_QTY)) return { ok: false, status: 400, error: `${name}: adet 1 ile ${MAX_QTY} arasında olmalı.` };

  const o = (it.order && typeof it.order === "object" ? it.order : {}) as Record<string, unknown>;
  const ref = { optionId: clean(o.optionId, 20), service: o.service === "stems" ? "stems" : "mix", producerId: clean(o.producerId, 40) };
  const unit = mainUnit(content, service, ref);
  if (!unit.ok) return { ok: false, status: 409, error: `${name}: ${unit.error}`, extra: { priceChanged: true } };

  const files = cleanFiles(o.files, `${BUCKET_PREFIX()}siparis/${user.id}/`);
  const details = cleanDetails(o.details);
  const payload: Record<string, unknown> = {};
  let title = "";

  if (service === "remake") {
    const song = clean(o.songName, 160);
    if (!song) return { ok: false, status: 400, error: "Remake Beat: şarkı / referans adı gerekli." };
    const artist = clean(o.artistName, 120);
    const head: [string, string][] = [["Seçenek", REMAKE_OPTIONS[ref.optionId]], ["Şarkı / referans", song]];
    if (artist) head.push(["Sanatçı", artist]);
    details.unshift(...head);
    payload.optionId = ref.optionId;
    title = `${SERVICE_NAMES.remake} · ${REMAKE_OPTIONS[ref.optionId]}${qty > 1 ? ` ×${qty}` : ""} · ${song}`;
  } else {
    if (!files.some((f) => f.kind !== "reference")) {
      return { ok: false, status: 400, error: "Mix & Mastering: vokal ve beat dosyaları eksik. Mix sayfasından dosyaları yükleyip sepeti güncelle." };
    }
    const kind = ref.service as "mix" | "stems";
    const producer = content.producers.find((p) => p.id === ref.producerId);
    details.unshift(["Hizmet", MIX_KINDS[kind]], ["Prodüktör", producer?.name || ref.producerId]);
    payload.producerId = ref.producerId;
    payload.service = kind;
    title = `${unit.name}${qty > 1 ? ` ×${qty}` : ""}`;
  }
  if (qty > 1) details.splice(1, 0, ["Adet", String(qty)]);

  const mainTotal = round2(unit.unit * qty);
  const items: OrderItem[] = [
    { kind: "main", service, id: service === "remake" ? ref.optionId : `${ref.service}:${ref.producerId}`, name: unit.name, qty, unitPrice: unit.unit, total: mainTotal },
  ];
  let amount = mainTotal;

  const addons = Array.isArray(it.addons) ? it.addons : [];
  if (addons.length > 1) return { ok: false, status: 400, error: `${name}: bir hizmete en fazla bir ek hizmet eklenebilir.` };
  for (const a of addons) {
    const ao = (a && typeof a === "object" ? a : {}) as Record<string, unknown>;
    const id = clean(ao.id, 40);
    const aq = Math.floor(Number(ao.qty));
    const item = addonFor(content, service, id);
    if (!item) {
      return { ok: false, status: 409, error: `${name} yanındaki ek hizmet artık sunulmuyor. Sepeti kontrol edip tekrar dene.`, extra: { priceChanged: true } };
    }
    if (!(aq >= 1 && aq <= qty)) return { ok: false, status: 400, error: `${item.name}: ek hizmet adedi ana hizmetin adedini (${qty}) geçemez.` };
    const total = round2(item.price * aq);
    amount += total;
    items.push({ kind: "addon", service, id: item.id, name: item.name, qty: aq, unitPrice: item.price, total });
    details.push(["Ek hizmet", `${item.name}${aq > 1 ? ` ×${aq}` : ""} · ${tl(total)}`]);
    title += ` + ${item.name}${aq > 1 ? ` ×${aq}` : ""}`;
  }
  details.push(["İletişim", user.email]);

  return {
    ok: true,
    order: {
      type: service,
      service: name,
      title: title.slice(0, 300),
      amount: round2(amount),
      payload: { ...payload, sepet: true, items, files, details },
    },
  };
}

/** Bu sepet kimliğiyle daha önce oluşmuş siparişler (çift ödeme önlemi ve yanıt için). */
async function ordersOf(userId: string, sepetId: string) {
  const r = await db<{ code: string; title: string; amount: number }[]>(
    `orders?user_id=eq.${encodeURIComponent(userId)}&payload->>sepetId=eq.${encodeURIComponent(sepetId)}&select=code,title,amount&order=id.asc`
  );
  return r.ok && Array.isArray(r.body) ? r.body.filter((x) => x && x.code) : [];
}

async function balanceOf(userId: string): Promise<number> {
  const b = await rpc<number>("wallet_balance", { p_user: userId });
  return b.ok ? round2(Number(b.body) || 0) : 0;
}

const isMissingFn = (r: { status: number; text: string }) => r.status === 404 || /PGRST202|Could not find the function/i.test(r.text);

async function checkout(user: AuthUser, b: Record<string, unknown>): Promise<Response> {
  // Ön bilgilendirme + mesafeli satış + hizmet sözleşmesi onayı ve hemen ifa talebi
  if (b.accept !== true) return fail("Siparişi tamamlamak için sözleşme onay kutusunu işaretlemelisin.", 400, { needAccept: true });
  const sepetId = clean(b.checkoutId, 64);
  if (!SEPET_ID.test(sepetId)) return fail("Sepet kimliği geçersiz. Sayfayı yenileyip tekrar dene.");

  const raw = Array.isArray(b.items) ? b.items : [];
  if (!raw.length) return fail("Sepette ana hizmet yok.");
  if (raw.length > CART_SERVICES.length) return fail("Sepet geçersiz. Sayfayı yenileyip tekrar dene.");
  const services = raw.map((x) => String((x as { service?: unknown })?.service || ""));
  if (new Set(services).size !== services.length) return fail("Aynı hizmet sepette iki kez olamaz.");

  // Güncel fiyatlar: Supabase (gizli anahtarla, önbelleksiz)
  const rows = await db<{ key: string; value: unknown }[]>("site_content?select=key,value&key=in.(pricing,producers,upsell)");
  if (!rows.ok || !Array.isArray(rows.body)) return fail("Fiyatlar okunamadı. Lütfen biraz sonra tekrar dene.", 503);
  const content = mergeContent(rows.body);

  const orders: OrderOut[] = [];
  for (const it of raw) {
    const built = buildOrder(it, content, user);
    if (!built.ok) return fail(built.error, built.status, built.extra);
    orders.push(built.order);
  }
  const total = round2(orders.reduce((s, o) => s + o.amount, 0));
  const expected = Number(b.expectedTotal);
  if (!Number.isFinite(expected) || Math.round(expected * 100) !== Math.round(total * 100)) {
    return fail(`Fiyatlar güncellendi. Yeni toplam ${tl(total)}; kontrol edip tekrar onayla.`, 409, { priceChanged: true, total });
  }

  const onay = await consentRecord(["kullanim-kosullari", "on-bilgilendirme", "mesafeli-satis"], { hemenIfa: true, sepet: true });
  for (const o of orders) o.payload = { ...o.payload, sepetId, onay };
  const name = clean(user.name, 120) || user.email.split("@")[0] || "Müşteri";

  const insufficient = async () => {
    const balance = await balanceOf(user.id);
    return fail("Bakiyen yetersiz.", 402, { needTopup: true, balance, total, missing: Math.max(0, round2(total - balance)) });
  };
  const done = async (repeat: boolean, balance?: number) => {
    const placed = await ordersOf(user.id, sepetId);
    if (!placed.length) return fail("Sipariş kaydedilemedi. Lütfen tekrar dene.", 500);
    if (!repeat) await audit(user.id, "sepet.siparis", sepetId, { codes: placed.map((p) => p.code), total });
    return Response.json({
      ok: true,
      repeat,
      orders: placed.map((p) => ({ code: p.code, title: p.title, amount: Number(p.amount) || 0 })),
      total,
      balance: balance ?? (await balanceOf(user.id)),
    });
  };

  // 1) Tercih edilen yol: tüm siparişler + bakiye düşümü tek veritabanı işleminde (migration 06)
  const r = await rpc<{ codes?: unknown[]; balance?: number; tekrar?: boolean }>("h7_sepet_siparis", {
    p_user: user.id,
    p_ad: name,
    p_sepet: sepetId,
    p_siparisler: orders,
    p_toplam: total,
  });
  if (r.ok) return done(!!r.body?.tekrar, numOrUndef(r.body?.balance));
  if (r.text.includes("YETERSIZ_BAKIYE")) return insufficient();
  if (!isMissingFn(r)) {
    if (/SEPET_(GECERSIZ|TUTAR_UYUSMAZ)/.test(r.text)) return fail("Sepet doğrulanamadı. Sayfayı yenileyip tekrar dene.", 400);
    return fail("Sipariş kaydedilemedi. Lütfen tekrar dene; bakiyenden bir şey düşülmedi.", 500);
  }

  // 2) Fonksiyon henüz kurulmamış: tek siparişlik sepet mevcut place_order ile (sipariş + bakiye düşümü tek işlem)
  if (orders.length > 1) {
    return fail(
      "Sepetteki hizmetleri tek ödemede almak için veritabanı güncellemesi gerekiyor. Şimdilik hizmetleri ayrı ayrı sipariş edebilirsin.",
      503,
      { needMigration: true }
    );
  }
  if ((await ordersOf(user.id, sepetId)).length) return done(true);
  const o = orders[0];
  const placed = await rpc("place_order", {
    p_user: user.id,
    p_name: name,
    p_type: o.type,
    p_service: o.service,
    p_title: o.title,
    p_amount: o.amount,
    p_payload: o.payload,
  });
  if (!placed.ok) {
    if (placed.text.includes("YETERSIZ_BAKIYE")) return insufficient();
    if (isMissingFn(placed)) return fail("Bakiye sistemi henüz kurulmamış (veritabanı fonksiyonu eksik).", 503);
    return fail("Sipariş kaydedilemedi. Lütfen tekrar dene.", 500);
  }
  const row = (Array.isArray(placed.body) ? placed.body[0] : placed.body) as { balance?: unknown } | null;
  return done(false, numOrUndef(row?.balance));
}

/** Sayıya çevrilebiliyorsa sayı, değilse undefined (null / eksik bakiye "0" sanılmasın). */
function numOrUndef(v: unknown): number | undefined {
  if (v === null || v === undefined || v === "") return undefined;
  const n = Number(v);
  return Number.isFinite(n) ? round2(n) : undefined;
}

/**
 * Sepetten çıkarılan (sipariş olmamış) satırın dosyalarını depodan siler.
 * Yalnızca kullanıcının kendi klasöründeki ve hiçbir siparişinde geçmeyen dosyalar silinir.
 */
async function releaseFiles(user: AuthUser, raw: unknown): Promise<Response> {
  const prefix = BUCKET_PREFIX();
  const own = `${prefix}siparis/${user.id}/`;
  const urls = Array.from(new Set((Array.isArray(raw) ? raw : []).slice(0, 60).map((u) => clean(u, 700)))).filter(
    (u) => u.startsWith(own) && !u.includes("..") && !u.includes("?") && !u.includes("#")
  );
  const paths: string[] = [];
  for (const url of urls) {
    const used = await db<{ id: number }[]>(
      `orders?user_id=eq.${encodeURIComponent(user.id)}&payload->files=cs.${encodeURIComponent(JSON.stringify([{ url }]))}&select=id&limit=1`
    );
    // Sorgu başarısızsa veya dosya bir siparişte geçiyorsa dokunma
    if (!used.ok || !Array.isArray(used.body) || used.body.length) continue;
    paths.push(url.slice(prefix.length));
  }
  if (!paths.length) return Response.json({ ok: true, deleted: 0 });
  const res = await fetch(`${SUPA_URL}/storage/v1/object/site-media`, {
    method: "DELETE",
    headers: { ...serviceHeaders(), "content-type": "application/json" },
    body: JSON.stringify({ prefixes: paths }),
    cache: "no-store",
  });
  return Response.json({ ok: res.ok, deleted: res.ok ? paths.length : 0 });
}

export async function POST(req: Request) {
  if (!serverReady()) return fail("Sipariş sistemi henüz kurulmamış (sunucu anahtarı eksik).", 503);
  const user = await getUser(req);
  if (!user) return fail("Siparişi tamamlamak için giriş yapmalısın.", 401, { needLogin: true });

  let b: Record<string, unknown> = {};
  try {
    b = await req.json();
  } catch {
    return fail("Geçersiz istek.");
  }
  if (b.action === "checkout") return checkout(user, b);
  if (b.action === "dosya-birak") return releaseFiles(user, b.files);
  return fail("Bilinmeyen işlem.");
}
