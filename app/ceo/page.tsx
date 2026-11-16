"use client";

import { useCallback, useEffect, useMemo, useRef, useState } from "react";
import type { Session } from "@supabase/supabase-js";
import Link from "next/link";
import { getSupabase } from "../../lib/supabase";
import {
  CART_SERVICES,
  DEFAULT_CONTENT,
  mergeContent,
  type AddonItem,
  type CartService,
  type ProducerItem,
  type ServiceItem,
  type SiteContent,
  type UpsellContent,
  type UpsellOffer,
} from "../../lib/site-content";
import {
  Patron,
  OrdersTab,
  WalletTab,
  InfluencersTab,
  SamplesSection,
  SmmTab,
  PaymentsTab,
  SupportTab,
  RolesPanel,
  type PermMap,
} from "./extra";
import { AuditTab, CeoDashboard, ReleasesTab, rpcCall } from "./ceo-extra";
import {
  DepolamaDurumu,
  ErisimMatrisi,
  FinansTab,
  PaketlerTab,
  SiteMetinleri,
  SiteYayinda,
  TeslimatlarTab,
  UyeYetkileri,
} from "./ceo-ek";
import { ONIZLEME_ANAHTARI } from "../../lib/use-site-content";
import { ERISIM_GRUPLARI, HIZMETLER, type ErisimGrubu, type HizmetId } from "../../lib/erisim";
import { LEGAL_DOCS, type LegalSlug } from "../../lib/yasal-belgeler";
import { LEGAL_TEMPLATES } from "../../lib/yasal-metinler";

/* ================================================================== */
/*  TİPLER                                                             */
/* ================================================================== */

type Stage = "loading" | "setup" | "gate" | "denied" | "intro" | "panel";
type TabId =
  | "ceo"
  | "overview"
  | "traffic"
  | "orders"
  | "deliveries"
  | "releases"
  | "audit"
  | "packages"
  | "finance"
  | "support"
  | "wallet"
  | "payments"
  | "influencers"
  | "smm"
  | "services"
  | "producers"
  | "content"
  | "members"
  | "ai"
  | "settings";

type RoleId = "ceo" | "admin" | "mod" | "amele" | "member";
const ROLE_LABEL: Record<RoleId, string> = { ceo: "CEO (patron)", admin: "Admin", mod: "Moderatör", amele: "Personel", member: "Kullanıcı" };
/**
 * Bu bölümleri yalnızca CEO görür (CEO Merkezi, finans / brüt kâr, influencer paketleri). İşlem kayıtları CEO ve admin'e açıktır.
 * Arayüzdeki bu liste tek koruma değildir: ilgili tablolar ve fonksiyonlar veritabanında da yalnızca CEO'ya açıktır.
 */
const CEO_ONLY: string[] = ["ceo", "finance", "packages"];
const ADMIN_ONLY: string[] = ["audit"];
const USER_DOMAIN = "panel.hity7.net";
/** Kullanıcı adını (ahmtfrknbyr) Supabase'in istediği e-posta biçimine çevirir. */
const toLoginEmail = (v: string) => {
  const t = v.trim().toLowerCase();
  return t.includes("@") ? t : `${t.replace(/[^a-z0-9._-]/g, "")}@${USER_DOMAIN}`;
};

type Profile = {
  id: string;
  email: string | null;
  username?: string | null;
  full_name: string | null;
  account_type: string | null;
  role: RoleId;
  panel_request?: boolean;
  banned: boolean;
  created_at: string;
};

type View = {
  path: string;
  referrer: string | null;
  device: string | null;
  browser: string | null;
  country: string | null;
  session_id: string | null;
  created_at: string;
};

type Order = {
  id: number;
  customer_name: string | null;
  service: string;
  title: string | null;
  amount: number | null;
  status: string;
  created_at: string;
};

type Proposal = { id: string; name: string; input: Record<string, unknown> };
type ChatMsg = {
  role: "user" | "assistant";
  content: string;
  proposals?: Proposal[];
  done?: Record<string, "applied" | "skipped">;
  error?: boolean;
};

const TABS: { id: TabId; label: string; icon: string }[] = [
  { id: "ceo", label: "CEO Merkezi", icon: "♛" },
  { id: "overview", label: "Genel Bakış", icon: "⌂" },
  { id: "traffic", label: "Trafik", icon: "↗" },
  { id: "orders", label: "Siparişler", icon: "▤" },
  { id: "deliveries", label: "Teslimatlar", icon: "⇩" },
  { id: "releases", label: "Dijital Yayınlar", icon: "◎" },
  { id: "support", label: "Destek Mesajları", icon: "✉" },
  { id: "wallet", label: "Cüzdan & Bakiye", icon: "₺" },
  { id: "finance", label: "Finans · Brüt Kâr", icon: "◷" },
  { id: "payments", label: "Ödeme Yöntemleri", icon: "▣" },
  { id: "influencers", label: "Influencerlar", icon: "★" },
  { id: "packages", label: "Influencer Paketleri", icon: "▦" },
  { id: "smm", label: "SMM Sağlayıcıları", icon: "⇄" },
  { id: "services", label: "Hizmetler & Fiyatlar", icon: "◈" },
  { id: "producers", label: "Prodüktörler", icon: "◉" },
  { id: "content", label: "Site Yazıları", icon: "✎" },
  { id: "members", label: "Üyeler", icon: "☺" },
  { id: "ai", label: "AI Asistan", icon: "✦" },
  { id: "audit", label: "İşlem Kayıtları", icon: "⛨" },
  { id: "settings", label: "Ayarlar", icon: "⚙" },
];

/** Veritabanı henüz kurulmadıysa kullanılacak varsayılan yetkiler. */
const DEFAULT_PERMS: PermMap = {
  mod: ["overview", "traffic", "orders", "support", "influencers", "smm", "services", "producers", "content", "members", "ai"],
  amele: ["orders", "support", "services", "producers"],
};



/* ================================================================== */
/*  TRAFİK HESAPLARI                                                   */
/* ================================================================== */

const dayKey = (d: Date) =>
  `${d.getFullYear()}-${String(d.getMonth() + 1).padStart(2, "0")}-${String(d.getDate()).padStart(2, "0")}`;

function countBy<T>(items: T[], pick: (item: T) => string, limit = 8): [string, number][] {
  const map = new Map<string, number>();
  for (const item of items) {
    const key = pick(item);
    map.set(key, (map.get(key) || 0) + 1);
  }
  return Array.from(map.entries())
    .sort((a, b) => b[1] - a[1])
    .slice(0, limit);
}

function summarize(views: View[], days: number) {
  const now = new Date();
  const startMs = new Date(now.getFullYear(), now.getMonth(), now.getDate() - (days - 1)).getTime();
  const prevStartMs = startMs - days * 86400000;

  const current = views.filter((v) => new Date(v.created_at).getTime() >= startMs);
  const previous = views.filter((v) => {
    const t = new Date(v.created_at).getTime();
    return t >= prevStartMs && t < startMs;
  });

  const buckets = Array.from({ length: days }, (_, i) => {
    const d = new Date(startMs + i * 86400000);
    return {
      key: dayKey(d),
      label: d.toLocaleDateString("tr-TR", { day: "2-digit", month: "short" }),
      views: 0,
      sessions: new Set<string>(),
    };
  });
  const index = new Map(buckets.map((b, i) => [b.key, i]));

  const allSessions = new Set<string>();
  current.forEach((v, i) => {
    const sid = v.session_id || `anon-${i}`;
    allSessions.add(sid);
    const bi = index.get(dayKey(new Date(v.created_at)));
    if (bi !== undefined) {
      buckets[bi].views += 1;
      buckets[bi].sessions.add(sid);
    }
  });

  const prevSessions = new Set(previous.map((v, i) => v.session_id || `p-${i}`));
  const fiveMin = Date.now() - 5 * 60000;
  const live = new Set(
    views.filter((v) => new Date(v.created_at).getTime() >= fiveMin).map((v, i) => v.session_id || `l-${i}`)
  );

  const region = (() => {
    try {
      return new Intl.DisplayNames(["tr"], { type: "region" });
    } catch {
      return null;
    }
  })();

  return {
    days: buckets.map((b) => ({ key: b.key, label: b.label, views: b.views, visitors: b.sessions.size })),
    totalViews: current.length,
    totalVisitors: allSessions.size,
    prevViews: previous.length,
    prevVisitors: prevSessions.size,
    live: live.size,
    today: buckets[buckets.length - 1]?.views || 0,
    pagesPerVisit: allSessions.size ? current.length / allSessions.size : 0,
    topPages: countBy(current, (v) => v.path),
    sources: countBy(current, (v) => v.referrer || "Doğrudan"),
    devices: countBy(current, (v) => v.device || "Bilinmiyor"),
    browsers: countBy(current, (v) => v.browser || "Bilinmiyor"),
    countries: countBy(current, (v) => {
      const c = (v.country || "").toUpperCase();
      if (!c) return "Bilinmiyor";
      try {
        return region?.of(c) || c;
      } catch {
        return c;
      }
    }),
  };
}

type TrafficSummary = ReturnType<typeof summarize>;

const delta = (cur: number, prev: number) => {
  if (!prev) return cur ? "yeni" : "—";
  const p = Math.round(((cur - prev) / prev) * 100);
  return `${p > 0 ? "+" : ""}${p}%`;
};

/* ================================================================== */
/*  AI ÖNERİ DOĞRULAMA / UYGULAMA                                      */
/* ================================================================== */

const GENERAL_FIELDS = Object.keys(DEFAULT_CONTENT.general) as (keyof SiteContent["general"])[];
const HOME_FIELDS = Object.keys(DEFAULT_CONTENT.home) as (keyof SiteContent["home"])[];
const SERVICE_FIELDS = ["name", "desc", "price", "href", "active"];
const PRODUCER_FIELDS = ["name", "role", "desc", "mixPrice", "stemsPrice", "active"];

function describeProposal(p: Proposal, content: SiteContent): string {
  const i = p.input as Record<string, unknown>;
  const val = typeof i.value === "string" ? `“${i.value}”` : String(i.value);
  if (p.name === "update_content") return `${i.section === "home" ? "Ana sayfa" : "Genel ayar"} · ${i.field} → ${val}`;
  if (p.name === "update_service") {
    const s = content.services.find((x) => x.id === i.id);
    return `Hizmet “${s?.name || i.id}” · ${i.field} → ${val}`;
  }
  if (p.name === "update_producer") {
    const s = content.producers.find((x) => x.id === i.id);
    return `Prodüktör “${s?.name || i.id}” · ${i.field} → ${val}`;
  }
  if (p.name === "update_access") {
    const h = HIZMETLER.find((x) => x.id === i.service);
    const nere = i.field === "active" ? "aktif" : `${i.field === "visible" ? "görünürlük" : "sipariş izni"} (${i.group})`;
    return `Hizmet erişimi “${h?.ad || i.service}” · ${nere} → ${i.value === true ? "açık" : "kapalı"}`;
  }
  return p.name;
}

/** Öneriyi doğrular ve yeni içerik döndürür. Geçersizse null. */
function applyProposal(content: SiteContent, p: Proposal): { next: SiteContent; keys: string[] } | null {
  const i = p.input as Record<string, unknown>;
  const next: SiteContent = JSON.parse(JSON.stringify(content));

  if (p.name === "update_content") {
    const section = i.section;
    const field = String(i.field);
    if (section === "general" && (GENERAL_FIELDS as string[]).includes(field)) {
      const current = (next.general as Record<string, unknown>)[field];
      if (typeof current !== typeof i.value) return null;
      (next.general as Record<string, unknown>)[field] = i.value;
      return { next, keys: ["general"] };
    }
    if (section === "home" && (HOME_FIELDS as string[]).includes(field)) {
      if (typeof i.value !== "string") return null;
      (next.home as Record<string, unknown>)[field] = i.value;
      return { next, keys: ["home"] };
    }
    return null;
  }

  if (p.name === "update_service") {
    const item = next.services.find((s) => s.id === i.id);
    const field = String(i.field);
    if (!item || !SERVICE_FIELDS.includes(field)) return null;
    if (field === "active" ? typeof i.value !== "boolean" : typeof i.value !== "string") return null;
    (item as Record<string, unknown>)[field] = i.value;
    return { next, keys: ["services"] };
  }

  if (p.name === "update_access") {
    const s = HIZMETLER.some((h) => h.id === i.service) ? next.erisim.services[i.service as HizmetId] : null;
    if (!s || typeof i.value !== "boolean") return null;
    if (i.field === "active") {
      s.active = i.value;
    } else if (i.field === "visible" && (ERISIM_GRUPLARI as string[]).includes(String(i.group))) {
      s.visible[i.group as ErisimGrubu] = i.value;
    } else if (i.field === "orderable" && ["member", "mod", "ceo"].includes(String(i.group))) {
      s.orderable[i.group as "member" | "mod" | "ceo"] = i.value;
    } else {
      return null;
    }
    return { next, keys: ["erisim"] };
  }

  if (p.name === "update_producer") {
    const item = next.producers.find((s) => s.id === i.id);
    const field = String(i.field);
    if (!item || !PRODUCER_FIELDS.includes(field)) return null;
    if (field === "mixPrice" || field === "stemsPrice") {
      const n = Number(i.value);
      if (!Number.isFinite(n) || n < 0) return null;
      (item as Record<string, unknown>)[field] = Math.round(n);
    } else if (field === "active") {
      if (typeof i.value !== "boolean") return null;
      item.active = i.value;
    } else {
      if (typeof i.value !== "string") return null;
      (item as Record<string, unknown>)[field] = i.value;
    }
    return { next, keys: ["producers"] };
  }

  return null;
}

/**
 * HITY7 çocuğu: Pixar tarzı mascot.
 * - Gözleri fareyi takip eder, göz kırpar, el sallar.
 * - Şifre alanına odaklanınca gözlerini kapatır (şifre gösteriliyorsa kapatmaz).
 * - Tıklayınca zıplayıp takla atar.
 * Form mantığına dokunmaz; sadece sayfadaki input odak olaylarını dinler.
 */
function KidMascot() {
  const ref = useRef<SVGSVGElement>(null);

  useEffect(() => {
    const svg = ref.current;
    if (!svg) return;
    const q = (id: string) => svg.querySelector<SVGGElement>("#" + id)!;
    const rootEl = q("k-root"), bodyEl = q("k-body");
    const legL = q("k-legL"), legR = q("k-legR"), armL = q("k-armL"), armR = q("k-armR"), headEl = q("k-head");
    const eyeL = q("k-eyeL"), eyeR = q("k-eyeR"), irisL = q("k-irisL"), irisR = q("k-irisR");
    const browL = q("k-browL"), browR = q("k-browR");
    const mSmile = q("m-smile"), mGrin = q("m-grin"), mO = q("m-o");

    const reduced = window.matchMedia("(prefers-reduced-motion: reduce)").matches;
    const clamp = (v: number, a: number, b: number) => Math.max(a, Math.min(b, v));
    const easeIO = (u: number) => (u < 0.5 ? 2 * u * u : 1 - Math.pow(-2 * u + 2, 2) / 2);

    const P = { aL: 8, aR: 8, head: 0, brow: 0 };
    let cover = false;
    let mx: number | null = null, my = 0;
    let time = 0, blinkT = 2.2, blinkU = 0, hop = 0, hopDir = 1;
    let mouth = "";
    let raf = 0, last = performance.now();

    const setMouth = (k: string) => {
      if (k === mouth) return;
      mouth = k;
      mSmile.style.display = k === "smile" ? "" : "none";
      mGrin.style.display = k === "grin" ? "" : "none";
      mO.style.display = k === "o" ? "" : "none";
    };

    const isPw = (t: EventTarget | null) =>
      t instanceof HTMLInputElement && t.type === "password";
    const onFocusIn = (e: FocusEvent) => { cover = isPw(e.target); };
    const onFocusOut = () => { cover = false; };
    const onMove = (e: PointerEvent) => {
      if (e.pointerType === "touch") { mx = null; return; }
      mx = e.clientX; my = e.clientY;
    };
    const onClick = () => { if (hop <= 0) { hop = 0.6; hopDir = Math.random() < 0.5 ? 1 : -1; } };

    document.addEventListener("focusin", onFocusIn);
    document.addEventListener("focusout", onFocusOut);
    window.addEventListener("pointermove", onMove, { passive: true });
    svg.addEventListener("click", onClick);
    cover = isPw(document.activeElement);

    const frame = (now: number) => {
      raf = requestAnimationFrame(frame);
      const dt = Math.min(0.033, (now - last) / 1000);
      last = now;
      if (document.hidden || dt <= 0) return;
      time += dt;

      let aL = 8, aR = 8, head = 0, brow = 0, m = "smile", arc = 0, rot = 0;
      if (hop > 0) {
        hop -= dt;
        const u = 1 - Math.max(hop, 0) / 0.6;
        arc = 70 * 4 * u * (1 - u);
        rot = reduced ? 0 : hopDir * 360 * easeIO(u);
        aL = 140; aR = 140; m = "o"; brow = -3;
      } else if (cover) {
        aL = -164; aR = -164; head = 3; m = "smile"; brow = 1;
      } else {
        aR = reduced ? 125 : 125 + 24 * Math.sin(time * 8);
        head = 4; m = "grin";
      }
      const k = reduced ? 1 : 1 - Math.exp(-dt * 12);
      P.aL += (aL - P.aL) * k; P.aR += (aR - P.aR) * k;
      P.head += (head - P.head) * k; P.brow += (brow - P.brow) * k;
      armL.setAttribute("transform", "rotate(" + P.aL.toFixed(1) + ")");
      armR.setAttribute("transform", "rotate(" + (-P.aR).toFixed(1) + ")");
      legL.setAttribute("transform", "rotate(2)");
      legR.setAttribute("transform", "rotate(-2)");
      headEl.setAttribute("transform", "rotate(" + P.head.toFixed(1) + " 0 32)");
      browL.setAttribute("transform", "translate(0 " + (-P.brow * 1.6).toFixed(2) + ")");
      browR.setAttribute("transform", "translate(0 " + (-P.brow * 1.6).toFixed(2) + ")");
      setMouth(m);

      let lx = 0.6, ly = 0.6;
      if (cover) { lx = 0; ly = 1.2; }
      else if (mx !== null) {
        const r = svg.getBoundingClientRect();
        const cx = r.left + r.width / 2, cy = r.top + r.height * 0.35;
        lx = clamp((mx - cx) / 260, -1, 1) * 2.6;
        ly = clamp((my - cy) / 260, -1, 1) * 2;
      }
      const pt = "translate(" + lx.toFixed(2) + " " + ly.toFixed(2) + ")";
      irisL.setAttribute("transform", pt); irisR.setAttribute("transform", pt);

      blinkT -= dt;
      if (blinkT < 0) { blinkU = 0.13; blinkT = 2.6 + Math.random() * 2.8; }
      let bl = 1;
      if (blinkU > 0) { blinkU -= dt; bl = 0.1; }
      eyeL.setAttribute("transform", "translate(-12.5 3) scale(1 " + bl + ")");
      eyeR.setAttribute("transform", "translate(12.5 3) scale(1 " + bl + ")");

      const bob = reduced ? 0 : Math.sin(time * 2.4) * 1.6;
      bodyEl.setAttribute("transform", "translate(0 " + (bob - arc).toFixed(2) + ")");
      rootEl.setAttribute("transform", "translate(0 -90) rotate(" + rot.toFixed(1) + ") translate(0 90)");
    };
    raf = requestAnimationFrame(frame);

    return () => {
      cancelAnimationFrame(raf);
      document.removeEventListener("focusin", onFocusIn);
      document.removeEventListener("focusout", onFocusOut);
      window.removeEventListener("pointermove", onMove);
      svg.removeEventListener("click", onClick);
    };
  }, []);

  return (
    <>
      <svg ref={ref} className="kid-svg" viewBox="-90 -215 180 245" aria-hidden="true" focusable="false">
      <defs>
        <radialGradient id="g-skin" cx="0.38" cy="0.3" r="0.8"><stop offset="0" stopColor="#f7d2af"/><stop offset="0.55" stopColor="#e9af86"/><stop offset="1" stopColor="#c98760"/></radialGradient>
        <linearGradient id="g-hood" x1="0" y1="0" x2="1" y2="1"><stop offset="0" stopColor="#ffe269"/><stop offset="0.5" stopColor="#f5c518"/><stop offset="1" stopColor="#dda500"/></linearGradient>
        <linearGradient id="g-pants" x1="0" y1="0" x2="1" y2="1"><stop offset="0" stopColor="#3d3d3d"/><stop offset="1" stopColor="#111"/></linearGradient>
        <radialGradient id="g-shoe" cx="0.4" cy="0.3" r="0.9"><stop offset="0" stopColor="#fff"/><stop offset="1" stopColor="#d6d6d6"/></radialGradient>
        <linearGradient id="g-hair" x1="0" y1="0" x2="1" y2="1"><stop offset="0" stopColor="#34302e"/><stop offset="1" stopColor="#0c0b0b"/></linearGradient>
        <radialGradient id="g-iris" cx="0.4" cy="0.35" r="0.8"><stop offset="0" stopColor="#8a5a35"/><stop offset="1" stopColor="#2b1708"/></radialGradient>
        <linearGradient id="g-cup" x1="0" y1="0" x2="1" y2="1"><stop offset="0" stopColor="#ffe269"/><stop offset="1" stopColor="#e5b600"/></linearGradient>
      </defs>
      <ellipse cx="0" cy="9" rx="72" ry="20" fill="#000" opacity="0.22"/>
      <ellipse cx="0" cy="4" rx="70" ry="19" fill="#111"/>
      <ellipse cx="0" cy="4" rx="58" ry="15" fill="none" stroke="#2c2c2c" strokeWidth="1.5"/>
      <ellipse cx="0" cy="4" rx="46" ry="12" fill="none" stroke="#2c2c2c" strokeWidth="1.5"/>
      <ellipse cx="0" cy="4" rx="22" ry="6" fill="#f5c518"/>
      <ellipse cx="0" cy="4" rx="3" ry="1" fill="#111"/>
      <g id="k-root">
        <g id="k-body">
          
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
          
          <path d="M -23 -112 Q -28 -88 -24 -58 Q 0 -50 24 -58 Q 28 -88 23 -112 Q 0 -122 -23 -112 Z" fill="url(#g-hood)"/>
          <path d="M -13 -76 Q 0 -70 13 -76 L 15 -62 Q 0 -57 -15 -62 Z" fill="#a06e00" opacity="0.22"/>
          <ellipse cx="0" cy="-114" rx="12" ry="5.5" fill="#d79f00"/>
          <path d="M -5 -112 L -6 -92 M 5 -112 L 6 -92" stroke="#111" strokeWidth="1.8" strokeLinecap="round" fill="none"/>
          <circle cx="-6" cy="-91" r="1.9" fill="#111"/><circle cx="6" cy="-91" r="1.9" fill="#111"/>
          <text x="0" y="-80" textAnchor="middle" fontFamily="Bricolage Grotesque, Arial, sans-serif" fontWeight="800" fontSize="11" fill="#111">H7</text>
          <ellipse cx="-13" cy="-96" rx="4" ry="14" fill="#fff" opacity="0.28" transform="rotate(8 -13 -96)"/>
          
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
          
          <g transform="translate(0 -148)"><g id="k-head">
            <path d="M -35 -4 Q -42 -40 -8 -44 Q 8 -52 26 -40 Q 42 -28 35 -2 Q 24 -26 0 -24 Q -22 -22 -35 -4 Z" fill="url(#g-hair)"/>
            <circle cx="-33" cy="5" r="7" fill="#d99a72"/><circle cx="33" cy="5" r="7" fill="#d99a72"/>
            <ellipse cx="0" cy="1" rx="34" ry="32" fill="url(#g-skin)"/>
            <ellipse cx="-12" cy="-14" rx="11" ry="6" fill="#fff" opacity="0.22" transform="rotate(-20 -12 -14)"/>
            <path d="M -34 -4 Q -32 -34 -4 -37 Q 22 -39 34 -6 Q 24 -22 6 -20 Q -14 -18 -22 -13 Q -28 -11 -34 -4 Z" fill="url(#g-hair)"/>
            <path d="M -3 -37 Q -1 -53 14 -49 Q 5 -47 7 -37 Z" fill="url(#g-hair)"/>
            <path d="M -14 -30 Q -4 -35 6 -31" stroke="#fff" strokeOpacity="0.3" strokeWidth="2.2" strokeLinecap="round" fill="none"/>
            <path d="M -37 4 Q -39 -48 0 -47 Q 39 -48 37 4" fill="none" stroke="#242424" strokeWidth="5" strokeLinecap="round"/>
            <ellipse cx="-37" cy="5" rx="8.5" ry="12.5" fill="url(#g-cup)" stroke="#111" strokeWidth="2.4"/>
            <ellipse cx="37" cy="5" rx="8.5" ry="12.5" fill="url(#g-cup)" stroke="#111" strokeWidth="2.4"/>
            <ellipse cx="-39" cy="2" rx="2.4" ry="4.6" fill="#fff" opacity="0.5"/><ellipse cx="35" cy="2" rx="2.4" ry="4.6" fill="#fff" opacity="0.5"/>
            <ellipse cx="-21" cy="15" rx="6.4" ry="4" fill="#e0715c" opacity="0.32"/><ellipse cx="21" cy="15" rx="6.4" ry="4" fill="#e0715c" opacity="0.32"/>
            
            <g id="k-eyeL" transform="translate(-12.5 3)">
              <ellipse rx="8.4" ry="10" fill="#fff"/>
              <g id="k-irisL"><circle r="6.4" fill="url(#g-iris)"/><circle r="3.2" fill="#0d0603"/><circle cx="-2.2" cy="-3" r="2.2" fill="#fff"/><circle cx="2.6" cy="2.6" r="1" fill="#fff" opacity="0.9"/></g>
              <path d="M -8.6 -4 Q 0 -13 8.6 -4" stroke="#111" strokeWidth="2.4" fill="none" strokeLinecap="round"/>
            </g>
            <g id="k-eyeR" transform="translate(12.5 3)">
              <ellipse rx="8.4" ry="10" fill="#fff"/>
              <g id="k-irisR"><circle r="6.4" fill="url(#g-iris)"/><circle r="3.2" fill="#0d0603"/><circle cx="-2.2" cy="-3" r="2.2" fill="#fff"/><circle cx="2.6" cy="2.6" r="1" fill="#fff" opacity="0.9"/></g>
              <path d="M -8.6 -4 Q 0 -13 8.6 -4" stroke="#111" strokeWidth="2.4" fill="none" strokeLinecap="round"/>
            </g>
            <g id="k-browL"><path d="M -20 -11 Q -12 -17 -5 -12" stroke="#111" strokeWidth="3" fill="none" strokeLinecap="round"/></g>
            <g id="k-browR"><path d="M 5 -12 Q 12 -17 20 -11" stroke="#111" strokeWidth="3" fill="none" strokeLinecap="round"/></g>
            <path d="M -3 14 Q 0 18 3 14" stroke="#b8704c" strokeWidth="2.2" fill="none" strokeLinecap="round"/>
            <ellipse cx="-1" cy="12" rx="2.2" ry="1.4" fill="#fff" opacity="0.45"/>
            
            <path id="m-smile" d="M -9 21 Q 0 29 9 21" stroke="#2a0f0f" strokeWidth="2.7" fill="none" strokeLinecap="round"/>
            <g id="m-grin" style={{ display: "none" }}>
              <path d="M -11 19 Q 0 39 11 19 Z" fill="#2a0f0f"/>
              <path d="M -9.6 19.8 Q 0 24.6 9.6 19.8 Q 0 21.6 -9.6 19.8 Z" fill="#fff"/>
              <ellipse cx="0" cy="30" rx="5.2" ry="3" fill="#f08a7c"/>
            </g>
            <ellipse id="m-o" cx="0" cy="25" rx="4.4" ry="5.6" fill="#2a0f0f" style={{ display: "none" }}/>
          </g></g>
        </g>
      </g>
    </svg>
    </>
  );
}

/* ================================================================== */
/*  KÜÇÜK ARAYÜZ PARÇALARI                                             */
/* ================================================================== */

const card = "rounded-3xl border-[2.5px] border-[#111] bg-white";
const inputCls =
  "field w-full rounded-2xl border-[2.5px] border-[#111] bg-white px-4 py-3 text-base outline-none transition";
const btnPrimary =
  "rounded-full border-[2.5px] border-[#111] bg-[#f5c518] px-5 py-3 text-sm font-bold text-[#111] shadow-[0_4px_0_#111] transition hover:-translate-y-0.5 hover:bg-[#e5b600] hover:shadow-[0_6px_0_#111] active:translate-y-[2px] active:shadow-[0_1px_0_#111] disabled:cursor-not-allowed disabled:opacity-50 disabled:hover:translate-y-0";
const btnGhost =
  "rounded-full border-[2.5px] border-[#111] bg-white px-4 py-2 text-xs font-bold transition hover:bg-[#f5c518] disabled:opacity-50";

function Title({ eyebrow, title, desc }: { eyebrow: string; title: string; desc?: string }) {
  return (
    <div className="mb-7">
      <p className="mb-3 inline-flex items-center gap-2 rounded-full border-2 border-[#111] bg-white px-3 py-1 text-[11px] font-bold uppercase tracking-[0.14em]">
        {eyebrow}
      </p>
      <h1 className="hd text-[34px] font-extrabold leading-none tracking-[-0.045em] sm:text-5xl">{title}</h1>
      {desc && <p className="mt-3 max-w-2xl text-base text-[#686868]">{desc}</p>}
    </div>
  );
}

function TextField({
  label,
  value,
  onChange,
  multiline = false,
  hint,
  type = "text",
  placeholder,
}: {
  label: string;
  value: string | number;
  onChange: (v: string) => void;
  multiline?: boolean;
  hint?: string;
  type?: string;
  placeholder?: string;
}) {
  return (
    <label className="block">
      <span className="mb-2 block text-sm font-bold">{label}</span>
      {multiline ? (
        <textarea
          className={`${inputCls} resize-y`}
          rows={3}
          value={value}
          placeholder={placeholder}
          onChange={(e) => onChange(e.target.value)}
        />
      ) : (
        <input
          className={inputCls}
          type={type}
          value={value}
          placeholder={placeholder}
          onChange={(e) => onChange(e.target.value)}
        />
      )}
      {hint && <span className="mt-1.5 block text-xs text-[#686868]">{hint}</span>}
    </label>
  );
}

function Toggle({ label, checked, onChange, hint }: { label: string; checked: boolean; onChange: (v: boolean) => void; hint?: string }) {
  return (
    <label className="flex cursor-pointer items-center justify-between gap-4 rounded-2xl border-[2.5px] border-[#111] bg-white p-4">
      <span>
        <span className="block text-sm font-bold">{label}</span>
        {hint && <span className="mt-1 block text-xs text-[#686868]">{hint}</span>}
      </span>
      <span
        className={`relative inline-block h-8 w-14 flex-none rounded-full border-[2.5px] border-[#111] transition ${
          checked ? "bg-[#f5c518]" : "bg-[#f5f5f5]"
        }`}
      >
        <input
          type="checkbox"
          className="peer sr-only"
          checked={checked}
          onChange={(e) => onChange(e.target.checked)}
        />
        <span
          className={`absolute top-0.5 h-5 w-5 rounded-full border-2 border-[#111] bg-white transition-all ${
            checked ? "left-[26px]" : "left-0.5"
          }`}
        />
      </span>
    </label>
  );
}

function SaveBar({ dirty, saving, onSave, onReset }: { dirty: boolean; saving: boolean; onSave: () => void; onReset: () => void }) {
  return (
    <div className="sticky bottom-20 z-20 mt-8 flex items-center justify-between gap-3 rounded-full border-[2.5px] border-[#111] bg-white p-2 pl-5 shadow-[0_5px_0_#111] lg:bottom-6">
      <span className="text-sm font-semibold">{dirty ? "● Kaydedilmemiş değişiklikler var" : "Tüm değişiklikler kayıtlı"}</span>
      <div className="flex gap-2">
        <button type="button" className={btnGhost} disabled={!dirty || saving} onClick={onReset}>
          Geri al
        </button>
        <button type="button" className={btnPrimary + " !py-2.5"} disabled={!dirty || saving} onClick={onSave}>
          {saving ? "Kaydediliyor…" : "Kaydet"}
        </button>
      </div>
    </div>
  );
}

function Stat({ label, value, sub }: { label: string; value: string; sub?: string }) {
  return (
    <div className={`${card} p-5`}>
      <div className="text-sm text-[#686868]">{label}</div>
      <div className="hd mt-3 text-4xl font-extrabold tracking-[-0.04em]">{value}</div>
      {sub && <div className="mt-1 text-xs font-semibold text-[#686868]">{sub}</div>}
    </div>
  );
}

function BarList({ title, items }: { title: string; items: [string, number][] }) {
  const max = Math.max(1, ...items.map((i) => i[1]));
  return (
    <div className={`${card} p-5`}>
      <h3 className="hd mb-4 text-lg font-extrabold">{title}</h3>
      {items.length === 0 ? (
        <p className="text-sm text-[#686868]">Henüz veri yok.</p>
      ) : (
        <ul className="space-y-3">
          {items.map(([label, count]) => (
            <li key={label}>
              <div className="mb-1 flex justify-between gap-3 text-sm">
                <span className="truncate font-semibold">{label}</span>
                <span className="tabular-nums text-[#686868]">{count}</span>
              </div>
              <div className="h-2.5 rounded-full border-2 border-[#111] bg-white">
                <div className="h-full rounded-full bg-[#f5c518]" style={{ width: `${(count / max) * 100}%` }} />
              </div>
            </li>
          ))}
        </ul>
      )}
    </div>
  );
}

function TrafficChart({ data }: { data: TrafficSummary["days"] }) {
  const W = 720;
  const H = 240;
  const pad = { l: 36, r: 12, t: 14, b: 30 };
  const max = Math.max(5, ...data.map((d) => d.views));
  const iw = W - pad.l - pad.r;
  const ih = H - pad.t - pad.b;
  const bw = Math.max(4, (iw / data.length) * 0.62);
  const x = (i: number) => pad.l + (iw / data.length) * (i + 0.5);
  const y = (v: number) => pad.t + ih - (v / max) * ih;
  const line = data.map((d, i) => `${x(i)},${y(d.visitors)}`).join(" ");
  const step = Math.ceil(data.length / 7);
  const ticks = [0, 0.5, 1].map((t) => Math.round(max * t));

  return (
    <svg
      viewBox={`0 0 ${W} ${H}`}
      className="h-auto w-full"
      role="img"
      aria-label={`Günlük görüntüleme ve ziyaretçi grafiği, toplam ${data.reduce((s, d) => s + d.views, 0)} görüntüleme`}
    >
      {ticks.map((t) => (
        <g key={t}>
          <line x1={pad.l} x2={W - pad.r} y1={y(t)} y2={y(t)} stroke="#e6e6e6" strokeWidth="1.5" />
          <text x={pad.l - 8} y={y(t) + 4} textAnchor="end" fontSize="11" fill="#686868">
            {t}
          </text>
        </g>
      ))}
      {data.map((d, i) => (
        <g key={d.key}>
          <rect
            x={x(i) - bw / 2}
            y={y(d.views)}
            width={bw}
            height={Math.max(0, pad.t + ih - y(d.views))}
            rx={Math.min(5, bw / 2)}
            fill="#f5c518"
            stroke="#111"
            strokeWidth="2"
          >
            <title>{`${d.label}: ${d.views} görüntüleme, ${d.visitors} ziyaretçi`}</title>
          </rect>
          {i % step === 0 && (
            <text x={x(i)} y={H - 9} textAnchor="middle" fontSize="11" fill="#686868">
              {d.label}
            </text>
          )}
        </g>
      ))}
      <polyline points={line} fill="none" stroke="#111" strokeWidth="2.5" strokeLinejoin="round" strokeLinecap="round" />
      {data.map((d, i) => (
        <circle key={d.key} cx={x(i)} cy={y(d.visitors)} r="3.5" fill="#fff" stroke="#111" strokeWidth="2" />
      ))}
    </svg>
  );
}

/* ================================================================== */
/*  GİRİŞ ANİMASYONU  (“hoş geldin patron”)                            */
/* ================================================================== */

function Intro({ onDone }: { onDone: () => void }) {
  useEffect(() => {
    const reduced = window.matchMedia("(prefers-reduced-motion: reduce)").matches;
    const timer = setTimeout(onDone, reduced ? 1600 : 5200);
    const key = (e: KeyboardEvent) => {
      if (e.key === "Escape" || e.key === "Enter" || e.key === " ") onDone();
    };
    window.addEventListener("keydown", key);
    return () => {
      clearTimeout(timer);
      window.removeEventListener("keydown", key);
    };
  }, [onDone]);

  return (
    <div className="h7-intro" onClick={onDone} role="dialog" aria-label="Hoş geldin patron">
      <div className="h7-glow" aria-hidden="true" />
      <div className="relative mb-2" aria-hidden="true">
        <Patron width={190} />
      </div>
      <svg viewBox="0 0 1000 250" className="h7-script" aria-hidden="true">
        <text x="500" y="150" textAnchor="middle" className="h7-script-text">
          hoş geldin patron
        </text>
      </svg>
      <p className="h7-sub">HITY7 YÖNETİM PANELİ</p>
      <span className="h7-skip">Geçmek için tıkla</span>
    </div>
  );
}

/* ================================================================== */
/*  GİRİŞ / ÜYE OL EKRANI                                              */
/* ================================================================== */

function Gate({ onAuthed }: { onAuthed: (s: Session) => void }) {
  const sb = getSupabase()!;
  const [mode, setMode] = useState<"login" | "register">("login");
  const [name, setName] = useState("");
  const [email, setEmail] = useState("");
  const [password, setPassword] = useState("");
  const [show, setShow] = useState(false);
  const [busy, setBusy] = useState(false);
  const [error, setError] = useState("");
  const [info, setInfo] = useState("");

  async function submit(e: React.FormEvent) {
    e.preventDefault();
    setError("");
    setInfo("");
    setBusy(true);
    try {
      if (mode === "login") {
        const { data, error: err } = await sb.auth.signInWithPassword({ email: toLoginEmail(email), password });
        if (err || !data.session) {
          setError(err?.message === "Invalid login credentials" ? "Kullanıcı adı veya şifre hatalı." : err?.message || "Giriş yapılamadı.");
        } else {
          onAuthed(data.session);
        }
      } else {
        if (password.length < 8) {
          setError("Şifre en az 8 karakter olmalı.");
        } else if (!email.trim().includes("@") && !/^[a-zA-Z0-9._-]{3,}$/.test(email.trim())) {
          setError("Kullanıcı adı en az 3 karakter olmalı; harf, rakam, nokta, tire ve alt çizgi kullanılabilir.");
        } else {
          const { data, error: err } = await sb.auth.signUp({
            email: toLoginEmail(email),
            password,
            options: { data: { full_name: name.trim(), username: email.trim().toLowerCase(), panel_request: "true" } },
          });
          if (err) setError(err.message.includes("already") ? "Bu kullanıcı adı zaten alınmış." : err.message);
          else if (data.session) onAuthed(data.session);
          else setInfo("Kayıt alındı. Supabase’de “Confirm email” kapalı değilse e-posta doğrulaması gerekir (KURULUM.md).");
        }
      }
    } catch {
      setError("Bağlantı hatası. İnternetini kontrol edip tekrar dene.");
    }
    setBusy(false);
  }

  return (
    <div className="grid min-h-screen place-items-center px-5 py-10">
      <div className="w-full max-w-md">
        <div className="mb-6 flex flex-col items-center">
          <div className="kid-wrap h-[180px] w-[140px]">
            <KidMascot />
          </div>
          <div className="hd mt-2 inline-flex items-baseline gap-[3px] text-3xl font-extrabold leading-none tracking-[-0.05em]">
            HITY7<span className="inline-block h-[9px] w-[9px] rounded-full border-2 border-[#111] bg-[#f5c518]" />
            <span className="ml-3 rounded-full border-2 border-[#111] bg-[#111] px-3 py-1 text-[11px] font-bold tracking-[0.14em] text-[#f5c518]">
              ADMIN
            </span>
          </div>
        </div>

        <form onSubmit={submit} className="rounded-[32px] border-[3px] border-[#111] bg-white p-6 shadow-[0_10px_0_#111] sm:p-8">
          <div className="mb-6 grid grid-cols-2 rounded-full border-[2.5px] border-[#111] p-1" role="tablist">
            {(
              [
                ["login", "Giriş yap"],
                ["register", "Üye ol"],
              ] as const
            ).map(([id, label]) => (
              <button
                key={id}
                type="button"
                role="tab"
                aria-selected={mode === id}
                onClick={() => {
                  setMode(id);
                  setError("");
                  setInfo("");
                }}
                className={`rounded-full py-2.5 text-sm font-bold transition ${
                  mode === id ? "bg-[#111] text-[#f5c518]" : "hover:bg-[#f5f5f5]"
                }`}
              >
                {label}
              </button>
            ))}
          </div>

          <div className="space-y-4">
            {mode === "register" && (
              <TextField label="Ad Soyad" value={name} onChange={setName} placeholder="Adın Soyadın" />
            )}
            <label className="block">
              <span className="mb-2 block text-sm font-bold">Kullanıcı adı</span>
              <input
                className={inputCls}
                type="text"
                required
                autoCapitalize="none"
                autoCorrect="off"
                spellCheck={false}
                autoComplete="username"
                value={email}
                onChange={(e) => setEmail(e.target.value)}
                placeholder="kullanici-adin"
              />
            </label>
            <label className="block">
              <span className="mb-2 block text-sm font-bold">Şifre</span>
              <div className="relative">
                <input
                  className={inputCls + " pr-20"}
                  type={show ? "text" : "password"}
                  required
                  minLength={mode === "register" ? 8 : undefined}
                  autoComplete={mode === "login" ? "current-password" : "new-password"}
                  value={password}
                  onChange={(e) => setPassword(e.target.value)}
                  placeholder="••••••••"
                />
                <button
                  type="button"
                  onClick={() => setShow(!show)}
                  className="absolute right-3 top-1/2 -translate-y-1/2 rounded-full border-2 border-[#111] px-3 py-1 text-xs font-bold hover:bg-[#f5c518]"
                >
                  {show ? "Gizle" : "Göster"}
                </button>
              </div>
            </label>
          </div>

          {error && (
            <p role="alert" className="mt-4 rounded-2xl border-[2.5px] border-[#111] bg-[#fff6cf] p-3 text-sm font-semibold">
              {error}
            </p>
          )}
          {info && (
            <p role="status" className="mt-4 rounded-2xl border-[2.5px] border-[#111] bg-[#fff6cf] p-3 text-sm font-semibold">
              {info}
            </p>
          )}

          <button type="submit" disabled={busy} className={btnPrimary + " mt-6 w-full !py-4"}>
            {busy ? "Lütfen bekle…" : mode === "login" ? "GİRİŞ YAP →" : "HESAP OLUŞTUR →"}
          </button>

          {mode === "register" && (
            <p className="mt-4 text-center text-xs leading-5 text-[#686868]">
              Bu ekrandan açılan hesaplar “yönetici başvurusu” olur ve CEO veya admin onaylayana kadar panele giremez. CEO hesabı buradan oluşturulamaz; yalnızca veritabanından atanır.
            </p>
          )}
        </form>
      </div>
    </div>
  );
}

/* ================================================================== */
/*  ANA SAYFA                                                          */
/* ================================================================== */

export default function AdminPage() {
  const sb = useMemo(() => getSupabase(), []);
  const [stage, setStage] = useState<Stage>("loading");
  const [session, setSession] = useState<Session | null>(null);
  const [profile, setProfile] = useState<Profile | null>(null);

  const afterAuth = useCallback(
    async (s: Session, withIntro: boolean) => {
      if (!sb) return;
      setSession(s);
      const { data } = await sb.from("profiles").select("*").eq("id", s.user.id).maybeSingle();
      const p = data as Profile | null;
      setProfile(p);
      if (p && p.role !== "member" && !p.banned) setStage(withIntro ? "intro" : "panel");
      else setStage("denied");
    },
    [sb]
  );

  useEffect(() => {
    if (!sb) {
      setStage("setup");
      return;
    }
    let alive = true;
    sb.auth.getSession().then(({ data }) => {
      if (!alive) return;
      if (data.session) afterAuth(data.session, false);
      else setStage("gate");
    });
    const { data: sub } = sb.auth.onAuthStateChange((event) => {
      if (event === "SIGNED_OUT") {
        setSession(null);
        setProfile(null);
        setStage("gate");
      }
    });
    return () => {
      alive = false;
      sub.subscription.unsubscribe();
    };
  }, [sb, afterAuth]);

  const logout = useCallback(async () => {
    await sb?.auth.signOut();
    setStage("gate");
  }, [sb]);

  const finishIntro = useCallback(() => setStage("panel"), []);

  return (
    <main className="dots editorial min-h-screen text-[#111]">
      <link rel="preconnect" href="https://fonts.googleapis.com" />
      <link rel="preconnect" href="https://fonts.gstatic.com" crossOrigin="" />
      <link
        href="https://fonts.googleapis.com/css2?family=Bricolage+Grotesque:opsz,wght@12..96,700;12..96,800&family=Dancing+Script:wght@700&family=Inter:wght@400;500;600;700&display=swap"
        rel="stylesheet"
      />
      <style jsx global>{`
        * { box-sizing: border-box; }
        body { margin: 0; }
        button, input, select, textarea { font: inherit; }
        .editorial { font-family: "Inter", system-ui, -apple-system, "Segoe UI", Roboto, Arial, sans-serif; -webkit-font-smoothing: antialiased; }
        .hd { font-family: "Bricolage Grotesque", "Helvetica Neue", Arial, sans-serif; }
        .dots { background-color: #ffffff; background-image: radial-gradient(#d9d9d9 1.4px, transparent 1.5px); background-size: 28px 28px; }
        .field:focus { background: #fffdf2; box-shadow: 0 0 0 4px #f5c518; }
        .editorial :focus-visible { outline: 3px solid #111; outline-offset: 3px; }
        .kid-wrap { position: relative; }
        .kid-svg { display: block; width: 100%; height: 100%; overflow: visible; cursor: pointer; }
        .pb-safe { padding-bottom: env(safe-area-inset-bottom); }

        .h7-intro { position: fixed; inset: 0; z-index: 100; display: flex; flex-direction: column; align-items: center; justify-content: center; background: #111; cursor: pointer; animation: h7in 0.5s ease both, h7out 0.7s ease 4.5s forwards; overflow: hidden; }
        .h7-glow { position: absolute; width: 70vmin; height: 70vmin; border-radius: 50%; background: radial-gradient(circle, rgba(245,197,24,0.28), rgba(245,197,24,0) 65%); animation: h7pulse 3.4s ease-in-out infinite; }
        .h7-script { position: relative; width: min(92vw, 980px); height: auto; overflow: visible; }
        .h7-script-text { font-family: "Dancing Script", "Brush Script MT", cursive; font-weight: 700; font-size: 112px; fill: transparent; stroke: #f5c518; stroke-width: 1.8; stroke-linejoin: round; stroke-dasharray: 2600; stroke-dashoffset: 2600; animation: h7draw 2.5s cubic-bezier(0.55, 0.1, 0.35, 1) 0.35s forwards, h7fill 0.9s ease 2.2s forwards; }
        .h7-sub { position: relative; margin: 14px 0 0; color: #f5c518; font-size: 13px; font-weight: 700; letter-spacing: 0.4em; opacity: 0; animation: h7fade 0.9s ease 3s forwards; }
        .h7-skip { position: absolute; bottom: 28px; color: rgba(255,255,255,0.4); font-size: 12px; letter-spacing: 0.12em; }
        @keyframes h7in { from { opacity: 0; } to { opacity: 1; } }
        @keyframes h7out { to { opacity: 0; visibility: hidden; } }
        @keyframes h7draw { to { stroke-dashoffset: 0; } }
        @keyframes h7fill { to { fill: #f5c518; stroke-width: 0.4; } }
        @keyframes h7fade { to { opacity: 1; } }
        @keyframes h7pulse { 0%, 100% { transform: scale(0.92); opacity: 0.7; } 50% { transform: scale(1.08); opacity: 1; } }
        @media (prefers-reduced-motion: reduce) {
          .h7-intro { animation: h7in 0.2s ease both, h7out 0.3s ease 1.2s forwards; }
          .h7-glow { animation: none; }
          .h7-script-text { animation: none; stroke-dashoffset: 0; fill: #f5c518; stroke-width: 0.4; }
          .h7-sub { animation: none; opacity: 1; }
        }
      `}</style>

      {stage === "loading" && (
        <div className="grid min-h-screen place-items-center text-sm font-bold tracking-[0.14em] text-[#686868]">
          YÜKLENİYOR…
        </div>
      )}

      {stage === "setup" && <SetupScreen />}

      {stage === "gate" && <Gate onAuthed={(s) => afterAuth(s, true)} />}

      {stage === "denied" && (
        <div className="grid min-h-screen place-items-center px-5">
          <div className="w-full max-w-md rounded-[32px] border-[3px] border-[#111] bg-white p-8 text-center shadow-[0_10px_0_#111]">
            <h1 className="hd text-3xl font-extrabold tracking-[-0.04em]">
              {profile?.panel_request && !profile?.banned ? "Başvurun onay bekliyor" : "Bu hesabın panel yetkisi yok"}
            </h1>
            <p className="mt-3 text-base text-[#686868]">
              {profile?.banned
                ? "Bu hesap engellenmiş."
                : profile?.panel_request
                  ? "Yönetici başvurun alındı. Admin (patron) Üyeler bölümünden başvurunu onaylayıp rolünü verdiğinde buradan giriş yapabilirsin."
                  : "Bu hesap panele giremez. Yetki için admin (patron) hesabıyla Üyeler bölümünden rol verilmelidir."}
            </p>
            <button type="button" onClick={logout} className={btnPrimary + " mt-6"}>
              Çıkış yap
            </button>
          </div>
        </div>
      )}

      {stage === "intro" && <Intro onDone={finishIntro} />}

      {stage === "panel" && sb && session && profile && (
        <Panel sb={sb} session={session} profile={profile} onLogout={logout} />
      )}
    </main>
  );
}

function SetupScreen() {
  return (
    <div className="grid min-h-screen place-items-center px-5 py-10">
      <div className="w-full max-w-xl rounded-[32px] border-[3px] border-[#111] bg-white p-8 shadow-[0_10px_0_#111]">
        <span className="inline-block rounded-full border-[2.5px] border-[#111] bg-[#f5c518] px-3 py-1 text-[11px] font-bold tracking-[0.14em]">
          KURULUM GEREKLİ
        </span>
        <h1 className="hd mt-4 text-3xl font-extrabold tracking-[-0.04em]">Supabase bağlantısı yok</h1>
        <p className="mt-3 text-base leading-7 text-[#686868]">
          Admin paneli için siteye şu iki bilgiyi eklemen gerekiyor. Bilgileri Supabase panelinde
          Project Settings → API sayfasından bulabilirsin. KURULUM.md dosyasında adım adım anlatılıyor.
        </p>
        <pre className="mt-5 overflow-x-auto rounded-2xl border-[2.5px] border-[#111] bg-[#111] p-4 text-xs leading-6 text-[#f5c518]">
{`NEXT_PUBLIC_SUPABASE_URL=...
NEXT_PUBLIC_SUPABASE_ANON_KEY=...`}
        </pre>
        <p className="mt-4 text-sm text-[#686868]">Ekledikten sonra siteyi yeniden başlat / yeniden yayınla.</p>
      </div>
    </div>
  );
}

/* ================================================================== */
/*  PANEL                                                              */
/* ================================================================== */

function Panel({
  sb,
  profile,
  onLogout,
}: {
  sb: NonNullable<ReturnType<typeof getSupabase>>;
  session: Session;
  profile: Profile;
  onLogout: () => void;
}) {
  const [tab, setTab] = useState<TabId>(profile.role === "ceo" ? "ceo" : "overview");
  const [content, setContent] = useState<SiteContent>(DEFAULT_CONTENT);
  const [draft, setDraft] = useState<SiteContent>(DEFAULT_CONTENT);
  const [saving, setSaving] = useState(false);
  const [views, setViews] = useState<View[]>([]);
  const [orders, setOrders] = useState<Order[]>([]);
  const [members, setMembers] = useState<Profile[]>([]);
  const [range, setRange] = useState(14);
  const [toast, setToast] = useState("");
  const [dataError, setDataError] = useState("");
  const [loaded, setLoaded] = useState(false);
  const [perms, setPerms] = useState<PermMap>(DEFAULT_PERMS);
  const [viewAs, setViewAs] = useState<"" | "mod" | "amele" | "member">("");
  const [supportNew, setSupportNew] = useState(0);
  const [orderSearch, setOrderSearch] = useState("");
  const [ceoStats, setCeoStats] = useState<Record<string, unknown> | null>(null);
  const [legalDoc, setLegalDoc] = useState<LegalSlug>("kvkk");
  /** Moderatör / personel için CEO'nun tanımladığı kişiye özel bölüm listesi (yoksa rol varsayılanı geçerli) */
  const [ozelYetki, setOzelYetki] = useState<string[] | null>(null);
  /** Üyeler bölümünde yetki düzenleyicisi açık olan üye */
  const [yetkiUye, setYetkiUye] = useState<string | null>(null);
  const isCeo = profile.role === "ceo";
  /** CEO veya admin: tüm yönetim bölümleri (CEO Merkezi, finans ve paketler yalnızca CEO'da) */
  const isAdmin = isCeo || profile.role === "admin";
  const effRole: RoleId = isAdmin && viewAs ? viewAs : profile.role;
  const allowed: string[] =
    effRole === "ceo"
      ? TABS.map((t) => t.id)
      : effRole === "admin"
        ? TABS.map((t) => t.id).filter((id) => !CEO_ONLY.includes(id))
        : effRole === "member"
          ? []
          : (effRole === profile.role && ozelYetki ? ozelYetki : perms[effRole] || []).filter((id) => !CEO_ONLY.includes(id) && !ADMIN_ONLY.includes(id));
  const can = (id: TabId) => allowed.includes(id);
  const visibleTabs = TABS.filter((t) => can(t.id));
  const navTabs = visibleTabs;

  const notify = useCallback((text: string) => {
    setToast(text);
    setTimeout(() => setToast(""), 3200);
  }, []);

  const loadViews = useCallback(async () => {
    const since = new Date(Date.now() - 60 * 86400000).toISOString();
    const all: View[] = [];
    for (let page = 0; page < 20; page++) {
      const { data, error } = await sb
        .from("page_views")
        .select("path,referrer,device,browser,country,session_id,created_at")
        .gte("created_at", since)
        .order("created_at", { ascending: false })
        .range(page * 1000, page * 1000 + 999);
      if (error) {
        setDataError("Trafik verisi okunamadı. supabase.sql dosyasının çalıştırıldığından emin ol.");
        break;
      }
      all.push(...((data as View[]) || []));
      if (!data || data.length < 1000) break;
    }
    setViews(all);
  }, [sb]);

  const loadAll = useCallback(async () => {
    setDataError("");
    const pr = await sb.from("role_permissions").select("role,tab");
    let myPerms = DEFAULT_PERMS;
    if (!pr.error && pr.data && pr.data.length) {
      myPerms = { mod: [], amele: [] };
      for (const r of pr.data as { role: "mod" | "amele"; tab: string }[]) myPerms[r.role]?.push(r.tab);
    }
    setPerms(myPerms);
    // Kişiye özel yetki (varsa yalnızca bu liste geçerlidir; API ve veritabanı da aynı listeyi uygular)
    let myOwn: string[] | null = null;
    if (profile.role === "mod" || profile.role === "amele") {
      const u = await sb.from("user_permission_sets").select("tabs").eq("user_id", profile.id).maybeSingle();
      if (!u.error && u.data) myOwn = (u.data as { tabs: string[] }).tabs || [];
    }
    setOzelYetki(myOwn);
    const [c, o, m] = await Promise.all([
      sb.from("site_content").select("key,value"),
      sb.from("orders").select("id,customer_name,service,title,amount,status,created_at").order("created_at", { ascending: false }).limit(300),
      sb.from("profiles").select("*").order("created_at", { ascending: false }),
    ]);
    if ((profile.role === "admin" || profile.role === "ceo") && (c.error || o.error || m.error)) {
      setDataError("Veriler okunamadı. Veritabanı kurulumunun (supabase/migrations) çalıştırıldığından emin ol.");
    }
    // CEO / admin: AI asistanı için satış ve sipariş istatistikleri
    if (profile.role === "admin" || profile.role === "ceo") {
      const st = await rpcCall<Record<string, unknown>>(sb, "h7_ceo_ozet");
      if (st.ok && st.data) setCeoStats(st.data);
    }
    const merged = mergeContent((c.data as { key: string; value: unknown }[]) || []);
    setContent(merged);
    setDraft(merged);
    setOrders((o.data as Order[]) || []);
    setMembers((m.data as Profile[]) || []);
    const myTabs = profile.role === "admin" || profile.role === "ceo" ? ["traffic", "overview"] : myOwn || myPerms[profile.role as "mod" | "amele"] || [];
    if (myTabs.includes("traffic") || myTabs.includes("overview")) await loadViews();
    setLoaded(true);
  }, [sb, loadViews, profile.role, profile.id]);

  useEffect(() => {
    loadAll();
  }, [loadAll]);

  const dirty = JSON.stringify(draft) !== JSON.stringify(content);

  // Kaydedilmemiş değişiklik varken sayfadan çıkılırsa tarayıcı uyarır
  useEffect(() => {
    if (!dirty) return;
    const uyar = (e: BeforeUnloadEvent) => {
      e.preventDefault();
      e.returnValue = "";
    };
    window.addEventListener("beforeunload", uyar);
    return () => window.removeEventListener("beforeunload", uyar);
  }, [dirty]);

  // Görünmeyen bir sekmede kalma (ör. "bu rolün gözüyle bak" açıldığında)
  useEffect(() => {
    if (loaded && !can(tab) && visibleTabs.length) setTab(visibleTabs[0].id);
    // eslint-disable-next-line react-hooks/exhaustive-deps
  }, [loaded, viewAs, perms, tab]);

  async function persist(next: SiteContent, keys: string[]) {
    setSaving(true);
    const rows = keys.map((key) => ({
      key,
      value: (next as unknown as Record<string, unknown>)[key],
      updated_at: new Date().toISOString(),
    }));
    const { error } = await sb.from("site_content").upsert(rows);
    setSaving(false);
    if (error) {
      notify("Kaydedilemedi: " + error.message);
      return false;
    }
    setContent(next);
    setDraft(next);
    return true;
  }

  async function saveDraft() {
    const keys = (Object.keys(draft) as (keyof SiteContent)[]).filter(
      (k) => JSON.stringify(draft[k]) !== JSON.stringify(content[k])
    );
    if (await persist(draft, keys)) notify("Kaydedildi. Değişiklikler siteye yansıdı.");
  }

  /** Yalnızca bir bölümü kaydeder; diğer bölümlerdeki kaydedilmemiş düzenlemeler taslakta kalır. */
  async function saveSection(key: keyof SiteContent) {
    setSaving(true);
    const { error } = await sb.from("site_content").upsert([{ key, value: draft[key], updated_at: new Date().toISOString() }]);
    setSaving(false);
    if (error) return notify("Kaydedilemedi: " + error.message);
    setContent((c) => ({ ...c, [key]: draft[key] }));
    notify("Kaydedildi. Ana sayfa ve menü en geç 15 saniye içinde güncellenir.");
  }

  /** Kaydetmeden önizleme: taslak yalnızca bu tarayıcıda saklanır, ana sayfa ?onizleme=1 ile açılır. */
  function onizle() {
    try {
      window.localStorage.setItem(ONIZLEME_ANAHTARI, JSON.stringify({ at: Date.now(), home: draft.home, nav: draft.nav, footer: draft.footer }));
      window.open("/?onizleme=1", "_blank", "noopener");
    } catch {
      notify("Önizleme açılamadı (tarayıcı depolaması kapalı olabilir).");
    }
  }

  const traffic = useMemo(() => summarize(views, range), [views, range]);
  const week = useMemo(() => summarize(views, 7), [views]);
  const month = useMemo(() => summarize(views, 30), [views]);
  const pending = orders.filter((o) => ["Ödeme Bekleniyor", "Alındı", "Beklemede", "İşlemde", "Revizyon"].includes(o.status)).length;
  const upd = <K extends keyof SiteContent>(key: K, value: SiteContent[K]) => setDraft({ ...draft, [key]: value });

  /* ---------- BÖLÜMLER ---------- */

  const overview = (
    <>
      <Title eyebrow="Yönetim merkezi" title="Genel Bakış" desc="Sitenin durumunu tek bakışta gör." />

      <div className="mb-7 flex flex-col items-center gap-5 rounded-[28px] border-[3px] border-[#111] bg-white p-6 shadow-[0_8px_0_#111] sm:flex-row sm:justify-between sm:px-8">
        <div className="max-w-md text-center sm:text-left">
          <p className="text-[11px] font-bold uppercase tracking-[0.14em] text-[#686868]">Hoş geldin patron</p>
          <h2 className="hd mt-2 text-3xl font-extrabold leading-tight tracking-[-0.04em] sm:text-4xl">
            {profile.full_name ? profile.full_name.split(" ")[0] : "Patron"}, bugün site nasıl?
          </h2>
          <div className="mt-5 flex flex-wrap justify-center gap-3 sm:justify-start">
            <button type="button" className={btnPrimary} onClick={() => setTab("traffic")}>
              Trafiği gör →
            </button>
            <button type="button" className={btnGhost + " !py-3"} onClick={() => setTab("ai")}>
              ✦ AI’a sor
            </button>
          </div>
        </div>
        <div className="flex-none">
          <Patron width={170} eyeDelay={1.2} />
        </div>
      </div>

      <div className="mb-7 grid gap-4 sm:grid-cols-2 xl:grid-cols-4">
        <Stat label="Şu an sitede" value={String(traffic.live)} sub="son 5 dakika" />
        <Stat label="Bugün görüntüleme" value={String(traffic.today)} />
        <Stat label="7 gün ziyaretçi" value={String(week.totalVisitors)} sub={`önceki haftaya göre ${delta(week.totalVisitors, week.prevVisitors)}`} />
        <Stat label="Aktif sipariş" value={String(pending)} sub={`${members.length} üye`} />
      </div>

      <div className={`${card} p-5 sm:p-6`}>
        <h2 className="hd mb-1 text-xl font-extrabold">Son 14 gün</h2>
        <p className="mb-4 text-xs text-[#686868]">Sarı çubuklar görüntüleme, siyah çizgi ziyaretçi sayısı.</p>
        <TrafficChart data={summarize(views, 14).days} />
      </div>
    </>
  );

  const trafficTab = (
    <>
      <Title eyebrow="Ziyaretçi analizi" title="Trafik" desc="Sitene kimler, nereden ve hangi cihazla geliyor?" />
      <div className="mb-5 flex flex-wrap gap-2">
        {[7, 14, 30].map((d) => (
          <button
            key={d}
            type="button"
            onClick={() => setRange(d)}
            className={`rounded-full border-[2.5px] border-[#111] px-4 py-2 text-sm font-semibold transition ${
              range === d ? "bg-[#f5c518] shadow-[0_3px_0_#111]" : "bg-white hover:bg-[#fffdf2]"
            }`}
          >
            Son {d} gün
          </button>
        ))}
        <button type="button" className={btnGhost + " ml-auto"} onClick={loadViews}>
          ↻ Yenile
        </button>
      </div>

      {views.length === 0 && loaded && (
        <div className="mb-5 rounded-2xl border-[2.5px] border-dashed border-[#111] bg-[#fff6cf] p-5 text-sm leading-6">
          <strong>Henüz ziyaret kaydı yok.</strong> Sayaç, sitenin <code>app/layout.tsx</code> dosyasına
          <code> &lt;HityTracker /&gt;</code> eklenince çalışır (KURULUM.md’de anlatılıyor). Ardından siteyi
          ziyaret edince burada görünür.
        </div>
      )}

      <div className="mb-6 grid gap-4 sm:grid-cols-2 xl:grid-cols-4">
        <Stat label="Görüntüleme" value={String(traffic.totalViews)} sub={`önceki dönem ${delta(traffic.totalViews, traffic.prevViews)}`} />
        <Stat label="Ziyaretçi" value={String(traffic.totalVisitors)} sub={`önceki dönem ${delta(traffic.totalVisitors, traffic.prevVisitors)}`} />
        <Stat label="Ziyaret başına sayfa" value={traffic.pagesPerVisit.toFixed(1)} />
        <Stat label="Şu an sitede" value={String(traffic.live)} sub="son 5 dakika" />
      </div>

      <div className={`${card} mb-6 p-5 sm:p-6`}>
        <TrafficChart data={traffic.days} />
      </div>

      <div className="grid gap-5 md:grid-cols-2">
        <BarList title="En çok bakılan sayfalar" items={traffic.topPages} />
        <BarList title="Nereden geliyorlar" items={traffic.sources} />
        <BarList title="Cihaz" items={traffic.devices} />
        <BarList title="Tarayıcı" items={traffic.browsers} />
        <BarList title="Ülke" items={traffic.countries} />
      </div>
    </>
  );

  const g = draft.general;
  const setG = (patch: Partial<SiteContent["general"]>) => upd("general", { ...g, ...patch });
  const co = draft.company;
  const setCo = (patch: Partial<SiteContent["company"]>) => upd("company", { ...co, ...patch });
  // Yasal metin düzenleyici: hazır metinle aynıysa kayıt tutulmaz; boş bırakılırsa sayfada hazır metin görünür
  const legalCustom = draft.legal.docs[legalDoc];
  const legalText = legalCustom ?? LEGAL_TEMPLATES[legalDoc];
  const setLegalText = (v: string) => {
    const docs = { ...draft.legal.docs };
    if (v === LEGAL_TEMPLATES[legalDoc]) delete docs[legalDoc];
    else docs[legalDoc] = v;
    upd("legal", { docs, updatedAt: new Date().toISOString().slice(0, 10) });
  };
  const resetLegal = () => {
    if (!confirm("Bu belgedeki düzenlemeler silinip hazır metne dönülsün mü?")) return;
    const docs = { ...draft.legal.docs };
    delete docs[legalDoc];
    upd("legal", { docs, updatedAt: new Date().toISOString().slice(0, 10) });
  };

  const contentTab = (
    <>
      <Title eyebrow="Site düzeni" title="Site Yazıları" desc="Slogan, ana sayfa metinleri, duyuru çubuğu ve iletişim bilgileri." />
      <div className="space-y-6">
        <div className={`${card} space-y-5 p-5 sm:p-7`}>
          <h2 className="hd text-xl font-extrabold">Genel</h2>
          <div className="grid gap-5 sm:grid-cols-2">
            <TextField label="Site adı" value={g.siteName} onChange={(v) => setG({ siteName: v })} />
            <TextField label="Slogan" value={g.slogan} onChange={(v) => setG({ slogan: v })} />
          </div>
        </div>

        <SiteYayinda
          bakim={g.maintenance}
          onBakim={(v) => setG({ maintenance: v })}
          izinli={draft.erisim.bakimdaGirebilir}
          onIzinli={(v) => upd("erisim", { ...draft.erisim, bakimdaGirebilir: v })}
          isCeo={isCeo && !viewAs}
        />

        <div className={`${card} space-y-5 p-5 sm:p-7`}>
          <h2 className="hd text-xl font-extrabold">Duyuru</h2>
          <Toggle label="Duyuru çubuğunu göster" hint="Sitenin üstünde kısa bir duyuru yazısı gösterilir." checked={g.announcementEnabled} onChange={(v) => setG({ announcementEnabled: v })} />
          <TextField label="Duyuru yazısı" value={g.announcementText} onChange={(v) => setG({ announcementText: v })} placeholder="Örn: Yeni yıl kampanyası başladı!" />
        </div>

        <SiteMetinleri
          home={draft.home}
          nav={draft.nav}
          footer={draft.footer}
          seo={draft.seo}
          kayitli={{ home: content.home, nav: content.nav, footer: content.footer, seo: content.seo }}
          onHome={(v) => upd("home", v)}
          onNav={(v) => upd("nav", v)}
          onFooter={(v) => upd("footer", v)}
          onSeo={(v) => upd("seo", v)}
          onKaydet={(k) => void saveSection(k)}
          onGeriAl={(k) => upd(k, content[k])}
          kaydediliyor={saving}
          onOnizle={onizle}
        />

        <div className={`${card} space-y-5 p-5 sm:p-7`}>
          <h2 className="hd text-xl font-extrabold">İletişim ve sosyal medya</h2>
          <div className="grid gap-5 sm:grid-cols-2">
            <TextField label="İletişim e-postası" type="email" value={g.contactEmail} onChange={(v) => setG({ contactEmail: v })} />
            <TextField label="WhatsApp" value={g.whatsapp} onChange={(v) => setG({ whatsapp: v })} placeholder="+90 5xx xxx xx xx" />
            <TextField label="Instagram" value={g.instagram} onChange={(v) => setG({ instagram: v })} placeholder="https://instagram.com/..." />
            <TextField label="TikTok" value={g.tiktok} onChange={(v) => setG({ tiktok: v })} placeholder="https://tiktok.com/@..." />
            <TextField label="YouTube" value={g.youtube} onChange={(v) => setG({ youtube: v })} placeholder="https://youtube.com/@..." />
          </div>
        </div>

        <div className={`${card} space-y-5 p-5 sm:p-7`}>
          <div>
            <h2 className="hd text-xl font-extrabold">Şirket bilgileri</h2>
            <p className="mt-1 text-sm text-[#686868]">
              KVKK metninde, sözleşmelerde, iade koşullarında ve sitenin en altında görünür. Ödeme kuruluşları (PayTR vb.) başvuruda bu
              bilgileri arar. Boş alanlar yasal sayfalarda sarı “doldurulacak” işaretiyle görünür.
            </p>
          </div>
          <div className="grid gap-5 sm:grid-cols-2">
            <TextField label="Şirket unvanı (şahıs şirketinde ad soyad)" value={co.title} onChange={(v) => setCo({ title: v })} />
            <TextField label="Telefon" value={co.phone} onChange={(v) => setCo({ phone: v })} placeholder="0 (5xx) xxx xx xx" />
            <TextField label="Vergi dairesi" value={co.taxOffice} onChange={(v) => setCo({ taxOffice: v })} />
            <TextField label="Vergi / T.C. kimlik no" value={co.taxNumber} onChange={(v) => setCo({ taxNumber: v })} />
            <TextField label="MERSİS no (varsa)" value={co.mersis} onChange={(v) => setCo({ mersis: v })} />
            <TextField label="KEP adresi (varsa)" value={co.kep} onChange={(v) => setCo({ kep: v })} placeholder="ornek@hs01.kep.tr" />
          </div>
          <TextField label="Açık adres" multiline value={co.address} onChange={(v) => setCo({ address: v })} />
          <p className="text-xs text-[#686868]">E-posta olarak yukarıdaki “İletişim e-postası” kullanılır.</p>
        </div>

        <div className={`${card} space-y-4 p-5 sm:p-7`}>
          <div>
            <h2 className="hd text-xl font-extrabold">Yasal metinler</h2>
            <p className="mt-1 text-sm text-[#686868]">
              Hazır metinler genel şablondur ve hukuki danışmanlık yerine geçmez. Yayına almadan önce bir hukukçuya kontrol ettirmeni
              öneririz; hukukçunun düzelttiği metni buraya yapıştırabilirsin.
            </p>
          </div>
          <div className="flex flex-wrap gap-2">
            {LEGAL_DOCS.map((d) => (
              <button
                key={d.slug}
                type="button"
                onClick={() => setLegalDoc(d.slug)}
                aria-pressed={legalDoc === d.slug}
                className={`rounded-full border-[2.5px] border-[#111] px-3 py-1.5 text-xs font-bold transition ${legalDoc === d.slug ? "bg-[#f5c518]" : "bg-white hover:bg-[#fffdf2]"}`}
              >
                {d.short}
                {draft.legal.docs[d.slug] !== undefined ? " ✎" : ""}
              </button>
            ))}
          </div>
          <textarea
            className={`${inputCls} min-h-[360px] resize-y font-mono text-[13px] leading-6`}
            value={legalText}
            onChange={(e) => setLegalText(e.target.value)}
            aria-label={`${LEGAL_DOCS.find((d) => d.slug === legalDoc)?.title || "Yasal metin"} metni`}
          />
          <p className="text-xs leading-5 text-[#686868]">
            Biçim: <b>## Başlık</b>, <b>### Alt başlık</b>, <b>- madde</b>, boş satır = yeni paragraf, <b>**kalın**</b>,{" "}
            <b>[bağlantı](/adres)</b>. Şu yer tutucular şirket bilgileriyle otomatik doldurulur:{" "}
            {"{{unvan}} {{adres}} {{telefon}} {{eposta}} {{vergiDairesi}} {{vergiNo}} {{mersis}} {{kep}} {{marka}} {{site}}"}
          </p>
          <div className="flex flex-wrap items-center gap-3">
            <a href={`/yasal/${legalDoc}`} target="_blank" rel="noopener noreferrer" className={btnGhost}>
              Sayfada gör ↗
            </a>
            {legalCustom !== undefined && (
              <button type="button" className={btnGhost} onClick={resetLegal}>
                Hazır metne dön
              </button>
            )}
            <span className="text-xs text-[#686868]">
              {legalCustom === undefined
                ? "Hazır metin kullanılıyor."
                : legalCustom.trim()
                  ? "Bu belge düzenlendi."
                  : "Metin boş: sayfada hazır metin görünür."}{" "}
              Değişiklikler “Kaydet” ile yayına alınır; “Sayfada gör” kaydedilmiş hâli gösterir.
            </span>
          </div>
        </div>
      </div>
      <SaveBar dirty={dirty} saving={saving} onSave={saveDraft} onReset={() => setDraft(content)} />
    </>
  );

  const setService = (id: string, patch: Partial<ServiceItem>) =>
    upd("services", draft.services.map((s) => (s.id === id ? { ...s, ...patch } : s)));

  // Ek hizmetler (upsell): fiyat / ad / satış durumu ve hangi sayfada önerileceği
  const setAddon = (id: string, patch: Partial<AddonItem>) =>
    upd("upsell", { ...draft.upsell, addons: draft.upsell.addons.map((a) => (a.id === id ? { ...a, ...patch } : a)) });
  const removeAddon = (id: string) =>
    upd("upsell", {
      addons: draft.upsell.addons.filter((a) => a.id !== id),
      offers: Object.fromEntries(
        CART_SERVICES.map((s) => [s, { ...draft.upsell.offers[s], addonIds: draft.upsell.offers[s].addonIds.filter((x) => x !== id) }])
      ) as UpsellContent["offers"],
    });
  const setOffer = (s: CartService, patch: Partial<UpsellOffer>) =>
    upd("upsell", { ...draft.upsell, offers: { ...draft.upsell.offers, [s]: { ...draft.upsell.offers[s], ...patch } } });
  const toggleOfferAddon = (s: CartService, id: string) => {
    const cur = draft.upsell.offers[s].addonIds;
    setOffer(s, { addonIds: cur.includes(id) ? cur.filter((x) => x !== id) : [...cur, id] });
  };
  const OFFER_PAGE: Record<CartService, string> = { remake: "Remake Beat sayfası", mix: "Mix & Mastering sayfası" };
  const moveService = (i: number, dir: -1 | 1) => {
    const list = [...draft.services];
    const j = i + dir;
    if (j < 0 || j >= list.length) return;
    [list[i], list[j]] = [list[j], list[i]];
    upd("services", list);
  };

  const servicesTab = (
    <>
      <Title eyebrow="Katalog" title="Hizmetler & Fiyatlar" desc="Hizmetlerin görünürlüğü, sipariş izni, adı, açıklaması ve fiyatları." />
      <div className="space-y-5">
        <ErisimMatrisi value={draft.erisim} onChange={(v) => upd("erisim", v)} isCeo={isCeo && !viewAs} />
        <p className="text-xs text-[#686868]">
          Aşağıdaki katalog kartları yalnızca hizmetlerin adını, açıklamasını ve fiyat yazısını tutar. Sitede kimin hangi hizmeti
          göreceği ve sipariş verebileceği yukarıdaki tablodan yönetilir.
        </p>
        {draft.services.map((s, i) => (
          <div key={s.id} className={`${card} p-5 sm:p-7 ${s.active ? "" : "opacity-70"}`}>
            <div className="mb-5 flex flex-wrap items-center justify-between gap-3">
              <span className="hd inline-flex items-center gap-3 text-xl font-extrabold">
                <span className="grid h-9 w-9 place-items-center rounded-full border-[2.5px] border-[#111] bg-[#f5c518] text-sm">{i + 1}</span>
                {s.name || "İsimsiz hizmet"}
              </span>
              <div className="flex gap-2">
                <button type="button" className={btnGhost} onClick={() => moveService(i, -1)} aria-label="Yukarı taşı">↑</button>
                <button type="button" className={btnGhost} onClick={() => moveService(i, 1)} aria-label="Aşağı taşı">↓</button>
                <button
                  type="button"
                  className={btnGhost}
                  onClick={() => {
                    if (confirm(`“${s.name}” hizmeti silinsin mi?`)) upd("services", draft.services.filter((x) => x.id !== s.id));
                  }}
                >
                  × Sil
                </button>
              </div>
            </div>
            <div className="grid gap-5 sm:grid-cols-2">
              <TextField label="Hizmet adı" value={s.name} onChange={(v) => setService(s.id, { name: v })} />
              <TextField label="Fiyat yazısı" value={s.price} onChange={(v) => setService(s.id, { price: v })} placeholder="Örn: 1.500 TL'den başlayan" />
              <TextField label="Sayfa adresi" value={s.href} onChange={(v) => setService(s.id, { href: v })} hint="Örn: /smm-panel" />
              <TextField label="Kısa açıklama" value={s.desc} onChange={(v) => setService(s.id, { desc: v })} />
            </div>
            <p className="mt-5 text-sm font-semibold">
              {(() => {
                const h = HIZMETLER.find((x) => x.yol === s.href);
                if (!h) return "Bu kart sitede bir hizmet sayfasına bağlı değil.";
                const e = draft.erisim.services[h.id];
                return e.active ? "Sitede: aktif — görünürlük ve sipariş izni yukarıdaki tablodan yönetilir." : "Sitede: PASİF — yalnızca CEO / Admin görür.";
              })()}
            </p>
          </div>
        ))}
        <button
          type="button"
          onClick={() =>
            upd("services", [
              ...draft.services,
              { id: "s" + Date.now().toString(36), name: "Yeni hizmet", desc: "", price: "", href: "/", active: false },
            ])
          }
          className="flex w-full items-center justify-center gap-3 rounded-3xl border-[2.5px] border-dashed border-[#111] bg-white p-5 text-sm font-bold transition hover:bg-[#fffdf2]"
        >
          <span className="grid h-10 w-10 place-items-center rounded-full border-[2.5px] border-[#111] bg-[#f5c518] text-xl">＋</span>
          Yeni hizmet ekle
        </button>

        <div className={`${card} border-[3px] p-5 sm:p-7`}>
          <h2 className="hd text-xl font-extrabold">Sipariş fiyatları (TL)</h2>
          <p className="mb-5 mt-1 text-sm text-[#686868]">
            Siparişte bakiyeden düşülen tutar bu fiyatlardan sunucuda hesaplanır. 0 yazılan yayın paketi ücretsiz başvuru olarak alınır.
            Mix & Mastering fiyatları Prodüktörler bölümünden, influencer fiyatları Influencerlar bölümünden, SMM fiyatları SMM Sağlayıcıları bölümünden yönetilir.
          </p>
          <p className="mb-2 text-[11px] font-bold uppercase tracking-[0.12em] text-[#686868]">Remake Beat</p>
          <div className="grid gap-4 sm:grid-cols-4">
            {(
              [
                ["free", "Free Beat"],
                ["birebir", "Birebir Remake"],
                ["modern", "Modern Remake"],
                ["ozgun", "Özgün Remake"],
              ] as const
            ).map(([k, label]) => (
              <TextField
                key={k}
                label={label}
                type="number"
                value={draft.pricing.remake[k]}
                onChange={(v) => upd("pricing", { ...draft.pricing, remake: { ...draft.pricing.remake, [k]: Math.max(0, Number(v) || 0) } })}
              />
            ))}
          </div>
          <p className="mb-2 mt-6 text-[11px] font-bold uppercase tracking-[0.12em] text-[#686868]">Dijital Yayın</p>
          <div className="grid gap-4 sm:grid-cols-3">
            {(
              [
                ["single", "Tekli (Single)"],
                ["ep", "EP"],
                ["album", "Albüm"],
              ] as const
            ).map(([k, label]) => (
              <TextField
                key={k}
                label={label}
                type="number"
                value={draft.pricing.yayin[k]}
                onChange={(v) => upd("pricing", { ...draft.pricing, yayin: { ...draft.pricing.yayin, [k]: Math.max(0, Number(v) || 0) } })}
              />
            ))}
          </div>
        </div>

        <div className={`${card} border-[3px] p-5 sm:p-7`}>
          <h2 className="hd text-xl font-extrabold">Ek hizmetler (sepet önerileri)</h2>
          <p className="mb-5 mt-1 text-sm text-[#686868]">
            Remake Beat ve Mix & Mastering sayfalarının sağ üstündeki öneri kartında ve sepette sunulur. Müşteri ek hizmeti ana hizmetle
            aynı siparişte, tek ödemede alır; Siparişler bölümünde ikisi aynı siparişin altında görünür. Tutar sunucuda bu fiyatlardan
            hesaplanır; “Kaydet” ile hemen geçerli olur.
          </p>
          <div className="space-y-4">
            {draft.upsell.addons.map((a) => (
              <div key={a.id} className={`rounded-2xl border-[2.5px] border-[#111] p-4 ${a.active ? "bg-white" : "bg-[#f5f5f5]"}`}>
                <div className="grid gap-4 sm:grid-cols-[1fr_180px]">
                  <TextField label="Ek hizmet adı" value={a.name} onChange={(v) => setAddon(a.id, { name: v })} />
                  <TextField
                    label="Fiyat (TL)"
                    type="number"
                    value={a.price}
                    onChange={(v) => setAddon(a.id, { price: Math.max(0, Math.round((Number(v) || 0) * 100) / 100) })}
                  />
                </div>
                <div className="mt-4">
                  <TextField label="Kısa açıklama" value={a.desc} onChange={(v) => setAddon(a.id, { desc: v })} />
                </div>
                <div className="mt-4 grid gap-3 sm:grid-cols-[1fr_auto] sm:items-center">
                  <Toggle
                    label="Satışta"
                    hint={a.active ? "Seçili sayfalarda ve sepette sunulur." : "Kapalı: hiçbir sayfada sunulmaz, sepetteki varsa ödeme öncesi uyarı verilir."}
                    checked={a.active}
                    onChange={(v) => setAddon(a.id, { active: v })}
                  />
                  <button
                    type="button"
                    className={btnGhost}
                    onClick={() => {
                      if (confirm(`“${a.name}” ek hizmeti silinsin mi?`)) removeAddon(a.id);
                    }}
                  >
                    × Sil
                  </button>
                </div>
              </div>
            ))}
            <button
              type="button"
              onClick={() =>
                upd("upsell", {
                  ...draft.upsell,
                  addons: [...draft.upsell.addons, { id: "e" + Date.now().toString(36), name: "Yeni ek hizmet", desc: "", price: 0, active: false }],
                })
              }
              className="flex w-full items-center justify-center gap-3 rounded-3xl border-[2.5px] border-dashed border-[#111] bg-white p-4 text-sm font-bold transition hover:bg-[#fffdf2]"
            >
              <span className="grid h-9 w-9 place-items-center rounded-full border-[2.5px] border-[#111] bg-[#f5c518] text-lg">＋</span>
              Yeni ek hizmet ekle
            </button>
          </div>

          <h3 className="hd mt-8 text-lg font-extrabold">Hangi sayfada ne önerilsin?</h3>
          <p className="mt-1 text-sm text-[#686868]">
            Birden fazla ek hizmet seçersen müşteri kartta bunlardan birini seçer. Hiçbiri seçili değilse veya kart kapalıysa sayfada ve
            sepette öneri görünmez.
          </p>
          <div className="mt-4 grid gap-4 lg:grid-cols-2">
            {CART_SERVICES.map((s) => {
              const o = draft.upsell.offers[s];
              return (
                <div key={s} className="rounded-2xl border-[2.5px] border-[#111] bg-white p-4">
                  <p className="mb-3 text-[11px] font-bold uppercase tracking-[0.12em] text-[#686868]">{OFFER_PAGE[s]}</p>
                  <Toggle label="Öneri kartı görünsün" checked={o.enabled} onChange={(v) => setOffer(s, { enabled: v })} />
                  <div className="mt-4">
                    <TextField label="Kart başlığı" value={o.title} onChange={(v) => setOffer(s, { title: v })} />
                  </div>
                  <p className="mb-2 mt-4 text-sm font-bold">Önerilecek ek hizmetler</p>
                  <div className="flex flex-wrap gap-2">
                    {draft.upsell.addons.length === 0 && <span className="text-sm text-[#686868]">Önce yukarıdan bir ek hizmet ekle.</span>}
                    {draft.upsell.addons.map((a) => {
                      const on = o.addonIds.includes(a.id);
                      return (
                        <button
                          key={a.id}
                          type="button"
                          aria-pressed={on}
                          onClick={() => toggleOfferAddon(s, a.id)}
                          className={`rounded-full border-[2.5px] border-[#111] px-3 py-1.5 text-xs font-bold transition ${on ? "bg-[#f5c518]" : "bg-white hover:bg-[#fffdf2]"} ${a.active ? "" : "opacity-60"}`}
                        >
                          {on ? "✓ " : "+ "}
                          {a.name} · {Number(a.price).toLocaleString("tr-TR")} TL{a.active ? "" : " (satışta değil)"}
                        </button>
                      );
                    })}
                  </div>
                </div>
              );
            })}
          </div>
        </div>
      </div>
      <SaveBar dirty={dirty} saving={saving} onSave={saveDraft} onReset={() => setDraft(content)} />
    </>
  );

  const setProducer = (id: string, patch: Partial<ProducerItem>) =>
    upd("producers", draft.producers.map((p) => (p.id === id ? { ...p, ...patch } : p)));

  const producersTab = (
    <>
      <Title eyebrow="Mix & Mastering" title="Prodüktörler" desc="Mix sayfasında görünen prodüktörler ve fiyatları." />
      <div className="space-y-5">
        {draft.producers.map((p) => (
          <div key={p.id} className={`${card} p-5 sm:p-7 ${p.active ? "" : "opacity-70"}`}>
            <div className="mb-5 flex flex-wrap items-center justify-between gap-3">
              <span className="hd inline-flex items-center gap-3 text-xl font-extrabold">
                {p.name}
                {p.hity7 && (
                  <span className="rounded-full bg-[#111] px-3 py-1 text-[11px] font-extrabold tracking-wider text-[#f5c518]">OFFICIAL</span>
                )}
              </span>
              {!p.hity7 && (
                <button
                  type="button"
                  className={btnGhost}
                  onClick={() => {
                    if (confirm(`“${p.name}” silinsin mi?`)) upd("producers", draft.producers.filter((x) => x.id !== p.id));
                  }}
                >
                  × Sil
                </button>
              )}
            </div>
            <div className="grid gap-5 sm:grid-cols-2">
              <TextField label="Ad" value={p.name} onChange={(v) => setProducer(p.id, { name: v })} />
              <TextField label="Uzmanlık" value={p.role} onChange={(v) => setProducer(p.id, { role: v })} />
              <TextField label="Mix & Mastering fiyatı (TL)" type="number" value={p.mixPrice} onChange={(v) => setProducer(p.id, { mixPrice: Math.max(0, Number(v) || 0) })} />
              <TextField label="Stems Mix fiyatı (TL)" type="number" value={p.stemsPrice} onChange={(v) => setProducer(p.id, { stemsPrice: Math.max(0, Number(v) || 0) })} />
            </div>
            <div className="mt-5">
              <TextField label="Açıklama" multiline value={p.desc} onChange={(v) => setProducer(p.id, { desc: v })} />
            </div>
            <div className="mt-5">
              <Toggle label="Sitede yayında" checked={p.active} onChange={(v) => setProducer(p.id, { active: v })} />
            </div>
          </div>
        ))}
        <button
          type="button"
          onClick={() =>
            upd("producers", [
              ...draft.producers,
              { id: "p" + Date.now().toString(36), name: "Yeni Prodüktör", role: "", desc: "", mixPrice: 0, stemsPrice: 0, hity7: false, active: false },
            ])
          }
          className="flex w-full items-center justify-center gap-3 rounded-3xl border-[2.5px] border-dashed border-[#111] bg-white p-5 text-sm font-bold transition hover:bg-[#fffdf2]"
        >
          <span className="grid h-10 w-10 place-items-center rounded-full border-[2.5px] border-[#111] bg-[#f5c518] text-xl">＋</span>
          Yeni prodüktör ekle
        </button>
      </div>
      <SaveBar dirty={dirty} saving={saving} onSave={saveDraft} onReset={() => setDraft(content)} />
      <div className="mt-10 space-y-8">
        <SamplesSection sb={sb} notify={notify} page="mix" />
        <SamplesSection sb={sb} notify={notify} page="remake" />
      </div>
    </>
  );

  // Rol / engel / başvuru işlemleri veritabanı fonksiyonlarıyla: yetki hiyerarşisi ve işlem kaydı orada uygulanır
  async function setMemberRole(id: string, role: Exclude<RoleId, "ceo">) {
    const r = await rpcCall(sb, "h7_uye_rol", { p_uye: id, p_rol: role });
    if (!r.ok) return notify("Rol değiştirilemedi: " + r.error);
    setMembers((cur) => cur.map((m) => (m.id === id ? { ...m, role, panel_request: false } : m)));
    notify("Rol güncellendi.");
  }
  async function setMemberBan(id: string, banned: boolean) {
    const r = await rpcCall(sb, "h7_uye_engel", { p_uye: id, p_engel: banned });
    if (!r.ok) return notify("Güncellenemedi: " + r.error);
    setMembers((cur) => cur.map((m) => (m.id === id ? { ...m, banned } : m)));
    notify(banned ? "Üye engellendi." : "Engel kaldırıldı.");
  }
  async function rejectApplicant(id: string) {
    const r = await rpcCall(sb, "h7_basvuru_red", { p_uye: id });
    if (!r.ok) return notify("Güncellenemedi: " + r.error);
    setMembers((cur) => cur.map((m) => (m.id === id ? { ...m, panel_request: false } : m)));
    notify("Başvuru reddedildi.");
  }
  /** Bu kullanıcı, hedef üyenin rolünü değiştirebilir mi? (veritabanındaki kuralın arayüz karşılığı) */
  const canEditRole = (m: Profile) => m.id !== profile.id && m.role !== "ceo" && (isCeo || (profile.role === "admin" && m.role !== "admin"));
  const roleOptions: Exclude<RoleId, "ceo">[] = isCeo ? ["admin", "mod", "amele", "member"] : ["mod", "amele", "member"];
  const canBan = (m: Profile) => m.id !== profile.id && m.role !== "ceo" && (m.role !== "admin" || isCeo) && (m.role === "member" || isAdmin);

  const applicants = members.filter((m) => m.panel_request && m.role === "member" && !m.banned);
  const memberLabel = (m: Profile) => m.full_name || m.username || m.email || "İsimsiz";

  const membersTab = (
    <>
      <Title eyebrow="Topluluk" title="Üyeler" desc={`Toplam ${members.length} kayıtlı hesap.`} />

      {isAdmin && applicants.length > 0 && (
        <div className={`${card} mb-6 border-[3px] bg-[#fff6cf] p-5 sm:p-6`}>
          <h2 className="hd text-xl font-extrabold">Yönetici başvuruları · {applicants.length}</h2>
          <p className="mb-4 mt-1 text-sm text-[#686868]">Panele giriş için kayıt olanlar. Rol seçip onayla ya da reddet.</p>
          <div className="space-y-3">
            {applicants.map((m) => (
              <ApplicantRow
                key={m.id}
                name={memberLabel(m)}
                sub={`${m.username || m.email} · ${new Date(m.created_at).toLocaleDateString("tr-TR")}`}
                allowAdmin={isCeo}
                onApprove={(role) => setMemberRole(m.id, role)}
                onReject={() => rejectApplicant(m.id)}
              />
            ))}
          </div>
        </div>
      )}

      {isAdmin && (
        <RolesPanel sb={sb} notify={notify} perms={perms} onChange={setPerms} viewAs={viewAs} onViewAs={setViewAs} />
      )}

      <div className={`${card} overflow-hidden`}>
        {members.length === 0 && <p className="p-6 text-sm text-[#686868]">Henüz üye yok.</p>}
        {members.map((m) => {
          const self = m.id === profile.id;
          return (
            <div key={m.id} className="flex flex-col gap-3 border-b border-[#111]/10 p-5 last:border-0 sm:flex-row sm:flex-wrap sm:items-center sm:justify-between">
              <div className="min-w-0">
                <p className="truncate font-bold">
                  {memberLabel(m)} {self && <span className="ml-1 text-xs text-[#686868]">(sen)</span>}
                </p>
                <p className="truncate text-xs text-[#686868]">
                  {m.username || m.email} · {new Date(m.created_at).toLocaleDateString("tr-TR")}
                  {m.account_type ? ` · ${m.account_type}` : ""}
                </p>
              </div>
              <div className="flex flex-wrap items-center gap-2">
                {isAdmin && canEditRole(m) ? (
                  <select
                    value={m.role}
                    onChange={(e) => {
                      const r = e.target.value as Exclude<RoleId, "ceo">;
                      if (confirm(`${memberLabel(m)} için rol “${ROLE_LABEL[r]}” olsun mu?`)) setMemberRole(m.id, r);
                    }}
                    aria-label="Rol"
                    className="field rounded-full border-[2.5px] border-[#111] bg-white px-3 py-2 text-sm font-bold outline-none disabled:opacity-50"
                  >
                    {Array.from(new Set([m.role, ...roleOptions])).map((r) => (
                      <option key={r} value={r} disabled={r === "ceo" || !(roleOptions as RoleId[]).includes(r)}>{ROLE_LABEL[r as RoleId] || r}</option>
                    ))}
                  </select>
                ) : (
                  <span className={`rounded-full border-2 border-[#111] px-3 py-1 text-xs font-bold ${m.role === "ceo" ? "bg-[#111] text-[#f5c518]" : ""}`}>
                    {m.role === "ceo" ? "♛ " : ""}{ROLE_LABEL[m.role] || m.role}
                  </span>
                )}
                <button
                  type="button"
                  disabled={!canBan(m)}
                  className={btnGhost}
                  onClick={() => {
                    if (!m.banned && !confirm(`${memberLabel(m)} engellensin mi? Siteye ve panele giremez.`)) return;
                    setMemberBan(m.id, !m.banned);
                  }}
                >
                  {m.banned ? "Engeli kaldır" : "Engelle"}
                </button>
                {m.banned && <span className="rounded-full bg-[#111] px-3 py-1 text-xs font-bold text-[#f5c518]">ENGELLİ</span>}
                {isCeo && !viewAs && (m.role === "mod" || m.role === "amele") && (
                  <button type="button" className={btnGhost} onClick={() => setYetkiUye(yetkiUye === m.id ? null : m.id)}>
                    {yetkiUye === m.id ? "Yetkileri kapat" : "Yetkiler"}
                  </button>
                )}
              </div>
              {yetkiUye === m.id && (m.role === "mod" || m.role === "amele") && (
                <UyeYetkileri
                  sb={sb}
                  notify={notify}
                  uyeId={m.id}
                  uyeAdi={memberLabel(m)}
                  rolVarsayilani={perms[m.role] || []}
                  onKapat={() => setYetkiUye(null)}
                />
              )}
            </div>
          );
        })}
      </div>
    </>
  );

  const settingsTab = (
    <>
      <SettingsTab
        sb={sb}
        profile={profile}
        content={content}
        onLogout={onLogout}
        notify={notify}
        onResetDefaults={() => {
          setDraft(DEFAULT_CONTENT);
          setTab("content");
          notify("Varsayılanlar yüklendi. Kaydet’e basarsan uygulanır.");
        }}
      />
      {isCeo && !viewAs && (
        <div className="mt-6">
          <DepolamaDurumu sb={sb} notify={notify} />
        </div>
      )}
    </>
  );

  const aiTab = (
    <AiTab
      sb={sb}
      content={content}
      context={{
        // Uzun yasal metinler bağlama eklenmez (asistanın satış ve trafik verisine yer kalsın)
        content: { ...content, legal: undefined },
        traffic7: {
          views: week.totalViews,
          visitors: week.totalVisitors,
          previousViews: week.prevViews,
          previousVisitors: week.prevVisitors,
          topPages: week.topPages.slice(0, 5),
          sources: week.sources.slice(0, 5),
          devices: week.devices,
          countries: week.countries.slice(0, 5),
          daily: week.days.map((d) => [d.label, d.views, d.visitors]),
        },
        traffic30: { views: month.totalViews, visitors: month.totalVisitors, topPages: month.topPages.slice(0, 5) },
        orders: {
          total: orders.length,
          byStatus: Object.fromEntries(countBy(orders, (o) => o.status, 10)),
        },
        members: { total: members.length },
        // Veritabanından gelen satış / ciro / cüzdan / yayın özetleri (yalnızca CEO ve admin)
        sales: ceoStats,
      }}
      canApply={isCeo}
      onApply={async (p) => {
        const result = applyProposal(content, p);
        if (!result) return false;
        const ok = await persist(result.next, result.keys);
        if (ok) notify("Değişiklik uygulandı.");
        return ok;
      }}
    />
  );

  const sections: Record<TabId, React.ReactNode> = {
    ceo: <CeoDashboard sb={sb} name={profile.full_name ? profile.full_name.split(" ")[0] : "patron"} onJump={(id) => setTab(id as TabId)} />,
    releases: <ReleasesTab sb={sb} notify={notify} />,
    audit: <AuditTab sb={sb} />,
    overview,
    traffic: trafficTab,
    content: contentTab,
    services: servicesTab,
    producers: producersTab,
    orders: <OrdersTab sb={sb} notify={notify} initialSearch={orderSearch} />,
    deliveries: <TeslimatlarTab sb={sb} notify={notify} />,
    packages: <PaketlerTab sb={sb} notify={notify} isCeo={isCeo && !viewAs} />,
    finance: <FinansTab sb={sb} />,
    support: (
      <SupportTab
        sb={sb}
        notify={notify}
        canOrders={can("orders")}
        onNewCount={setSupportNew}
        onJumpOrder={(code) => {
          setOrderSearch(code);
          setTab("orders");
        }}
      />
    ),
    wallet: <WalletTab sb={sb} notify={notify} canAdjust={isAdmin && !viewAs} />,
    payments: <PaymentsTab sb={sb} notify={notify} />,
    influencers: <InfluencersTab sb={sb} notify={notify} isCeo={isCeo && !viewAs} />,
    smm: <SmmTab sb={sb} notify={notify} />,
    members: membersTab,
    ai: aiTab,
    settings: settingsTab,
  };

  const initials = (profile.full_name || profile.email || "AD")
    .split(/[\s@]/)
    .filter(Boolean)
    .slice(0, 2)
    .map((s) => s[0]?.toUpperCase())
    .join("");

  return (
    <div>
      <header className="sticky top-0 z-30 border-b-[3px] border-[#111] bg-white/90 backdrop-blur">
        <div className="mx-auto flex h-16 max-w-[1500px] items-center justify-between px-4 sm:px-7">
          <Link href="/" className="hd inline-flex items-baseline gap-[3px] text-2xl font-extrabold leading-none tracking-[-0.05em]">
            HITY7<span className="inline-block h-[9px] w-[9px] rounded-full border-2 border-[#111] bg-[#f5c518]" />
            <span className={`ml-3 hidden rounded-full px-3 py-1 text-[11px] font-bold tracking-[0.14em] sm:inline ${isCeo ? "bg-[#f5c518] text-[#111] shadow-[0_0_0_2px_#111]" : "bg-[#111] text-[#f5c518]"}`}>
              {isCeo ? "♛ CEO" : "ADMIN"}
            </span>
          </Link>
          <div className="flex items-center gap-3">
            <a href="/" target="_blank" rel="noreferrer" className={btnGhost + " hidden sm:inline-block"}>
              Siteyi aç ↗
            </a>
            <div className="flex items-center gap-2">
              <div className="flex h-9 w-9 items-center justify-center rounded-full border-[2.5px] border-[#111] bg-[#f5c518] text-xs font-bold">{initials}</div>
              <div className="hidden sm:block">
                <p className="text-xs font-semibold">{profile.full_name || profile.username || ROLE_LABEL[profile.role]}</p>
                <p className="text-[11px] text-[#686868]">{ROLE_LABEL[profile.role]}</p>
              </div>
            </div>
          </div>
        </div>
      </header>

      <div className="mx-auto grid max-w-[1500px] lg:grid-cols-[260px_1fr]">
        <aside className="hidden min-h-[calc(100vh-64px)] border-r-[3px] border-[#111] bg-white p-5 lg:block">
          <p className="mb-4 px-3 text-[11px] font-bold uppercase tracking-[0.2em] text-[#686868]">Yönetim</p>
          <nav className="space-y-1">
            {navTabs.map((t) => (
              <button
                key={t.id}
                type="button"
                onClick={() => setTab(t.id)}
                aria-current={tab === t.id ? "page" : undefined}
                className={`flex w-full items-center gap-3 rounded-xl px-3 py-3 text-left text-sm transition ${
                  tab === t.id
                    ? "border-[2.5px] border-[#111] bg-[#f5c518] font-bold text-[#111]"
                    : "border-[2.5px] border-transparent text-[#242424] hover:bg-[#f5f5f5] hover:text-[#111]"
                }`}
              >
                <span className="w-5 text-center text-base">{t.icon}</span>
                {t.label}
                {t.id === "support" && supportNew > 0 && (
                  <span className="ml-auto rounded-full bg-[#111] px-2 py-0.5 text-[11px] font-bold text-[#f5c518]">{supportNew}</span>
                )}
              </button>
            ))}
          </nav>
          <button
            type="button"
            onClick={onLogout}
            className="mt-8 w-full rounded-2xl px-3 py-3 text-left text-sm font-semibold text-[#686868] hover:bg-[#f5f5f5]"
          >
            ↗ Çıkış yap
          </button>
        </aside>

        <section className="min-w-0 px-4 py-7 pb-32 sm:px-7 sm:py-10 lg:px-10">
          <nav className="-mx-4 mb-6 flex gap-2 overflow-x-auto px-4 pb-2 lg:hidden" aria-label="Bölümler">
            {navTabs.map((t) => (
              <button
                key={t.id}
                type="button"
                onClick={() => setTab(t.id)}
                aria-current={tab === t.id ? "page" : undefined}
                className={`flex-none rounded-full border-[2.5px] border-[#111] px-4 py-2 text-sm font-bold ${
                  tab === t.id ? "bg-[#f5c518] shadow-[0_3px_0_#111]" : "bg-white"
                }`}
              >
                {t.icon} {t.label}{t.id === "support" && supportNew > 0 ? ` (${supportNew})` : ""}
              </button>
            ))}
          </nav>

          {isAdmin && viewAs && (
            <p className="mb-5 flex flex-wrap items-center justify-between gap-3 rounded-2xl border-[2.5px] border-[#111] bg-[#f5c518] p-4 text-sm font-bold">
              Şu an “{viewAs === "mod" ? "Moderatör" : viewAs === "amele" ? "Personel" : "Kullanıcı"}” gözüyle bakıyorsun.
              <button type="button" className={btnGhost} onClick={() => setViewAs("")}>Kendi gözüne dön</button>
            </p>
          )}

          {dataError && (
            <p role="alert" className="mb-5 rounded-2xl border-[2.5px] border-[#111] bg-[#fff6cf] p-4 text-sm font-semibold">
              {dataError}
            </p>
          )}

          <div className="mx-auto max-w-5xl">{loaded ? sections[tab] : <p className="text-sm font-bold tracking-[0.14em] text-[#686868]">VERİLER YÜKLENİYOR…</p>}</div>
        </section>
      </div>

      {toast && (
        <div role="status" className="fixed bottom-24 left-1/2 z-50 -translate-x-1/2 rounded-full border-[2.5px] border-[#111] bg-[#111] px-5 py-3 text-sm font-bold text-[#f5c518] shadow-[0_5px_0_#f5c518] lg:bottom-8">
          {toast}
        </div>
      )}
    </div>
  );
}

function ApplicantRow({
  name,
  sub,
  allowAdmin,
  onApprove,
  onReject,
}: {
  name: string;
  sub: string;
  allowAdmin: boolean;
  onApprove: (role: "admin" | "mod" | "amele") => void;
  onReject: () => void;
}) {
  const [role, setRole] = useState<"mod" | "amele" | "admin">("amele");
  return (
    <div className="flex flex-col gap-3 rounded-2xl border-2 border-[#111] bg-white p-4 sm:flex-row sm:items-center sm:justify-between">
      <div className="min-w-0">
        <p className="truncate font-bold">{name}</p>
        <p className="truncate text-xs text-[#686868]">{sub}</p>
      </div>
      <div className="flex flex-wrap items-center gap-2">
        <select
          value={role}
          onChange={(e) => setRole(e.target.value as "mod" | "amele" | "admin")}
          aria-label="Verilecek rol"
          className="field rounded-full border-[2.5px] border-[#111] bg-white px-3 py-2 text-sm font-bold outline-none"
        >
          <option value="amele">Personel</option>
          <option value="mod">Moderatör</option>
          {allowAdmin && <option value="admin">Admin</option>}
        </select>
        <button type="button" className={btnPrimary + " !px-4 !py-2 !text-xs"} onClick={() => onApprove(role)}>Onayla</button>
        <button type="button" className={btnGhost} onClick={onReject}>Reddet</button>
      </div>
    </div>
  );
}

/* ================================================================== */
/*  AYARLAR                                                            */
/* ================================================================== */

function SettingsTab({
  sb,
  profile,
  content,
  onLogout,
  notify,
  onResetDefaults,
}: {
  sb: NonNullable<ReturnType<typeof getSupabase>>;
  profile: Profile;
  content: SiteContent;
  onLogout: () => void;
  notify: (t: string) => void;
  onResetDefaults: () => void;
}) {
  const [pw, setPw] = useState("");
  const [busy, setBusy] = useState(false);

  async function changePassword(e: React.FormEvent) {
    e.preventDefault();
    if (pw.length < 8) return notify("Şifre en az 8 karakter olmalı.");
    setBusy(true);
    const { error } = await sb.auth.updateUser({ password: pw });
    setBusy(false);
    if (error) notify(error.message);
    else {
      setPw("");
      notify("Şifre güncellendi.");
    }
  }

  function exportContent() {
    const blob = new Blob([JSON.stringify(content, null, 2)], { type: "application/json" });
    const url = URL.createObjectURL(blob);
    const a = document.createElement("a");
    a.href = url;
    a.download = "hity7-site-icerik.json";
    a.click();
    URL.revokeObjectURL(url);
  }

  return (
    <>
      <Title eyebrow="Hesap ve sistem" title="Ayarlar" />
      <div className="space-y-6">
        <div className={`${card} p-5 sm:p-7`}>
          <h2 className="hd text-xl font-extrabold">Hesabım</h2>
          <p className="mt-2 text-sm text-[#686868]">{profile.email} · Rol: Admin</p>
          <form onSubmit={changePassword} className="mt-5 flex flex-col gap-3 sm:flex-row">
            <input
              className={inputCls}
              type="password"
              autoComplete="new-password"
              placeholder="Yeni şifre (en az 8 karakter)"
              value={pw}
              onChange={(e) => setPw(e.target.value)}
            />
            <button type="submit" disabled={busy} className={btnPrimary + " flex-none"}>
              Şifreyi değiştir
            </button>
          </form>
          <button type="button" onClick={onLogout} className={btnGhost + " mt-5 !py-3"}>
            ↗ Çıkış yap
          </button>
        </div>

        <div className={`${card} p-5 sm:p-7`}>
          <h2 className="hd text-xl font-extrabold">Yedek ve sıfırlama</h2>
          <p className="mt-2 text-sm text-[#686868]">Site yazılarını, hizmetleri ve prodüktörleri dosya olarak indir veya varsayılan haline döndür.</p>
          <div className="mt-5 flex flex-wrap gap-3">
            <button type="button" className={btnGhost + " !py-3"} onClick={exportContent}>
              ↓ İçeriği indir (JSON)
            </button>
            <button
              type="button"
              className={btnGhost + " !py-3"}
              onClick={() => {
                if (confirm("Tüm içerik varsayılana dönsün mü? (Kaydet’e basana kadar uygulanmaz)")) onResetDefaults();
              }}
            >
              Varsayılana dön
            </button>
          </div>
        </div>
      </div>
    </>
  );
}

/* ================================================================== */
/*  AI ASİSTAN                                                         */
/* ================================================================== */

function AiTab({
  sb,
  content,
  context,
  canApply,
  onApply,
}: {
  sb: NonNullable<ReturnType<typeof getSupabase>>;
  content: SiteContent;
  context: unknown;
  /** Yapay zekâ önerilerini yalnızca CEO uygulayabilir (kritik değişiklikler CEO onayı ister). */
  canApply: boolean;
  onApply: (p: Proposal) => Promise<boolean>;
}) {
  const [messages, setMessages] = useState<ChatMsg[]>([]);
  const [input, setInput] = useState("");
  const [busy, setBusy] = useState(false);
  const endRef = useRef<HTMLDivElement>(null);

  useEffect(() => {
    endRef.current?.scrollIntoView({ behavior: "smooth", block: "end" });
  }, [messages, busy]);

  const quick = [
    "Bu ayın satışlarını ve ciroyu hizmet bazında yorumla.",
    "Son 7 günün trafiğini yorumla ve ne yapmam gerektiğini söyle.",
    "Bekleyen siparişlere ve iadelere göre önceliklerimi sırala.",
    "Önümüzdeki ay için bir kampanya planı öner.",
    "Prodüktör fiyatlarını satış verisine göre gözden geçir.",
    "Hizmet açıklamalarını daha satış odaklı yaz.",
  ];

  async function send(text: string) {
    const value = text.trim();
    if (!value || busy) return;
    const history: ChatMsg[] = [...messages, { role: "user", content: value }];
    setMessages(history);
    setInput("");
    setBusy(true);
    try {
      const { data } = await sb.auth.getSession();
      const token = data.session?.access_token;
      const res = await fetch("/api/admin-ai", {
        method: "POST",
        headers: { "Content-Type": "application/json", Authorization: `Bearer ${token}` },
        body: JSON.stringify({
          messages: history.map((m) => ({ role: m.role, content: m.content })),
          context,
        }),
      });
      const json = await res.json().catch(() => ({}));
      if (!res.ok) {
        const msg =
          json.error === "ANTHROPIC_API_KEY_MISSING"
            ? "Yapay zekâ henüz bağlı değil. ANTHROPIC_API_KEY anahtarını siteye eklemen gerekiyor (KURULUM.md, 5. adım)."
            : json.error || "Bir hata oluştu.";
        setMessages([...history, { role: "assistant", content: msg, error: true }]);
      } else {
        setMessages([
          ...history,
          {
            role: "assistant",
            content: json.text || (json.proposals?.length ? "Aşağıdaki değişiklikleri önerdim." : "…"),
            proposals: json.proposals || [],
            done: {},
          },
        ]);
      }
    } catch {
      setMessages([...history, { role: "assistant", content: "Bağlantı hatası. Tekrar dene.", error: true }]);
    }
    setBusy(false);
  }

  async function decide(mi: number, p: Proposal, apply: boolean) {
    let status: "applied" | "skipped" = "skipped";
    if (apply) {
      const ok = await onApply(p);
      status = ok ? "applied" : "skipped";
    }
    setMessages((cur) =>
      cur.map((m, i) => (i === mi ? { ...m, done: { ...(m.done || {}), [p.id]: status } } : m))
    );
  }

  return (
    <>
      <Title eyebrow="Claude ile çalış" title="AI Asistan" desc="Satışları ve trafiği yorumlat, kampanya planla, fiyatları tartış, metin yazdır. Değişiklik gerekiyorsa öneri olarak gelir; CEO onaylamadan hiçbir şey değişmez." />

      <div className={`${card} flex min-h-[460px] flex-col p-4 sm:p-6`}>
        <div className="flex-1 space-y-4 overflow-y-auto pb-4">
          {messages.length === 0 && (
            <div className="flex flex-col items-center py-6 text-center">
              <div className="kid-wrap h-[170px] w-[132px]">
                <KidMascot />
              </div>
              <p className="hd mt-3 text-2xl font-extrabold tracking-[-0.03em]">Ne yapmamı istersin?</p>
              <div className="mt-5 flex max-w-xl flex-wrap justify-center gap-2">
                {quick.map((q) => (
                  <button key={q} type="button" onClick={() => send(q)} className={btnGhost + " !py-2.5 text-left"}>
                    {q}
                  </button>
                ))}
              </div>
            </div>
          )}

          {messages.map((m, mi) => (
            <div key={mi} className={m.role === "user" ? "flex justify-end" : "flex justify-start"}>
              <div
                className={`max-w-[88%] rounded-3xl border-[2.5px] border-[#111] px-4 py-3 text-sm leading-6 ${
                  m.role === "user" ? "bg-[#f5c518]" : m.error ? "bg-[#fff6cf]" : "bg-white"
                }`}
              >
                <p className="whitespace-pre-wrap">{m.content}</p>
                {m.proposals && m.proposals.length > 0 && (
                  <div className="mt-3 space-y-2">
                    {m.proposals.map((p) => {
                      const state = m.done?.[p.id];
                      return (
                        <div key={p.id} className="rounded-2xl border-2 border-[#111] bg-[#f5f5f5] p-3">
                          <p className="text-[11px] font-bold uppercase tracking-[0.12em] text-[#686868]">Öneri</p>
                          <p className="mt-1 font-semibold">{describeProposal(p, content)}</p>
                          <div className="mt-3 flex gap-2">
                            {state ? (
                              <span className="rounded-full bg-[#111] px-3 py-1 text-xs font-bold text-[#f5c518]">
                                {state === "applied" ? "✓ Uygulandı" : "Yok sayıldı"}
                              </span>
                            ) : !canApply ? (
                              <span className="rounded-full border-2 border-[#111] bg-white px-3 py-1 text-xs font-bold">CEO onayı gerekir</span>
                            ) : (
                              <>
                                <button type="button" className={btnPrimary + " !px-4 !py-2 !text-xs"} onClick={() => decide(mi, p, true)}>
                                  Uygula
                                </button>
                                <button type="button" className={btnGhost} onClick={() => decide(mi, p, false)}>
                                  Yok say
                                </button>
                              </>
                            )}
                          </div>
                        </div>
                      );
                    })}
                  </div>
                )}
              </div>
            </div>
          ))}

          {busy && (
            <div className="flex justify-start">
              <div className="rounded-3xl border-[2.5px] border-[#111] bg-white px-4 py-3 text-sm font-semibold">Düşünüyor…</div>
            </div>
          )}
          <div ref={endRef} />
        </div>

        <form
          onSubmit={(e) => {
            e.preventDefault();
            send(input);
          }}
          className="flex gap-2 border-t-2 border-[#111]/10 pt-4"
        >
          <input
            className={inputCls}
            value={input}
            onChange={(e) => setInput(e.target.value)}
            placeholder="Örn: Slogan’ı daha iddialı yap ve duyuru çubuğuna yılbaşı kampanyası yaz"
            aria-label="Mesajın"
          />
          <button type="submit" disabled={busy || !input.trim()} className={btnPrimary + " flex-none"}>
            Gönder
          </button>
        </form>
      </div>
    </>
  );
}
