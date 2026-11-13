// @ts-nocheck
/* eslint-disable */
"use client";

/**
 * HITY7 ana sayfa: kaydırdıkça plaklara zoom yapan, plaktan plağa zıplayan çocuk.
 * Dosya yolu: app/page.tsx  (mevcut ana sayfanın yerine; eski dosyayı önce yedekle)
 *
 * Yalnızca ana sayfayı değiştirir. Diğer sayfalara, auth'a, formlara ve verilere dokunmaz.
 * Aşağıdaki ROUTES bölümünü kendi gerçek yollarına göre düzenle.
 */
import { useEffect, useRef } from "react";
import { useRouter } from "next/navigation";

const ROUTES = {
  smm: "/smm-panel",
  influencer: "/influencer-marketing",
  remake: "/remake-beat",
  yayin: "/dijital-yayin",
  login: "/giris",
  register: "/uye-ol",
};

const CSS = `
.h7 {

/* Tek sahne: ekran sabit kalır, kaydırdıkça kamera bir sonraki (daha küçük) plağa zoom yapar, çocuk plaktan plağa zıplar. */
&{
  --white: #ffffff; --gray: #f5f5f5; --gray-2: #e6e6e6; --ink: #111111; --ink-2: #242424; --muted: #686868;
  --yellow: #f5c518; --yellow-h: #e5b600; --hh: 71px; /* ortak SiteMenu yüksekliği (68px + 3px çizgi) */
  --display: "Bricolage Grotesque", "Helvetica Neue", Arial, sans-serif;
  --body: "Inter", system-ui, -apple-system, "Segoe UI", Roboto, Arial, sans-serif;
  color-scheme: light;
}
& *, & *::before, & *::after { box-sizing: border-box; }

&{ position: relative; margin: 0; background: var(--white); color: var(--ink); font-family: var(--body); font-size: 16px; line-height: 1.6; overflow-x: clip; width: 100%; -webkit-font-smoothing: antialiased; }
&::before { content: ""; position: fixed; inset: 0 0 auto; height: env(safe-area-inset-top, 0px); z-index: 40; background: var(--white); }
a { color: inherit; }
:focus-visible { outline: 3px solid var(--ink); outline-offset: 3px; border-radius: 8px; }
.wrap { width: 100%; max-width: 1240px; margin: 0 auto; padding-left: max(16px, env(safe-area-inset-left, 0px)); padding-right: max(16px, env(safe-area-inset-right, 0px)); }
/* Butonlar */
.btn { display: inline-flex; align-items: center; justify-content: center; gap: 10px; min-height: 48px; padding: 0 24px; border-radius: 999px; border: 2.5px solid var(--ink); background: var(--white); color: var(--ink); font-family: var(--body); font-size: 15px; font-weight: 600; text-decoration: none; white-space: nowrap; cursor: pointer; box-shadow: 0 4px 0 var(--ink); transition: transform 0.15s ease, box-shadow 0.15s ease, background 0.2s ease; }
.btn:hover { transform: translateY(-2px); box-shadow: 0 6px 0 var(--ink); }
.btn:active { transform: translateY(3px); box-shadow: 0 1px 0 var(--ink); }
.btn-yellow { background: var(--yellow); }
.btn-yellow:hover { background: var(--yellow-h); }
.btn-dark { background: var(--ink); color: var(--white); box-shadow: 0 4px 0 var(--ink-2); }
.btn-dark:hover { box-shadow: 0 6px 0 var(--ink-2); }
.btn-sm { min-height: 42px; padding: 0 18px; font-size: 14px; box-shadow: 0 3px 0 var(--ink); }
.btn-flat { box-shadow: none; border-color: rgba(17, 17, 17, 0.25); }
.btn-flat:hover { box-shadow: none; border-color: var(--ink); transform: none; }

/* Header */
.hdr { position: sticky; top: env(safe-area-inset-top, 0px); z-index: 30; background: var(--white); transition: background 0.25s ease, box-shadow 0.25s ease; }
.hdr.scrolled { background: rgba(255, 255, 255, 0.82); -webkit-backdrop-filter: saturate(180%) blur(16px); backdrop-filter: saturate(180%) blur(16px); box-shadow: 0 1px 0 rgba(17, 17, 17, 0.07), 0 10px 30px rgba(17, 17, 17, 0.06); }
.hdr-in { display: flex; align-items: center; gap: 28px; min-height: 72px; }
.logo { display: inline-flex; align-items: baseline; gap: 3px; font-family: var(--display); font-weight: 800; font-size: 28px; letter-spacing: -0.05em; text-decoration: none; line-height: 1; }
.logo i { width: 9px; height: 9px; background: var(--yellow); border: 2px solid var(--ink); border-radius: 50%; display: inline-block; }
.menu { display: flex; align-items: center; gap: 4px; margin-left: 10px; flex: 1; min-width: 0; }
.menu a { position: relative; padding: 10px 14px; font-size: 15px; font-weight: 500; text-decoration: none; color: var(--ink-2); white-space: nowrap; }
.menu a::after { content: ""; position: absolute; left: 14px; right: 14px; bottom: 4px; height: 3px; border-radius: 3px; background: var(--yellow); transform: scaleX(0); transform-origin: left; transition: transform 0.25s ease; }
.menu a:hover::after, .menu a[aria-current="page"]::after { transform: scaleX(1); }
.menu a[aria-current="page"] { color: var(--ink); font-weight: 600; }
.menu .menu-auth { display: none; }
.auth { display: flex; align-items: center; gap: 10px; }
.burger { display: none; width: 46px; height: 46px; border: 2.5px solid var(--ink); border-radius: 14px; background: var(--white); cursor: pointer; padding: 0; align-items: center; justify-content: center; box-shadow: 0 3px 0 var(--ink); }
.burger span, .burger span::before, .burger span::after { display: block; width: 18px; height: 2.5px; background: var(--ink); border-radius: 2px; position: relative; transition: transform 0.25s ease, background 0.2s ease; }
.burger span::before, .burger span::after { content: ""; position: absolute; left: 0; }
.burger span::before { top: -6px; }
.burger span::after { top: 6px; }
.burger[aria-expanded="true"] span { background: transparent; }
.burger[aria-expanded="true"] span::before { transform: translateY(6px) rotate(45deg); }
.burger[aria-expanded="true"] span::after { transform: translateY(-6px) rotate(-45deg); }


.kicker { display: inline-flex; align-items: center; gap: 10px; padding: 7px 14px; border: 2.5px solid var(--ink); border-radius: 999px; background: var(--white); font-size: 12px; font-weight: 700; letter-spacing: 0.14em; }
.kicker::before { content: ""; width: 9px; height: 9px; border-radius: 50%; background: var(--yellow); border: 2px solid var(--ink); }
h1 { margin: 22px 0 0; font-family: var(--display); font-weight: 800; font-size: clamp(2.2rem, 5.4vw, 5rem); line-height: 0.96; letter-spacing: -0.045em; text-wrap: balance; }
h1 .mark { text-decoration: underline wavy var(--yellow); text-decoration-thickness: 0.09em; text-underline-offset: 0.14em; text-decoration-skip-ink: none; }
h2 { margin: 0; font-family: var(--display); font-weight: 800; font-size: clamp(2rem, 4.4vw, 3.6rem); line-height: 1; letter-spacing: -0.04em; text-wrap: balance; }
.lead { margin: 22px 0 0; max-width: 31rem; font-size: 19px; color: var(--muted); }
.cta { display: flex; flex-wrap: wrap; gap: 14px; margin-top: 30px; }
/* Plaklar (3B) */
.rec-stage { --d: min(330px, 70vw); position: relative; width: var(--d); height: calc(var(--d) * 0.58); perspective: calc(var(--d) * 2.6); margin-inline: auto; }
.rec-stage::after { content: ""; position: absolute; left: 6%; right: 6%; bottom: -10%; height: 20%; border-radius: 50%; background: radial-gradient(ellipse at center, rgba(17, 17, 17, 0.28), transparent 70%); filter: blur(8px); z-index: -1; }
.rec { position: absolute; left: 0; top: 50%; width: var(--d); height: var(--d); margin-top: calc(var(--d) * -0.5); transform: rotateX(62deg); transform-style: preserve-3d; --rim: #0a0a0a; }
.rec .rim { position: absolute; inset: 0; border-radius: 50%; background: var(--rim); transform: translateZ(calc(var(--d) * -0.011 * var(--n))); }
.disc { position: absolute; inset: 0; border-radius: 50%; overflow: hidden; }
.disc::before { content: ""; position: absolute; inset: 0; border-radius: 50%; background: repeating-conic-gradient(from 0deg, var(--wedge) 0 5deg, transparent 5deg 10deg); }
.sheen { position: absolute; inset: 0; border-radius: 50%; transform: translateZ(1px); pointer-events: none; background: conic-gradient(from 28deg, transparent 0 9%, rgba(255, 255, 255, 0.34) 13% 16%, transparent 21% 55%, rgba(255, 255, 255, 0.22) 61% 64%, transparent 70%); }
.label { position: absolute; left: 50%; top: 50%; width: 36%; height: 36%; transform: translate(-50%, -50%); border-radius: 50%; overflow: hidden; box-shadow: 0 0 0 calc(var(--d) * 0.008) rgba(0, 0, 0, 0.35); }
.label svg { display: block; width: 100%; height: 100%; }
.v-black .disc { background: repeating-radial-gradient(circle at 50% 50%, #161616 0 2px, #0b0b0b 2px 4px); --wedge: rgba(255, 255, 255, 0.05); }
.v-yellow { --rim: #d3a400; }
.v-yellow .disc { background: repeating-radial-gradient(circle at 50% 50%, #f7cc2c 0 2px, #e9b912 2px 4px); --wedge: rgba(255, 255, 255, 0.22); }
.v-clear { --rim: #b5b5b5; }
.v-clear .disc { background: repeating-radial-gradient(circle at 50% 50%, #f4f4f4 0 2px, #e3e3e3 2px 4px); --wedge: rgba(17, 17, 17, 0.05); }
.bump { animation: bump 0.55s cubic-bezier(0.3, 1.5, 0.5, 1); }



.rec-stage { position: absolute; margin: 0; }
.rec-stage::after { display: none; }
.rec-stage .shadow { position: absolute; left: 6%; right: 6%; bottom: -12%; height: 22%; border-radius: 50%; background: radial-gradient(ellipse at center, rgba(17,17,17,0.3), transparent 70%); filter: blur(6px); }

/* Sahne */
.scene { position: relative; height: 600vh; }
.pin { position: sticky; top: var(--hh); height: calc(100vh - var(--hh)); height: calc(100svh - var(--hh)); overflow: hidden; background-color: var(--white); background-image: radial-gradient(#d4d4d4 1.4px, transparent 1.5px); background-size: 28px 28px; }
.tint { position: absolute; inset: 0; background: var(--yellow); opacity: 0; pointer-events: none; }
#world { position: absolute; left: 0; top: 0; transform-origin: 0 0; }
.anc { position: absolute; left: 0; width: 1px; height: 1px; scroll-margin-top: var(--hh); pointer-events: none; }

.pp { position: absolute; z-index: 8; opacity: 0; visibility: hidden; transform: translateY(18px) scale(0.98); transition: opacity 0.35s ease, transform 0.45s cubic-bezier(0.3, 1.4, 0.5, 1), visibility 0s 0.35s; }
.pp.on { opacity: 1; visibility: visible; transform: none; transition: opacity 0.4s ease 0.15s, transform 0.55s cubic-bezier(0.3, 1.4, 0.5, 1) 0.15s, visibility 0s; }
.pp.left { left: max(16px, 5vw); top: 50%; margin-top: var(--mt, -190px); width: min(520px, 44vw); }
.pp.right { right: max(16px, 5vw); top: 50%; margin-top: var(--mt, -190px); width: min(520px, 44vw); }
.pp.top { left: 50%; top: 4%; width: min(640px, 92vw); margin-left: calc(min(640px, 92vw) / -2); text-align: center; }
.pp.hero { width: min(640px, 52vw); }
.card { padding: 28px 30px 32px; background: var(--white); border: 3px solid var(--ink); border-radius: 32px; box-shadow: 0 10px 0 var(--ink); }
.tag { display: inline-flex; align-items: center; padding: 5px 12px; border: 2.5px solid var(--ink); border-radius: 999px; background: var(--yellow); font-size: 12px; font-weight: 700; letter-spacing: 0.14em; }
h3 { margin: 14px 0 0; font-family: var(--display); font-weight: 800; font-size: clamp(1.9rem, 3.4vw, 2.9rem); line-height: 1; letter-spacing: -0.04em; text-wrap: balance; }
.card p { margin: 12px 0 0; color: var(--muted); font-size: 17px; }
.feats { list-style: none; margin: 20px 0 0; padding: 0; display: flex; flex-direction: column; gap: 9px; }
.feats li { display: flex; align-items: center; gap: 12px; align-self: flex-start; max-width: 100%; padding: 7px 18px 7px 9px; border: 2.5px solid var(--ink); border-radius: 999px; background: var(--white); font-size: 15px; font-weight: 600; transition: transform 0.3s cubic-bezier(0.3, 1.6, 0.5, 1), background 0.25s ease; }
.feats li::before { content: "✓"; flex: none; display: grid; place-items: center; width: 24px; height: 24px; border-radius: 50%; background: var(--gray); border: 2px solid var(--ink); font-size: 12px; font-weight: 800; }
.feats li.on { background: var(--yellow); transform: translateX(8px) rotate(-1deg); }
.feats li.on::before { background: var(--ink); color: var(--yellow); }
.go { margin-top: 24px; background: var(--ink); color: var(--white); padding-right: 8px; box-shadow: 0 4px 0 var(--ink-2); }
.go:hover { box-shadow: 0 6px 0 var(--ink-2); }
.go .arr { display: inline-grid; place-items: center; width: 32px; height: 32px; border-radius: 50%; background: var(--yellow); color: var(--ink); font-size: 16px; }
.hint { position: absolute; z-index: 9; left: 50%; bottom: 14px; transform: translateX(-50%); display: inline-flex; align-items: center; gap: 8px; padding: 6px 14px; border: 2.5px solid var(--ink); border-radius: 999px; background: var(--white); font-size: 12px; font-weight: 700; letter-spacing: 0.1em; transition: opacity 0.3s ease; pointer-events: none; }
.hint i { display: block; width: 8px; height: 8px; border-radius: 50%; background: var(--yellow); border: 2px solid var(--ink); animation: dn 1.2s ease-in-out infinite; }

.prog { position: absolute; z-index: 9; right: max(12px, 1.4vw); top: 50%; transform: translateY(-50%); display: flex; flex-direction: column; gap: 10px; }
.prog b { width: 12px; height: 12px; border-radius: 50%; border: 2.5px solid var(--ink); background: var(--white); transition: background 0.25s ease, transform 0.25s ease; }
.prog b.on { background: var(--yellow); transform: scale(1.35); }
.bump { animation: bump 0.55s cubic-bezier(0.3, 1.5, 0.5, 1); }

.ftr { padding-block: 44px; }
.ftr-in { display: flex; flex-wrap: wrap; justify-content: space-between; gap: 22px 40px; align-items: center; }
.ftr nav { display: flex; flex-wrap: wrap; gap: 6px 22px; }
.ftr nav a { font-size: 14px; color: var(--muted); text-decoration: none; }
.ftr small { width: 100%; padding-top: 22px; border-top: 2px solid var(--gray-2); color: var(--muted); font-size: 13px; }

/* Çocuk */
#kid-layer { position: absolute; inset: 0; z-index: 12; pointer-events: none; }
#kshadow { position: absolute; left: 0; top: 0; width: 96px; height: 28px; border-radius: 50%; background: radial-gradient(ellipse at center, rgba(0,0,0,0.5), transparent 70%); }
#kid { position: absolute; left: 0; top: 0; width: 140px; height: 230px; padding: 0; margin: 0; border: 0; background: transparent; transform-origin: 70px 215px; pointer-events: auto; cursor: pointer; -webkit-tap-highlight-color: transparent; }
#kid svg { display: block; width: 140px; height: 230px; overflow: visible; pointer-events: none; }
#kbub { position: absolute; left: 0; top: 0; }
#kbub-in { position: relative; width: max-content; max-width: 220px; padding: 10px 16px; background: var(--white); border: 2.5px solid var(--ink); border-radius: 20px; box-shadow: 0 4px 0 var(--ink); font-size: 14px; font-weight: 600; line-height: 1.35; opacity: 0; transform: scale(0.7) translateY(8px); transition: opacity 0.2s ease, transform 0.35s cubic-bezier(0.3, 1.6, 0.5, 1); }
#kbub-in::after { content: ""; position: absolute; left: var(--tx, 50%); bottom: -11px; width: 16px; height: 16px; margin-left: -8px; background: var(--white); border-right: 2.5px solid var(--ink); border-bottom: 2.5px solid var(--ink); transform: rotate(45deg); border-bottom-right-radius: 4px; }
#kbub.show #kbub-in { opacity: 1; transform: none; }
.fx { position: absolute; left: 0; top: 0; pointer-events: none; }

@media (max-width: 1020px) { .menu a { padding: 10px 10px; font-size: 14px; } .hdr-in { gap: 16px; } }
@media (max-width: 900px) {
  .burger { display: inline-flex; margin-left: auto; }
  .auth { margin-left: auto; }
  .auth .btn-flat { display: none; }
  .hdr-in { gap: 12px; }
  .menu { position: absolute; left: 0; right: 0; top: 100%; flex-direction: column; align-items: stretch; gap: 0; margin: 0; padding: 8px max(16px, env(safe-area-inset-right, 0px)) 18px max(16px, env(safe-area-inset-left, 0px)); background: rgba(255,255,255,0.98); -webkit-backdrop-filter: blur(16px); backdrop-filter: blur(16px); box-shadow: 0 18px 30px rgba(17,17,17,0.1); border-bottom: 3px solid var(--ink); display: none; }
  .menu.open { display: flex; }
  .menu a { padding: 15px 4px; border-bottom: 2px solid var(--gray-2); font-size: 17px; }
  .menu a::after { display: none; }
  .menu .menu-auth { display: inline-flex; margin-top: 14px; border: 2.5px solid var(--ink); justify-content: center; border-radius: 999px; }
  .pp.left, .pp.right, .pp.hero, .pp.top { left: 16px; right: 16px; top: auto; bottom: 14px; width: auto; margin: 0; text-align: left; }
  .pp.top { text-align: center; }
  .card { padding: 20px 20px 22px; border-radius: 26px; box-shadow: 0 7px 0 var(--ink); }
  .card p { font-size: 15px; margin-top: 8px; }
  .feats { gap: 7px; margin-top: 14px; }
  .feats li { font-size: 13.5px; padding: 5px 14px 5px 7px; }
  .go { margin-top: 16px; }
  .lead { font-size: 16px; margin-top: 14px; }
  .pp.hero .kicker { display: none; }
  h1 { margin-top: 0; font-size: clamp(2rem, 9.4vw, 2.7rem); }
  .cta { margin-top: 18px; }
  .cta .btn { flex: 1 1 100%; }
  .prog { right: 8px; }
  .hint { display: none; }
}
@media (prefers-reduced-motion: reduce) { .btn, .hdr, .pp, .feats li { transition: none; } .bump { animation: none; } .hint i { animation: none; } }

}
@keyframes bump { 0% { transform: translateY(0); } 25% { transform: translateY(10px) scale(0.985); } 100% { transform: none; } }
@keyframes dn { 50% { transform: translateY(4px); } }
@keyframes bump { 25% { transform: translateY(8px); } }
`;

const HTML = `
<main id="top">
<section class="scene" id="scene">
  <span class="anc" id="h7-plak-1" data-i="1"></span><span class="anc" data-i="2"></span><span class="anc" data-i="3"></span><span class="anc" data-i="4"></span>
  <div class="pin" id="pin">
    <div class="tint" id="tint"></div>
    <div id="world">
      <div class="rec-stage v-black" data-rec="0"><div class="shadow"></div><div class="rec"><i class="rim" style="--n:1"></i><i class="rim" style="--n:2"></i><i class="rim" style="--n:3"></i><i class="rim" style="--n:4"></i><i class="rim" style="--n:5"></i><i class="rim" style="--n:6"></i><div class="disc"><div class="label"><svg viewBox="0 0 100 100" aria-hidden="true"><rect width="100" height="100" fill="#f5c518"/><text x="50" y="52" text-anchor="middle" font-family="Bricolage Grotesque, Arial, sans-serif" font-weight="800" font-size="25" fill="#111">HITY7</text><text x="50" y="68" text-anchor="middle" font-family="Inter, Arial, sans-serif" font-weight="700" font-size="9" fill="#111">33⅓ RPM</text><circle cx="50" cy="86" r="3" fill="#111"/></svg></div></div><div class="sheen"></div></div></div>
<div class="rec-stage v-black" data-rec="1"><div class="shadow"></div><div class="rec"><i class="rim" style="--n:1"></i><i class="rim" style="--n:2"></i><i class="rim" style="--n:3"></i><i class="rim" style="--n:4"></i><i class="rim" style="--n:5"></i><i class="rim" style="--n:6"></i><div class="disc"><div class="label"><svg viewBox="0 0 100 100" aria-hidden="true"><rect width="100" height="100" fill="#f5c518"/><rect x="18" y="58" width="12" height="20" rx="3" fill="#111"/><rect x="36" y="48" width="12" height="30" rx="3" fill="#111"/><rect x="54" y="36" width="12" height="42" rx="3" fill="#111"/><rect x="72" y="22" width="12" height="56" rx="3" fill="#111"/></svg></div></div><div class="sheen"></div></div></div>
<div class="rec-stage v-yellow" data-rec="2"><div class="shadow"></div><div class="rec"><i class="rim" style="--n:1"></i><i class="rim" style="--n:2"></i><i class="rim" style="--n:3"></i><i class="rim" style="--n:4"></i><i class="rim" style="--n:5"></i><i class="rim" style="--n:6"></i><div class="disc"><div class="label"><svg viewBox="0 0 100 100" aria-hidden="true"><rect width="100" height="100" fill="#111"/><circle cx="50" cy="48" r="26" fill="none" stroke="#f5c518" stroke-width="5"/><path d="M43 36 L63 48 L43 60 Z" fill="#f5c518"/></svg></div></div><div class="sheen"></div></div></div>
<div class="rec-stage v-black" data-rec="3"><div class="shadow"></div><div class="rec"><i class="rim" style="--n:1"></i><i class="rim" style="--n:2"></i><i class="rim" style="--n:3"></i><i class="rim" style="--n:4"></i><i class="rim" style="--n:5"></i><i class="rim" style="--n:6"></i><div class="disc"><div class="label"><svg viewBox="0 0 100 100" aria-hidden="true"><rect width="100" height="100" fill="#f5c518"/><rect x="14" y="42" width="7" height="16" rx="3" fill="#111"/><rect x="25" y="32" width="7" height="36" rx="3" fill="#111"/><rect x="36" y="22" width="7" height="56" rx="3" fill="#111"/><rect x="47" y="36" width="7" height="28" rx="3" fill="#111"/><rect x="58" y="26" width="7" height="48" rx="3" fill="#111"/><rect x="69" y="38" width="7" height="24" rx="3" fill="#111"/><rect x="80" y="44" width="7" height="12" rx="3" fill="#111"/></svg></div></div><div class="sheen"></div></div></div>
<div class="rec-stage v-clear" data-rec="4"><div class="shadow"></div><div class="rec"><i class="rim" style="--n:1"></i><i class="rim" style="--n:2"></i><i class="rim" style="--n:3"></i><i class="rim" style="--n:4"></i><i class="rim" style="--n:5"></i><i class="rim" style="--n:6"></i><div class="disc"><div class="label"><svg viewBox="0 0 100 100" aria-hidden="true"><rect width="100" height="100" fill="#111"/><circle cx="50" cy="48" r="28" fill="none" stroke="#f5c518" stroke-width="4"/><ellipse cx="50" cy="48" rx="12" ry="28" fill="none" stroke="#f5c518" stroke-width="3"/><line x1="22" y1="48" x2="78" y2="48" stroke="#f5c518" stroke-width="3"/></svg></div></div><div class="sheen"></div></div></div>
<div class="rec-stage v-black" data-rec="5"><div class="shadow"></div><div class="rec"><i class="rim" style="--n:1"></i><i class="rim" style="--n:2"></i><i class="rim" style="--n:3"></i><i class="rim" style="--n:4"></i><i class="rim" style="--n:5"></i><i class="rim" style="--n:6"></i><div class="disc"><div class="label"><svg viewBox="0 0 100 100" aria-hidden="true"><rect width="100" height="100" fill="#f5c518"/><text x="50" y="66" text-anchor="middle" font-family="Bricolage Grotesque, Arial, sans-serif" font-weight="800" font-size="62" fill="#111">7</text></svg></div></div><div class="sheen"></div></div></div>

    </div>

    <div class="pp left hero on" data-i="0" data-say="Selam! Kaydır, plağa zoom yapalım.|Her plakta bir hizmet var.|Hazır mısın? Aşağı!">
      <div class="kicker">MÜZİK TEKNOLOJİ PLATFORMU</div>
      <h1>MÜZİĞİN GELECEĞİNİ <span class="mark">ŞEKİLLENDİR.</span></h1>
      <p class="lead">Sanatını büyüt. Müziğini dünyaya duyur. Dijital gücünü HITY7 ile keşfet.</p>
      <div class="cta"><a class="btn" href="#h7-plak-1" data-scroll="1">Hizmetleri Keşfet</a><a class="btn btn-yellow" href="${ROUTES.register}">Hemen Başla</a></div>
    </div>

    <div class="pp right" data-i="1" style="--mt:-190px" data-say="Hesaplarını tek noktadan yönet!|Kampanyalarını buradan takip et.|Profesyonel araçlar hazır!">
      <div class="card"><span class="tag">PLAK 1 / 4 · SMM PANEL</span><h3>Dijital Gücünü Artır</h3><p>Sosyal medya hesaplarını profesyonel araçlarla yönet, kampanyalarını tek noktadan takip et.</p><ul class="feats"><li>Tek noktadan yönetim</li><li>Kampanya takibi</li><li>Profesyonel araçlar</li></ul><a class="btn go" href="${ROUTES.smm}">SMM Paneli Keşfet <span class="arr" aria-hidden="true">→</span></a></div>
    </div>
    <div class="pp left" data-i="2" data-say="Doğru içerik üreticileriyle tanış!|Etkili kampanyalar kur.|Görünürlüğün büyüsün!">
      <div class="card"><span class="tag">PLAK 2 / 4 · INFLUENCER MARKETING</span><h3>Doğru Kitleye Ulaş</h3><p>Markanı ve müziğini doğru içerik üreticileriyle buluştur. Etkili kampanyalar oluştur.</p><ul class="feats"><li>Doğru içerik üreticileri</li><li>Etkili kampanyalar</li><li>Dijital görünürlük</li></ul><a class="btn go" href="${ROUTES.influencer}">Kampanya Oluştur <span class="arr" aria-hidden="true">→</span></a></div>
    </div>
    <div class="pp right" data-i="3" data-say="Referans sound'unu yeniden tasarla!|Sana özel altyapılar var.|Profesyonel prodüksiyon!">
      <div class="card"><span class="tag">PLAK 3 / 4 · REMAKE BEAT</span><h3>Sesini Yeniden Yarat</h3><p>Referans sound'unuzu yeniden tasarlayın. Müziğinize özel altyapılar ve profesyonel prodüksiyon.</p><ul class="feats"><li>Referans sound'u yeniden tasarım</li><li>Özel altyapılar</li><li>Profesyonel prodüksiyon</li></ul><a class="btn go" href="${ROUTES.remake}">Remake Beat'i Keşfet <span class="arr" aria-hidden="true">→</span></a></div>
    </div>
    <div class="pp left" data-i="4" data-say="Müziğin tüm platformlarda!|Dağıtım süreci tek merkezde.|Yayına hazır mısın?">
      <div class="card"><span class="tag">PLAK 4 / 4 · DİJİTAL YAYIN</span><h3>Dijital Yayın</h3><p>Müziğinizi dijital platformlarda yayınlayın. Yayın ve dağıtım sürecinizi tek merkezden yönetin.</p><ul class="feats"><li>Dijital platformlarda yayın</li><li>Dağıtım süreci</li><li>Tek merkezden yönetim</li></ul><a class="btn go" href="${ROUTES.yayin}">Dijital Yayını Keşfet <span class="arr" aria-hidden="true">→</span></a></div>
    </div>
    <div class="pp top" data-i="5">
      <h2>Müziğin Geleceğini Şekillendir.</h2>
      <div style="margin-top:22px"><a class="btn btn-dark" href="${ROUTES.register}" style="min-height:54px;padding:0 32px;font-size:17px">Hemen Başla</a></div>
    </div>

    <div class="prog" id="prog" aria-hidden="true"><b class="on"></b><b></b><b></b><b></b><b></b><b></b></div>
    <div class="hint" id="hint"><i></i>AŞAĞI KAYDIR</div>
    <div id="kid-layer">
  <div id="kshadow"></div>
  <button id="kid" type="button" aria-label="Çocuğa dokun">
    <svg id="kid-svg" viewBox="-70 -215 140 230" xmlns="http://www.w3.org/2000/svg" focusable="false" aria-hidden="true">
      <defs>
        <radialGradient id="g-skin" cx="0.38" cy="0.3" r="0.8"><stop offset="0" stop-color="#f7d2af"/><stop offset="0.55" stop-color="#e9af86"/><stop offset="1" stop-color="#c98760"/></radialGradient>
        <linearGradient id="g-hood" x1="0" y1="0" x2="1" y2="1"><stop offset="0" stop-color="#ffe269"/><stop offset="0.5" stop-color="#f5c518"/><stop offset="1" stop-color="#dda500"/></linearGradient>
        <linearGradient id="g-pants" x1="0" y1="0" x2="1" y2="1"><stop offset="0" stop-color="#3d3d3d"/><stop offset="1" stop-color="#111"/></linearGradient>
        <radialGradient id="g-shoe" cx="0.4" cy="0.3" r="0.9"><stop offset="0" stop-color="#fff"/><stop offset="1" stop-color="#d6d6d6"/></radialGradient>
        <linearGradient id="g-hair" x1="0" y1="0" x2="1" y2="1"><stop offset="0" stop-color="#34302e"/><stop offset="1" stop-color="#0c0b0b"/></linearGradient>
        <radialGradient id="g-iris" cx="0.4" cy="0.35" r="0.8"><stop offset="0" stop-color="#8a5a35"/><stop offset="1" stop-color="#2b1708"/></radialGradient>
        <linearGradient id="g-cup" x1="0" y1="0" x2="1" y2="1"><stop offset="0" stop-color="#ffe269"/><stop offset="1" stop-color="#e5b600"/></linearGradient>
      </defs>
      <g id="k-root">
        <g id="k-body">
          <!-- bacaklar -->
          <g transform="translate(-9 -62)"><g id="k-legL">
            <rect x="-8" y="-6" width="16" height="56" rx="8" fill="url(#g-pants)"/>
            <rect x="-8" y="-6" width="5" height="56" rx="2.5" fill="#fff" opacity="0.08"/>
            <ellipse cx="-1" cy="53" rx="13.5" ry="7.5" fill="url(#g-shoe)"/>
            <path d="M -14 55.5 Q -1 63 15 55.5 Q 14 62 -1 62 Q -13 62 -14 55.5 Z" fill="#f5c518"/>
          </g></g>
          <g transform="translate(9 -62)"><g id="k-legR">
            <rect x="-8" y="-6" width="16" height="56" rx="8" fill="url(#g-pants)"/>
            <rect x="-8" y="-6" width="5" height="56" rx="2.5" fill="#fff" opacity="0.08"/>
            <ellipse cx="1" cy="53" rx="13.5" ry="7.5" fill="url(#g-shoe)"/>
            <path d="M -15 55.5 Q 1 63 14 55.5 Q 13 62 1 62 Q -14 62 -15 55.5 Z" fill="#f5c518"/>
          </g></g>
          <!-- gövde -->
          <path d="M -23 -112 Q -28 -88 -24 -58 Q 0 -50 24 -58 Q 28 -88 23 -112 Q 0 -122 -23 -112 Z" fill="url(#g-hood)"/>
          <path d="M -13 -76 Q 0 -70 13 -76 L 15 -62 Q 0 -57 -15 -62 Z" fill="#a06e00" opacity="0.22"/>
          <ellipse cx="0" cy="-114" rx="12" ry="5.5" fill="#d79f00"/>
          <path d="M -5 -112 L -6 -92 M 5 -112 L 6 -92" stroke="#111" stroke-width="1.8" stroke-linecap="round" fill="none"/>
          <circle cx="-6" cy="-91" r="1.9" fill="#111"/><circle cx="6" cy="-91" r="1.9" fill="#111"/>
          <text x="0" y="-80" text-anchor="middle" font-family="Bricolage Grotesque, Arial, sans-serif" font-weight="800" font-size="11" fill="#111">H7</text>
          <ellipse cx="-13" cy="-96" rx="4" ry="14" fill="#fff" opacity="0.28" transform="rotate(8 -13 -96)"/>
          <!-- kollar -->
          <g transform="translate(-23 -108)"><g id="k-armL">
            <rect x="-7.5" y="-6" width="15" height="38" rx="7.5" fill="url(#g-hood)"/>
            <rect x="-8" y="26" width="16" height="7" rx="3.5" fill="#d79f00"/>
            <circle cx="0" cy="38" r="8.6" fill="url(#g-skin)"/>
            <rect x="-5" y="-4" width="3.6" height="26" rx="1.8" fill="#fff" opacity="0.25"/>
          </g></g>
          <g transform="translate(23 -108)"><g id="k-armR">
            <rect x="-7.5" y="-6" width="15" height="38" rx="7.5" fill="url(#g-hood)"/>
            <rect x="-8" y="26" width="16" height="7" rx="3.5" fill="#d79f00"/>
            <circle cx="0" cy="38" r="8.6" fill="url(#g-skin)"/>
            <rect x="-5" y="-4" width="3.6" height="26" rx="1.8" fill="#fff" opacity="0.25"/>
          </g></g>
          <!-- kafa -->
          <g transform="translate(0 -148)"><g id="k-head">
            <path d="M -35 -4 Q -42 -40 -8 -44 Q 8 -52 26 -40 Q 42 -28 35 -2 Q 24 -26 0 -24 Q -22 -22 -35 -4 Z" fill="url(#g-hair)"/>
            <circle cx="-33" cy="5" r="7" fill="#d99a72"/><circle cx="33" cy="5" r="7" fill="#d99a72"/>
            <ellipse cx="0" cy="1" rx="34" ry="32" fill="url(#g-skin)"/>
            <ellipse cx="-12" cy="-14" rx="11" ry="6" fill="#fff" opacity="0.22" transform="rotate(-20 -12 -14)"/>
            <path d="M -34 -4 Q -32 -34 -4 -37 Q 22 -39 34 -6 Q 24 -22 6 -20 Q -14 -18 -22 -13 Q -28 -11 -34 -4 Z" fill="url(#g-hair)"/>
            <path d="M -3 -37 Q -1 -53 14 -49 Q 5 -47 7 -37 Z" fill="url(#g-hair)"/>
            <path d="M -14 -30 Q -4 -35 6 -31" stroke="#fff" stroke-opacity="0.3" stroke-width="2.2" stroke-linecap="round" fill="none"/>
            <path d="M -37 4 Q -39 -48 0 -47 Q 39 -48 37 4" fill="none" stroke="#242424" stroke-width="5" stroke-linecap="round"/>
            <ellipse cx="-37" cy="5" rx="8.5" ry="12.5" fill="url(#g-cup)" stroke="#111" stroke-width="2.4"/>
            <ellipse cx="37" cy="5" rx="8.5" ry="12.5" fill="url(#g-cup)" stroke="#111" stroke-width="2.4"/>
            <ellipse cx="-39" cy="2" rx="2.4" ry="4.6" fill="#fff" opacity="0.5"/><ellipse cx="35" cy="2" rx="2.4" ry="4.6" fill="#fff" opacity="0.5"/>
            <ellipse cx="-21" cy="15" rx="6.4" ry="4" fill="#e0715c" opacity="0.32"/><ellipse cx="21" cy="15" rx="6.4" ry="4" fill="#e0715c" opacity="0.32"/>
            <!-- gözler -->
            <g id="k-eyeL" transform="translate(-12.5 3)">
              <ellipse rx="8.4" ry="10" fill="#fff"/>
              <g id="k-irisL"><circle r="6.4" fill="url(#g-iris)"/><circle r="3.2" fill="#0d0603"/><circle cx="-2.2" cy="-3" r="2.2" fill="#fff"/><circle cx="2.6" cy="2.6" r="1" fill="#fff" opacity="0.9"/></g>
              <path d="M -8.6 -4 Q 0 -13 8.6 -4" stroke="#111" stroke-width="2.4" fill="none" stroke-linecap="round"/>
            </g>
            <g id="k-eyeR" transform="translate(12.5 3)">
              <ellipse rx="8.4" ry="10" fill="#fff"/>
              <g id="k-irisR"><circle r="6.4" fill="url(#g-iris)"/><circle r="3.2" fill="#0d0603"/><circle cx="-2.2" cy="-3" r="2.2" fill="#fff"/><circle cx="2.6" cy="2.6" r="1" fill="#fff" opacity="0.9"/></g>
              <path d="M -8.6 -4 Q 0 -13 8.6 -4" stroke="#111" stroke-width="2.4" fill="none" stroke-linecap="round"/>
            </g>
            <g id="k-browL"><path d="M -20 -11 Q -12 -17 -5 -12" stroke="#111" stroke-width="3" fill="none" stroke-linecap="round"/></g>
            <g id="k-browR"><path d="M 5 -12 Q 12 -17 20 -11" stroke="#111" stroke-width="3" fill="none" stroke-linecap="round"/></g>
            <path d="M -3 14 Q 0 18 3 14" stroke="#b8704c" stroke-width="2.2" fill="none" stroke-linecap="round"/>
            <ellipse cx="-1" cy="12" rx="2.2" ry="1.4" fill="#fff" opacity="0.45"/>
            <!-- ağız -->
            <path id="m-smile" d="M -9 21 Q 0 29 9 21" stroke="#2a0f0f" stroke-width="2.7" fill="none" stroke-linecap="round"/>
            <g id="m-grin" style="display:none">
              <path d="M -11 19 Q 0 39 11 19 Z" fill="#2a0f0f"/>
              <path d="M -9.6 19.8 Q 0 24.6 9.6 19.8 Q 0 21.6 -9.6 19.8 Z" fill="#fff"/>
              <ellipse cx="0" cy="30" rx="5.2" ry="3" fill="#f08a7c"/>
            </g>
            <ellipse id="m-o" cx="0" cy="25" rx="4.4" ry="5.6" fill="#2a0f0f" style="display:none"/>
          </g></g>
        </g>
      </g>
    </svg>
  </button>
  <div id="kbub"><div id="kbub-in"></div></div>
</div>


  </div>
</section>
</main>

<footer class="ftr">
  <div class="wrap ftr-in">
    <a class="logo" href="/" aria-label="HITY7 ana sayfa">HITY7<i></i></a>
    <nav aria-label="Alt menü"><a href="${ROUTES.smm}">SMM Panel</a><a href="${ROUTES.influencer}">Influencer Marketing</a><a href="${ROUTES.remake}">Remake Beat</a><a href="${ROUTES.yayin}">Dijital Yayın</a></nav>
    <small>HITY7 © 2026 · Müziğin Geleceğini Şekillendir.</small>
  </div>
</footer>
`;

export default function HomePage() {
  const rootRef = useRef(null);
  const router = useRouter();

  useEffect(() => {
    const root = rootRef.current;
    if (!root) return;

    /* Sayfa içi yönlendirmeler tam yenileme yapmasın */
    const onLinkClick = (e) => {
      const a = e.target && e.target.closest ? e.target.closest("a") : null;
      if (!a || e.metaKey || e.ctrlKey || e.shiftKey || e.altKey || e.button !== 0) return;
      const href = a.getAttribute("href") || "";
      if (a.getAttribute("data-scroll")) {
        e.preventDefault();
        const el = root.querySelector(href);
        if (el) el.scrollIntoView({ behavior: "smooth", block: "start" });
        return;
      }
      if (href.startsWith("/")) {
        e.preventDefault();
        router.push(href);
      }
    };
    root.addEventListener("click", onLinkClick);

    const stop = (function () {

      var dead = false, offs = [];
        function on(t, e, f, o) { t.addEventListener(e, f, o); offs.push(function () { t.removeEventListener(e, f, o); }); }
        var $ = function (id) { return root.querySelector('#' + id); };
        var reduced = window.matchMedia('(prefers-reduced-motion: reduce)').matches;
        var N = 6, HH = 71;
        var stages = [].slice.call(root.querySelectorAll('.rec-stage')).sort(function (a, b) { return +a.getAttribute('data-rec') - +b.getAttribute('data-rec'); });
        var recs = stages.map(function (s) { return { stage: s, disc: s.querySelector('.disc'), ang: Math.random() * 360, kick: 0 }; });
        var pps = [].slice.call(root.querySelectorAll('.pp')).sort(function (a, b) { return +a.getAttribute('data-i') - +b.getAttribute('data-i'); });
        var says = pps.map(function (p) { var d = p.getAttribute('data-say'); return d ? d.split('|') : null; });
        var dots = [].slice.call($('prog').children);
        var pin = $('pin'), world = $('world'), tint = $('tint'), scene = $('scene'), hint = $('hint');
        var helloLines = ['Hehe, gıdıklanıyorum!', 'Hop hop! Plak dönüyor.', 'Bir tane daha atlayayım mı?', 'Kulaklığım güzel, değil mi?'];

        /* Dünya yerleşimi: plaklar küçülerek aşağı-zikzak iner; kamera zoom ile sıradakine geçer */
        var R = [1, 0.7, 0.55, 0.42, 0.32, 0.24], WD = [], PX = [], PY = [], Z = [], AX = [], AY = [], SD = [];
        var W = 0, H = 0, seg = 600, mobile = false;
        var BASE = 560;
        function layout() {
          W = pin.clientWidth; H = pin.clientHeight; mobile = W < 900;
          var s0 = mobile ? Math.min(W * 0.7, 300, H * 0.42) : Math.min(W * 0.36, H * 0.7, 480);
          var sr = [1, 0.93, 0.86, 0.8, 0.74, 0.62];
          var x = 0, y = 0;
          for (var i = 0; i < N; i++) {
            WD[i] = BASE * R[i];
            if (i > 0) { x += (i % 2 ? 1 : -1) * 120 * R[i - 1] * 1.2; y += 560 * R[i - 1]; }
            PX[i] = x; PY[i] = y;
            SD[i] = s0 * sr[i]; Z[i] = SD[i] / WD[i];
            var even = (i % 2 === 0);
            AX[i] = mobile ? W * 0.5 : (i === 5 ? W * 0.5 : W * (even ? 0.72 : 0.28));
            AY[i] = mobile ? (i === 5 ? H * 0.5 : H * 0.32) : (i === 5 ? H * 0.74 : H * 0.6);
            var st = stages[i], d = WD[i];
            st.style.setProperty('--d', d + 'px');
            st.style.width = d + 'px'; st.style.height = (d * 0.58) + 'px';
            st.style.left = (PX[i] - d / 2) + 'px'; st.style.top = (PY[i] - d * 0.29) + 'px';
          }
          seg = H * 0.95;
          scene.style.height = (H + 5 * seg + HH * 0) + 'px';
        }
        var ancs = [].slice.call(root.querySelectorAll('.anc'));
        function placeAnchors() { ancs.forEach(function (a) { a.style.top = (+a.getAttribute('data-i') * seg) + 'px'; }); }

        function clamp(v, a, b) { return Math.max(a, Math.min(b, v)); }
        function lerp(a, b, u) { return a + (b - a) * u; }
        function easeIO(u) { return u < 0.5 ? 2 * u * u : 1 - Math.pow(-2 * u + 2, 2) / 2; }
        function smooth(u) { return u * u * (3 - 2 * u); }

        function tTarget() {
          var x = clamp(window.scrollY / seg, 0, 5);
          if (x >= 5) return 5;
          var i = Math.floor(x), f = x - i;
          return i + smooth(clamp((f - 0.3) / 0.5, 0, 1));
        }

        /* kamera */
        var cam = { cx: 0, cy: 0, z: 1, ax: 0, ay: 0 };
        function setCam(t) {
          var i = Math.min(Math.floor(t), 4), u = t - i;
          cam.cx = lerp(PX[i], PX[i + 1], u); cam.cy = lerp(PY[i], PY[i + 1], u);
          cam.z = Z[i] * Math.pow(Z[i + 1] / Z[i], u);
          cam.ax = lerp(AX[i], AX[i + 1], u); cam.ay = lerp(AY[i], AY[i + 1], u);
          world.style.transform = 'translate(' + (cam.ax - cam.cx * cam.z).toFixed(2) + 'px,' + (cam.ay - cam.cy * cam.z).toFixed(2) + 'px) scale(' + cam.z.toFixed(4) + ')';
          var gs = 28 * Math.max(0.8, Math.min(2.6, cam.z * 1.1));
          pin.style.backgroundSize = gs + 'px ' + gs + 'px';
          pin.style.backgroundPosition = (cam.ax - cam.cx * cam.z * 0.3).toFixed(1) + 'px ' + (cam.ay - cam.cy * cam.z * 0.3).toFixed(1) + 'px';
          return i;
        }
        function scr(j) { return { x: cam.ax + (PX[j] - cam.cx) * cam.z, y: cam.ay + (PY[j] - cam.cy) * cam.z, d: WD[j] * cam.z }; }

        /* çocuk */
        var kidBtn = $('kid'), shadow = $('kshadow'), layer = $('kid-layer');
        var rootEl = $('k-root'), bodyEl = $('k-body');
        var legL = $('k-legL'), legR = $('k-legR'), armL = $('k-armL'), armR = $('k-armR'), headEl = $('k-head');
        var eyeL = $('k-eyeL'), eyeR = $('k-eyeR'), irisL = $('k-irisL'), irisR = $('k-irisR'), browL = $('k-browL'), browR = $('k-browR');
        var mSmile = $('m-smile'), mGrin = $('m-grin'), mO = $('m-o');
        var bub = $('kbub'), bubIn = $('kbub-in');
        var Pz = { aL: 8, aR: 8, lL: 2, lR: 2, head: 0, brow: 0 }, mouthKey = '';
        var mx = null, my = null, time = 0, blinkT = 2.4, blinkU = 0, bubText = '';
        var tS = 0, act = -1, flying = false, landT = 9, presT = 0, featIdx = -1, helloT = 0, helloDir = 1, KX = 0, KY = 0;
        on(window, 'pointermove', function (e) { if (e.pointerType === 'touch') { mx = null; return; } var r = pin.getBoundingClientRect(); mx = e.clientX - r.left; my = e.clientY - r.top; }, { passive: true });

        function say(t) { if (t === bubText) { bub.classList.add('show'); return; } bubText = t; bubIn.textContent = t; bub.classList.add('show'); }
        function hush() { bub.classList.remove('show'); bubText = ''; }
        function clearChips() { var on = root.querySelectorAll('.feats li.on'); for (var i = 0; i < on.length; i++) on[i].classList.remove('on'); }
        function chip(i, f) { clearChips(); var p = pps[i]; if (!p) return; var li = p.querySelectorAll('.feats li')[f]; if (li) li.classList.add('on'); }
        var ac = null;
        function blip() { try { var AC = window.AudioContext || window.webkitAudioContext; if (!AC) return; if (!ac) ac = new AC(); var o = ac.createOscillator(), g = ac.createGain(), t0 = ac.currentTime, f = 480 + Math.random() * 240; o.type = 'triangle'; o.frequency.setValueAtTime(f, t0); o.frequency.exponentialRampToValueAtTime(f * 1.8, t0 + 0.1); g.gain.setValueAtTime(0.07, t0); g.gain.exponentialRampToValueAtTime(0.0001, t0 + 0.16); o.connect(g); g.connect(ac.destination); o.start(); o.stop(t0 + 0.18); } catch (e) {} }

        function landFX(i, kk) {
          var r = recs[i]; r.kick = 520;
          r.stage.classList.remove('bump'); void r.stage.offsetWidth; r.stage.classList.add('bump');
          if (reduced || !layer.animate) return;
          var s = kk, ring = document.createElement('div'); ring.className = 'fx';
          ring.style.cssText = 'width:' + (90 * s) + 'px;height:' + (28 * s) + 'px;margin:' + (-14 * s) + 'px 0 0 ' + (-45 * s) + 'px;border:3px solid rgba(17,17,17,.4);border-radius:50%;left:' + KX + 'px;top:' + KY + 'px';
          layer.appendChild(ring);
          ring.animate([{ transform: 'scale(.4)', opacity: 0.9 }, { transform: 'scale(2.1)', opacity: 0 }], { duration: 650, easing: 'ease-out' }).onfinish = function () { ring.remove(); };
          for (var n = 0; n < 7; n++) {
            var sp = document.createElement('div'); sp.className = 'fx'; var sz = 6 + Math.random() * 6;
            sp.style.cssText = 'width:' + sz + 'px;height:' + sz + 'px;margin:' + (-sz / 2) + 'px 0 0 ' + (-sz / 2) + 'px;border-radius:50%;background:' + (n % 2 ? '#f5c518' : '#111') + ';left:' + KX + 'px;top:' + KY + 'px';
            layer.appendChild(sp);
            var ang = (-Math.PI * (0.15 + 0.7 * (n / 6))) + (Math.random() - 0.5) * 0.3, dist = (50 + Math.random() * 50) * s;
            sp.animate([{ transform: 'translate(0,0)', opacity: 1 }, { transform: 'translate(' + Math.cos(ang) * dist + 'px,' + (Math.sin(ang) * dist + 24) + 'px)', opacity: 0 }], { duration: 700 + Math.random() * 250, easing: 'cubic-bezier(.2,.7,.4,1)' }).onfinish = (function (el) { return function () { el.remove(); }; })(sp);
          }
        }

        on(kidBtn, 'click', function () {
          if (flying || helloT > 0) return;
          blip(); clearChips(); hush();
          helloT = 0.55; helloDir = Math.random() < 0.5 ? 1 : -1;
          say(helloLines[Math.floor(Math.random() * helloLines.length)]);
        });

        function setMouth(k) { if (k === mouthKey) return; mouthKey = k; mSmile.style.display = k === 'smile' ? '' : 'none'; mGrin.style.display = k === 'grin' ? '' : 'none'; mO.style.display = k === 'o' ? '' : 'none'; }

        function setActive(i) {
          act = i; presT = 0; featIdx = -1; clearChips();
          for (var q = 0; q < pps.length; q++) pps[q].classList.toggle('on', q === i);
          for (var d = 0; d < dots.length; d++) dots[d].classList.toggle('on', d === i);
          hint.style.opacity = i === 0 ? 1 : 0;
        }

        var last = performance.now();
        function frame(now) {
          if (dead) return; rafId = requestAnimationFrame(frame);
          var dt = Math.min(0.033, (now - last) / 1000); last = now;
          if (document.hidden || dt <= 0) return;
          time += dt;
          var tg0 = tTarget();
          tS = reduced ? tg0 : tS + (tg0 - tS) * (1 - Math.exp(-dt * 9));
          if (Math.abs(tg0 - tS) < 0.0005) tS = tg0;
          var i = setCam(tS), u = tS - i;
          if (tS >= 5) { i = 4; u = 1; }
          tint.style.opacity = clamp(tS - 4, 0, 1).toFixed(3);

          for (var ri = 0; ri < recs.length; ri++) {
            var Rr = recs[ri], spd = reduced ? 0 : (ri === Math.round(tS) ? 90 : 34) + Rr.kick;
            Rr.ang += spd * dt; Rr.kick *= Math.exp(-dt * 2.6);
            Rr.disc.style.transform = 'rotate(' + Rr.ang.toFixed(1) + 'deg)';
          }

          for (var oi = 0; oi < N; oi++) { var od = tS - oi, oo = od > 0 ? 1 - od * 2.2 : 1 + od * 0.9; stages[oi].style.opacity = clamp(oo, 0, 1).toFixed(2); }
          var near = clamp(Math.round(tS), 0, 5);
          if (near !== act) setActive(near);

          var a = scr(i), b = scr(i + 1);
          var uu = clamp(u, 0, 1);
          var x = lerp(a.x, b.x, uu), y = lerp(a.y, b.y, uu), dd = lerp(a.d, b.d, uu);
          var k = clamp(0.3 + dd / 720, 0.48, 0.95);
          var nowFly = uu > 0.012 && uu < 0.988;
          var arc = 0, rot = 0, sx = 1, sy = 1;
          var dir = (b.x - a.x) >= 0 ? 1 : -1;
          if (nowFly) {
            if (!flying) { flying = true; clearChips(); hush(); }
            if (reduced) { arc = 0; }
            else {
              var dist = Math.sqrt(Math.pow(b.x - a.x, 2) + Math.pow(b.y - a.y, 2));
              arc = clamp(dist * 0.3, 90, 240) * 4 * uu * (1 - uu);
              rot = ((i + 1) % 2 === 0 || i === 4) ? dir * 360 * easeIO(clamp((uu - 0.12) / 0.76, 0, 1)) : dir * 8 * Math.sin(Math.PI * uu);
              var st = Math.sin(Math.PI * uu); sy = 1 + 0.14 * st; sx = 1 - 0.07 * st;
              if (uu < 0.12) { sy = 1 - 0.24 * (uu / 0.12); sx = 1 + 0.14 * (uu / 0.12); }
            }
          } else {
            var gi = uu >= 0.988 ? i + 1 : i; if (tS >= 5) gi = 5;
            x = scr(Math.min(gi, 4) === gi ? gi : 4).x; 
            if (gi === 5) { var f5 = scr(4); var ct = { x: AX[5], y: AY[5] }; x = ct.x; y = ct.y; dd = SD[5]; }
            else { var g1 = scr(gi); x = g1.x; y = g1.y; dd = g1.d; }
            k = clamp(0.3 + dd / 720, 0.48, 0.95);
            if (flying) { flying = false; landT = 0; KX = x; KY = y; landFX(gi, k); }
          }
          if (!nowFly && landT < 0.5 && !reduced) { landT += dt; var s2 = Math.exp(-landT * 5) * Math.cos(landT * 9); sy = 1 - 0.25 * s2; sx = 1 + 0.15 * s2; }
          if (helloT > 0) {
            helloT -= dt; var hu = 1 - Math.max(helloT, 0) / 0.55;
            if (!reduced) { arc = 90 * 4 * hu * (1 - hu); rot = helloDir * 360 * easeIO(hu); }
            if (helloT <= 0) { landFX(act, k); }
          }
          KX = x; KY = y;

          /* sunum: balon + özellik vurgusu */
          if (!nowFly && helloT <= 0) {
            presT += dt;
            if (act >= 1 && act <= 4) { var fi = Math.floor(presT / 1.9) % 3; if (fi !== featIdx) { featIdx = fi; chip(act, fi); say(says[act][fi]); } }
            else if (act === 0) { var hi = Math.floor(presT / 3.4) % 3; if (hi !== featIdx) { featIdx = hi; say(says[0][hi]); } }
            else if (featIdx !== 9) { featIdx = 9; say('Hadi başlayalım!'); }
          }

          /* poz */
          var tg = { aL: 8, aR: 8, lL: 2, lR: 2, head: 0, brow: 0, mouth: 'smile' };
          var side = AX[act] > W * 0.5 ? -1 : 1; /* panel hangi tarafta: kayıt sağdaysa panel solda */
          if (nowFly) {
            if (uu < 0.12) { tg.aL = -22; tg.aR = -22; tg.lL = 18; tg.lR = 18; tg.mouth = 'grin'; tg.brow = 1; }
            else if (Math.abs(rot) > 20 && Math.abs(rot) < 340) { tg.aL = 55; tg.aR = 55; tg.lL = 40; tg.lR = 40; tg.mouth = 'o'; tg.brow = -3; }
            else { tg.aL = 150; tg.aR = 150; tg.lL = 26; tg.lR = 12; tg.mouth = 'o'; tg.brow = -3; }
          } else if (landT < 0.3 && !reduced) { tg.aL = 34; tg.aR = 34; tg.lL = 10; tg.lR = 10; tg.mouth = 'grin'; tg.brow = 1; }
          else if (helloT > 0) { tg.aL = 130 + 24 * Math.sin(time * 9); tg.aR = 130 - 24 * Math.sin(time * 9); tg.mouth = 'grin'; }
          else if (act === 0) { tg.aR = 128 + 24 * Math.sin(time * 8); tg.head = 4; tg.mouth = 'grin'; }
          else if (act === 5) { tg.aL = 95 + 60 * Math.sin(time * 6); tg.aR = 95 + 60 * Math.sin(time * 6 + Math.PI); tg.lL = 8 + 12 * Math.sin(time * 6); tg.lR = 8 + 12 * Math.sin(time * 6 + Math.PI); tg.head = 7 * Math.sin(time * 3); tg.mouth = 'grin'; }
          else {
            var pa = 84 + 7 * Math.sin(time * 3.2);
            if (mobile) { tg.aL = 52 + 8 * Math.sin(time * 3); tg.aR = tg.aL; }
            else if (side === 1) { tg.aR = pa; tg.aL = 10; } else { tg.aL = pa; tg.aR = 10; }
            tg.head = mobile ? 0 : 5 * side; tg.mouth = 'grin';
          }
          var kk2 = reduced ? 1 : 1 - Math.exp(-dt * (nowFly ? 22 : 12));
          Pz.aL += (tg.aL - Pz.aL) * kk2; Pz.aR += (tg.aR - Pz.aR) * kk2; Pz.lL += (tg.lL - Pz.lL) * kk2; Pz.lR += (tg.lR - Pz.lR) * kk2; Pz.head += (tg.head - Pz.head) * kk2; Pz.brow += (tg.brow - Pz.brow) * kk2;
          armL.setAttribute('transform', 'rotate(' + Pz.aL.toFixed(1) + ')'); armR.setAttribute('transform', 'rotate(' + (-Pz.aR).toFixed(1) + ')');
          legL.setAttribute('transform', 'rotate(' + Pz.lL.toFixed(1) + ')'); legR.setAttribute('transform', 'rotate(' + (-Pz.lR).toFixed(1) + ')');
          headEl.setAttribute('transform', 'rotate(' + Pz.head.toFixed(1) + ' 0 32)');
          browL.setAttribute('transform', 'translate(0 ' + (-Pz.brow * 1.6).toFixed(2) + ')'); browR.setAttribute('transform', 'translate(0 ' + (-Pz.brow * 1.6).toFixed(2) + ')');
          setMouth(tg.mouth);

          var lx, ly, ex = x, ey = y - arc - 150 * k;
          if (mx !== null) { lx = clamp((mx - ex) / 260, -1, 1) * 2.6; ly = clamp((my - ey) / 260, -1, 1) * 2; } else { lx = (AX[act] > W * 0.5 ? -1 : 1) * 2.2; ly = 0.6; }
          var pt = 'translate(' + lx.toFixed(2) + ' ' + ly.toFixed(2) + ')'; irisL.setAttribute('transform', pt); irisR.setAttribute('transform', pt);
          blinkT -= dt; if (blinkT < 0) { blinkU = 0.13; blinkT = 2.6 + Math.random() * 2.8; }
          var bl = 1; if (blinkU > 0) { blinkU -= dt; bl = 0.1; }
          eyeL.setAttribute('transform', 'translate(-12.5 3) scale(1 ' + bl + ')'); eyeR.setAttribute('transform', 'translate(12.5 3) scale(1 ' + bl + ')');
          var bob = (!reduced && !nowFly) ? Math.sin(time * 2.4) * 1.6 : 0;
          if (!reduced && !nowFly && act === 5) bob = -Math.abs(Math.sin(time * 6)) * 6;
          bodyEl.setAttribute('transform', 'translate(0 ' + bob.toFixed(2) + ')');
          rootEl.setAttribute('transform', 'translate(0 -90) rotate(' + rot.toFixed(1) + ') translate(0 90) scale(' + sx.toFixed(3) + ' ' + sy.toFixed(3) + ')');
          kidBtn.style.transform = 'translate(' + (x - 70).toFixed(1) + 'px,' + (y - arc - 215).toFixed(1) + 'px) scale(' + k.toFixed(3) + ')';
          var sw = 96 * k, shh = 28 * k, shs = 1 - Math.min(arc / 420, 0.45);
          shadow.style.transform = 'translate(' + (x - sw / 2).toFixed(1) + 'px,' + (y - shh / 2 + 3).toFixed(1) + 'px) scale(' + shs.toFixed(3) + ')';
          shadow.style.width = sw + 'px'; shadow.style.height = shh + 'px'; shadow.style.opacity = (1 - Math.min(arc / 300, 0.6)).toFixed(2);
          var bw = bubIn.offsetWidth, bh = bubIn.offsetHeight;
          var bx = clamp(x - bw / 2, 8, Math.max(8, W - bw - 8)), by = Math.max(6, y - arc - 215 * k - bh - 8);
          bubIn.style.setProperty('--tx', clamp(x - bx, 18, Math.max(18, bw - 18)).toFixed(0) + 'px');
          bub.style.transform = 'translate(' + bx.toFixed(1) + 'px,' + by.toFixed(1) + 'px)';
        }

        var rafId = 0;
        function init() { layout(); placeAnchors(); tS = tTarget(); setActive(clamp(Math.round(tS), 0, 5)); rafId = requestAnimationFrame(function (n) { last = n; frame(n); }); }
        on(window, 'resize', function () { layout(); placeAnchors(); });
        init();
        return function () { dead = true; cancelAnimationFrame(rafId); offs.forEach(function (f) { f(); }); };
    })();

    return () => {
      root.removeEventListener("click", onLinkClick);
      if (typeof stop === "function") stop();
    };
  }, [router]);

  return (
    <>
      <link rel="preconnect" href="https://fonts.googleapis.com" />
      <link rel="preconnect" href="https://fonts.gstatic.com" crossOrigin="" />
      <link
        href="https://fonts.googleapis.com/css2?family=Bricolage+Grotesque:opsz,wght@12..96,700;12..96,800&family=Inter:wght@400;500;600&display=swap"
        rel="stylesheet"
      />
      <style dangerouslySetInnerHTML={{ __html: CSS }} />
      <div className="h7" ref={rootRef} dangerouslySetInnerHTML={{ __html: HTML }} />
    </>
  );
}
