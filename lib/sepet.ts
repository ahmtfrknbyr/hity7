/**
 * lib/sepet.ts
 * Tarayıcıdaki sepet. localStorage'da tutulur: sayfa değişince veya yenilenince kaybolmaz, açık sekmeler arasında eşitlenir.
 *
 * Kurallar
 *  - Her hizmetten (Remake Beat, Mix & Mastering) sepette en fazla BİR ana hizmet satırı olur. Aynı hizmet yeniden
 *    eklenmek istenirse "exists" döner; sayfa "sepettekini güncelle" seçeneği sunar (yanlışlıkla çift ekleme olmaz).
 *  - Her ana hizmetin yanında en fazla bir ek hizmet olur (öneri kartında müşteri birini seçer). Aynı ek hizmet tekrar
 *    eklenmez; farklı biri seçilirse eskisinin yerine geçer.
 *  - Ek hizmetin adedi ana hizmetin adedini geçemez. Ana hizmet çıkarılırsa ek hizmeti de çıkar.
 *  - Fiyat burada SAKLANMAZ: sepette ve sunucuda güncel içerikten (lib/sepet-hesap.ts) hesaplanır.
 *  - Ödeme yalnızca sunucuda (/api/sepet) ve bakiyeden yapılır; burada hiçbir ödeme veya bakiye işlemi yoktur.
 */
import { useSyncExternalStore } from "react";
import { CART_SERVICES, type AddonItem, type CartService, type SiteContent } from "./site-content";
import { MAX_QTY, addonFor, clampQty, mainUnit, round2 } from "./sepet-hesap";
import { getSupabase } from "./supabase";
import type { UploadedFile } from "./siparis";

export type CartMainOrder = {
  optionId?: string;
  songName?: string;
  artistName?: string;
  service?: "mix" | "stems";
  producerId?: string;
  details: [string, string][];
  files: UploadedFile[];
};

export type CartMain = {
  key: string; // "main:<hizmet>"
  kind: "main";
  service: CartService;
  qty: number;
  order: CartMainOrder;
  info: string; // sepette görünen kısa özet
  addedAt: number;
};

export type CartAddon = {
  key: string; // "addon:<bağlı olduğu hizmet>"
  kind: "addon";
  service: CartService;
  addonId: string;
  qty: number;
  addedAt: number;
};

export type CartLine = CartMain | CartAddon;

export type CartState = {
  v: 1;
  /** Dosya yükleyen üyenin kimliği. Başka bir üye giriş yaparsa sepet temizlenir (dosyalar ona ait değildir). */
  owner: string | null;
  lines: CartLine[];
  /** Aynı sepetin iki kez ödenmesini önler (çift tıklama, bağlantı kopması). Sepet değişince sıfırlanır. */
  checkoutId: string | null;
};

const KEY = "hity7.sepet.v1";
const EMPTY: CartState = { v: 1, owner: null, lines: [], checkoutId: null };

export const mainKey = (s: CartService) => `main:${s}`;
export const addonKey = (s: CartService) => `addon:${s}`;

/* ------------------------------------------------------------------ */
/*  Depolama (localStorage verisi kullanıcı tarafından değiştirilebilir; */
/*  her okumada doğrulanır)                                            */
/* ------------------------------------------------------------------ */

const str = (v: unknown, max: number) => (typeof v === "string" ? v.slice(0, max) : "");

function cleanFiles(v: unknown): UploadedFile[] {
  if (!Array.isArray(v)) return [];
  return v.slice(0, 60).flatMap((f) => {
    const o = (f && typeof f === "object" ? f : {}) as Record<string, unknown>;
    const url = str(o.url, 700);
    if (!/^https?:\/\//.test(url)) return [];
    const kind = str(o.kind, 30);
    return [{ name: str(o.name, 160) || "dosya", url, ...(kind ? { kind } : {}) }];
  });
}

function cleanDetails(v: unknown): [string, string][] {
  if (!Array.isArray(v)) return [];
  return v
    .slice(0, 30)
    .flatMap((r) => (Array.isArray(r) && r.length >= 2 ? [[str(r[0], 60), str(r[1], 1500)] as [string, string]] : []))
    .filter(([k, val]) => k && val);
}

/** Ek hizmet adedini ana hizmetin adedine göre sınırlar. */
function normalize(lines: CartLine[]): CartLine[] {
  return lines.map((l) => {
    if (l.kind !== "addon") return l;
    const main = lines.find((m) => m.key === mainKey(l.service));
    const q = clampQty(l.qty, main ? main.qty : MAX_QTY);
    return q === l.qty ? l : { ...l, qty: q };
  });
}

function sanitize(raw: unknown): CartState {
  const s = (raw && typeof raw === "object" ? raw : {}) as Record<string, unknown>;
  if (s.v !== 1) return EMPTY;
  const lines: CartLine[] = [];
  for (const item of Array.isArray(s.lines) ? s.lines.slice(0, 20) : []) {
    const o = (item && typeof item === "object" ? item : {}) as Record<string, unknown>;
    const service = o.service as CartService;
    if (!CART_SERVICES.includes(service)) continue;
    if (o.kind === "main") {
      if (lines.some((x) => x.key === mainKey(service))) continue;
      const ord = (o.order && typeof o.order === "object" ? o.order : {}) as Record<string, unknown>;
      lines.push({
        key: mainKey(service),
        kind: "main",
        service,
        qty: clampQty(o.qty),
        info: str(o.info, 300),
        addedAt: Number(o.addedAt) || 0,
        order: {
          optionId: str(ord.optionId, 20) || undefined,
          songName: str(ord.songName, 160) || undefined,
          artistName: str(ord.artistName, 120) || undefined,
          service: ord.service === "stems" ? "stems" : ord.service === "mix" ? "mix" : undefined,
          producerId: str(ord.producerId, 40) || undefined,
          details: cleanDetails(ord.details),
          files: cleanFiles(ord.files),
        },
      });
    } else if (o.kind === "addon") {
      const addonId = str(o.addonId, 40);
      if (!addonId || lines.some((x) => x.key === addonKey(service))) continue;
      lines.push({ key: addonKey(service), kind: "addon", service, addonId, qty: clampQty(o.qty), addedAt: Number(o.addedAt) || 0 });
    }
  }
  const owner = typeof s.owner === "string" && s.owner ? s.owner.slice(0, 64) : null;
  const checkoutId = typeof s.checkoutId === "string" && /^[A-Za-z0-9-]{8,64}$/.test(s.checkoutId) ? s.checkoutId : null;
  return { v: 1, owner, lines: normalize(lines), checkoutId };
}

let cache: CartState | null = null;
const listeners = new Set<() => void>();
let storageHooked = false;

function read(): CartState {
  if (cache) return cache;
  if (typeof window === "undefined") return EMPTY;
  try {
    const raw = window.localStorage.getItem(KEY);
    cache = raw ? sanitize(JSON.parse(raw)) : EMPTY;
  } catch {
    cache = EMPTY;
  }
  return cache;
}

function emit() {
  listeners.forEach((l) => l());
}

function write(next: CartState) {
  cache = next;
  try {
    if (next.lines.length || next.checkoutId) window.localStorage.setItem(KEY, JSON.stringify(next));
    else window.localStorage.removeItem(KEY);
  } catch {
    /* gizli sekme / dolu depolama: sepet bu sayfada yine çalışır */
  }
  emit();
}

function subscribe(listener: () => void) {
  listeners.add(listener);
  if (!storageHooked && typeof window !== "undefined") {
    storageHooked = true;
    // Başka sekmede yapılan değişiklikler
    window.addEventListener("storage", (e) => {
      if (e.key === KEY || e.key === null) {
        cache = null;
        emit();
      }
    });
  }
  return () => {
    listeners.delete(listener);
  };
}

/** Sepeti okur ve değişince bileşeni yeniler. Sunucuda (ve ilk çizimde) boş sepet döner. */
export function useCart(): CartState {
  return useSyncExternalStore(subscribe, read, () => EMPTY);
}

export const getCart = () => read();

/* ------------------------------------------------------------------ */
/*  İşlemler                                                           */
/* ------------------------------------------------------------------ */

export type AddResult = "added" | "exists" | "replaced";

/**
 * Ana hizmeti ekler. Aynı hizmet sepette varsa replace olmadan EKLEMEZ ("exists").
 * replace: sepettekini yeni form bilgileriyle değiştirir (adet ve ek hizmet korunur).
 */
export function addMain(
  service: CartService,
  order: CartMainOrder,
  info: string,
  opts: { replace?: boolean; owner?: string | null } = {}
): { result: AddResult; previous?: CartMain } {
  const cur = read();
  const key = mainKey(service);
  const previous = cur.lines.find((l): l is CartMain => l.key === key);
  if (previous && !opts.replace) return { result: "exists", previous };
  const line: CartMain = { key, kind: "main", service, qty: previous?.qty || 1, order, info: info.slice(0, 300), addedAt: Date.now() };
  const lines = previous ? cur.lines.map((l) => (l.key === key ? line : l)) : [...cur.lines, line];
  write({ ...cur, owner: cur.owner || opts.owner || null, lines: normalize(lines), checkoutId: null });
  return { result: previous ? "replaced" : "added", previous };
}

/** Ek hizmeti ana hizmete bağlar. Aynısı varsa eklemez; farklı biri varsa onun yerine geçer. */
export function addAddon(service: CartService, addonId: string): AddResult {
  const cur = read();
  const key = addonKey(service);
  const previous = cur.lines.find((l): l is CartAddon => l.key === key);
  if (previous && previous.addonId === addonId) return "exists";
  const line: CartAddon = { key, kind: "addon", service, addonId, qty: previous?.qty || 1, addedAt: Date.now() };
  const lines = previous ? cur.lines.map((l) => (l.key === key ? line : l)) : [...cur.lines, line];
  write({ ...cur, lines: normalize(lines), checkoutId: null });
  return previous ? "replaced" : "added";
}

/** Adet günceller (1–10; ek hizmet en fazla ana hizmetin adedi kadar). Ana hizmet azalınca ek hizmet de sınırlanır. */
export function setQty(key: string, qty: number) {
  const cur = read();
  const line = cur.lines.find((l) => l.key === key);
  if (!line) return;
  const main = line.kind === "addon" ? cur.lines.find((l) => l.key === mainKey(line.service)) : undefined;
  const q = clampQty(qty, main ? main.qty : MAX_QTY);
  if (q === line.qty) return;
  write({ ...cur, lines: normalize(cur.lines.map((l) => (l.key === key ? { ...l, qty: q } : l))), checkoutId: null });
}

/** Satırı çıkarır (ana hizmetle birlikte ek hizmeti de). Çıkarılan satırları döndürür. */
export function removeLine(key: string): CartLine[] {
  const cur = read();
  const line = cur.lines.find((l) => l.key === key);
  if (!line) return [];
  const drop = line.kind === "main" ? [key, addonKey(line.service)] : [key];
  const removed = cur.lines.filter((l) => drop.includes(l.key));
  const lines = cur.lines.filter((l) => !drop.includes(l.key));
  write({ ...cur, owner: lines.length ? cur.owner : null, lines, checkoutId: null });
  return removed;
}

export function clearCart() {
  write({ ...EMPTY });
}

/**
 * Oturum değişince çağrılır. Sepette başka bir üyenin yüklediği dosyalar varsa sepet temizlenir;
 * ziyaretçi sepeti giriş yapan üyeye geçer.
 */
export function syncOwner(uid: string) {
  const cur = read();
  if (cur.owner && cur.owner !== uid) clearCart();
  else if (!cur.owner && cur.lines.length) write({ ...cur, owner: uid });
}

function randomId() {
  try {
    if (typeof crypto !== "undefined" && typeof crypto.randomUUID === "function") return crypto.randomUUID();
  } catch {
    /* güvenli olmayan bağlam */
  }
  return `${Date.now().toString(36)}-${Math.random().toString(36).slice(2, 12)}`;
}

/** Bu sepet içeriği için ödeme kimliği (aynı içerik tekrar gönderilirse sunucu ikinci siparişi oluşturmaz). */
export function ensureCheckoutId(): string {
  const cur = read();
  if (cur.checkoutId) return cur.checkoutId;
  const id = randomId();
  write({ ...cur, checkoutId: id });
  return id;
}

export const cartCount = (s: CartState) => s.lines.reduce((a, l) => a + l.qty, 0);

/** Sepet panelini açar (components/SepetButonu dinler). */
export const openCart = () => {
  try {
    window.dispatchEvent(new Event("hity7:sepet-ac"));
  } catch {
    /* sunucu */
  }
};

/* ------------------------------------------------------------------ */
/*  Fiyatlı görünüm (gösterim için; asıl hesap sunucuda yapılır)       */
/* ------------------------------------------------------------------ */

export type PricedGroup = {
  service: CartService;
  main: CartMain | null;
  addon: CartAddon | null;
  mainName: string;
  mainUnit: number;
  addonItem: AddonItem | null;
  mainError: string;
  addonError: string;
  total: number;
};

export type PricedCart = {
  groups: PricedGroup[];
  mainsTotal: number;
  addonsTotal: number;
  total: number;
  /** Ödemeyi engelleyen ilk sorun (yoksa boş). */
  blocking: string;
};

export function priceCart(state: CartState, content: SiteContent): PricedCart {
  const groups: PricedGroup[] = [];
  let mainsTotal = 0;
  let addonsTotal = 0;
  let blocking = "";
  for (const service of CART_SERVICES) {
    const main = (state.lines.find((l) => l.key === mainKey(service)) as CartMain | undefined) || null;
    const addon = (state.lines.find((l) => l.key === addonKey(service)) as CartAddon | undefined) || null;
    if (!main && !addon) continue;
    const u = main ? mainUnit(content, service, main.order) : null;
    const addonItem = addon ? addonFor(content, service, addon.addonId) : null;
    const mainError = main && u && !u.ok ? u.error : "";
    const addonError = addon && !addonItem ? "Bu ek hizmet artık sunulmuyor. Sepetten çıkarabilirsin." : addon && !main ? "Bu ek hizmet bir ana hizmetle birlikte alınır." : "";
    const mUnit = u && u.ok ? u.unit : 0;
    const mTotal = main ? round2(mUnit * main.qty) : 0;
    const aTotal = addon && addonItem && main ? round2(addonItem.price * addon.qty) : 0;
    mainsTotal += mTotal;
    addonsTotal += aTotal;
    if (!blocking) blocking = mainError || addonError;
    groups.push({
      service,
      main,
      addon,
      mainName: u && u.ok ? u.name : "",
      mainUnit: mUnit,
      addonItem,
      mainError,
      addonError,
      total: round2(mTotal + aTotal),
    });
  }
  if (!blocking && !groups.some((g) => g.main)) blocking = "Sepette ana hizmet yok.";
  return { groups, mainsTotal: round2(mainsTotal), addonsTotal: round2(addonsTotal), total: round2(mainsTotal + addonsTotal), blocking };
}

/* ------------------------------------------------------------------ */
/*  Sunucu çağrıları                                                    */
/* ------------------------------------------------------------------ */

async function accessToken(): Promise<string | undefined> {
  try {
    return (await getSupabase().auth.getSession()).data.session?.access_token;
  } catch {
    return undefined;
  }
}

/** Giriş yapmış üyenin kimliği (yoksa null). Sepete dosyalı hizmet eklenirken sahip olarak kaydedilir. */
export async function currentUserId(): Promise<string | null> {
  try {
    return (await getSupabase().auth.getSession()).data.session?.user.id || null;
  } catch {
    return null;
  }
}

/** Satırlardaki yüklenmiş dosyalar. */
export const filesOf = (lines: CartLine[]): UploadedFile[] => lines.flatMap((l) => (l.kind === "main" ? l.order.files : []));

/** Sepetten çıkarılan / değiştirilen dosyaları depodan siler (bir siparişte geçen dosyalara sunucu dokunmaz). */
export async function releaseFiles(files: UploadedFile[]) {
  const urls = files.map((f) => f.url);
  if (!urls.length) return;
  const t = await accessToken();
  if (!t) return;
  try {
    await fetch("/api/sepet", {
      method: "POST",
      headers: { "content-type": "application/json", Authorization: `Bearer ${t}` },
      body: JSON.stringify({ action: "dosya-birak", files: urls }),
      keepalive: true,
    });
  } catch {
    /* temizlik başarısız olsa da sepet çalışır */
  }
}

export type PlacedOrder = { code: string; title: string; amount: number };

export type CheckoutResult =
  | { ok: true; orders: PlacedOrder[]; total: number; balance: number; repeat: boolean }
  | {
      ok: false;
      status: number;
      error: string;
      needLogin?: boolean;
      needAccept?: boolean;
      needTopup?: boolean;
      priceChanged?: boolean;
      balance?: number;
      total?: number;
      missing?: number;
    };

/** Sepeti öder: sunucu fiyatları yeniden hesaplar, bakiyeyi kontrol eder ve siparişleri tek işlemde oluşturur. */
export async function checkout(accept: boolean, expectedTotal: number): Promise<CheckoutResult> {
  const state = read();
  const items = CART_SERVICES.flatMap((service) => {
    const main = state.lines.find((l): l is CartMain => l.key === mainKey(service));
    if (!main) return [];
    const addon = state.lines.find((l): l is CartAddon => l.key === addonKey(service));
    return [{ service, qty: main.qty, order: main.order, addons: addon ? [{ id: addon.addonId, qty: addon.qty }] : [] }];
  });
  const t = await accessToken();
  if (!t) return { ok: false, status: 401, error: "Siparişi tamamlamak için giriş yapmalısın.", needLogin: true };
  const checkoutId = ensureCheckoutId();
  try {
    const res = await fetch("/api/sepet", {
      method: "POST",
      headers: { "content-type": "application/json", Authorization: `Bearer ${t}` },
      body: JSON.stringify({ action: "checkout", accept, checkoutId, expectedTotal, items }),
    });
    const j = (await res.json().catch(() => ({}))) as Record<string, unknown>;
    if (!res.ok) {
      return {
        ok: false,
        status: res.status,
        error: String(j.error || "Sipariş oluşturulamadı. Lütfen tekrar dene."),
        needLogin: res.status === 401,
        needAccept: !!j.needAccept,
        needTopup: res.status === 402,
        priceChanged: !!j.priceChanged,
        balance: Number(j.balance) || 0,
        total: Number(j.total) || 0,
        missing: Number(j.missing) || 0,
      };
    }
    try {
      window.dispatchEvent(new Event("hity7:bakiye"));
    } catch {}
    return {
      ok: true,
      orders: (Array.isArray(j.orders) ? j.orders : []) as PlacedOrder[],
      total: Number(j.total) || 0,
      balance: Number(j.balance) || 0,
      repeat: !!j.repeat,
    };
  } catch {
    return { ok: false, status: 0, error: "Bağlantı hatası. Lütfen tekrar dene; aynı sepet ikinci kez ücretlendirilmez." };
  }
}
