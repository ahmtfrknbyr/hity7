"use client";

/**
 * components/EkHizmetKarti.tsx
 * Hizmet sayfasının sağ üstündeki ek hizmet (upsell) kartı.
 * Başlık, önerilen ek hizmetler ve fiyatlar yönetim panelinden gelir (Hizmetler & Fiyatlar → Ek hizmetler).
 * Ek hizmet sepette bu sayfanın ana hizmetine bağlanır ve aynı siparişte, aynı ödemede satılır.
 * Birden fazla ek hizmet önerilirse müşteri birini seçer. Stil kendi içindedir.
 */
import { useId, useState } from "react";
import { useSiteContent } from "../lib/use-site-content";
import { addAddon, addonKey, mainKey, openCart, removeLine, useCart, type CartAddon } from "../lib/sepet";
import { SERVICE_NAMES, offerFor, tl } from "../lib/sepet-hesap";
import type { CartService } from "../lib/site-content";

const CSS = `
.h7u{position:relative;overflow:hidden;padding:20px;border:2.5px solid #111;border-radius:28px;background:#fff;box-shadow:0 8px 0 #111;color:#111;font-family:Inter,"Helvetica Neue",Arial,sans-serif;-webkit-font-smoothing:antialiased;animation:h7uIn .8s cubic-bezier(.16,1,.3,1) both}
.h7u *,.h7u *::before,.h7u *::after{box-sizing:border-box}
.h7u::after{content:"";position:absolute;top:-60px;right:-60px;width:160px;height:160px;border-radius:50%;background:radial-gradient(circle,rgba(245,197,24,.22),rgba(245,197,24,0) 70%);pointer-events:none}
.h7u-top{display:flex;flex-wrap:wrap;align-items:center;justify-content:space-between;gap:6px 8px}
.h7u-eye{display:inline-flex;align-items:center;gap:6px;padding:5px 10px;border-radius:999px;background:#111;color:#fff;font-size:10px;font-weight:800;letter-spacing:.14em;white-space:nowrap}
.h7u-eye i{color:#f5c518;font-style:normal}
.h7u-same{font-size:10.5px;font-weight:700;letter-spacing:.06em;color:#686868;white-space:nowrap}
.h7u-title{margin:14px 0 0;font:800 21px/1.15 "Bricolage Grotesque","Helvetica Neue",Arial,sans-serif;letter-spacing:-.03em}
.h7u-one{display:flex;align-items:flex-start;justify-content:space-between;gap:14px;margin-top:14px;padding:14px;border-radius:18px;background:#f4f4f2}
.h7u-one b{display:block;font-size:14.5px;font-weight:800}
.h7u-one p{margin:4px 0 0;font-size:12.5px;line-height:1.5;color:#686868}
.h7u-price{flex:none;font:800 20px/1.1 "Bricolage Grotesque","Helvetica Neue",Arial,sans-serif;letter-spacing:-.02em;white-space:nowrap}
.h7u-list{display:grid;gap:8px;margin:14px 0 0;padding:0;border:0;min-width:0}
.h7u-opt{position:relative;display:flex;align-items:center;gap:12px;padding:11px 12px;border:2px solid transparent;border-radius:16px;background:#f4f4f2;cursor:pointer;transition:background .25s ease,border-color .25s ease,transform .25s cubic-bezier(.2,.8,.2,1),box-shadow .25s ease}
.h7u-opt:hover{background:#efefec}
.h7u-opt.on{border-color:#111;background:#fff;box-shadow:0 3px 0 #111;transform:translateY(-1px)}
.h7u-opt input{position:absolute;opacity:0;width:1px;height:1px;margin:0;pointer-events:none}
.h7u-opt:has(input:focus-visible){outline:3px solid #111;outline-offset:2px}
.h7u-dot{flex:none;display:grid;place-items:center;width:20px;height:20px;border:2px solid #111;border-radius:50%;background:#fff;transition:background .2s ease}
.h7u-dot::after{content:"";width:8px;height:8px;border-radius:50%;background:#f5c518;transform:scale(0);transition:transform .3s cubic-bezier(.34,1.56,.64,1)}
.h7u-opt.on .h7u-dot{background:#111}
.h7u-opt.on .h7u-dot::after{transform:scale(1)}
.h7u-optx{flex:1;min-width:0}
.h7u-optx b{display:block;font-size:13.5px;font-weight:800}
.h7u-optx small{display:block;margin-top:2px;font-size:11.5px;line-height:1.4;color:#686868}
.h7u-optp{flex:none;font:800 15px/1 "Bricolage Grotesque","Helvetica Neue",Arial,sans-serif;white-space:nowrap}
.h7u-in{position:absolute;top:-8px;right:10px;padding:2px 7px;border-radius:999px;background:#f5c518;border:1.5px solid #111;font-size:9px;font-weight:800;letter-spacing:.1em}
.h7u-act{display:flex;align-items:center;gap:10px;margin-top:16px}
.h7u-cta{flex:1;display:inline-flex;align-items:center;justify-content:space-between;gap:10px;padding:13px 14px 13px 18px;border:2.5px solid #111;border-radius:999px;background:#111;color:#fff;font:800 12.5px/1 Inter,Arial,sans-serif;letter-spacing:.1em;text-transform:uppercase;cursor:pointer;transition:transform .2s cubic-bezier(.2,.8,.2,1),box-shadow .2s ease,background .2s ease}
.h7u-cta span{padding:6px 10px;border-radius:999px;background:#f5c518;color:#111;letter-spacing:.02em}
.h7u-cta:hover{transform:translateY(-2px);box-shadow:0 5px 0 #f5c518}
.h7u-cta:active{transform:scale(.97);box-shadow:none}
.h7u-cta:focus-visible,.h7u-rm:focus-visible,.h7u-open:focus-visible{outline:3px solid #111;outline-offset:3px}
.h7u-ok{flex:1;display:inline-flex;align-items:center;gap:8px;padding:13px 16px;border:2.5px solid #111;border-radius:999px;background:#f5c518;font-size:12.5px;font-weight:800;letter-spacing:.1em;animation:h7uPop .45s cubic-bezier(.34,1.56,.64,1) both}
.h7u-rm,.h7u-open{padding:8px 4px;border:0;background:none;color:#111;font:700 12px/1 Inter,Arial,sans-serif;text-decoration:underline;text-underline-offset:3px;cursor:pointer}
.h7u-rm{color:#686868}
.h7u-flash{display:flex;flex-wrap:wrap;align-items:center;gap:4px 10px;margin:12px 0 0;font-size:12.5px;line-height:1.5;color:#242424;animation:h7uIn .4s ease both}
.h7u-foot{margin:12px 0 0;font-size:11.5px;line-height:1.5;color:#686868}
@keyframes h7uIn{from{opacity:0;transform:translateY(12px) scale(.985)}to{opacity:1;transform:none}}
@keyframes h7uPop{from{opacity:0;transform:scale(.92)}to{opacity:1;transform:none}}
@media (max-width:480px){.h7u{padding:18px;border-radius:24px}.h7u-title{font-size:19px}}
@media (prefers-reduced-motion:reduce){.h7u,.h7u-opt,.h7u-cta,.h7u-ok,.h7u-flash,.h7u-dot::after{animation:none!important;transition:none!important}}
`;

export default function EkHizmetKarti({ service, className = "" }: { service: CartService; className?: string }) {
  const content = useSiteContent();
  const cart = useCart();
  const [picked, setPicked] = useState("");
  const [flash, setFlash] = useState("");
  const group = useId();

  const offer = offerFor(content, service);
  if (!offer) return null;

  const inCart = cart.lines.find((l): l is CartAddon => l.key === addonKey(service)) || null;
  const hasMain = cart.lines.some((l) => l.key === mainKey(service));
  const selected = offer.addons.find((a) => a.id === (picked || inCart?.addonId)) || offer.addons[0];
  const isIn = inCart?.addonId === selected.id;
  const single = offer.addons.length === 1;
  const mainName = SERVICE_NAMES[service];

  function add() {
    const r = addAddon(service, selected.id);
    if (r === "exists") setFlash("Bu ek hizmet zaten sepette.");
    else if (r === "replaced") setFlash(`Ek hizmet ${selected.name} olarak güncellendi.`);
    else setFlash(hasMain ? `${selected.name} sepete eklendi.` : `${selected.name} sepete eklendi. ${mainName} siparişini de sepete ekleyince ikisi aynı siparişte birleşir.`);
  }

  function remove() {
    removeLine(addonKey(service));
    setFlash("Ek hizmet sepetten çıkarıldı.");
  }

  return (
    <aside className={`h7u ${className}`} aria-label="Önerilen ek hizmet">
      <style dangerouslySetInnerHTML={{ __html: CSS }} />
      <div className="h7u-top">
        <span className="h7u-eye">
          <i aria-hidden="true">✦</i> ÖNERİLEN EK HİZMET
        </span>
        <span className="h7u-same">Aynı sipariş · tek ödeme</span>
      </div>
      <h2 className="h7u-title">{offer.title}</h2>

      {single ? (
        <div className="h7u-one">
          <div>
            <b>{selected.name}</b>
            {selected.desc && <p>{selected.desc}</p>}
          </div>
          <span className="h7u-price">+{tl(selected.price)}</span>
        </div>
      ) : (
        <fieldset className="h7u-list">
          <legend style={{ position: "absolute", width: 1, height: 1, overflow: "hidden", clip: "rect(0 0 0 0)" }}>Ek hizmet seçimi</legend>
          {offer.addons.map((a) => {
            const on = a.id === selected.id;
            return (
              <label key={a.id} className={`h7u-opt ${on ? "on" : ""}`}>
                <input
                  type="radio"
                  name={group}
                  value={a.id}
                  checked={on}
                  onChange={() => {
                    setPicked(a.id);
                    setFlash("");
                  }}
                />
                <span className="h7u-dot" aria-hidden="true" />
                <span className="h7u-optx">
                  <b>{a.name}</b>
                  {a.desc && <small>{a.desc}</small>}
                </span>
                <span className="h7u-optp">+{tl(a.price)}</span>
                {inCart?.addonId === a.id && <span className="h7u-in">SEPETTE</span>}
              </label>
            );
          })}
        </fieldset>
      )}

      <div className="h7u-act">
        {isIn ? (
          <>
            <span className="h7u-ok" role="status">
              ✓ SEPETTE
            </span>
            <button type="button" className="h7u-rm" onClick={remove}>
              Çıkar
            </button>
          </>
        ) : (
          <button type="button" className="h7u-cta" onClick={add}>
            {inCart ? "Seçimi güncelle" : "Sepete ekle"}
            <span>+{tl(selected.price)}</span>
          </button>
        )}
      </div>

      {flash ? (
        <p className="h7u-flash" role="status">
          {flash}
          <button type="button" className="h7u-open" onClick={openCart}>
            Sepeti gör →
          </button>
        </p>
      ) : (
        <p className="h7u-foot">Sepette {mainName} siparişine bağlanır; ikisi aynı siparişte, tek ödemede alınır.</p>
      )}
    </aside>
  );
}
