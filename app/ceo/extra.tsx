"use client";

/**
 * app/ceo/extra.tsx
 * Yönetim panelinin (/ceo) bölümleri: Siparişler, Cüzdan, Influencerlar, SMM Sağlayıcıları,
 * Ödeme Yöntemleri, örnek ses alanları ve patron karakteri.
 */

import { useCallback, useEffect, useMemo, useState } from "react";
import type { getSupabase } from "../../lib/supabase";
import { OrderWorkbench, rpcCall, smmBulkRefresh } from "./ceo-extra";

type SB = NonNullable<ReturnType<typeof getSupabase>>;
type Notify = (text: string) => void;

/* ================================================================== */
/*  ORTAK PARÇALAR                                                     */
/* ================================================================== */

const card = "rounded-3xl border-[2.5px] border-[#111] bg-white";
const inputCls = "field w-full rounded-2xl border-[2.5px] border-[#111] bg-white px-4 py-3 text-base outline-none transition";
const btnPrimary =
  "rounded-full border-[2.5px] border-[#111] bg-[#f5c518] px-5 py-3 text-sm font-bold text-[#111] shadow-[0_4px_0_#111] transition hover:-translate-y-0.5 hover:bg-[#e5b600] hover:shadow-[0_6px_0_#111] active:translate-y-[2px] active:shadow-[0_1px_0_#111] disabled:cursor-not-allowed disabled:opacity-50 disabled:hover:translate-y-0";
const btnGhost = "rounded-full border-[2.5px] border-[#111] bg-white px-4 py-2 text-xs font-bold transition hover:bg-[#f5c518] disabled:opacity-50";

const tl = (n: number) => new Intl.NumberFormat("tr-TR", { maximumFractionDigits: 2 }).format(n || 0) + " TL";
const fmt = (n: number) => new Intl.NumberFormat("tr-TR").format(n || 0);
const dateTr = (s: string) => new Date(s).toLocaleDateString("tr-TR", { day: "numeric", month: "short" });

function Head({ eyebrow, title, desc }: { eyebrow: string; title: string; desc?: string }) {
  return (
    <div className="mb-7">
      <p className="mb-3 inline-flex items-center gap-2 rounded-full border-2 border-[#111] bg-white px-3 py-1 text-[11px] font-bold uppercase tracking-[0.14em]">{eyebrow}</p>
      <h1 className="hd text-[34px] font-extrabold leading-none tracking-[-0.045em] sm:text-5xl">{title}</h1>
      {desc && <p className="mt-3 max-w-2xl text-base text-[#686868]">{desc}</p>}
    </div>
  );
}

function Field({
  label,
  value,
  onChange,
  type = "text",
  placeholder,
  hint,
  onBlur,
}: {
  label: string;
  value: string | number;
  onChange: (v: string) => void;
  type?: string;
  placeholder?: string;
  hint?: string;
  onBlur?: () => void;
}) {
  return (
    <label className="block">
      <span className="mb-2 block text-sm font-bold">{label}</span>
      <input className={inputCls} type={type} value={value} placeholder={placeholder} onChange={(e) => onChange(e.target.value)} onBlur={onBlur} />
      {hint && <span className="mt-1.5 block text-xs text-[#686868]">{hint}</span>}
    </label>
  );
}

function StatBox({ label, value, sub }: { label: string; value: string; sub?: string }) {
  return (
    <div className={`${card} p-5`}>
      <div className="text-sm text-[#686868]">{label}</div>
      <div className="hd mt-3 whitespace-nowrap text-3xl font-extrabold tracking-[-0.04em] sm:text-[34px]">{value}</div>
      {sub && <div className="mt-1 text-xs font-semibold text-[#686868]">{sub}</div>}
    </div>
  );
}

function Chip({ active, onClick, children }: { active: boolean; onClick: () => void; children: React.ReactNode }) {
  return (
    <button
      type="button"
      onClick={onClick}
      className={`rounded-full border-[2.5px] border-[#111] px-4 py-2 text-sm font-semibold transition ${active ? "bg-[#f5c518] shadow-[0_3px_0_#111]" : "bg-white hover:bg-[#fffdf2]"}`}
    >
      {children}
    </button>
  );
}

function Badge({ tone, children }: { tone: "yellow" | "ink" | "plain"; children: React.ReactNode }) {
  const cls = tone === "yellow" ? "bg-[#f5c518] text-[#111]" : tone === "ink" ? "bg-[#111] text-[#f5c518]" : "bg-[#fff6cf] text-[#111]";
  return <span className={`inline-block rounded-full border-2 border-[#111] px-2.5 py-0.5 text-[11px] font-bold ${cls}`}>{children}</span>;
}

function Empty({ title, text }: { title: string; text: string }) {
  return (
    <div className="rounded-3xl border-[2.5px] border-dashed border-[#111] bg-white px-6 py-14 text-center">
      <div className="mx-auto mb-4 grid h-12 w-12 place-items-center rounded-full border-[2.5px] border-[#111] bg-[#f5c518] text-xl">◇</div>
      <h3 className="hd text-lg font-extrabold">{title}</h3>
      <p className="mx-auto mt-2 max-w-sm text-sm text-[#686868]">{text}</p>
    </div>
  );
}

function SetupNote({ message }: { message: string }) {
  return (
    <p role="alert" className="mb-5 rounded-2xl border-[2.5px] border-[#111] bg-[#fff6cf] p-4 text-sm font-semibold">
      {message} <span className="font-normal">Supabase’de <code>supabase.sql</code> dosyasının güncel halini çalıştırdığından emin ol.</span>
    </p>
  );
}

function AddRow({ onClick, children }: { onClick: () => void; children: React.ReactNode }) {
  return (
    <button
      type="button"
      onClick={onClick}
      className="flex w-full items-center justify-center gap-3 rounded-3xl border-[2.5px] border-dashed border-[#111] bg-white p-5 text-sm font-bold transition hover:bg-[#fffdf2]"
    >
      <span className="grid h-10 w-10 place-items-center rounded-full border-[2.5px] border-[#111] bg-[#f5c518] text-xl">＋</span>
      {children}
    </button>
  );
}

const safeName = (n: string) => n.normalize("NFKD").replace(/[^\w.\-]+/g, "-").slice(-80);

async function uploadMedia(sb: SB, file: Blob, folder: string, name: string, contentType?: string) {
  const path = `${folder}/${Date.now()}-${safeName(name)}`;
  const { error } = await sb.storage.from("site-media").upload(path, file, { contentType: contentType || (file as File).type || undefined });
  if (error) throw new Error(error.message);
  return sb.storage.from("site-media").getPublicUrl(path).data.publicUrl;
}

/** Fotoğrafı kare kırpıp 640px'e küçültür (JPEG). */
function squarePhoto(file: File): Promise<Blob> {
  return new Promise((resolve, reject) => {
    const url = URL.createObjectURL(file);
    const img = new Image();
    img.onload = () => {
      const side = Math.min(img.width, img.height);
      const out = Math.min(640, side);
      const c = document.createElement("canvas");
      c.width = c.height = out;
      const ctx = c.getContext("2d");
      if (!ctx) return reject(new Error("Fotoğraf işlenemedi."));
      ctx.drawImage(img, (img.width - side) / 2, (img.height - side) / 2, side, side, 0, 0, out, out);
      URL.revokeObjectURL(url);
      c.toBlob((b) => (b ? resolve(b) : reject(new Error("Fotoğraf işlenemedi."))), "image/jpeg", 0.86);
    };
    img.onerror = () => {
      URL.revokeObjectURL(url);
      reject(new Error("Bu dosya bir görsel gibi görünmüyor."));
    };
    img.src = url;
  });
}

async function callSecure(sb: SB, body: Record<string, unknown>): Promise<{ ok: boolean; error?: string; [k: string]: unknown }> {
  const { data } = await sb.auth.getSession();
  const token = data.session?.access_token;
  if (!token) return { ok: false, error: "Oturum bulunamadı, tekrar giriş yap." };
  try {
    const res = await fetch("/api/admin-secure", {
      method: "POST",
      headers: { "content-type": "application/json", Authorization: `Bearer ${token}` },
      body: JSON.stringify(body),
    });
    const json = await res.json().catch(() => ({}));
    if (!res.ok) {
      if (json.error === "SUPABASE_SERVICE_ROLE_KEY_MISSING")
        return { ok: false, error: "SUPABASE_SERVICE_ROLE_KEY ortam değişkeni eklenmemiş (KURULUM.md, adım 8)." };
      return { ok: false, error: json.error || "İşlem başarısız oldu." };
    }
    return { ok: true, ...json };
  } catch {
    return { ok: false, error: "Sunucuya ulaşılamadı." };
  }
}

const normUrl = (u: string) => (!u ? "" : /^https?:\/\//i.test(u) ? u : "https://" + u);

/* ================================================================== */
/*  PATRON KARAKTERİ (göz kırpan)                                      */
/*  Dosyalar: public/patron.webp ve public/patron-goz.png              */
/* ================================================================== */

export function Patron({ width = 130, eyeDelay = 0 }: { width?: number; eyeDelay?: number }) {
  return (
    <div className="pt" style={{ width }} aria-hidden="true">
      <div className="pt-in">
        {/* eslint-disable-next-line @next/next/no-img-element */}
        <img className="pt-base" src="/patron.webp" alt="" draggable={false} />
        {/* eslint-disable-next-line @next/next/no-img-element */}
        <img className="pt-eye" src="/patron-goz.png" alt="" draggable={false} style={{ animationDelay: `${eyeDelay}s` }} />
      </div>
      <style>{`
        .pt { position: relative; overflow: hidden; aspect-ratio: 420 / 682; -webkit-mask-image: linear-gradient(#000 80%, transparent); mask-image: linear-gradient(#000 80%, transparent); flex: none; }
        .pt-in { position: absolute; left: 0; top: 0; width: 100%; aspect-ratio: 420 / 909; animation: ptfloat 3.6s ease-in-out infinite; }
        .pt-base { position: absolute; inset: 0; width: 100%; height: 100%; user-select: none; }
        .pt-eye { position: absolute; left: 36.08%; top: 25.33%; width: 13.57%; height: 4.73%; user-select: none; animation: ptwink 3.8s steps(1, end) infinite; }
        @keyframes ptwink { 0%, 70% { opacity: 1; } 71%, 79% { opacity: 0; } 80%, 100% { opacity: 1; } }
        @keyframes ptfloat { 0%, 100% { transform: translateY(0); } 50% { transform: translateY(-4px); } }
        @media (prefers-reduced-motion: reduce) { .pt-in { animation: none; } .pt-eye { animation: none; opacity: 0; } }
      `}</style>
    </div>
  );
}

/* ================================================================== */
/*  SİPARİŞLER                                                         */
/* ================================================================== */

type OrderRow = {
  id: number;
  code: string | null;
  user_id: string | null;
  customer_name: string | null;
  service: string;
  title: string | null;
  amount: number | null;
  status: string;
  type: string | null;
  payload: Record<string, unknown> | null;
  created_at: string;
};
type InfLite = { id: string; name: string; photo_url: string; price: number };

const ORDER_TYPES: { id: string; label: string }[] = [
  { id: "yayin", label: "Dijital Yayın" },
  { id: "smm", label: "SMM Panel" },
  { id: "influencer", label: "Influencer" },
  { id: "remake", label: "Remake Beat" },
  { id: "mix", label: "Mix & Mastering" },
];
export const ORDER_STATUSES = ["Ödeme Bekleniyor", "Alındı", "İşlemde", "Revizyon", "Tamamlandı", "İptal Edildi"];
/** Eski durum adlarını yenilerine çevirir (veritabanı migration'ı çalışmadan önceki kayıtlar için). */
const normStatus = (s: string) => (s === "Beklemede" ? "Alındı" : s === "İptal" ? "İptal Edildi" : s);

function orderType(o: OrderRow): string {
  if (o.type) return o.type;
  const s = (o.service || "").toLocaleLowerCase("tr");
  if (s.includes("yayın") || s.includes("yayin")) return "yayin";
  if (s.includes("smm")) return "smm";
  if (s.includes("influencer")) return "influencer";
  if (s.includes("remake")) return "remake";
  if (s.includes("mix")) return "mix";
  return "";
}

const HIDDEN_KEYS = new Set(["files", "dosyalar", "influencers", "influencerIds", "details"]);

function detailEntries(p: Record<string, unknown> | null): [string, string][] {
  if (!p) return [];
  if (Array.isArray(p.details)) {
    return (p.details as unknown[])
      .filter((r): r is unknown[] => Array.isArray(r) && r.length >= 2)
      .map((r) => [String(r[0]), String(r[1])]);
  }
  return Object.entries(p)
    .filter(([k, v]) => !HIDDEN_KEYS.has(k) && (typeof v === "string" || typeof v === "number" || typeof v === "boolean"))
    .map(([k, v]) => [k, typeof v === "boolean" ? (v ? "Evet" : "Hayır") : String(v)]);
}

/** Sepetten gelen siparişin kalemleri: ana hizmet + ek hizmetler (payload.items, sunucunun hesapladığı tutarlarla). */
type ItemRow = { kind: "main" | "addon"; name: string; qty: number; unitPrice: number; total: number };
function orderItems(p: Record<string, unknown> | null): ItemRow[] {
  const raw = p && Array.isArray(p.items) ? (p.items as unknown[]) : [];
  return raw.flatMap((x) => {
    const o = (x && typeof x === "object" ? x : {}) as Record<string, unknown>;
    if (!o.name) return [];
    return [{ kind: o.kind === "addon" ? "addon" : "main", name: String(o.name), qty: Number(o.qty) || 1, unitPrice: Number(o.unitPrice) || 0, total: Number(o.total) || 0 }];
  });
}

function fileEntries(p: Record<string, unknown> | null): { name: string; url?: string }[] {
  const raw = (p && (p.files || p.dosyalar)) as unknown;
  if (!Array.isArray(raw)) return [];
  return raw.map((f) => (typeof f === "string" ? { name: f } : { name: String((f as { name?: string }).name || "dosya"), url: (f as { url?: string }).url }));
}

export function OrdersTab({ sb, notify, initialSearch = "" }: { sb: SB; notify: Notify; initialSearch?: string }) {
  const [q, setQ] = useState(initialSearch);
  useEffect(() => setQ(initialSearch), [initialSearch]);
  const [rows, setRows] = useState<OrderRow[]>([]);
  const [infs, setInfs] = useState<InfLite[]>([]);
  const [filter, setFilter] = useState("all");
  const [open, setOpen] = useState<number | null>(null);
  const [err, setErr] = useState("");
  const [ready, setReady] = useState(false);

  const load = useCallback(async () => {
    const [o, i] = await Promise.all([
      sb.from("orders").select("id,code,user_id,customer_name,service,title,amount,status,type,payload,created_at").order("created_at", { ascending: false }).limit(300),
      sb.from("influencers").select("id,name,photo_url,price"),
    ]);
    if (o.error) setErr("Siparişler okunamadı.");
    setRows((o.data as OrderRow[]) || []);
    setInfs((i.data as InfLite[]) || []);
    setReady(true);
  }, [sb]);

  useEffect(() => {
    load();
  }, [load]);

  const counts = useMemo(() => {
    const c: Record<string, number> = { all: rows.length };
    rows.forEach((r) => {
      const t = orderType(r);
      c[t] = (c[t] || 0) + 1;
    });
    return c;
  }, [rows]);

  const qq = q.trim().toLowerCase();
  const shown = rows.filter(
    (r) =>
      (filter === "all" || orderType(r) === filter) &&
      (!qq || (r.code || "").toLowerCase().includes(qq) || (r.customer_name || "").toLowerCase().includes(qq) || (r.title || "").toLowerCase().includes(qq))
  );

  const [statusFilter, setStatusFilter] = useState("all");
  const [bulkBusy, setBulkBusy] = useState(false);

  // Durum değişikliği veritabanı fonksiyonuyla yapılır: yetki + işlem kaydı + (iptalde) tek seferlik iade
  async function setStatus(o: OrderRow, status: string) {
    if (status === normStatus(o.status)) return;
    let refund = false;
    if (status === "İptal Edildi") {
      if (!confirm(`${o.code || "#" + o.id} siparişi iptal edilsin mi?`)) return;
      if (Number(o.amount) > 0 && o.user_id) {
        refund = confirm(`${tl(Number(o.amount))} müşterinin bakiyesine iade edilsin mi?\n\nTamam: iade et · Vazgeç: iade etmeden iptal et`);
      }
    }
    const r = await rpcCall(sb, "h7_siparis_durum", { p_siparis: o.id, p_durum: status, p_not: null, p_iade: refund });
    if (!r.ok) return notify("Durum güncellenemedi: " + r.error);
    setRows((cur) => cur.map((x) => (x.id === o.id ? { ...x, status } : x)));
    notify(refund ? "Sipariş iptal edildi, tutar bakiyeye iade edildi." : "Sipariş durumu güncellendi.");
  }

  async function bulkSmm() {
    setBulkBusy(true);
    const r = await smmBulkRefresh(sb);
    setBulkBusy(false);
    notify(r.message);
    load();
  }

  const shownByStatus = shown.filter((r) => statusFilter === "all" || normStatus(r.status) === statusFilter);

  return (
    <>
      <Head eyebrow="İşlem takibi" title="Siparişler" desc="Dijital yayın, SMM, influencer, remake beat ve mix siparişlerini türüne göre ayrı ayrı gör. Durumu değiştir, teslim dosyası gönder, gerekirse iade et." />
      {err && <SetupNote message={err} />}
      <div className="mb-4 flex flex-wrap items-center gap-2">
        <input className={inputCls + " max-w-md"} placeholder="Sipariş koduna göre ara (örn. 7777-3-48213)" value={q} onChange={(e) => setQ(e.target.value)} />
        {(filter === "all" || filter === "smm") && (
          <button type="button" className={btnGhost} disabled={bulkBusy} onClick={bulkSmm}>
            {bulkBusy ? "Sorgulanıyor…" : "↻ SMM durumlarını güncelle"}
          </button>
        )}
      </div>
      <div className="mb-3 flex flex-wrap gap-2">
        <Chip active={statusFilter === "all"} onClick={() => setStatusFilter("all")}>Tüm durumlar</Chip>
        {ORDER_STATUSES.map((s) => (
          <Chip key={s} active={statusFilter === s} onClick={() => setStatusFilter(s)}>
            {s} · {shown.filter((r) => normStatus(r.status) === s).length}
          </Chip>
        ))}
      </div>
      <div className="mb-5 flex flex-wrap gap-2">
        <Chip active={filter === "all"} onClick={() => setFilter("all")}>Tümü · {counts.all || 0}</Chip>
        {ORDER_TYPES.map((t) => (
          <Chip key={t.id} active={filter === t.id} onClick={() => setFilter(t.id)}>
            {t.label} · {counts[t.id] || 0}
          </Chip>
        ))}
      </div>

      {!ready ? (
        <p className="text-sm font-bold tracking-[0.14em] text-[#686868]">YÜKLENİYOR…</p>
      ) : shownByStatus.length === 0 ? (
        <Empty title="Bu filtrede sipariş yok" text="Müşteriler hizmet sayfalarından sipariş verdikçe burada türüne ve durumuna göre listelenir." />
      ) : (
        <div className={`${card} overflow-hidden`}>
          {shownByStatus.map((o) => {
            const t = ORDER_TYPES.find((x) => x.id === orderType(o));
            const isOpen = open === o.id;
            const det = detailEntries(o.payload);
            const files = fileEntries(o.payload);
            const items = orderItems(o.payload);
            const addonCount = items.filter((x) => x.kind === "addon").length;
            const ids = Array.isArray(o.payload?.influencers) ? (o.payload!.influencers as unknown[]).map(String) : Array.isArray(o.payload?.influencerIds) ? (o.payload!.influencerIds as unknown[]).map(String) : [];
            const chosen = ids.map((id) => infs.find((x) => x.id === id)).filter(Boolean) as InfLite[];
            return (
              <div key={o.id} className="border-b border-[#111]/10 last:border-0">
                <div className="flex flex-col gap-3 p-5 sm:flex-row sm:items-center sm:justify-between">
                  <button type="button" className="min-w-0 text-left" onClick={() => setOpen(isOpen ? null : o.id)} aria-expanded={isOpen}>
                    <p className="flex flex-wrap items-center gap-2 text-xs text-[#686868]">
                      <b className="rounded-md bg-[#111] px-2 py-0.5 font-mono text-[11px] text-[#f5c518]">{o.code || "#" + o.id}</b> · {dateTr(o.created_at)} {t && <Badge tone="plain">{t.label}</Badge>}
                      {addonCount > 0 && <Badge tone="yellow">+ {addonCount} ek hizmet</Badge>}
                    </p>
                    <h3 className="mt-1 font-bold">{o.title || o.service}</h3>
                    <p className="mt-1 text-xs text-[#686868]">
                      {o.customer_name || "Müşteri"} · {isOpen ? "Detayı gizle ▲" : "Detayı gör ▼"}
                    </p>
                  </button>
                  <div className="flex items-center gap-3">
                    <span className="text-sm font-bold">{tl(o.amount || 0)}</span>
                    <select
                      value={normStatus(o.status)}
                      onChange={(e) => setStatus(o, e.target.value)}
                      aria-label="Sipariş durumu"
                      className="field rounded-full border-[2.5px] border-[#111] bg-white px-3 py-2 text-sm font-bold outline-none"
                    >
                      {Array.from(new Set([normStatus(o.status), ...ORDER_STATUSES])).map((s) => (
                        <option key={s}>{s}</option>
                      ))}
                    </select>
                  </div>
                </div>

                {isOpen && (
                  <div className="space-y-5 border-t-2 border-dashed border-[#111]/30 bg-[#f5f5f5] p-5">
                    {items.length > 0 && (
                      <div>
                        <p className="mb-2 text-[11px] font-bold uppercase tracking-[0.12em] text-[#686868]">Sipariş kalemleri</p>
                        <div className="overflow-hidden rounded-2xl border-2 border-[#111] bg-white">
                          {items.map((x, i) => (
                            <div key={i} className={`flex items-center justify-between gap-3 px-4 py-3 text-sm ${i ? "border-t border-[#111]/10" : ""} ${x.kind === "addon" ? "bg-[#fffdf2]" : ""}`}>
                              <span className="flex min-w-0 items-center gap-2">
                                <Badge tone={x.kind === "addon" ? "yellow" : "ink"}>{x.kind === "addon" ? "EK HİZMET" : "ANA HİZMET"}</Badge>
                                <span className="truncate font-semibold">{x.name}</span>
                              </span>
                              <span className="flex-none text-right">
                                <span className="text-xs text-[#686868]">
                                  {x.qty} × {tl(x.unitPrice)}
                                </span>{" "}
                                <b>{tl(x.total)}</b>
                              </span>
                            </div>
                          ))}
                          <div className="flex items-center justify-between border-t-2 border-[#111] px-4 py-3 text-sm">
                            <b>Sipariş toplamı</b>
                            <b>{tl(o.amount || 0)}</b>
                          </div>
                        </div>
                      </div>
                    )}
                    {det.length > 0 ? (
                      <dl className="grid gap-x-6 gap-y-3 sm:grid-cols-2">
                        {det.map(([k, v]) => (
                          <div key={k}>
                            <dt className="text-[11px] font-bold uppercase tracking-[0.12em] text-[#686868]">{k}</dt>
                            <dd className="mt-0.5 break-words text-sm font-semibold">{v}</dd>
                          </div>
                        ))}
                      </dl>
                    ) : (
                      <p className="text-sm text-[#686868]">Bu siparişte ek bilgi kaydedilmemiş.</p>
                    )}

                    {chosen.length > 0 && (
                      <div>
                        <p className="mb-2 text-[11px] font-bold uppercase tracking-[0.12em] text-[#686868]">Seçilen influencerlar</p>
                        <div className="flex flex-wrap gap-2">
                          {chosen.map((c) => (
                            <span key={c.id} className="inline-flex items-center gap-2 rounded-full border-2 border-[#111] bg-white py-1 pl-1 pr-3 text-xs font-bold">
                              {/* eslint-disable-next-line @next/next/no-img-element */}
                              <img src={c.photo_url} alt="" className="h-7 w-7 rounded-full border-2 border-[#111] object-cover" />
                              {c.name} · {tl(c.price)}
                            </span>
                          ))}
                        </div>
                      </div>
                    )}

                    {files.length > 0 && (
                      <div>
                        <p className="mb-2 text-[11px] font-bold uppercase tracking-[0.12em] text-[#686868]">Yüklenen dosyalar</p>
                        <ul className="space-y-2">
                          {files.map((f, i) => (
                            <li key={i} className="flex items-center justify-between gap-3 rounded-xl border-2 border-[#111] bg-white px-3 py-2 text-sm font-semibold">
                              <span className="min-w-0 truncate">{f.name}</span>
                              {f.url && (
                                <a href={f.url} target="_blank" rel="noreferrer" className={btnGhost}>
                                  İndir ↓
                                </a>
                              )}
                            </li>
                          ))}
                        </ul>
                      </div>
                    )}

                    <OrderWorkbench
                      sb={sb}
                      notify={notify}
                      order={{ id: o.id, code: o.code, type: orderType(o), status: normStatus(o.status), payload: o.payload }}
                      onChanged={load}
                    />
                  </div>
                )}
              </div>
            );
          })}
        </div>
      )}
    </>
  );
}

/* ================================================================== */
/*  CÜZDAN & BAKİYE                                                    */
/* ================================================================== */

type Tx = {
  id: number;
  user_id: string | null;
  kind: "topup" | "spend";
  amount: number;
  status: "ok" | "pending" | "failed";
  provider: string | null;
  note: string | null;
  created_at: string;
};
type Person = { id: string; full_name: string | null; email: string | null };

const PROVIDER_LABEL: Record<string, string> = {
  paytr: "Kart (PayTR)",
  havale: "Havale / EFT",
  admin: "Yönetim düzeltmesi",
  iade: "İade",
};

export function WalletTab({ sb, notify, canAdjust = false }: { sb: SB; notify: Notify; canAdjust?: boolean }) {
  const [txs, setTxs] = useState<Tx[]>([]);
  const [people, setPeople] = useState<Person[]>([]);
  const [filter, setFilter] = useState<"all" | "topup" | "spend" | "pending">("all");
  const [err, setErr] = useState("");
  const [ready, setReady] = useState(false);
  const [who, setWho] = useState("");
  const [amount, setAmount] = useState("");
  const [note, setNote] = useState("");
  const [dir, setDir] = useState<"ekle" | "dus">("ekle");
  const [busy, setBusy] = useState(false);

  const load = useCallback(async () => {
    const [t, p] = await Promise.all([
      sb.from("wallet_transactions").select("id,user_id,kind,amount,status,provider,note,created_at").order("created_at", { ascending: false }).limit(500),
      sb.from("profiles").select("id,full_name,email"),
    ]);
    if (t.error) setErr("Cüzdan hareketleri okunamadı.");
    setTxs((t.data as Tx[]) || []);
    setPeople((p.data as Person[]) || []);
    setReady(true);
  }, [sb]);

  useEffect(() => {
    load();
  }, [load]);

  // Onay / ret veritabanı fonksiyonuyla: yalnızca bekleyen kayıt, tek sefer, işlem kaydına yazılır
  async function decide(t: Tx, status: "ok" | "failed") {
    if (!confirm(status === "ok" ? `${tl(Number(t.amount))} bakiye yüklemesi onaylansın mı? Dekontu kontrol ettiğinden emin ol.` : "Bu yükleme reddedilsin mi?")) return;
    const r = await rpcCall(sb, "h7_bakiye_onay", { p_islem: t.id, p_onay: status === "ok", p_not: null });
    if (!r.ok) return notify("Güncellenemedi: " + r.error);
    notify(status === "ok" ? "Yükleme onaylandı, bakiye eklendi." : "Yükleme reddedildi.");
    load();
  }

  const nameOf = (id: string | null) => {
    const p = people.find((x) => x.id === id);
    return p ? p.full_name || p.email || "Üye" : "Silinmiş üye";
  };

  const ok = txs.filter((t) => t.status === "ok");
  const loaded = ok.filter((t) => t.kind === "topup").reduce((a, t) => a + Number(t.amount), 0);
  const spent = ok.filter((t) => t.kind === "spend").reduce((a, t) => a + Number(t.amount), 0);

  // Üye bakiyeleri: onaylı hareketlerden (yükleme − harcama); yalnızca gösterim
  const balances = useMemo(() => {
    const m = new Map<string, number>();
    for (const t of txs) {
      if (t.status !== "ok" || !t.user_id) continue;
      m.set(t.user_id, (m.get(t.user_id) || 0) + (t.kind === "topup" ? Number(t.amount) : -Number(t.amount)));
    }
    return Array.from(m.entries())
      .map(([id, b]) => {
        const p = people.find((x) => x.id === id);
        return { id, name: p ? p.full_name || p.email || "Üye" : "Silinmiş üye", balance: Math.round(b * 100) / 100 };
      })
      .sort((a, b) => b.balance - a.balance);
  }, [txs, people]);
  const balanceOf = (id: string) => balances.find((b) => b.id === id)?.balance ?? 0;
  const pending = txs.filter((t) => t.status === "pending").length;
  const shown = txs.filter((t) => filter === "all" || (filter === "pending" ? t.status === "pending" : t.kind === filter));

  // Manuel bakiye düzeltme: yalnızca CEO / admin, gerekçe zorunlu, işlem kaydına yazılır (veritabanında kontrol edilir)
  async function adjust() {
    const amt = Math.round(Number(amount) * 100) / 100;
    if (!who || !(amt > 0)) return notify("Üye seç ve geçerli bir tutar yaz.");
    if (note.trim().length < 5) return notify("Gerekçe zorunlu (en az 5 karakter).");
    const p = people.find((x) => x.id === who);
    if (!confirm(`${p?.full_name || p?.email || "Üye"} hesabına ${tl(amt)} ${dir === "ekle" ? "EKLENECEK" : "DÜŞÜLECEK"}.\nGerekçe: ${note.trim()}\n\nOnaylıyor musun?`)) return;
    setBusy(true);
    const r = await rpcCall<{ once: number; sonra: number }>(sb, "h7_bakiye_duzelt", { p_uye: who, p_tutar: amt, p_yon: dir, p_gerekce: note.trim() });
    setBusy(false);
    if (!r.ok) return notify("Düzeltme yapılamadı: " + r.error);
    setAmount("");
    setNote("");
    notify(`Bakiye düzeltildi: ${tl(Number(r.data?.once))} → ${tl(Number(r.data?.sonra))}`);
    load();
  }

  return (
    <>
      <Head eyebrow="Satış" title="Cüzdan & Bakiye" desc="Üyelerin yüklediği ve harcadığı bakiye." />
      {err && <SetupNote message={err} />}
      <div className="mb-7 grid gap-4 sm:grid-cols-2 xl:grid-cols-4">
        <StatBox label="Toplam yüklenen" value={tl(loaded)} />
        <StatBox label="Toplam harcanan" value={tl(spent)} />
        <StatBox label="Üyelerde kalan" value={tl(loaded - spent)} />
        <StatBox label="Bekleyen yükleme" value={String(pending)} sub="onay bekliyor" />
      </div>

      {balances.length > 0 && (
        <div className={`${card} mb-7 overflow-hidden`}>
          <div className="flex flex-wrap items-center justify-between gap-2 border-b border-[#111]/10 px-5 py-3">
            <h2 className="hd text-lg font-extrabold">Üye bakiyeleri</h2>
            <span className="text-xs text-[#686868]">{txs.length >= 500 ? "Son 500 hareket üzerinden" : "Onaylı hareketlerden hesaplanır"}</span>
          </div>
          {balances.slice(0, 50).map((b) => (
            <div key={b.id} className="flex items-center justify-between gap-3 border-b border-[#111]/10 px-5 py-3 text-sm last:border-0">
              <span className="min-w-0 truncate font-semibold">{b.name}</span>
              <b className="whitespace-nowrap">{tl(b.balance)}</b>
            </div>
          ))}
        </div>
      )}

      <div className="mb-5 flex flex-wrap gap-2">
        <Chip active={filter === "all"} onClick={() => setFilter("all")}>Tümü</Chip>
        <Chip active={filter === "pending"} onClick={() => setFilter("pending")}>Onay bekleyen · {pending}</Chip>
        <Chip active={filter === "topup"} onClick={() => setFilter("topup")}>Yüklenen</Chip>
        <Chip active={filter === "spend"} onClick={() => setFilter("spend")}>Harcanan</Chip>
      </div>

      {!ready ? (
        <p className="text-sm font-bold tracking-[0.14em] text-[#686868]">YÜKLENİYOR…</p>
      ) : shown.length === 0 ? (
        <Empty title="Henüz hareket yok" text="Üyeler bakiye yükleyip harcadıkça burada görünür. İstersen aşağıdan bir üyeye elle bakiye ekleyebilirsin." />
      ) : (
        <div className={`${card} mb-7 overflow-hidden`}>
          {shown.map((t) => (
            <div key={t.id} className="flex items-center justify-between gap-4 border-b border-[#111]/10 p-5 last:border-0">
              <div className="min-w-0">
                <p className="text-xs text-[#686868]">
                  {dateTr(t.created_at)} · {t.kind === "topup" ? "Yükleme" : "Harcama"}
                  {t.provider ? ` · ${PROVIDER_LABEL[t.provider] || t.provider}` : ""}
                  {t.status !== "ok" && (
                    <span className="ml-2">
                      <Badge tone={t.status === "pending" ? "plain" : "ink"}>{t.status === "pending" ? "Bekliyor" : "Başarısız"}</Badge>
                    </span>
                  )}
                </p>
                <p className="mt-1 truncate font-bold">{nameOf(t.user_id)}</p>
                {t.note && <p className="mt-0.5 truncate text-xs text-[#686868]">{t.note}</p>}
              </div>
              <div className="flex flex-none items-center gap-2">
                {t.status === "pending" && t.provider === "havale" && (
                  <>
                    <button type="button" className={btnPrimary + " !px-3 !py-1.5 !text-xs"} onClick={() => decide(t, "ok")}>Onayla</button>
                    <button type="button" className={btnGhost} onClick={() => decide(t, "failed")}>Reddet</button>
                  </>
                )}
                <span className={`whitespace-nowrap text-sm font-bold ${t.status === "failed" ? "line-through opacity-50" : ""}`}>
                  {t.kind === "topup" ? "+" : "−"} {tl(Number(t.amount))}
                </span>
              </div>
            </div>
          ))}
        </div>
      )}

      {!canAdjust ? (
        <p className="rounded-2xl border-[2.5px] border-dashed border-[#111] bg-white p-5 text-sm text-[#686868]">
          Manuel bakiye düzeltmesini yalnızca CEO veya admin yapabilir. Havale bildirimlerini yukarıdan onaylayabilirsin.
        </p>
      ) : (
      <div className={`${card} p-5 sm:p-7`}>
        <h2 className="hd mb-1 text-xl font-extrabold">Manuel bakiye düzeltme</h2>
        <p className="mb-5 text-sm text-[#686868]">Gerekçe zorunludur. Her düzeltme önceki ve sonraki bakiyeyle birlikte İşlem Kayıtları’na yazılır ve geri alınamaz; hatalı düzeltme ters yönde yeni bir düzeltmeyle giderilir.</p>
        <div className="mb-5 flex flex-wrap gap-2">
          <Chip active={dir === "ekle"} onClick={() => setDir("ekle")}>＋ Bakiye ekle</Chip>
          <Chip active={dir === "dus"} onClick={() => setDir("dus")}>− Bakiye düş</Chip>
        </div>
        <div className="grid gap-5 sm:grid-cols-2">
          <label className="block">
            <span className="mb-2 block text-sm font-bold">Üye</span>
            <select className={inputCls} value={who} onChange={(e) => setWho(e.target.value)}>
              <option value="">Üye seç…</option>
              {people.map((p) => (
                <option key={p.id} value={p.id}>
                  {(p.full_name || "İsimsiz") + " · " + (p.email || "")}
                </option>
              ))}
            </select>
            {who && (
              <span className="mt-1.5 block text-xs text-[#686868]">
                Mevcut bakiye: <b className="text-[#111]">{tl(balanceOf(who))}</b>
              </span>
            )}
          </label>
          <Field label="Tutar (TL)" type="number" value={amount} onChange={setAmount} placeholder="500" />
        </div>
        <div className="mt-5">
          <Field label="Gerekçe (zorunlu)" value={note} onChange={setNote} placeholder="Örn: 12.11 tarihli havale dekontu, sistem dışı ödeme" />
        </div>
        <button type="button" className={btnPrimary + " mt-6"} disabled={busy} onClick={adjust}>
          {busy ? "Kaydediliyor…" : dir === "ekle" ? "Bakiyeyi ekle →" : "Bakiyeden düş →"}
        </button>
      </div>
      )}
    </>
  );
}

/* ================================================================== */
/*  INFLUENCERLAR                                                      */
/* ================================================================== */

type Infl = {
  id: string;
  name: string;
  username: string | null;
  followers: number | null;
  price: number | null;
  tiktok: string | null;
  instagram: string | null;
  youtube: string | null;
  photo_url: string | null;
  active: boolean;
  sort: number;
};

type InflForm = { name: string; username: string; followers: string; price: string; tiktok: string; instagram: string; youtube: string };
const emptyInfl: InflForm = { name: "", username: "", followers: "", price: "", tiktok: "", instagram: "", youtube: "" };

function InflEditor({
  sb,
  notify,
  editing,
  onDone,
}: {
  sb: SB;
  notify: Notify;
  editing: Infl | null;
  onDone: () => void;
}) {
  const [f, setF] = useState<InflForm>(
    editing
      ? {
          name: editing.name,
          username: editing.username || "",
          followers: String(editing.followers ?? ""),
          price: String(editing.price ?? ""),
          tiktok: editing.tiktok || "",
          instagram: editing.instagram || "",
          youtube: editing.youtube || "",
        }
      : emptyInfl
  );
  const [file, setFile] = useState<File | null>(null);
  const [preview, setPreview] = useState(editing?.photo_url || "");
  const [busy, setBusy] = useState(false);
  const set = (patch: Partial<InflForm>) => setF((cur) => ({ ...cur, ...patch }));

  function pick(file: File | undefined) {
    if (!file) return;
    if (!file.type.startsWith("image/")) return notify("Lütfen bir görsel seç.");
    setFile(file);
    const r = new FileReader();
    r.onload = () => setPreview(String(r.result));
    r.readAsDataURL(file);
  }

  async function save() {
    if (!f.name.trim()) return notify("Ad gerekli.");
    setBusy(true);
    try {
      let photo = editing?.photo_url || "";
      if (file) photo = await uploadMedia(sb, await squarePhoto(file), "influencers", file.name.replace(/\.\w+$/, "") + ".jpg", "image/jpeg");
      const row = {
        name: f.name.trim(),
        username: f.username.trim(),
        followers: Math.max(0, Number(f.followers) || 0),
        price: Math.max(0, Number(f.price) || 0),
        tiktok: f.tiktok.trim(),
        instagram: f.instagram.trim(),
        youtube: f.youtube.trim(),
        photo_url: photo,
      };
      const { error } = editing
        ? await sb.from("influencers").update(row).eq("id", editing.id)
        : await sb.from("influencers").insert({ ...row, active: true, sort: Date.now() % 1000000 });
      if (error) throw new Error(error.message);
      notify(editing ? "Influencer güncellendi." : "Influencer eklendi ve sitede yayında.");
      onDone();
    } catch (e) {
      notify(e instanceof Error ? e.message : "Kaydedilemedi.");
    } finally {
      setBusy(false);
    }
  }

  return (
    <div className={`${card} mb-7 p-5 sm:p-7 ${editing ? "border-[3.5px]" : ""}`}>
      <div className="mb-5 flex items-center justify-between gap-3">
        <h2 className="hd text-xl font-extrabold">{editing ? `${editing.name} · düzenle` : "Yeni influencer ekle"}</h2>
        {editing && (
          <button type="button" className={btnGhost} onClick={onDone}>
            Kapat
          </button>
        )}
      </div>
      <div className="grid gap-5 sm:grid-cols-2">
        <Field label="Ad" value={f.name} onChange={(v) => set({ name: v })} placeholder="Örn: Creator 07" />
        <Field label="Kullanıcı adı" value={f.username} onChange={(v) => set({ username: v })} placeholder="@kullaniciadi" />
        <Field label="Takipçi sayısı" type="number" value={f.followers} onChange={(v) => set({ followers: v })} placeholder="125000" />
        <Field label="Fiyat (TL)" type="number" value={f.price} onChange={(v) => set({ price: v })} placeholder="4500" />
      </div>
      <div className="mt-5 grid gap-5 sm:grid-cols-3">
        <Field label="TikTok bağlantısı" value={f.tiktok} onChange={(v) => set({ tiktok: v })} placeholder="https://www.tiktok.com/@..." />
        <Field label="Instagram bağlantısı" value={f.instagram} onChange={(v) => set({ instagram: v })} placeholder="https://www.instagram.com/..." />
        <Field label="YouTube bağlantısı" value={f.youtube} onChange={(v) => set({ youtube: v })} placeholder="https://www.youtube.com/@..." />
      </div>
      <div className="mt-5">
        <span className="mb-2 block text-sm font-bold">Fotoğraf</span>
        <label className="flex cursor-pointer items-center gap-4 rounded-2xl border-[2.5px] border-dashed border-[#111] bg-white p-3 focus-within:outline focus-within:outline-[3px] focus-within:outline-offset-[3px] focus-within:outline-[#111]">
          {preview ? (
            // eslint-disable-next-line @next/next/no-img-element
            <img src={preview} alt="" className="h-20 w-16 rounded-[10px] border-2 border-[#111] object-cover" />
          ) : (
            <span className="grid h-20 w-16 place-items-center rounded-[10px] border-2 border-[#111] bg-[#f5f5f5] text-2xl">＋</span>
          )}
          <span>
            <b className="block text-sm">{preview ? "Fotoğrafı değiştir" : "Fotoğraf seç"}</b>
            <span className="text-xs text-[#686868]">JPG veya PNG. Otomatik küçültülür ve kare kırpılır.</span>
          </span>
          <input type="file" accept="image/*" className="sr-only" onChange={(e) => pick(e.target.files?.[0])} />
        </label>
      </div>
      <button type="button" className={btnPrimary + " mt-6"} disabled={busy} onClick={save}>
        {busy ? "Kaydediliyor…" : editing ? "Değişiklikleri kaydet →" : "Influencer’ı ekle →"}
      </button>
    </div>
  );
}

export function InfluencersTab({ sb, notify }: { sb: SB; notify: Notify }) {
  const [list, setList] = useState<Infl[]>([]);
  const [editing, setEditing] = useState<Infl | null>(null);
  const [formKey, setFormKey] = useState(0);
  const [err, setErr] = useState("");
  const [ready, setReady] = useState(false);

  const load = useCallback(async () => {
    const { data, error } = await sb.from("influencers").select("*").order("sort", { ascending: true }).order("created_at", { ascending: true });
    if (error) setErr("Influencerlar okunamadı.");
    setList((data as Infl[]) || []);
    setReady(true);
  }, [sb]);

  useEffect(() => {
    load();
  }, [load]);

  async function toggle(x: Infl) {
    const { error } = await sb.from("influencers").update({ active: !x.active }).eq("id", x.id);
    if (error) return notify("Güncellenemedi: " + error.message);
    notify(!x.active ? "Influencer sitede yayında." : "Influencer sitede gizlendi.");
    load();
  }

  async function remove(x: Infl) {
    if (!confirm(`“${x.name}” silinsin mi?`)) return;
    const { error } = await sb.from("influencers").delete().eq("id", x.id);
    if (error) return notify("Silinemedi: " + error.message);
    notify("Influencer silindi.");
    if (editing?.id === x.id) setEditing(null);
    load();
  }

  const done = () => {
    setEditing(null);
    setFormKey((k) => k + 1);
    load();
  };

  return (
    <>
      <Head eyebrow="Hizmetler" title="Influencerlar" desc="Influencer sayfasında görünen kişiler. Fotoğraf ve linkleri buradan yönet." />
      {err && <SetupNote message={err} />}

      {!ready ? (
        <p className="text-sm font-bold tracking-[0.14em] text-[#686868]">YÜKLENİYOR…</p>
      ) : list.length === 0 ? (
        <div className="mb-7">
          <Empty title="Henüz influencer yok" text="Aşağıdaki formdan ilk influencer’ını fotoğrafı ve linkleriyle ekle." />
        </div>
      ) : (
        <div className="mb-7 grid grid-cols-[repeat(auto-fill,minmax(230px,1fr))] gap-4">
          {list.map((x) => (
            <div key={x.id} className={`${card} flex flex-col overflow-hidden ${x.active ? "" : "opacity-60"}`}>
              {x.photo_url ? (
                // eslint-disable-next-line @next/next/no-img-element
                <img src={x.photo_url} alt={`${x.name} fotoğrafı`} className="aspect-[4/5] w-full border-b-[2.5px] border-[#111] bg-[#f5f5f5] object-cover" />
              ) : (
                <div className="grid aspect-[4/5] w-full place-items-center border-b-[2.5px] border-[#111] bg-[#f5f5f5] text-sm text-[#686868]">Fotoğraf yok</div>
              )}
              <div className="flex flex-1 flex-col gap-1.5 p-4">
                <strong className="hd text-lg">{x.name}</strong>
                <span className="text-[13px] text-[#686868]">
                  {x.username} · {fmt(x.followers || 0)} takipçi
                </span>
                <b>{tl(x.price || 0)}</b>
                <div className="flex flex-wrap gap-1.5">
                  {([["TikTok", x.tiktok], ["Instagram", x.instagram], ["YouTube", x.youtube]] as const).map(([l, u]) =>
                    u ? (
                      <a key={l} href={normUrl(u)} target="_blank" rel="noreferrer" className="rounded-full border-2 border-[#111] bg-white px-2.5 py-0.5 text-[11px] font-bold hover:bg-[#f5c518]">
                        {l} ↗
                      </a>
                    ) : (
                      <span key={l} className="rounded-full border-2 border-[#111] px-2.5 py-0.5 text-[11px] font-bold line-through opacity-30">
                        {l}
                      </span>
                    )
                  )}
                </div>
                <div className="mt-auto flex flex-wrap gap-2 pt-3">
                  <button type="button" className={btnGhost} onClick={() => setEditing(x)}>Düzenle</button>
                  <button type="button" className={btnGhost} onClick={() => toggle(x)}>{x.active ? "Gizle" : "Yayına al"}</button>
                  <button type="button" className={btnGhost} onClick={() => remove(x)}>× Sil</button>
                </div>
              </div>
            </div>
          ))}
        </div>
      )}

      {editing && <InflEditor key={editing.id} sb={sb} notify={notify} editing={editing} onDone={done} />}
      <InflEditor key={"new" + formKey} sb={sb} notify={notify} editing={null} onDone={done} />
    </>
  );
}

/* ================================================================== */
/*  ÖRNEK SES ALANLARI (Prodüktörler sekmesinin altında)               */
/* ================================================================== */

type Sample = { id: string; page: "mix" | "remake"; title: string; a_url: string | null; a_name: string | null; b_url: string | null; b_name: string | null; sort: number };

const SAMPLE_COPY = {
  mix: { h: "Mix & Mastering sayfası · örnek çalışmalar", d: "Sayfadaki “önce / sonra” dinleme alanları. İstediğin kadar ekle, istediğini kaldır.", a: "Önce (ham kayıt)", b: "Sonra (mix & mastering)", ph: "Örn: Hip-Hop vokal" },
  remake: { h: "Remake Beat sayfası · örnek çalışmalar", d: "Sayfadaki “orijinal / remake” dinleme alanları.", a: "Orijinal / referans", b: "Remake", ph: "Örn: Trap remake" },
} as const;

export function SamplesSection({ sb, notify, page }: { sb: SB; notify: Notify; page: "mix" | "remake" }) {
  const [list, setList] = useState<Sample[]>([]);
  const [titles, setTitles] = useState<Record<string, string>>({});
  const [busy, setBusy] = useState("");
  const [err, setErr] = useState("");
  const c = SAMPLE_COPY[page];

  const load = useCallback(async () => {
    const { data, error } = await sb.from("samples").select("*").eq("page", page).order("sort", { ascending: true }).order("created_at", { ascending: true });
    if (error) setErr("Örnek alanları okunamadı.");
    const rows = (data as Sample[]) || [];
    setList(rows);
    setTitles(Object.fromEntries(rows.map((r) => [r.id, r.title])));
  }, [sb, page]);

  useEffect(() => {
    load();
  }, [load]);

  async function add() {
    const { error } = await sb.from("samples").insert({ page, title: "Yeni örnek", sort: Date.now() % 1000000 });
    if (error) return notify("Eklenemedi: " + error.message);
    load();
  }

  async function remove(s: Sample) {
    if (!confirm(`“${s.title}” alanı kaldırılsın mı?`)) return;
    const { error } = await sb.from("samples").delete().eq("id", s.id);
    if (error) return notify("Kaldırılamadı: " + error.message);
    notify("Örnek alanı kaldırıldı.");
    load();
  }

  async function saveTitle(s: Sample) {
    const t = (titles[s.id] || "").trim() || "Yeni örnek";
    if (t === s.title) return;
    const { error } = await sb.from("samples").update({ title: t }).eq("id", s.id);
    if (error) return notify("Kaydedilemedi: " + error.message);
    setList((cur) => cur.map((x) => (x.id === s.id ? { ...x, title: t } : x)));
    notify("Örnek adı kaydedildi.");
  }

  async function upload(s: Sample, side: "a" | "b", file: File | undefined) {
    if (!file) return;
    if (file.size > 50 * 1024 * 1024) return notify("Dosya 50 MB’tan büyük olamaz.");
    setBusy(s.id + side);
    try {
      const url = await uploadMedia(sb, file, "samples/" + page, file.name);
      const { error } = await sb.from("samples").update({ [`${side}_url`]: url, [`${side}_name`]: file.name }).eq("id", s.id);
      if (error) throw new Error(error.message);
      notify("Örnek dosya yüklendi.");
      load();
    } catch (e) {
      notify(e instanceof Error ? e.message : "Yüklenemedi.");
    } finally {
      setBusy("");
    }
  }

  async function clear(s: Sample, side: "a" | "b") {
    const { error } = await sb.from("samples").update({ [`${side}_url`]: "", [`${side}_name`]: "" }).eq("id", s.id);
    if (error) return notify("Kaldırılamadı: " + error.message);
    load();
  }

  const slot = (s: Sample, side: "a" | "b") => {
    const url = side === "a" ? s.a_url : s.b_url;
    const name = side === "a" ? s.a_name : s.b_name;
    const label = side === "a" ? c.a : c.b;
    const id = `smp-${s.id}-${side}`;
    return (
      <div className={`flex flex-col gap-2 rounded-2xl border-[2.5px] p-3 ${url ? "border-solid border-[#111] bg-white" : "border-dashed border-[#111] bg-[#f5f5f5]"}`}>
        <small className="text-[11px] font-bold uppercase tracking-[0.12em] text-[#686868]">{label}</small>
        {url ? (
          <>
            <span className="break-all text-sm font-bold">{name}</span>
            <audio controls preload="none" src={url} className="h-9 w-full" />
          </>
        ) : (
          <span className="text-[13px] text-[#686868]">Henüz dosya yok</span>
        )}
        <div className="flex flex-wrap gap-2">
          <label htmlFor={id} className={(url ? btnGhost : btnPrimary + " !px-4 !py-2 !text-[13px]") + " cursor-pointer"}>
            {busy === s.id + side ? "Yükleniyor…" : url ? "Dosyayı değiştir" : "WAV / MP3 yükle"}
          </label>
          {url && (
            <button type="button" className={btnGhost} onClick={() => clear(s, side)}>
              Kaldır
            </button>
          )}
          <input id={id} type="file" accept="audio/*,.wav,.mp3" className="sr-only" disabled={!!busy} onChange={(e) => { upload(s, side, e.target.files?.[0]); e.target.value = ""; }} />
        </div>
      </div>
    );
  };

  return (
    <div className={`${card} p-5 sm:p-7`}>
      <h2 className="hd mb-1 text-xl font-extrabold">{c.h}</h2>
      <p className="mb-5 text-sm text-[#686868]">{c.d}</p>
      {err && <SetupNote message={err} />}
      <div className="space-y-4">
        {list.map((s) => (
          <div key={s.id} className="space-y-3.5 rounded-[20px] border-[2.5px] border-[#111] bg-white p-4">
            <div className="flex items-end gap-3">
              <div className="min-w-0 flex-1">
                <Field label="Örnek adı" value={titles[s.id] ?? s.title} onChange={(v) => setTitles((cur) => ({ ...cur, [s.id]: v }))} onBlur={() => saveTitle(s)} placeholder={c.ph} />
              </div>
              <button type="button" className={btnGhost + " whitespace-nowrap"} onClick={() => remove(s)}>
                × Alanı kaldır
              </button>
            </div>
            <div className="grid gap-3 sm:grid-cols-2">
              {slot(s, "a")}
              {slot(s, "b")}
            </div>
          </div>
        ))}
        <AddRow onClick={add}>Yeni örnek alanı ekle</AddRow>
      </div>
    </div>
  );
}

/* ================================================================== */
/*  SMM SAĞLAYICILARI                                                  */
/* ================================================================== */

type SmmProv = { id: string; name: string; api_url: string; key_hint: string | null; markup_pct: number; active: boolean; balance: string | null; currency: string | null; service_count: number | null; last_sync: string | null };
type SmmSvc = { id: number; code: string | null; provider_id: string | null; service_id: string | null; name: string; category: string | null; rate: number; min_qty: number | null; max_qty: number | null; source: "provider" | "manual"; price: number | null; descr: string | null; active: boolean };

export function SmmTab({ sb, notify }: { sb: SB; notify: Notify }) {
  const [provs, setProvs] = useState<SmmProv[]>([]);
  const [svcs, setSvcs] = useState<SmmSvc[]>([]);
  const [markups, setMarkups] = useState<Record<string, string>>({});
  const [busy, setBusy] = useState("");
  const [err, setErr] = useState("");
  const [ready, setReady] = useState(false);
  const [f, setF] = useState({ name: "", markup: "200", url: "", key: "" });
  const [sf, setSf] = useState<"all" | "on" | "off" | "manual">("all");
  const [sq, setSq] = useState("");
  const [mf, setMf] = useState({ name: "", category: "", price: "", min: "100", max: "10000", descr: "" });

  const load = useCallback(async () => {
    const [p, s] = await Promise.all([
      sb.from("smm_providers").select("*").order("created_at", { ascending: true }),
      sb.from("smm_services").select("id,code,provider_id,service_id,name,category,rate,min_qty,max_qty,source,price,descr,active").order("id", { ascending: true }).limit(3000),
    ]);
    if (p.error) setErr("SMM sağlayıcıları okunamadı.");
    const rows = (p.data as SmmProv[]) || [];
    setProvs(rows);
    setMarkups(Object.fromEntries(rows.map((r) => [r.id, String(r.markup_pct)])));
    setSvcs((s.data as SmmSvc[]) || []);
    setReady(true);
  }, [sb]);

  useEffect(() => {
    load();
  }, [load]);

  async function add() {
    if (!f.name.trim() || !f.url.trim() || !f.key.trim()) return notify("Ad, API adresi ve anahtar gerekli.");
    setBusy("add");
    const r = await callSecure(sb, { action: "smm_add", name: f.name, markup: Number(f.markup) || 200, url: f.url, key: f.key });
    setBusy("");
    if (!r.ok) return notify(r.error || "Eklenemedi.");
    notify(`Bağlantı başarılı. ${r.services} servis çekildi.`);
    setF({ name: "", markup: "200", url: "", key: "" });
    load();
  }

  async function sync(p: SmmProv) {
    setBusy(p.id);
    const r = await callSecure(sb, { action: "smm_sync", id: p.id });
    setBusy("");
    if (!r.ok) return notify(r.error || "Güncellenemedi.");
    notify(`Servisler güncellendi (${r.services}).`);
    load();
  }

  async function toggle(p: SmmProv) {
    const { error } = await sb.from("smm_providers").update({ active: !p.active }).eq("id", p.id);
    if (error) return notify("Güncellenemedi: " + error.message);
    notify(!p.active ? "Sağlayıcı açıldı." : "Sağlayıcı kapatıldı; servisleri satıştan kalktı.");
    load();
  }

  async function saveMarkup(p: SmmProv) {
    const v = Math.max(0, Math.min(2000, Number(markups[p.id]) || 0));
    if (v === Number(p.markup_pct)) return;
    const { error } = await sb.from("smm_providers").update({ markup_pct: v }).eq("id", p.id);
    if (error) return notify("Kaydedilemedi: " + error.message);
    notify("Kâr oranı kaydedildi.");
    load();
  }

  const svcPrice = (s: SmmSvc, p?: SmmProv) =>
    s.source === "manual" ? Number(s.price || 0) : Number(s.rate) * (1 + Number(p?.markup_pct || 0) / 100);

  const shownSvcs = useMemo(() => {
    const qq = sq.trim().toLowerCase();
    return svcs.filter(
      (s) =>
        (sf === "all" || (sf === "on" && s.active) || (sf === "off" && !s.active) || (sf === "manual" && s.source === "manual")) &&
        (!qq || s.name.toLowerCase().includes(qq) || (s.category || "").toLowerCase().includes(qq) || (s.code || "").toLowerCase().includes(qq))
    );
  }, [svcs, sf, sq]);

  async function setActive(ids: number[], active: boolean) {
    for (let i = 0; i < ids.length; i += 200) {
      const { error } = await sb.from("smm_services").update({ active }).in("id", ids.slice(i, i + 200));
      if (error) return notify("Güncellenemedi: " + error.message);
    }
    setSvcs((cur) => cur.map((s) => (ids.includes(s.id) ? { ...s, active } : s)));
  }

  async function bulk(active: boolean) {
    const ids = (active ? shownSvcs.slice(0, 200) : shownSvcs).map((s) => s.id);
    if (!ids.length) return;
    if (!confirm(`${ids.length} hizmet ${active ? "satışa alınsın" : "satıştan kaldırılsın"} mı?`)) return;
    await setActive(ids, active);
    notify(active ? "Hizmetler satışa alındı." : "Hizmetler satıştan kaldırıldı.");
  }

  async function addManual() {
    const price = Number(mf.price);
    if (!mf.name.trim() || !(price > 0)) return notify("Hizmet adı ve satış fiyatı gerekli.");
    const { error } = await sb.from("smm_services").insert({
      source: "manual",
      name: mf.name.trim(),
      category: mf.category.trim(),
      price,
      min_qty: Number(mf.min) || 0,
      max_qty: Number(mf.max) || 0,
      descr: mf.descr.trim(),
      active: true,
    });
    if (error) return notify("Eklenemedi: " + error.message);
    notify("Manuel hizmet eklendi ve satışa alındı.");
    setMf({ name: "", category: "", price: "", min: "100", max: "10000", descr: "" });
    load();
  }

  async function delManual(s: SmmSvc) {
    if (!confirm(`“${s.name}” silinsin mi?`)) return;
    const { error } = await sb.from("smm_services").delete().eq("id", s.id);
    if (error) return notify("Silinemedi: " + error.message);
    setSvcs((cur) => cur.filter((x) => x.id !== s.id));
    notify("Hizmet silindi.");
  }

  async function remove(p: SmmProv) {
    if (!confirm(`“${p.name}” sağlayıcısı ve servisleri kaldırılsın mı?`)) return;
    setBusy(p.id);
    const r = await callSecure(sb, { action: "smm_delete", id: p.id });
    setBusy("");
    if (!r.ok) return notify(r.error || "Kaldırılamadı.");
    notify("Sağlayıcı çıkarıldı.");
    load();
  }

  return (
    <>
      <Head eyebrow="Hizmetler" title="SMM Sağlayıcıları" desc="SMM panelinde satılan hizmetler hangi sağlayıcıdan geliyorsa onun API’sini buradan ekle veya çıkar." />
      {err && <SetupNote message={err} />}
      <div className="space-y-5">
        {ready && provs.length === 0 && <Empty title="Henüz sağlayıcı yok" text="Aşağıdan SMM sağlayıcının API adresini ve anahtarını ekle." />}
        {provs.map((p) => (
          <div key={p.id} className={`${card} p-5 sm:p-6 ${p.active ? "" : "opacity-70"}`}>
            <div className="flex flex-wrap items-start justify-between gap-3">
              <div>
                <span className="hd text-[22px] font-extrabold">{p.name}</span> <Badge tone={p.active ? "yellow" : "plain"}>{p.active ? "✓ Bağlı" : "Kapalı"}</Badge>
                <p className="mt-1 break-all text-[13px] text-[#686868]">{p.api_url} · anahtar {p.key_hint}</p>
              </div>
              <div className="flex flex-wrap gap-2">
                <button type="button" className={btnGhost} disabled={busy === p.id} onClick={() => sync(p)}>{busy === p.id ? "Çekiliyor…" : "↻ Servisleri çek"}</button>
                <button type="button" className={btnGhost} onClick={() => toggle(p)}>{p.active ? "Kapat" : "Aç"}</button>
                <button type="button" className={btnGhost} disabled={busy === p.id} onClick={() => remove(p)}>× Çıkar</button>
              </div>
            </div>
            <div className="mt-4 grid grid-cols-[repeat(auto-fit,minmax(140px,1fr))] gap-3">
              <div className="rounded-2xl border-2 border-[#111] px-3.5 py-2.5"><small className="block text-[11px] font-bold uppercase tracking-[0.1em] text-[#686868]">Sağlayıcıdaki bakiye</small><b className="hd text-xl">{p.balance || "—"} {p.currency}</b></div>
              <div className="rounded-2xl border-2 border-[#111] px-3.5 py-2.5"><small className="block text-[11px] font-bold uppercase tracking-[0.1em] text-[#686868]">Servis sayısı</small><b className="hd text-xl">{fmt(p.service_count || 0)}</b></div>
              <label className="rounded-2xl border-2 border-[#111] px-3.5 py-2.5"><small className="block text-[11px] font-bold uppercase tracking-[0.1em] text-[#686868]">Kâr oranı (%)</small>
                <input type="number" className="hd w-full bg-transparent text-xl font-bold outline-none" value={markups[p.id] ?? ""} onChange={(e) => setMarkups((m) => ({ ...m, [p.id]: e.target.value }))} onBlur={() => saveMarkup(p)} /></label>
              <div className="rounded-2xl border-2 border-[#111] px-3.5 py-2.5"><small className="block text-[11px] font-bold uppercase tracking-[0.1em] text-[#686868]">Son senkron</small><b className="hd text-base">{p.last_sync ? new Date(p.last_sync).toLocaleString("tr-TR") : "—"}</b></div>
            </div>
          </div>
        ))}

        <div className={`${card} p-5 sm:p-7`}>
          <h2 className="hd mb-1.5 text-xl font-extrabold">Yeni SMM paneli ekle</h2>
          <p className="mb-5 text-sm text-[#686868]">Sağlayıcının verdiği API adresi ve anahtarı yaz. Eklemeden önce bağlantı gerçekten denenir. Anahtar sadece sunucuda saklanır.</p>
          <div className="grid gap-5 sm:grid-cols-2">
            <Field label="Sağlayıcı adı" value={f.name} onChange={(v) => setF({ ...f, name: v })} placeholder="Örn: SMM Sağlayıcı C" />
            <Field label="Kâr oranı (%)" type="number" value={f.markup} onChange={(v) => setF({ ...f, markup: v })} hint="Sağlayıcı fiyatının üstüne eklenir." />
          </div>
          <div className="mt-5"><Field label="API adresi" value={f.url} onChange={(v) => setF({ ...f, url: v })} placeholder="https://panel.ornek.com/api/v2" /></div>
          <div className="mt-5"><Field label="API anahtarı" type="password" value={f.key} onChange={(v) => setF({ ...f, key: v })} placeholder="Sağlayıcı panelinden kopyala" /></div>
          <button type="button" className={btnPrimary + " mt-6"} disabled={busy === "add"} onClick={add}>{busy === "add" ? "Bağlanıyor…" : "Bağlantıyı test et ve ekle →"}</button>
        </div>

        <div className={`${card} p-5 sm:p-7`}>
          <h2 className="hd mb-1.5 text-xl font-extrabold">Manuel hizmet ekle</h2>
          <p className="mb-5 text-sm text-[#686868]">Hiçbir sağlayıcıdan gelmeyen, kendi belirlediğin fiyatla sattığın hizmet. Eklenince otomatik “Satışta” olur ve 7-2-NNN kodu alır.</p>
          <div className="grid gap-5 sm:grid-cols-2">
            <Field label="Hizmet adı" value={mf.name} onChange={(v) => setMf({ ...mf, name: v })} placeholder="Örn: Instagram Türk Takipçi" />
            <Field label="Kategori" value={mf.category} onChange={(v) => setMf({ ...mf, category: v })} placeholder="Örn: Instagram" />
            <Field label="Satış fiyatı (1.000 adet, TL)" type="number" value={mf.price} onChange={(v) => setMf({ ...mf, price: v })} />
            <div className="grid grid-cols-2 gap-3">
              <Field label="En az" type="number" value={mf.min} onChange={(v) => setMf({ ...mf, min: v })} />
              <Field label="En çok" type="number" value={mf.max} onChange={(v) => setMf({ ...mf, max: v })} />
            </div>
          </div>
          <div className="mt-5"><Field label="Açıklama" value={mf.descr} onChange={(v) => setMf({ ...mf, descr: v })} placeholder="Müşteri bu açıklamayı görür" /></div>
          <button type="button" className={btnPrimary + " mt-6"} onClick={addManual}>Hizmeti ekle →</button>
        </div>

        {svcs.length > 0 && (
          <div className={`${card} overflow-hidden`}>
            <div className="flex flex-wrap items-center justify-between gap-3 border-b border-[#111]/10 p-5">
              <strong className="hd text-lg">Servisler · hangisi satışta?</strong>
              <span className="text-xs text-[#686868]">Fiyatlar 1.000 adet başınadır</span>
            </div>
            <div className="flex flex-wrap items-center gap-2 border-b border-[#111]/10 p-4">
              {([["all", "Tümü"], ["on", "Satışta"], ["off", "Kapalı"], ["manual", "Manuel"]] as const).map(([id, l]) => (
                <Chip key={id} active={sf === id} onClick={() => setSf(id)}>{l} · {id === "all" ? svcs.length : id === "on" ? svcs.filter((x) => x.active).length : id === "off" ? svcs.filter((x) => !x.active).length : svcs.filter((x) => x.source === "manual").length}</Chip>
              ))}
              <input className={inputCls + " !w-auto min-w-[200px] flex-1 !py-2 !text-sm"} placeholder="Ad, kategori veya kod ara" value={sq} onChange={(e) => setSq(e.target.value)} />
              <button type="button" className={btnGhost} onClick={() => bulk(true)}>Görünenlerin hepsini aç</button>
              <button type="button" className={btnGhost} onClick={() => bulk(false)}>Hepsini kapat</button>
            </div>
            {shownSvcs.slice(0, 200).map((s) => {
              const p = provs.find((x) => x.id === s.provider_id);
              const sale = svcPrice(s, p);
              return (
                <div key={s.id} className="flex items-center justify-between gap-4 border-b border-[#111]/10 p-4 last:border-0">
                  <div className="min-w-0">
                    <strong className="block truncate text-sm"><span className="mr-2 rounded-md bg-[#111] px-1.5 py-0.5 font-mono text-[11px] text-[#f5c518]">{s.code}</span>{s.name}</strong>
                    <small className="text-xs text-[#686868]">{s.category || "—"} · {s.source === "manual" ? "Manuel" : `${p?.name || "Sağlayıcı"} · maliyet ${Number(s.rate).toFixed(2)} ${p?.currency || ""}`} · {fmt(s.min_qty || 0)}–{fmt(s.max_qty || 0)}</small>
                  </div>
                  <div className="flex flex-none items-center gap-3">
                    <b className="whitespace-nowrap text-sm">{sale.toFixed(2)} {s.source === "manual" ? "TL" : p?.currency || ""}</b>
                    <button type="button" className={s.active ? btnPrimary + " !px-4 !py-2 !text-xs" : btnGhost} onClick={() => setActive([s.id], !s.active)}>{s.active ? "✓ Satışta" : "Satışa al"}</button>
                    {s.source === "manual" && <button type="button" className={btnGhost} onClick={() => delManual(s)}>×</button>}
                  </div>
                </div>
              );
            })}
            {shownSvcs.length > 200 && <p className="p-4 text-center text-xs text-[#686868]">İlk 200 hizmet gösteriliyor. Aramayı daralt.</p>}
            {shownSvcs.length === 0 && <p className="p-6 text-sm text-[#686868]">Bu filtrede hizmet yok.</p>}
          </div>
        )}
      </div>
    </>
  );
}

/* ================================================================== */
/*  ÖDEME YÖNTEMLERİ                                                   */
/* ================================================================== */

type PayProv = { id: string; kind: string; name: string; mode: "test" | "live"; active: boolean; mid_hint: string | null; key_hint: string | null; salt_hint: string | null; callback_url: string | null; iban: string | null; holder: string | null; last_check: string | null };

const PAY_KINDS: { id: string; label: string }[] = [
  { id: "paytr", label: "PayTR" },
  { id: "iyzico", label: "iyzico" },
  { id: "stripe", label: "Stripe" },
  { id: "shopier", label: "Shopier" },
  { id: "papara", label: "Papara" },
  { id: "havale", label: "Havale / EFT" },
];

export function PaymentsTab({ sb, notify }: { sb: SB; notify: Notify }) {
  const [provs, setProvs] = useState<PayProv[]>([]);
  const [month, setMonth] = useState({ sum: 0, ok: 0, failed: 0 });
  const [busy, setBusy] = useState("");
  const [err, setErr] = useState("");
  const [ready, setReady] = useState(false);
  const [f, setF] = useState({ kind: "paytr", mid: "", key: "", salt: "", mode: "test" as "test" | "live", iban: "", holder: "" });

  const load = useCallback(async () => {
    const since = new Date(Date.now() - 30 * 86400000).toISOString();
    const [p, t] = await Promise.all([
      sb.from("payment_providers").select("*").order("created_at", { ascending: true }),
      sb.from("wallet_transactions").select("amount,status").eq("kind", "topup").gte("created_at", since),
    ]);
    if (p.error) setErr("Ödeme sunucuları okunamadı.");
    setProvs((p.data as PayProv[]) || []);
    const tx = (t.data as { amount: number; status: string }[]) || [];
    setMonth({
      sum: tx.filter((x) => x.status === "ok").reduce((a, x) => a + Number(x.amount), 0),
      ok: tx.filter((x) => x.status === "ok").length,
      failed: tx.filter((x) => x.status === "failed").length,
    });
    setReady(true);
  }, [sb]);

  useEffect(() => {
    load();
  }, [load]);

  async function add() {
    const manual = f.kind === "havale";
    if (!manual && (!f.mid.trim() || !f.key.trim() || (f.kind === "paytr" && !f.salt.trim()))) return notify("Mağaza no ve gerekli anahtarları yaz.");
    if (manual && !f.iban.trim()) return notify("IBAN yaz.");
    setBusy("add");
    const r = await callSecure(sb, { action: "pay_add", kind: f.kind, mid: f.mid, key: f.key, salt: f.salt, mode: f.mode, iban: f.iban, holder: f.holder });
    setBusy("");
    if (!r.ok) return notify(r.error || "Eklenemedi.");
    notify("Ödeme sunucusu eklendi.");
    setF({ kind: "paytr", mid: "", key: "", salt: "", mode: "test", iban: "", holder: "" });
    load();
  }

  async function toggle(p: PayProv) {
    const { error } = await sb.from("payment_providers").update({ active: !p.active }).eq("id", p.id);
    if (error) return notify("Güncellenemedi: " + error.message);
    notify(!p.active ? "Ödeme yöntemi açıldı." : "Ödeme yöntemi kapatıldı; sitede görünmez.");
    load();
  }

  async function setMode(p: PayProv, mode: "test" | "live") {
    if (mode === "live" && !confirm("Canlı moda geçilsin mi? Gerçek ödemeler alınmaya başlar.")) return;
    const { error } = await sb.from("payment_providers").update({ mode }).eq("id", p.id);
    if (error) return notify("Güncellenemedi: " + error.message);
    notify(mode === "live" ? "Canlı moda geçildi." : "Test moduna geçildi. Gerçek para çekilmez.");
    load();
  }

  async function check(p: PayProv) {
    setBusy(p.id);
    const r = await callSecure(sb, { action: "pay_check", id: p.id });
    setBusy("");
    notify(r.ok ? String(r.message) : r.error || "Kontrol edilemedi.");
    load();
  }

  async function remove(p: PayProv) {
    if (!confirm(`“${p.name}” kaldırılsın mı? Kayıtlı anahtarlar da silinir.`)) return;
    setBusy(p.id);
    const r = await callSecure(sb, { action: "pay_delete", id: p.id });
    setBusy("");
    if (!r.ok) return notify(r.error || "Kaldırılamadı.");
    notify("Ödeme sunucusu kaldırıldı.");
    load();
  }

  const copy = async (u: string) => {
    try {
      await navigator.clipboard.writeText(u);
      notify("Bildirim adresi kopyalandı.");
    } catch {
      notify("Kopyalanamadı, adresi elle seç.");
    }
  };

  const active = provs.filter((p) => p.active).length;
  const manual = f.kind === "havale";

  return (
    <>
      <Head eyebrow="Satış" title="Ödeme Yöntemleri" desc="Sitede ödeme alan sunucular. Durumunu gör, aç veya kapat, yenisini ekle." />
      {err && <SetupNote message={err} />}
      <div className="mb-7 grid gap-4 sm:grid-cols-3">
        <StatBox label="Açık yöntem" value={String(active)} sub={`${provs.length} sağlayıcı kayıtlı`} />
        <StatBox label="30 gün tahsilat" value={tl(month.sum)} sub={`${month.ok} başarılı ödeme`} />
        <StatBox label="Başarısız ödeme" value={String(month.failed)} sub="son 30 gün" />
      </div>

      <div className="space-y-5">
        {ready && provs.length === 0 && <Empty title="Henüz ödeme sunucusu yok" text="Aşağıdan PayTR veya başka bir sağlayıcının anahtarlarını ekle." />}
        {provs.map((p) => {
          const isManual = p.kind === "havale";
          return (
            <div key={p.id} className={`${card} p-5 sm:p-6 ${p.active ? "" : "opacity-70"}`}>
              <div className="flex flex-wrap items-start justify-between gap-3">
                <div>
                  <span className="hd text-[22px] font-extrabold">
                    <span className={`mr-2 inline-block h-2.5 w-2.5 rounded-full border-2 border-[#111] align-[-1px] ${p.active ? "bg-[#f5c518]" : "bg-white"}`} />
                    {p.name}
                  </span>{" "}
                  <Badge tone={isManual ? "ink" : "yellow"}>{isManual ? "Manuel" : "✓ Bağlı"}</Badge>{" "}
                  {!isManual && <Badge tone={p.mode === "live" ? "ink" : "plain"}>{p.mode === "live" ? "CANLI" : "TEST"}</Badge>}
                </div>
                <div className="flex flex-wrap gap-2">
                  {!isManual && <button type="button" className={btnGhost} disabled={busy === p.id} onClick={() => check(p)}>↻ Kontrol et</button>}
                  <button type="button" className={btnGhost} onClick={() => toggle(p)}>{p.active ? "Kapat" : "Aç"}</button>
                  <button type="button" className={btnGhost} disabled={busy === p.id} onClick={() => remove(p)}>× Kaldır</button>
                </div>
              </div>

              {isManual ? (
                <div className="mt-4 grid gap-3 sm:grid-cols-2">
                  <div className="rounded-2xl border-2 border-[#111] px-3.5 py-2.5"><small className="block text-[11px] font-bold uppercase tracking-[0.1em] text-[#686868]">IBAN</small><b className="hd text-base">{p.iban}</b></div>
                  <div className="rounded-2xl border-2 border-[#111] px-3.5 py-2.5"><small className="block text-[11px] font-bold uppercase tracking-[0.1em] text-[#686868]">Hesap sahibi</small><b className="hd text-base">{p.holder || "—"}</b></div>
                </div>
              ) : (
                <>
                  <div className="mt-4 grid grid-cols-[repeat(auto-fit,minmax(150px,1fr))] gap-3">
                    <div className="rounded-2xl border-2 border-[#111] px-3.5 py-2.5"><small className="block text-[11px] font-bold uppercase tracking-[0.1em] text-[#686868]">Merchant ID</small><b className="hd text-lg">{p.mid_hint}</b></div>
                    <div className="rounded-2xl border-2 border-[#111] px-3.5 py-2.5"><small className="block text-[11px] font-bold uppercase tracking-[0.1em] text-[#686868]">Merchant Key</small><b className="hd text-lg">{p.key_hint}</b></div>
                    {p.salt_hint && <div className="rounded-2xl border-2 border-[#111] px-3.5 py-2.5"><small className="block text-[11px] font-bold uppercase tracking-[0.1em] text-[#686868]">Merchant Salt</small><b className="hd text-lg">{p.salt_hint}</b></div>}
                  </div>
                  <div className="mt-4 flex flex-wrap items-center gap-3">
                    <span className="inline-flex overflow-hidden rounded-full border-[2.5px] border-[#111]" role="group" aria-label="Çalışma modu">
                      {(["test", "live"] as const).map((m) => (
                        <button key={m} type="button" aria-pressed={p.mode === m} onClick={() => p.mode !== m && setMode(p, m)} className={`px-4 py-2 text-[13px] font-bold ${p.mode === m ? "bg-[#111] text-[#f5c518]" : "bg-white"}`}>
                          {m === "test" ? "Test" : "Canlı"}
                        </button>
                      ))}
                    </span>
                    <span className="text-[13px] text-[#686868]">{p.last_check}</span>
                  </div>
                  {p.callback_url && (
                    <div className="mt-4 flex items-center gap-2 rounded-[14px] border-2 border-[#111] bg-[#f5f5f5] py-2 pl-3.5 pr-2">
                      <code className="flex-1 break-all text-xs">{p.callback_url}</code>
                      <button type="button" className={btnGhost} onClick={() => copy(p.callback_url!)}>Kopyala</button>
                    </div>
                  )}
                  <p className="mt-3 text-xs text-[#686868]">Bu adresi {p.name} mağaza panelindeki “Bildirim URL” alanına yapıştır. Anahtarlar sunucuda saklanır, buraya tam olarak hiç gelmez.</p>
                </>
              )}
            </div>
          );
        })}

        <div className={`${card} p-5 sm:p-7`}>
          <h2 className="hd mb-1.5 text-xl font-extrabold">Yeni ödeme sunucusu ekle</h2>
          <p className="mb-5 text-sm text-[#686868]">Anahtarları sağlayıcının mağaza panelinden kopyala. Kaydedilince tamamı sunucuda saklanır; bu sayfada yalnızca maskeli görünür.</p>
          <div className="grid gap-5 sm:grid-cols-2">
            <label className="block">
              <span className="mb-2 block text-sm font-bold">Sağlayıcı</span>
              <select className={inputCls} value={f.kind} onChange={(e) => setF({ ...f, kind: e.target.value })}>
                {PAY_KINDS.map((k) => <option key={k.id} value={k.id}>{k.label}</option>)}
              </select>
            </label>
            {manual ? <Field label="Hesap sahibi" value={f.holder} onChange={(v) => setF({ ...f, holder: v })} placeholder="Ad Soyad / Şirket" /> : <Field label="Merchant ID / Mağaza no" value={f.mid} onChange={(v) => setF({ ...f, mid: v })} placeholder="123456" />}
          </div>
          {manual ? (
            <div className="mt-5"><Field label="IBAN" value={f.iban} onChange={(v) => setF({ ...f, iban: v })} placeholder="TR00 0000 0000 0000 0000 0000 00" /></div>
          ) : (
            <>
              <div className="mt-5 grid gap-5 sm:grid-cols-2">
                <Field label="Merchant Key / API anahtarı" type="password" value={f.key} onChange={(v) => setF({ ...f, key: v })} placeholder="Sağlayıcı panelinden kopyala" />
                <Field label={f.kind === "paytr" ? "Merchant Salt" : "Gizli anahtar (varsa)"} type="password" value={f.salt} onChange={(v) => setF({ ...f, salt: v })} placeholder="Sağlayıcı panelinden kopyala" />
              </div>
              <div className="mt-5">
                <span className="mb-2 block text-sm font-bold">Mod</span>
                <span className="inline-flex overflow-hidden rounded-full border-[2.5px] border-[#111]" role="group">
                  {(["test", "live"] as const).map((m) => (
                    <button key={m} type="button" aria-pressed={f.mode === m} onClick={() => setF({ ...f, mode: m })} className={`px-4 py-2 text-[13px] font-bold ${f.mode === m ? "bg-[#111] text-[#f5c518]" : "bg-white"}`}>
                      {m === "test" ? "Test" : "Canlı"}
                    </button>
                  ))}
                </span>
              </div>
            </>
          )}
          <button type="button" className={btnPrimary + " mt-6"} disabled={busy === "add"} onClick={add}>{busy === "add" ? "Ekleniyor…" : "Ekle →"}</button>
        </div>
      </div>
    </>
  );
}

/* ================================================================== */
/*  DESTEK MESAJLARI                                                   */
/* ================================================================== */

type Ticket = {
  id: string;
  no: string | null;
  user_id: string | null;
  subject: string;
  customer_name?: string | null;
  contact?: string | null;
  service_code: string | null;
  status: "Yeni" | "Yanıtlandı" | "Kapandı";
  created_at: string;
  updated_at: string;
};
type TMsg = { id: string; ticket_id: string; sender: "customer" | "staff"; body: string; created_at: string };

export function SupportTab({
  sb,
  notify,
  canOrders,
  onJumpOrder,
  onNewCount,
}: {
  sb: SB;
  notify: Notify;
  canOrders: boolean;
  onJumpOrder: (code: string) => void;
  onNewCount?: (n: number) => void;
}) {
  const [tickets, setTickets] = useState<Ticket[]>([]);
  const [msgs, setMsgs] = useState<TMsg[]>([]);
  const [names, setNames] = useState<Record<string, string>>({});
  const [filter, setFilter] = useState<"all" | "Yeni" | "Yanıtlandı" | "Kapandı">("all");
  const [q, setQ] = useState("");
  const [sel, setSel] = useState<string | null>(null);
  const [reply, setReply] = useState("");
  const [code, setCode] = useState("");
  const [err, setErr] = useState("");
  const [ready, setReady] = useState(false);

  const load = useCallback(async () => {
    const [t, m, p] = await Promise.all([
      sb.from("support_tickets").select("*").order("updated_at", { ascending: false }).limit(300),
      sb.from("support_messages").select("*").order("created_at", { ascending: true }).limit(3000),
      sb.from("profiles").select("id,full_name,email").limit(2000),
    ]);
    if (t.error || m.error) setErr("Destek mesajları okunamadı. supabase.sql dosyasının çalıştırıldığından emin ol.");
    const rows = (t.data as Ticket[]) || [];
    setTickets(rows);
    setMsgs((m.data as TMsg[]) || []);
    setNames(Object.fromEntries(((p.data as Person[]) || []).map((x) => [x.id, x.full_name || x.email || "Müşteri"])));
    onNewCount?.(rows.filter((r) => r.status === "Yeni").length);
    setReady(true);
  }, [sb, onNewCount]);

  useEffect(() => {
    load();
  }, [load]);

  const current = tickets.find((t) => t.id === sel) || null;
  useEffect(() => setCode(current?.service_code || ""), [current?.id, current?.service_code]);

  const who = (t: Ticket) => names[t.user_id || ""] || t.customer_name || "Müşteri";
  const shown = tickets.filter((t) => {
    const qq = q.trim().toLowerCase();
    return (
      (filter === "all" || t.status === filter) &&
      (!qq || (t.no || "").toLowerCase().includes(qq) || t.subject.toLowerCase().includes(qq) || (t.service_code || "").toLowerCase().includes(qq) || who(t).toLowerCase().includes(qq) || (t.contact || "").toLowerCase().includes(qq))
    );
  });

  async function setStatus(t: Ticket, status: Ticket["status"]) {
    const { error } = await sb.from("support_tickets").update({ status, updated_at: new Date().toISOString() }).eq("id", t.id);
    if (error) return notify("Güncellenemedi: " + error.message);
    notify(status === "Kapandı" ? "Mesaj kapatıldı." : "Durum güncellendi.");
    load();
  }

  async function saveCode() {
    if (!current) return;
    const { error } = await sb.from("support_tickets").update({ service_code: code.trim() }).eq("id", current.id);
    if (error) return notify("Kaydedilemedi: " + error.message);
    notify("Servis ID kaydedildi.");
    load();
  }

  async function send() {
    if (!current || !reply.trim()) return;
    const { error } = await sb.from("support_messages").insert({ ticket_id: current.id, sender: "staff", body: reply.trim() });
    if (error) return notify("Gönderilemedi: " + error.message);
    await sb.from("support_tickets").update({ status: "Yanıtlandı", updated_at: new Date().toISOString() }).eq("id", current.id);
    setReply("");
    notify("Yanıt gönderildi.");
    load();
  }

  const tone = (s: string): "yellow" | "ink" | "plain" => (s === "Yeni" ? "yellow" : s === "Yanıtlandı" ? "ink" : "plain");

  return (
    <>
      <Head eyebrow="Müşteri iletişimi" title="Destek Mesajları" desc="Siteden gelen tüm destek mesajları. Her mesaja bir sipariş kodu veya hizmet ID’si bağlayabilirsin." />
      {err && <SetupNote message={err} />}
      <div className="mb-4 flex flex-wrap items-center gap-2">
        {(["all", "Yeni", "Yanıtlandı", "Kapandı"] as const).map((f) => (
          <Chip key={f} active={filter === f} onClick={() => setFilter(f)}>
            {f === "all" ? "Tümü" : f} · {f === "all" ? tickets.length : tickets.filter((t) => t.status === f).length}
          </Chip>
        ))}
        <input className={inputCls + " !w-auto min-w-[220px] flex-1 !py-2 !text-sm"} placeholder="Numara, konu, müşteri veya servis ID ara" value={q} onChange={(e) => setQ(e.target.value)} />
      </div>

      {!ready ? (
        <p className="text-sm font-bold tracking-[0.14em] text-[#686868]">YÜKLENİYOR…</p>
      ) : shown.length === 0 ? (
        <Empty title="Mesaj yok" text="Müşteriler siteden destek mesajı gönderdiğinde burada listelenir." />
      ) : (
        <div className="grid gap-4 lg:grid-cols-[340px_1fr]">
          <div className={`${card} max-h-[640px] overflow-y-auto`}>
            {shown.map((t) => (
              <button
                key={t.id}
                type="button"
                onClick={() => setSel(t.id)}
                className={`block w-full border-b border-[#111]/10 p-4 text-left last:border-0 ${sel === t.id ? "bg-[#fff6cf]" : "hover:bg-[#f5f5f5]"}`}
              >
                <p className="flex items-center justify-between gap-2 text-xs text-[#686868]">
                  <span>{t.no} · {dateTr(t.created_at)}</span>
                  <Badge tone={tone(t.status)}>{t.status}</Badge>
                </p>
                <p className="mt-1 truncate font-bold">{t.subject || "Konu yok"}</p>
                <p className="mt-0.5 truncate text-xs text-[#686868]">{who(t)}{t.service_code ? ` · ${t.service_code}` : ""}</p>
              </button>
            ))}
          </div>

          <div className={`${card} p-5`}>
            {!current ? (
              <p className="py-16 text-center text-sm text-[#686868]">Soldan bir mesaj seç.</p>
            ) : (
              <>
                <div className="flex flex-wrap items-start justify-between gap-3">
                  <div>
                    <p className="text-xs text-[#686868]">{current.no} · {who(current)}{current.contact ? ` · ${current.contact}` : ""}</p>
                    <h3 className="hd text-xl font-extrabold">{current.subject || "Konu yok"}</h3>
                  </div>
                  <div className="flex gap-2">
                    {current.status !== "Kapandı" ? (
                      <button type="button" className={btnGhost} onClick={() => setStatus(current, "Kapandı")}>Kapat</button>
                    ) : (
                      <button type="button" className={btnGhost} onClick={() => setStatus(current, "Yeni")}>Yeniden aç</button>
                    )}
                  </div>
                </div>

                <div className="mt-4 flex flex-wrap items-end gap-2 rounded-2xl border-2 border-dashed border-[#111]/40 bg-[#f5f5f5] p-3">
                  <label className="min-w-[200px] flex-1">
                    <span className="mb-1 block text-[11px] font-bold uppercase tracking-[0.12em] text-[#686868]">Servis ID / Sipariş kodu</span>
                    <input className={inputCls + " !py-2 !text-sm"} value={code} onChange={(e) => setCode(e.target.value)} placeholder="7777-3-48213 veya 7-2-014" />
                  </label>
                  <button type="button" className={btnGhost} onClick={saveCode}>Kaydet</button>
                  {canOrders && current.service_code && current.service_code.startsWith("7777-") && (
                    <button type="button" className={btnGhost} onClick={() => onJumpOrder(current.service_code!)}>Siparişi gör →</button>
                  )}
                </div>

                <div className="mt-4 max-h-[340px] space-y-3 overflow-y-auto">
                  {msgs.filter((m) => m.ticket_id === current.id).map((m) => (
                    <div key={m.id} className={`max-w-[85%] rounded-2xl border-2 border-[#111] px-4 py-3 text-sm ${m.sender === "staff" ? "ml-auto bg-[#f5c518]" : "bg-white"}`}>
                      <p className="whitespace-pre-wrap break-words">{m.body}</p>
                      <small className="mt-1 block text-[11px] text-[#686868]">{m.sender === "staff" ? "Ekibimiz" : "Müşteri"} · {new Date(m.created_at).toLocaleString("tr-TR")}</small>
                    </div>
                  ))}
                </div>

                {current.status !== "Kapandı" && (
                  <div className="mt-4 flex gap-2">
                    <textarea className={inputCls + " min-h-[70px] flex-1 !text-sm"} placeholder="Yanıtını yaz…" value={reply} onChange={(e) => setReply(e.target.value)} />
                    <button type="button" className={btnPrimary + " self-end"} onClick={send}>Gönder</button>
                  </div>
                )}
              </>
            )}
          </div>
        </div>
      )}
    </>
  );
}

/* ================================================================== */
/*  ROLLER VE YETKİLER (Üyeler bölümünde)                              */
/* ================================================================== */

export const PERM_TABS: { id: string; label: string }[] = [
  { id: "overview", label: "Genel Bakış" },
  { id: "traffic", label: "Trafik" },
  { id: "orders", label: "Siparişler" },
  { id: "releases", label: "Dijital Yayınlar (ISRC / UPC)" },
  { id: "support", label: "Destek Mesajları" },
  { id: "wallet", label: "Cüzdan & Bakiye" },
  { id: "payments", label: "Ödeme Yöntemleri" },
  { id: "influencers", label: "Influencerlar" },
  { id: "smm", label: "SMM Sağlayıcıları" },
  { id: "services", label: "Hizmetler & Fiyatlar" },
  { id: "producers", label: "Prodüktörler" },
  { id: "content", label: "Site Yazıları" },
  { id: "members", label: "Üyeler" },
  { id: "ai", label: "AI Asistan" },
  { id: "settings", label: "Ayarlar" },
];

export type PermMap = Record<"mod" | "amele", string[]>;

export function RolesPanel({
  sb,
  notify,
  perms,
  onChange,
  viewAs,
  onViewAs,
}: {
  sb: SB;
  notify: Notify;
  perms: PermMap;
  onChange: (p: PermMap) => void;
  viewAs: "" | "mod" | "amele" | "member";
  onViewAs: (r: "" | "mod" | "amele" | "member") => void;
}) {
  const roles: { id: "mod" | "amele"; label: string }[] = [
    { id: "mod", label: "Moderatör" },
    { id: "amele", label: "Personel" },
  ];

  async function toggle(role: "mod" | "amele", tab: string) {
    const has = perms[role].includes(tab);
    const q = has
      ? sb.from("role_permissions").delete().eq("role", role).eq("tab", tab)
      : sb.from("role_permissions").insert({ role, tab });
    const { error } = await q;
    if (error) return notify("Yetki değiştirilemedi: " + error.message);
    onChange({ ...perms, [role]: has ? perms[role].filter((x) => x !== tab) : [...perms[role], tab] });
  }

  return (
    <div className={`${card} mb-6 p-5 sm:p-7`}>
      <div className="mb-4 flex flex-wrap items-start justify-between gap-3">
        <div>
          <h2 className="hd text-xl font-extrabold">Roller ve yetkiler</h2>
          <p className="mt-1 text-sm text-[#686868]">Hangi rol hangi bölümü görebilir? CEO ve admin her şeyi görür; Kullanıcı panele giremez. Yetkiler veritabanında da uygulanır.</p>
        </div>
        <label className="text-xs font-bold">
          Bu rolün gözüyle bak
          <select
            className="field mt-1 block rounded-full border-[2.5px] border-[#111] bg-white px-3 py-2 text-sm font-bold outline-none"
            value={viewAs}
            onChange={(e) => onViewAs(e.target.value as "" | "mod" | "amele" | "member")}
          >
            <option value="">Kapalı (kendi gözüm)</option>
            <option value="mod">Moderatör</option>
            <option value="amele">Personel</option>
            <option value="member">Kullanıcı</option>
          </select>
        </label>
      </div>
      <div className="overflow-x-auto">
        <table className="w-full min-w-[420px] text-sm">
          <thead>
            <tr className="border-b-2 border-[#111] text-left">
              <th className="py-2 pr-3">Bölüm</th>
              <th className="px-3 py-2 text-center">CEO / Admin</th>
              {roles.map((r) => (
                <th key={r.id} className="px-3 py-2 text-center">{r.label}</th>
              ))}
            </tr>
          </thead>
          <tbody>
            {PERM_TABS.map((t) => (
              <tr key={t.id} className="border-b border-[#111]/10">
                <td className="py-2 pr-3 font-semibold">{t.label}</td>
                <td className="px-3 py-2 text-center text-[#686868]">✓</td>
                {roles.map((r) => (
                  <td key={r.id} className="px-3 py-2 text-center">
                    <input
                      type="checkbox"
                      className="h-5 w-5 accent-[#f5c518]"
                      checked={perms[r.id].includes(t.id)}
                      onChange={() => toggle(r.id, t.id)}
                      aria-label={`${r.label} · ${t.label}`}
                    />
                  </td>
                ))}
              </tr>
            ))}
          </tbody>
        </table>
      </div>
    </div>
  );
}
