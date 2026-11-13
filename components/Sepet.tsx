"use client";

/**
 * components/Sepet.tsx
 * Üst menüdeki sepet düğmesi (ürün sayısıyla) ve sağdan açılan sepet paneli.
 * Panel: ana hizmet ve ek hizmetler ayrı ayrı, adet güncelleme, çıkarma, otomatik toplam, bakiye kontrolü,
 * sözleşme onayı ve "Siparişi tamamla". Ödeme yalnızca sunucuda ve bakiyeden yapılır (/api/sepet);
 * burada hiçbir ödeme veya bakiye işlemi taklit edilmez. Stil kendi içindedir, sayfaların CSS'ine bağlı değildir.
 */
import { useCallback, useEffect, useMemo, useRef, useState, useSyncExternalStore } from "react";
import { createPortal } from "react-dom";
import { useRouter } from "next/navigation";
import { reloadSiteContent, useSiteContent } from "../lib/use-site-content";
import {
  addAddon,
  cartCount,
  checkout,
  clearCart,
  filesOf,
  priceCart,
  releaseFiles,
  removeLine,
  setQty,
  syncOwner,
  useCart,
  type PlacedOrder,
  type PricedGroup,
} from "../lib/sepet";
import { MAX_QTY, SERVICE_NAMES, offerFor, tl } from "../lib/sepet-hesap";
import type { CartService, SiteContent } from "../lib/site-content";
import { getSupabase } from "../lib/supabase";
import SozlesmeOnay from "./SozlesmeOnay";

const PAGE: Record<CartService, string> = { remake: "/remake-beat", mix: "/mix-mastering" };

const CSS = `
.h7s-btn{position:relative;display:inline-grid;place-items:center;flex:none;width:42px;height:42px;padding:0;border:2.5px solid #111;border-radius:999px;background:#fff;color:#111;cursor:pointer;transition:background .2s ease,transform .25s cubic-bezier(.2,.8,.2,1)}
.h7s-btn:hover{background:#f5c518}
.h7s-btn:active{transform:scale(.93)}
.h7s-btn:focus-visible{outline:3px solid #111;outline-offset:3px}
.h7s-btn.dark{border-color:#fff;background:transparent;color:#fff}
.h7s-btn.dark:hover{background:#fff;color:#111}
.h7s-btn svg{width:19px;height:19px;display:block}
.h7s-badge{position:absolute;top:-7px;right:-7px;min-width:21px;height:21px;padding:0 5px;border-radius:999px;background:#f5c518;border:2px solid #111;color:#111;font:800 11px/17px Inter,"Helvetica Neue",Arial,sans-serif;text-align:center;box-sizing:border-box}
@media (max-width:560px){.h7s-btn{width:38px;height:38px}.h7s-btn svg{width:17px;height:17px}}

.h7s-root{position:fixed;inset:0;z-index:1000;pointer-events:none;font-family:Inter,"Helvetica Neue",Arial,sans-serif;-webkit-font-smoothing:antialiased;color:#111;visibility:hidden;transition:visibility 0s linear .5s}
.h7s-root.open{pointer-events:auto;visibility:visible;transition:visibility 0s}
.h7s-root *,.h7s-root *::before,.h7s-root *::after{box-sizing:border-box}
.h7s-veil{position:absolute;inset:0;background:rgba(17,17,17,.3);-webkit-backdrop-filter:blur(6px);backdrop-filter:blur(6px);opacity:0;transition:opacity .4s ease}
.h7s-root.open .h7s-veil{opacity:1}
.h7s-panel{position:absolute;top:0;right:0;bottom:0;width:min(440px,100vw);display:flex;flex-direction:column;background:#fff;border-left:3px solid #111;box-shadow:-30px 0 70px rgba(0,0,0,.16);transform:translateX(104%);transition:transform .5s cubic-bezier(.32,.72,0,1)}
.h7s-root.open .h7s-panel{transform:none}
.h7s-head{display:flex;align-items:center;justify-content:space-between;gap:12px;padding:16px 20px;border-bottom:3px solid #111}
.h7s-head h2{margin:0;font:800 24px/1 "Bricolage Grotesque","Helvetica Neue",Arial,sans-serif;letter-spacing:-.035em}
.h7s-count{display:inline-block;margin-left:8px;padding:4px 9px;border-radius:999px;background:#111;color:#f5c518;font:800 11px/1.2 Inter,Arial,sans-serif;letter-spacing:.06em;vertical-align:4px}
.h7s-close{width:40px;height:40px;flex:none;border:2.5px solid #111;border-radius:999px;background:#fff;color:#111;font-size:15px;font-weight:800;cursor:pointer;transition:background .2s ease,transform .2s ease}
.h7s-close:hover{background:#f5c518}
.h7s-close:active{transform:scale(.92)}
.h7s-body{flex:1;overflow-y:auto;overscroll-behavior:contain;padding:16px 20px 8px;background:#fafaf9}
.h7s-group{margin-bottom:14px;border:2.5px solid #111;border-radius:22px;background:#fff;overflow:hidden;animation:h7sIn .5s cubic-bezier(.16,1,.3,1) both;transition:opacity .22s ease,transform .22s ease}
.h7s-group[data-leaving],.h7s-line[data-leaving]{opacity:0;transform:translateX(28px)}
.h7s-line{padding:14px 16px;transition:opacity .22s ease,transform .22s ease}
.h7s-sub{background:#f4f4f2;border-top:2px dashed rgba(17,17,17,.22)}
.h7s-tag{display:inline-block;margin-bottom:8px;padding:3px 8px;border-radius:999px;background:#111;color:#fff;font-size:10px;font-weight:800;letter-spacing:.14em}
.h7s-tag.soft{background:#fff;color:#111;box-shadow:inset 0 0 0 1.5px #111}
.h7s-row{display:flex;align-items:flex-start;justify-content:space-between;gap:12px}
.h7s-name{min-width:0}
.h7s-name b{display:block;font-size:14.5px;font-weight:800;line-height:1.3}
.h7s-name small{display:block;margin-top:3px;font-size:12.5px;line-height:1.45;color:#686868;overflow-wrap:anywhere}
.h7s-warn{display:block;margin-top:7px;padding:5px 9px;border-radius:9px;background:#fff6cf;color:#111;font-size:12px;font-style:normal;font-weight:700;line-height:1.4}
.h7s-price{font:800 17px/1.25 "Bricolage Grotesque","Helvetica Neue",Arial,sans-serif;letter-spacing:-.01em;white-space:nowrap}
.h7s-ctl{display:flex;align-items:center;gap:10px;margin-top:12px}
.h7s-unit{flex:1;font-size:11.5px;color:#686868}
.h7s-step{display:inline-flex;align-items:center;border:2px solid #111;border-radius:999px;background:#fff;overflow:hidden}
.h7s-step button{width:32px;height:30px;border:0;background:transparent;color:#111;font:700 17px/1 Inter,Arial,sans-serif;cursor:pointer;transition:background .15s ease}
.h7s-step button:hover:not(:disabled){background:#f5c518}
.h7s-step button:disabled{opacity:.28;cursor:not-allowed}
.h7s-step output{min-width:24px;text-align:center;font-size:13px;font-weight:800}
.h7s-x{margin-left:auto;padding:6px 2px;border:0;background:none;color:#686868;font:700 12px/1 Inter,Arial,sans-serif;text-decoration:underline;text-underline-offset:3px;cursor:pointer}
.h7s-x:hover{color:#111}
.h7s-pending{background:#fffdf2}
.h7s-pending p{margin:0;font-size:13px;line-height:1.5}
.h7s-pending a{display:inline-block;margin-top:8px;color:#111;font-weight:800;font-size:13px}
.h7s-suggest{padding:12px 16px 14px;background:#f4f4f2;border-top:2px dashed rgba(17,17,17,.22)}
.h7s-suggest>span{display:block;margin-bottom:8px;color:#686868;font-size:10px;font-weight:800;letter-spacing:.14em}
.h7s-chips{display:flex;flex-wrap:wrap;gap:8px}
.h7s-chip{padding:7px 12px;border:2px solid #111;border-radius:999px;background:#fff;color:#111;font:700 12px/1.2 Inter,Arial,sans-serif;cursor:pointer;transition:background .15s ease,transform .15s ease}
.h7s-chip:hover{background:#f5c518}
.h7s-chip:active{transform:scale(.96)}
.h7s-chip b{margin-left:4px;font-weight:800}
.h7s-foot{padding:14px 20px 18px;border-top:3px solid #111;background:#fff}
.h7s-sum{margin:0}
.h7s-sum div{display:flex;justify-content:space-between;gap:12px;padding:2px 0;font-size:13.5px}
.h7s-sum dt{color:#686868}
.h7s-sum dd{margin:0;font-weight:700}
.h7s-sum .tot{align-items:baseline;margin-top:6px;padding-top:8px;border-top:2px solid #ececec}
.h7s-sum .tot dt{color:#111;font-size:11.5px;font-weight:800;letter-spacing:.12em}
.h7s-sum .tot dd{font:800 28px/1 "Bricolage Grotesque","Helvetica Neue",Arial,sans-serif;letter-spacing:-.035em}
.h7s-wallet{display:flex;flex-wrap:wrap;justify-content:space-between;gap:4px 10px;margin-top:10px;padding:9px 12px;border-radius:14px;background:#f4f4f2;font-size:12.5px;line-height:1.45}
.h7s-wallet b{font-weight:800}
.h7s-wallet.low{background:#fff6cf}
.h7s-wallet a{color:#111;font-weight:800}
.h7s-msg{margin:12px 0 0;padding:10px 12px;border:2px solid #111;border-radius:14px;background:#fff6cf;font-size:13px;font-weight:600;line-height:1.5}
.h7s-msg.info{background:#f4f4f2}
.h7s-msg a{color:#111;font-weight:800;white-space:nowrap}
.h7s-cta{display:flex;align-items:center;justify-content:center;gap:8px;width:100%;margin-top:14px;padding:15px 18px;border:2.5px solid #111;border-radius:999px;background:#f5c518;color:#111;font:800 13px/1.2 Inter,Arial,sans-serif;letter-spacing:.08em;text-transform:uppercase;text-decoration:none;cursor:pointer;box-shadow:0 5px 0 #111;transition:transform .15s ease,box-shadow .15s ease,background .2s ease}
.h7s-cta:hover:not(:disabled){transform:translateY(-1px);box-shadow:0 6px 0 #111;background:#e5b600}
.h7s-cta:active:not(:disabled){transform:translateY(3px);box-shadow:0 1px 0 #111}
.h7s-cta:disabled{opacity:.5;cursor:not-allowed}
.h7s-cta.dark{background:#111;color:#fff;box-shadow:0 5px 0 #f5c518}
.h7s-note{margin:10px 0 0;color:#686868;font-size:11.5px;line-height:1.5;text-align:center}
.h7s-empty,.h7s-done{padding:44px 8px;text-align:center;animation:h7sIn .5s cubic-bezier(.16,1,.3,1) both}
.h7s-empty h3,.h7s-done h3{margin:16px 0 6px;font:800 24px/1.1 "Bricolage Grotesque","Helvetica Neue",Arial,sans-serif;letter-spacing:-.03em}
.h7s-empty p,.h7s-done p{margin:0 auto;max-width:320px;color:#686868;font-size:14px;line-height:1.55}
.h7s-ico{display:inline-grid;place-items:center;width:64px;height:64px;border:2.5px solid #111;border-radius:999px;background:#f5c518;box-shadow:0 5px 0 #111}
.h7s-ico svg{width:26px;height:26px}
.h7s-links{display:flex;flex-wrap:wrap;justify-content:center;gap:10px;margin-top:20px}
.h7s-links a{padding:10px 16px;border:2.5px solid #111;border-radius:999px;color:#111;font-size:12px;font-weight:800;letter-spacing:.06em;text-decoration:none;transition:background .2s ease}
.h7s-links a:hover{background:#f5c518}
.h7s-codes{margin:18px 0 0;padding:0;list-style:none;text-align:left}
.h7s-codes li{display:flex;align-items:center;gap:10px;padding:10px 12px;margin-bottom:8px;border:2px solid #111;border-radius:14px;background:#fff;font-size:12.5px}
.h7s-codes code{flex:none;padding:2px 7px;border-radius:6px;background:#111;color:#f5c518;font:700 11.5px/1.4 ui-monospace,Menlo,Consolas,monospace}
.h7s-codes span{flex:1;min-width:0;overflow:hidden;text-overflow:ellipsis;white-space:nowrap}
.h7s-codes b{white-space:nowrap}
.h7s-link{margin-top:12px;border:0;background:none;color:#111;font:700 13px/1 Inter,Arial,sans-serif;text-decoration:underline;text-underline-offset:3px;cursor:pointer}
@keyframes h7sIn{from{opacity:0;transform:translateY(10px)}to{opacity:1;transform:none}}
@media (max-width:480px){.h7s-panel{border-left:0}.h7s-head,.h7s-foot{padding-left:16px;padding-right:16px}.h7s-body{padding-left:14px;padding-right:14px}}
@media (prefers-reduced-motion:reduce){.h7s-btn,.h7s-veil,.h7s-panel,.h7s-group,.h7s-line,.h7s-empty,.h7s-done,.h7s-root{transition:none!important;animation:none!important}}
`;

function BagIcon() {
  return (
    <svg viewBox="0 0 24 24" fill="none" stroke="currentColor" strokeWidth="2.2" strokeLinecap="round" strokeLinejoin="round" aria-hidden="true">
      <path d="M5 8h14l-1.2 11.2a2 2 0 0 1-2 1.8H8.2a2 2 0 0 1-2-1.8L5 8Z" />
      <path d="M9 10V6.5a3 3 0 0 1 6 0V10" />
    </svg>
  );
}

const noopSubscribe = () => () => {};
/** Yalnızca tarayıcıda true (portal ve localStorage ilk çizimden sonra devreye girer). */
const useIsClient = () => useSyncExternalStore(noopSubscribe, () => true, () => false);

type Wallet = { kind: "load" } | { kind: "guest" } | { kind: "err"; status: number } | { kind: "ok"; balance: number; methods: number };

async function loadWallet(): Promise<Wallet> {
  let token: string | undefined;
  try {
    token = (await getSupabase().auth.getSession()).data.session?.access_token;
  } catch {
    return { kind: "guest" };
  }
  if (!token) return { kind: "guest" };
  try {
    const res = await fetch("/api/bakiye", {
      method: "POST",
      headers: { "content-type": "application/json", Authorization: `Bearer ${token}` },
      body: JSON.stringify({ action: "summary" }),
    });
    if (!res.ok) return { kind: "err", status: res.status };
    const j = await res.json();
    return { kind: "ok", balance: Number(j.balance) || 0, methods: Array.isArray(j.methods) ? j.methods.length : 0 };
  } catch {
    return { kind: "err", status: 0 };
  }
}

/* ------------------------------------------------------------------ */
/*  Üst menü düğmesi                                                    */
/* ------------------------------------------------------------------ */

export default function SepetButonu({ dark = false }: { dark?: boolean }) {
  const cart = useCart();
  const count = cartCount(cart);
  const isClient = useIsClient();
  const [open, setOpen] = useState(false);
  const btnRef = useRef<HTMLButtonElement>(null);
  const badgeRef = useRef<HTMLSpanElement>(null);
  const prevCount = useRef<number | null>(null);

  const close = useCallback(() => {
    setOpen(false);
    btnRef.current?.focus();
  }, []);

  // Sayfalardan "sepeti aç" isteği (ör. Sepete ekle sonrası)
  useEffect(() => {
    const onOpen = () => setOpen(true);
    window.addEventListener("hity7:sepet-ac", onOpen);
    return () => window.removeEventListener("hity7:sepet-ac", onOpen);
  }, []);

  // Çıkış yapılınca sepet temizlenir; başka bir üye giriş yaparsa önceki üyenin sepeti (dosyaları) silinir
  useEffect(() => {
    let sb: ReturnType<typeof getSupabase>;
    try {
      sb = getSupabase();
    } catch {
      return;
    }
    const { data } = sb.auth.onAuthStateChange((event, session) => {
      if (event === "SIGNED_OUT") clearCart();
      else if (session?.user?.id) syncOwner(session.user.id);
    });
    return () => data.subscription.unsubscribe();
  }, []);

  // Ürün eklenince rozet hafifçe büyüyüp küçülür (sayfa açılışında oynamaz)
  useEffect(() => {
    if (!isClient) return;
    if (prevCount.current !== null && count > prevCount.current) {
      try {
        badgeRef.current?.animate(
          [{ transform: "scale(1)" }, { transform: "scale(1.35)" }, { transform: "scale(1)" }],
          { duration: 450, easing: "cubic-bezier(.34,1.56,.64,1)" }
        );
      } catch {
        /* eski tarayıcı */
      }
    }
    prevCount.current = count;
  }, [count, isClient]);

  return (
    <>
      <style dangerouslySetInnerHTML={{ __html: CSS }} />
      <button
        ref={btnRef}
        type="button"
        className={`h7s-btn ${dark ? "dark" : ""}`}
        aria-label={count ? `Sepet: ${count} ürün` : "Sepet (boş)"}
        aria-haspopup="dialog"
        aria-expanded={open}
        onClick={() => setOpen(true)}
      >
        <BagIcon />
        {count > 0 && (
          <span ref={badgeRef} className="h7s-badge" aria-hidden="true">
            {count > 99 ? "99+" : count}
          </span>
        )}
      </button>
      {isClient && createPortal(<SepetPaneli open={open} onClose={close} />, document.body)}
    </>
  );
}

/* ------------------------------------------------------------------ */
/*  Sepet paneli                                                        */
/* ------------------------------------------------------------------ */

function Stepper({ value, max, onChange, label }: { value: number; max: number; onChange: (v: number) => void; label: string }) {
  return (
    <div className="h7s-step" role="group" aria-label={label}>
      <button type="button" aria-label="Adedi azalt" disabled={value <= 1} onClick={() => onChange(value - 1)}>
        −
      </button>
      <output aria-live="polite">{value}</output>
      <button type="button" aria-label="Adedi artır" disabled={value >= max} onClick={() => onChange(value + 1)}>
        +
      </button>
    </div>
  );
}

function Suggest({ service, content }: { service: CartService; content: SiteContent }) {
  const offer = offerFor(content, service);
  if (!offer) return null;
  return (
    <div className="h7s-suggest">
      <span>ÖNERİLEN EK HİZMET</span>
      <div className="h7s-chips">
        {offer.addons.map((a) => (
          <button key={a.id} type="button" className="h7s-chip" onClick={() => addAddon(service, a.id)}>
            ＋ {a.name}
            <b>+{tl(a.price)}</b>
          </button>
        ))}
      </div>
    </div>
  );
}

function Group({ g, content, leaving, onRemove }: { g: PricedGroup; content: SiteContent; leaving: string[]; onRemove: (key: string) => void }) {
  const name = SERVICE_NAMES[g.service];
  const mainLeaving = !!g.main && leaving.includes(g.main.key);
  return (
    <div className="h7s-group" data-leaving={mainLeaving || undefined}>
      {g.main ? (
        <div className="h7s-line">
          <span className="h7s-tag">ANA HİZMET</span>
          <div className="h7s-row">
            <div className="h7s-name">
              <b>{g.mainName || name}</b>
              {g.main.info && <small>{g.main.info}</small>}
              {g.mainError && <em className="h7s-warn">{g.mainError}</em>}
            </div>
            <div className="h7s-price">{tl(g.mainUnit * g.main.qty)}</div>
          </div>
          <div className="h7s-ctl">
            <Stepper value={g.main.qty} max={MAX_QTY} onChange={(q) => setQty(g.main!.key, q)} label={`${name} adedi`} />
            <span className="h7s-unit">{g.main.qty > 1 ? `${tl(g.mainUnit)} / adet` : ""}</span>
            <button type="button" className="h7s-x" onClick={() => onRemove(g.main!.key)}>
              Kaldır
            </button>
          </div>
        </div>
      ) : (
        <div className="h7s-line h7s-pending">
          <span className="h7s-tag soft">ANA HİZMET BEKLENİYOR</span>
          <p>
            Bu ek hizmet bir <b>{name}</b> siparişine eklenir. {name} sayfasında formu doldurup sepete eklediğinde ikisi aynı siparişte
            birleşir.
          </p>
          <a href={PAGE[g.service]}>{name} sayfasına git →</a>
        </div>
      )}

      {g.addon ? (
        <div className="h7s-line h7s-sub" data-leaving={leaving.includes(g.addon.key) || undefined}>
          <span className="h7s-tag soft">EK HİZMET</span>
          <div className="h7s-row">
            <div className="h7s-name">
              <b>＋ {g.addonItem?.name || "Ek hizmet"}</b>
              {g.addonError && <em className="h7s-warn">{g.addonError}</em>}
            </div>
            <div className="h7s-price">{g.addonItem && g.main ? `+${tl(g.addonItem.price * g.addon.qty)}` : g.addonItem ? `+${tl(g.addonItem.price)}` : "—"}</div>
          </div>
          <div className="h7s-ctl">
            <Stepper
              value={g.addon.qty}
              max={g.main ? g.main.qty : MAX_QTY}
              onChange={(q) => setQty(g.addon!.key, q)}
              label={`${g.addonItem?.name || "Ek hizmet"} adedi`}
            />
            <span className="h7s-unit">{g.main && g.addon.qty >= g.main.qty && g.main.qty > 1 ? "Ana hizmet adedi kadar" : ""}</span>
            <button type="button" className="h7s-x" onClick={() => onRemove(g.addon!.key)}>
              Kaldır
            </button>
          </div>
        </div>
      ) : g.main ? (
        <Suggest service={g.service} content={content} />
      ) : null}
    </div>
  );
}

function WalletLine({ wallet, total }: { wallet: Wallet; total: number }) {
  if (wallet.kind === "load") return <div className="h7s-wallet">Bakiye kontrol ediliyor…</div>;
  if (wallet.kind === "guest") return <div className="h7s-wallet">Ödeme bakiyenden alınır. Siparişi tamamlamak için giriş yapmalısın.</div>;
  if (wallet.kind === "err") {
    return (
      <div className="h7s-wallet low">
        {wallet.status === 503 ? "Ödeme sistemi henüz kurulmamış; şu an sipariş tamamlanamıyor." : "Bakiye bilgisi şu an alınamadı."}
      </div>
    );
  }
  const missing = Math.max(0, Math.round((total - wallet.balance) * 100) / 100);
  return (
    <div className={`h7s-wallet ${missing > 0 ? "low" : ""}`}>
      <span>
        Bakiyen: <b>{tl(wallet.balance)}</b>
      </span>
      {missing > 0 ? (
        wallet.methods > 0 ? (
          <a href={`/bakiye?tutar=${Math.ceil(missing)}`}>Eksik {tl(missing)} · Bakiye yükle →</a>
        ) : (
          <span>Eksik {tl(missing)}. Şu an aktif bir ödeme yöntemi yok.</span>
        )
      ) : (
        <span>Sipariş sonrası: {tl(wallet.balance - total)}</span>
      )}
    </div>
  );
}

function SepetPaneli({ open, onClose }: { open: boolean; onClose: () => void }) {
  const router = useRouter();
  const cart = useCart();
  const content = useSiteContent();
  const priced = useMemo(() => priceCart(cart, content), [cart, content]);
  const count = cartCount(cart);
  const [onay, setOnay] = useState(false);
  const [sending, setSending] = useState(false);
  const [msg, setMsg] = useState<{ tone: "err" | "info"; text: string; topup?: number } | null>(null);
  const [done, setDone] = useState<{ orders: PlacedOrder[]; total: number; balance: number } | null>(null);
  const [wallet, setWallet] = useState<Wallet>({ kind: "load" });
  const [leaving, setLeaving] = useState<string[]>([]);
  const closeRef = useRef<HTMLButtonElement>(null);
  const closeFn = useRef<() => void>(onClose);

  function close() {
    onClose();
    setMsg(null);
    if (done) setDone(null);
  }

  // Esc tuşu da aynı kapatma işlemini kullanır (sonuç ekranı ve mesajlar sıfırlanır)
  useEffect(() => {
    closeFn.current = close;
  });

  // Açılınca bakiye okunur; ödeme / yükleme sonrası yenilenir
  useEffect(() => {
    if (!open) return;
    let alive = true;
    const refresh = () => {
      loadWallet().then((w) => {
        if (alive) setWallet(w);
      });
    };
    refresh();
    window.addEventListener("hity7:bakiye", refresh);
    return () => {
      alive = false;
      window.removeEventListener("hity7:bakiye", refresh);
    };
  }, [open]);

  // Esc ile kapanır, arka plan kaymaz, odak kapatma düğmesine gelir
  useEffect(() => {
    if (!open) return;
    const html = document.documentElement;
    const prev = html.style.overflow;
    html.style.overflow = "hidden";
    const onKey = (e: KeyboardEvent) => {
      if (e.key === "Escape") closeFn.current();
    };
    window.addEventListener("keydown", onKey);
    const t = window.setTimeout(() => closeRef.current?.focus(), 80);
    return () => {
      html.style.overflow = prev;
      window.removeEventListener("keydown", onKey);
      window.clearTimeout(t);
    };
  }, [open]);

  function remove(key: string) {
    setLeaving((l) => [...l, key]);
    window.setTimeout(() => {
      releaseFiles(filesOf(removeLine(key)));
      setLeaving((l) => l.filter((k) => k !== key));
    }, 220);
  }

  async function submit() {
    setMsg(null);
    if (priced.blocking) return setMsg({ tone: "err", text: priced.blocking });
    if (!onay) return setMsg({ tone: "err", text: "Siparişi tamamlamak için sözleşme onay kutusunu işaretle." });
    if (wallet.kind === "ok" && wallet.balance < priced.total) {
      const missing = Math.round((priced.total - wallet.balance) * 100) / 100;
      return setMsg({ tone: "err", text: `Bakiyen yetersiz. Toplam ${tl(priced.total)}, bakiyen ${tl(wallet.balance)}.`, topup: wallet.methods > 0 ? missing : undefined });
    }
    setSending(true);
    const r = await checkout(true, priced.total);
    setSending(false);
    if (r.ok) {
      setDone({ orders: r.orders, total: r.total, balance: r.balance });
      setOnay(false);
      clearCart(); // dosyalar siparişe ait olduğu için silinmez
      return;
    }
    if (r.needLogin) {
      close();
      router.push("/giris?next=" + encodeURIComponent(window.location.pathname));
      return;
    }
    if (r.needTopup) {
      setWallet((w) => ({ kind: "ok", balance: r.balance ?? 0, methods: w.kind === "ok" ? w.methods : 1 }));
      return setMsg({ tone: "err", text: `Bakiyen yetersiz. Toplam ${tl(r.total ?? priced.total)}, bakiyen ${tl(r.balance ?? 0)}.`, topup: r.missing });
    }
    if (r.priceChanged) {
      reloadSiteContent();
      setOnay(false);
      return setMsg({ tone: "info", text: r.error });
    }
    setMsg({ tone: "err", text: r.error });
  }

  const loginHref = `/giris?next=${encodeURIComponent(typeof window !== "undefined" ? window.location.pathname : "/")}`;

  return (
    <div className={`h7s-root ${open ? "open" : ""}`} inert={!open}>
      <div className="h7s-veil" onClick={close} aria-hidden="true" />
      <section className="h7s-panel" role="dialog" aria-modal="true" aria-labelledby="h7s-baslik">
        <header className="h7s-head">
          <h2 id="h7s-baslik">
            Sepetim{count > 0 && !done ? <span className="h7s-count">{count} ÜRÜN</span> : null}
          </h2>
          <button ref={closeRef} type="button" className="h7s-close" onClick={close} aria-label="Sepeti kapat">
            ✕
          </button>
        </header>

        <div className="h7s-body">
          {done ? (
            <div className="h7s-done" role="status">
              <span className="h7s-ico" aria-hidden="true">
                <svg viewBox="0 0 24 24" fill="none" stroke="currentColor" strokeWidth="3" strokeLinecap="round" strokeLinejoin="round">
                  <path d="m5 12.5 4.5 4.5L19 7.5" />
                </svg>
              </span>
              <h3>Siparişin alındı</h3>
              <p>
                {done.total > 0 ? `${tl(done.total)} bakiyenden düşüldü. ` : "Ücretsiz siparişin oluşturuldu. "}
                Güncel bakiyen: {tl(done.balance)}.
              </p>
              <ul className="h7s-codes">
                {done.orders.map((o) => (
                  <li key={o.code}>
                    <code>{o.code}</code>
                    <span title={o.title}>{o.title}</span>
                    <b>{tl(o.amount)}</b>
                  </li>
                ))}
              </ul>
            </div>
          ) : priced.groups.length === 0 ? (
            <div className="h7s-empty">
              <span className="h7s-ico" aria-hidden="true">
                <BagIcon />
              </span>
              <h3>Sepetin boş</h3>
              <p>Remake Beat veya Mix &amp; Mastering sayfasında hizmetini seçip sepete ekleyebilirsin.</p>
              <div className="h7s-links">
                <a href="/remake-beat">REMAKE BEAT →</a>
                <a href="/mix-mastering">MIX &amp; MASTERING →</a>
              </div>
            </div>
          ) : (
            priced.groups.map((g) => <Group key={g.service} g={g} content={content} leaving={leaving} onRemove={remove} />)
          )}
        </div>

        {done ? (
          <footer className="h7s-foot">
            <a className="h7s-cta" href="/panel?tab=orders">
              SİPARİŞLERİM →
            </a>
            <p className="h7s-note">
              <button type="button" className="h7s-link" onClick={close}>
                Alışverişe devam et
              </button>
            </p>
          </footer>
        ) : priced.groups.length > 0 ? (
          <footer className="h7s-foot">
            <dl className="h7s-sum">
              <div>
                <dt>Ana hizmetler</dt>
                <dd>{tl(priced.mainsTotal)}</dd>
              </div>
              <div>
                <dt>Ek hizmetler</dt>
                <dd>{priced.addonsTotal > 0 ? `+${tl(priced.addonsTotal)}` : "—"}</dd>
              </div>
              <div className="tot">
                <dt>TOPLAM</dt>
                <dd>{tl(priced.total)}</dd>
              </div>
            </dl>
            <WalletLine wallet={wallet} total={priced.total} />
            {wallet.kind !== "guest" && <SozlesmeOnay tur="siparis" checked={onay} onChange={setOnay} />}
            {msg && (
              <p className={`h7s-msg ${msg.tone}`} role="alert">
                {msg.text}{" "}
                {msg.topup ? <a href={`/bakiye?tutar=${Math.ceil(msg.topup)}`}>Bakiye yükle →</a> : null}
              </p>
            )}
            {wallet.kind === "guest" ? (
              <a className="h7s-cta" href={loginHref}>
                GİRİŞ YAP VE TAMAMLA →
              </a>
            ) : (
              <button type="button" className="h7s-cta" disabled={sending || !!priced.blocking} onClick={submit}>
                {sending ? "SİPARİŞ OLUŞTURULUYOR…" : `SİPARİŞİ TAMAMLA · ${tl(priced.total)}`}
              </button>
            )}
            <p className="h7s-note">
              {priced.blocking && !sending
                ? priced.blocking
                : "Tutar sunucuda güncel fiyatlarla yeniden hesaplanır ve bakiyenden tek seferde düşülür. Bakiye yetmezse sipariş oluşmaz."}
            </p>
          </footer>
        ) : null}
      </section>
    </div>
  );
}
