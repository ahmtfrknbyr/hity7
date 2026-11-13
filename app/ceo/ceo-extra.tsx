"use client";

/**
 * app/ceo/ceo-extra.tsx
 * Yönetim panelinin yeni bölümleri:
 *  - CEO Merkezi (yalnızca CEO): satış, ziyaret, cüzdan, bekleyen işler ve entegrasyon durumu
 *  - Dijital Yayınlar: başvurular, durum, ISRC / UPC ataması
 *  - İşlem Kayıtları (CEO / admin): güvenlik ve işlem geçmişi, SMM hata kayıtları
 * Tüm yetkili işlemler veritabanı fonksiyonlarıyla (RPC) yapılır; yetki veritabanında kontrol edilir.
 */

import { useCallback, useEffect, useMemo, useState } from "react";
import type { getSupabase } from "../../lib/supabase";

type SB = NonNullable<ReturnType<typeof getSupabase>>;
type Notify = (text: string) => void;

/* ================================================================== */
/*  ORTAK                                                              */
/* ================================================================== */

const card = "rounded-3xl border-[2.5px] border-[#111] bg-white";
const inputCls = "field w-full rounded-2xl border-[2.5px] border-[#111] bg-white px-4 py-3 text-base outline-none transition";
const btnPrimary =
  "rounded-full border-[2.5px] border-[#111] bg-[#f5c518] px-5 py-3 text-sm font-bold text-[#111] shadow-[0_4px_0_#111] transition hover:-translate-y-0.5 hover:bg-[#e5b600] hover:shadow-[0_6px_0_#111] active:translate-y-[2px] active:shadow-[0_1px_0_#111] disabled:cursor-not-allowed disabled:opacity-50 disabled:hover:translate-y-0";
const btnGhost = "rounded-full border-[2.5px] border-[#111] bg-white px-4 py-2 text-xs font-bold transition hover:bg-[#f5c518] disabled:opacity-50";

const tl = (n: number) => new Intl.NumberFormat("tr-TR", { maximumFractionDigits: 2 }).format(Number(n) || 0) + " TL";
const num = (n: number) => new Intl.NumberFormat("tr-TR").format(Number(n) || 0);
const dateTime = (s: string) => new Date(s).toLocaleString("tr-TR", { day: "2-digit", month: "short", hour: "2-digit", minute: "2-digit" });

/** Veritabanı fonksiyonu çağırır; hata mesajlarını okunur hale getirir. */
export async function rpcCall<T = unknown>(sb: SB, fn: string, args: Record<string, unknown> = {}): Promise<{ ok: boolean; data?: T; error?: string }> {
  const { data, error } = await sb.rpc(fn, args);
  if (error) {
    const m = String(error.message || "");
    if (error.code === "PGRST202" || /could not find the function/i.test(m)) {
      return { ok: false, error: "Veritabanı kurulumu eksik: supabase/migrations klasöründeki SQL dosyaları çalıştırılmalı." };
    }
    return { ok: false, error: m.replace(/^YETKISIZ:?\s*/, "Yetki yok: ") || "İşlem başarısız." };
  }
  return { ok: true, data: data as T };
}

async function authedPost(sb: SB, url: string, body: Record<string, unknown>) {
  const { data } = await sb.auth.getSession();
  const token = data.session?.access_token;
  const res = await fetch(url, {
    method: "POST",
    headers: { "content-type": "application/json", ...(token ? { Authorization: `Bearer ${token}` } : {}) },
    body: JSON.stringify(body),
  });
  return { ok: res.ok, json: (await res.json().catch(() => ({}))) as Record<string, unknown> };
}

function Head({ eyebrow, title, desc }: { eyebrow: string; title: string; desc?: string }) {
  return (
    <div className="mb-7">
      <p className="mb-3 inline-flex items-center gap-2 rounded-full border-2 border-[#111] bg-white px-3 py-1 text-[11px] font-bold uppercase tracking-[0.14em]">{eyebrow}</p>
      <h1 className="hd text-[34px] font-extrabold leading-none tracking-[-0.045em] sm:text-5xl">{title}</h1>
      {desc && <p className="mt-3 max-w-2xl text-base text-[#686868]">{desc}</p>}
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

function Note({ children }: { children: React.ReactNode }) {
  return <p role="alert" className="mb-5 rounded-2xl border-[2.5px] border-[#111] bg-[#fff6cf] p-4 text-sm font-semibold">{children}</p>;
}

/* ================================================================== */
/*  CEO MERKEZİ                                                         */
/* ================================================================== */

type Gun = { gun: string; ciro: number; siparis: number; ziyaret: number };
type Ozet = {
  olusturuldu: string;
  uye_toplam: number;
  uye_30g: number;
  yonetici: number;
  ziyaret_bugun: number;
  ziyaretci_bugun: number;
  ziyaret_ay: number;
  ziyaretci_ay: number;
  ziyaret_30g: number;
  ziyaretci_30g: number;
  siparis_toplam: number;
  ciro_toplam: number;
  ciro_ay: number;
  ciro_bugun: number;
  siparis_ay: number;
  siparis_bekleyen: number;
  siparis_revizyon: number;
  siparis_iptal: number;
  durumlar: Record<string, number>;
  hizmetler: { tur: string; adet: number; ciro: number }[];
  yukleme_toplam: number;
  yukleme_ay: number;
  yukleme_bekleyen_adet: number;
  yukleme_bekleyen_tutar: number;
  yukleme_basarisiz_30g: number;
  iade_adet: number;
  iade_tutar: number;
  duzeltme_adet: number;
  uyelerdeki_bakiye: number;
  destek_yeni: number;
  yayin_bekleyen: number;
  yayin_kodsuz: number;
  gunluk: Gun[];
};

type Durum = {
  sunucuAnahtari?: boolean;
  yapayZeka?: boolean;
  yapayZekaModel?: string;
  dagitim?: string;
  kartOdeme?: { aktif: boolean; mod?: "test" | "canli" };
  havale?: boolean;
  digerOdeme?: string[];
  smm?: { toplam: number; aktif: number };
  veritabani?: { yayinTablosu: boolean; islemKaydi: boolean };
};

const SERVICE_LABEL: Record<string, string> = {
  influencer: "Influencer Marketing",
  smm: "SMM Panel",
  remake: "Remake Beat",
  mix: "Mix & Mastering",
  yayin: "Dijital Yayın",
  diger: "Diğer",
};

const shortDay = (iso: string) => new Date(iso + "T12:00:00").toLocaleDateString("tr-TR", { day: "numeric", month: "short" });

/** Düzgün bir üst sınır (1-2-5 serisi) */
function niceMax(v: number) {
  if (v <= 0) return 1;
  const p = Math.pow(10, Math.floor(Math.log10(v)));
  const m = v / p;
  return (m <= 1 ? 1 : m <= 2 ? 2 : m <= 5 ? 5 : 10) * p;
}

/** Tek serilik küçük sütun grafik (koyu zemin). Üzerine gelince / klavye odağında değer gösterir. */
function MiniColumns({ title, data, fmt }: { title: string; data: { label: string; value: number }[]; fmt: (n: number) => string }) {
  const [hi, setHi] = useState<number | null>(null);
  const W = 336;
  const H = 128;
  const top = 10;
  const base = H - 20;
  const n = Math.max(1, data.length);
  const slot = W / n;
  const bw = Math.min(16, slot - 2); // ince sütun + aradaki boşluk
  const max = niceMax(Math.max(0, ...data.map((d) => d.value)));
  const total = data.reduce((a, d) => a + d.value, 0);
  const y = (v: number) => base - ((base - top) * v) / max;

  return (
    <figure className="min-w-0 rounded-2xl border border-white/10 bg-[#161616] p-4">
      <figcaption className="flex items-baseline justify-between gap-2">
        <span className="text-[13px] font-semibold text-white">{title}</span>
        <span className="text-[12px] text-[#bdbdbd]" aria-live="polite">
          {hi !== null ? `${shortDay(data[hi].label)} · ${fmt(data[hi].value)}` : `14 gün · ${fmt(total)}`}
        </span>
      </figcaption>
      <svg viewBox={`0 0 ${W} ${H}`} className="mt-3 block h-auto w-full" role="img" aria-label={`${title}: son 14 gün, toplam ${fmt(total)}`} onMouseLeave={() => setHi(null)}>
        {/* yatay çizgiler: üst değer ve taban (ince, geri planda) */}
        <line x1="0" x2={W} y1={top} y2={top} stroke="#2a2a2a" strokeWidth="1" />
        <line x1="0" x2={W} y1={base} y2={base} stroke="#3a3a3a" strokeWidth="1" />
        <text x="0" y={top - 2} fontSize="10" fill="#8a8a8a" className="tabular-nums">
          {fmt(max)}
        </text>
        {data.map((d, i) => {
          const x = i * slot + (slot - bw) / 2;
          const h = Math.max(0, base - y(d.value));
          const r = Math.min(4, h, bw / 2);
          const yy = base - h;
          return (
            <g key={d.label}>
              {h > 0 && (
                <path
                  d={`M${x},${base} L${x},${yy + r} Q${x},${yy} ${x + r},${yy} L${x + bw - r},${yy} Q${x + bw},${yy} ${x + bw},${yy + r} L${x + bw},${base} Z`}
                  fill="#f5c518"
                  opacity={hi === null || hi === i ? 1 : 0.45}
                />
              )}
              {/* sütundan büyük görünmez dokunma / odak alanı */}
              <rect
                x={i * slot}
                y={0}
                width={slot}
                height={H}
                fill="transparent"
                tabIndex={0}
                aria-label={`${shortDay(d.label)}: ${fmt(d.value)}`}
                onMouseEnter={() => setHi(i)}
                onFocus={() => setHi(i)}
                onBlur={() => setHi(null)}
              />
            </g>
          );
        })}
        {data.length > 1 && (
          <>
            <text x="0" y={H - 4} fontSize="10" fill="#8a8a8a">
              {shortDay(data[0].label)}
            </text>
            <text x={W} y={H - 4} fontSize="10" fill="#8a8a8a" textAnchor="end">
              {shortDay(data[data.length - 1].label)}
            </text>
          </>
        )}
      </svg>
    </figure>
  );
}

function DarkStat({ label, value, sub, onClick }: { label: string; value: string; sub?: string; onClick?: () => void }) {
  const inner = (
    <>
      <span className="block text-[12px] font-semibold text-[#bdbdbd]">{label}</span>
      <span className="mt-2 block whitespace-nowrap text-[28px] font-semibold leading-none tracking-[-0.03em] text-white">{value}</span>
      {sub && <span className="mt-2 block text-[12px] text-[#8a8a8a]">{sub}</span>}
    </>
  );
  return onClick ? (
    <button type="button" onClick={onClick} className="min-w-0 rounded-2xl border border-white/10 bg-[#161616] p-4 text-left transition hover:border-[#f5c518]/60 focus-visible:outline-[#f5c518]">
      {inner}
    </button>
  ) : (
    <div className="min-w-0 rounded-2xl border border-white/10 bg-[#161616] p-4">{inner}</div>
  );
}

function IntegrationRow({ ok, warn, title, text }: { ok: boolean; warn?: boolean; title: string; text: string }) {
  const tone = ok ? "bg-[#f5c518] text-[#111]" : warn ? "bg-white text-[#111]" : "bg-[#3a3a3a] text-white";
  const icon = ok ? "✓" : warn ? "!" : "–";
  const status = ok ? "Bağlı" : warn ? "Dikkat" : "Bekleyen entegrasyon";
  return (
    <li className="flex items-start gap-3 border-b border-white/10 py-3 last:border-0">
      <span className={`grid h-6 w-6 flex-none place-items-center rounded-full text-xs font-bold ${tone}`} aria-hidden="true">{icon}</span>
      <div className="min-w-0">
        <p className="text-sm font-semibold text-white">
          {title} <span className="ml-1 text-[11px] font-bold uppercase tracking-[0.1em] text-[#bdbdbd]">· {status}</span>
        </p>
        <p className="mt-0.5 text-[12px] leading-5 text-[#8a8a8a]">{text}</p>
      </div>
    </li>
  );
}

export function CeoDashboard({ sb, name, onJump }: { sb: SB; name: string; onJump: (tab: string) => void }) {
  const [ozet, setOzet] = useState<Ozet | null>(null);
  const [durum, setDurum] = useState<Durum | null>(null);
  const [err, setErr] = useState("");
  const [busy, setBusy] = useState(false);
  const [loaded, setLoaded] = useState(false);

  const fetchAll = useCallback(() => Promise.all([rpcCall<Ozet>(sb, "h7_ceo_ozet"), authedPost(sb, "/api/durum", {})]), [sb]);
  const apply = useCallback(([o, d]: Awaited<ReturnType<typeof fetchAll>>) => {
    if (o.ok && o.data) {
      setOzet(o.data);
      setErr("");
    } else setErr(o.error || "İstatistikler okunamadı.");
    if (d.ok) setDurum(d.json as Durum);
    setLoaded(true);
  }, []);

  async function load() {
    setBusy(true);
    apply(await fetchAll());
    setBusy(false);
  }

  useEffect(() => {
    let alive = true;
    fetchAll().then((r) => {
      if (alive) apply(r);
    });
    return () => {
      alive = false;
    };
  }, [fetchAll, apply]);

  const days = ozet?.gunluk || [];
  const services = useMemo(() => [...(ozet?.hizmetler || [])].sort((a, b) => b.ciro - a.ciro), [ozet]);
  const maxService = Math.max(1, ...services.map((s) => Number(s.ciro) || 0));
  const today = new Date().toLocaleDateString("tr-TR", { weekday: "long", day: "numeric", month: "long" });

  return (
    <>
      <div className="relative overflow-hidden rounded-[32px] border-[3px] border-[#111] bg-[#0b0b0b] p-5 text-white shadow-[0_10px_0_#f5c518] sm:p-8">
        <div className="pointer-events-none absolute -right-24 -top-24 h-72 w-72 rounded-full bg-[radial-gradient(circle,rgba(245,197,24,0.22),rgba(245,197,24,0)_65%)]" aria-hidden="true" />
        <div className="relative flex flex-wrap items-start justify-between gap-4">
          <div>
            <span className="inline-flex items-center gap-2 rounded-full bg-[#f5c518] px-3 py-1 text-[11px] font-extrabold tracking-[0.16em] text-[#111]">♛ CEO MERKEZİ</span>
            <h1 className="hd mt-4 text-[34px] font-extrabold leading-none tracking-[-0.045em] sm:text-5xl">Hoş geldin, {name}.</h1>
            <p className="mt-2 text-sm text-[#bdbdbd]">{today} · platformun tamamı tek ekranda</p>
          </div>
          <button type="button" onClick={load} disabled={busy} className="rounded-full border-2 border-white/30 px-4 py-2 text-xs font-bold text-white transition hover:border-[#f5c518] hover:text-[#f5c518] disabled:opacity-50">
            {busy ? "Yenileniyor…" : "↻ Yenile"}
          </button>
        </div>

        {err && <p className="relative mt-6 rounded-2xl border border-[#f5c518]/50 bg-[#1b1608] p-4 text-sm font-semibold text-[#f5c518]">{err}</p>}
        {!loaded && <p className="relative mt-6 text-sm font-bold tracking-[0.14em] text-[#bdbdbd]">YÜKLENİYOR…</p>}

        {ozet && (
          <div className="relative mt-7 space-y-6">
            {/* Ana rakam */}
            <div className="flex flex-wrap items-end justify-between gap-6 border-b border-white/10 pb-6">
              <div>
                <p className="text-[13px] font-semibold text-[#bdbdbd]">Bu ay ciro</p>
                <p className="mt-1 text-[52px] font-semibold leading-none tracking-[-0.04em] text-white sm:text-[64px]">{tl(ozet.ciro_ay)}</p>
                <p className="mt-3 text-sm text-[#bdbdbd]">
                  Bugün {tl(ozet.ciro_bugun)} · Toplam {tl(ozet.ciro_toplam)} · {num(ozet.siparis_toplam)} sipariş
                </p>
              </div>
              <div className="flex flex-wrap gap-2">
                <button type="button" className="rounded-full bg-[#f5c518] px-4 py-2 text-xs font-bold text-[#111]" onClick={() => onJump("orders")}>Siparişler →</button>
                <button type="button" className="rounded-full border-2 border-white/30 px-4 py-2 text-xs font-bold text-white hover:border-[#f5c518]" onClick={() => onJump("ai")}>✦ AI’a sor</button>
              </div>
            </div>

            {/* Göstergeler */}
            <div className="grid grid-cols-2 gap-3 lg:grid-cols-4">
              <DarkStat label="Bekleyen sipariş" value={num(ozet.siparis_bekleyen)} sub={`${num(ozet.siparis_revizyon)} revizyonda · ${num(ozet.siparis_iptal)} iptal`} onClick={() => onJump("orders")} />
              <DarkStat label="Bugün ziyaretçi" value={num(ozet.ziyaretci_bugun)} sub={`Bu ay ${num(ozet.ziyaretci_ay)} · ${num(ozet.ziyaret_ay)} görüntüleme`} onClick={() => onJump("traffic")} />
              <DarkStat label="Toplam üye" value={num(ozet.uye_toplam)} sub={`Son 30 gün +${num(ozet.uye_30g)} · ${num(ozet.yonetici)} yönetici`} onClick={() => onJump("members")} />
              <DarkStat label="Cüzdan yüklemeleri" value={tl(ozet.yukleme_toplam)} sub={`Bu ay ${tl(ozet.yukleme_ay)}`} onClick={() => onJump("wallet")} />
              <DarkStat label="Onay bekleyen yükleme" value={num(ozet.yukleme_bekleyen_adet)} sub={tl(ozet.yukleme_bekleyen_tutar)} onClick={() => onJump("wallet")} />
              <DarkStat label="İadeler" value={num(ozet.iade_adet)} sub={`${tl(ozet.iade_tutar)} · ${num(ozet.yukleme_basarisiz_30g)} başarısız ödeme (30 gün)`} onClick={() => onJump("wallet")} />
              <DarkStat label="Yeni destek talebi" value={num(ozet.destek_yeni)} onClick={() => onJump("support")} />
              <DarkStat label="Bekleyen yayın" value={num(ozet.yayin_bekleyen)} sub={`${num(ozet.yayin_kodsuz)} şarkıda ISRC yok`} onClick={() => onJump("releases")} />
            </div>

            {/* Son 14 gün — üç ayrı küçük grafik (farklı ölçekler aynı eksende gösterilmez) */}
            <div>
              <p className="mb-3 text-[13px] font-semibold text-[#bdbdbd]">Son 14 gün</p>
              <div className="grid gap-3 lg:grid-cols-3">
                <MiniColumns title="Günlük ciro" data={days.map((d) => ({ label: d.gun, value: Number(d.ciro) || 0 }))} fmt={tl} />
                <MiniColumns title="Günlük sipariş" data={days.map((d) => ({ label: d.gun, value: Number(d.siparis) || 0 }))} fmt={num} />
                <MiniColumns title="Günlük ziyaret" data={days.map((d) => ({ label: d.gun, value: Number(d.ziyaret) || 0 }))} fmt={num} />
              </div>
              <details className="mt-3 text-sm text-[#bdbdbd]">
                <summary className="cursor-pointer text-[12px] font-semibold text-[#bdbdbd] hover:text-white">Tablo olarak gör</summary>
                <div className="mt-3 overflow-x-auto">
                  <table className="w-full min-w-[420px] text-left text-[13px] tabular-nums">
                    <thead>
                      <tr className="border-b border-white/15 text-[#8a8a8a]">
                        <th className="py-2 pr-3 font-semibold">Gün</th>
                        <th className="py-2 pr-3 text-right font-semibold">Ciro</th>
                        <th className="py-2 pr-3 text-right font-semibold">Sipariş</th>
                        <th className="py-2 text-right font-semibold">Ziyaret</th>
                      </tr>
                    </thead>
                    <tbody>
                      {days.map((d) => (
                        <tr key={d.gun} className="border-b border-white/5 text-white">
                          <td className="py-1.5 pr-3">{shortDay(d.gun)}</td>
                          <td className="py-1.5 pr-3 text-right">{tl(d.ciro)}</td>
                          <td className="py-1.5 pr-3 text-right">{num(d.siparis)}</td>
                          <td className="py-1.5 text-right">{num(d.ziyaret)}</td>
                        </tr>
                      ))}
                    </tbody>
                  </table>
                </div>
              </details>
            </div>

            <div className="grid gap-3 lg:grid-cols-[1.2fr_1fr]">
              {/* Hizmet bazında ciro */}
              <div className="rounded-2xl border border-white/10 bg-[#161616] p-4">
                <p className="text-[13px] font-semibold text-white">Hizmetlere göre ciro</p>
                <p className="mt-0.5 text-[12px] text-[#8a8a8a]">İptal edilenler hariç, tüm zamanlar</p>
                {services.length === 0 ? (
                  <p className="mt-4 text-sm text-[#8a8a8a]">Henüz sipariş yok.</p>
                ) : (
                  <ul className="mt-4 space-y-3">
                    {services.map((s) => (
                      <li key={s.tur}>
                        <div className="flex items-baseline justify-between gap-3 text-[13px]">
                          <span className="text-white">{SERVICE_LABEL[s.tur] || s.tur}</span>
                          <span className="tabular-nums text-[#bdbdbd]">
                            {tl(s.ciro)} · {num(s.adet)} sipariş
                          </span>
                        </div>
                        <div className="mt-1.5 h-3">
                          <div
                            className="h-3 rounded-r-[4px] bg-[#f5c518]"
                            style={{ width: `${Math.max(Number(s.ciro) > 0 ? 1.5 : 0, (Number(s.ciro) / maxService) * 100)}%` }}
                            role="img"
                            aria-label={`${SERVICE_LABEL[s.tur] || s.tur}: ${tl(s.ciro)}`}
                          />
                        </div>
                      </li>
                    ))}
                  </ul>
                )}
              </div>

              {/* Entegrasyon durumu — çalışmayan hiçbir şey "bağlı" görünmez */}
              <div className="rounded-2xl border border-white/10 bg-[#161616] p-4">
                <p className="text-[13px] font-semibold text-white">Entegrasyonlar</p>
                {!durum ? (
                  <p className="mt-3 text-sm text-[#8a8a8a]">Durum okunamadı.</p>
                ) : (
                  <ul className="mt-2">
                    <IntegrationRow
                      ok={!!durum.sunucuAnahtari}
                      title="Sunucu anahtarı (Supabase)"
                      text={durum.sunucuAnahtari ? "Sipariş, cüzdan, dosya yükleme ve destek API'leri çalışabilir." : "SUPABASE_SECRET_KEY / SUPABASE_SERVICE_ROLE_KEY eklenmeli; eklenmeden sipariş ve ödeme alınamaz."}
                    />
                    {durum.veritabani && (
                      <IntegrationRow
                        ok={durum.veritabani.yayinTablosu && durum.veritabani.islemKaydi}
                        title="Veritabanı kurulumu"
                        text={durum.veritabani.yayinTablosu && durum.veritabani.islemKaydi ? "Migration'lar çalıştırılmış." : "supabase/migrations klasöründeki SQL dosyaları çalıştırılmalı."}
                      />
                    )}
                    <IntegrationRow
                      ok={!!durum.kartOdeme?.aktif && durum.kartOdeme?.mod === "canli"}
                      warn={!!durum.kartOdeme?.aktif && durum.kartOdeme?.mod !== "canli"}
                      title="Kartla ödeme (PayTR)"
                      text={
                        !durum.kartOdeme?.aktif
                          ? "Gerçek PayTR mağaza bilgileri girilmedi; kartla bakiye yüklenemez."
                          : durum.kartOdeme.mod === "canli"
                            ? "Canlı modda: gerçek ödemeler alınıyor."
                            : "TEST modunda: gerçek para çekilmez. Canlıya almak için Ödeme Yöntemleri bölümü."
                      }
                    />
                    <IntegrationRow ok={!!durum.havale} title="Havale / EFT" text={durum.havale ? "IBAN tanımlı; bildirimler elle onaylanır." : "IBAN eklenmedi."} />
                    {!!durum.digerOdeme?.length && (
                      <IntegrationRow ok={false} title={`Diğer ödeme sağlayıcıları (${durum.digerOdeme.join(", ")})`} text="Anahtarlar kayıtlı ama bu sağlayıcıların ödeme akışı henüz yazılmadı; sitede kullanılamaz." />
                    )}
                    <IntegrationRow
                      ok={!!durum.smm && durum.smm.aktif > 0}
                      title="SMM sağlayıcıları"
                      text={durum.smm && durum.smm.aktif > 0 ? `${durum.smm.aktif} aktif sağlayıcı; siparişler otomatik gönderilir.` : "Aktif sağlayıcı yok; SMM siparişleri elle işlenir."}
                    />
                    <IntegrationRow
                      ok={!!durum.yapayZeka}
                      title="Yapay zekâ asistanı (Claude)"
                      text={durum.yapayZeka ? `Model: ${durum.yapayZekaModel}` : "ANTHROPIC_API_KEY eklenmeli."}
                    />
                    <IntegrationRow ok={false} title="Dijital dağıtım ortağı" text="Platformlara gönderim için bir dağıtım ortağı API'si bağlı değil; yayınlar yönetim tarafından elle iletilir." />
                  </ul>
                )}
              </div>
            </div>
          </div>
        )}
      </div>
    </>
  );
}

/* ================================================================== */
/*  DİJİTAL YAYINLAR                                                    */
/* ================================================================== */

type Track = {
  id: string;
  position: number;
  title: string;
  audio_url: string | null;
  audio_name: string | null;
  songwriter: string | null;
  composer: string | null;
  language: string | null;
  explicit: boolean;
  instrumental: boolean;
  isrc: string | null;
};
type Release = {
  id: string;
  order_id: number | null;
  user_id: string;
  format: "single" | "ep" | "album";
  title: string;
  artist: string;
  release_date: string | null;
  genre: string | null;
  language: string | null;
  explicit: boolean;
  release_type: string;
  cover_url: string | null;
  stores: string[];
  upc: string | null;
  status: string;
  admin_note: string | null;
  meta: Record<string, unknown> | null;
  created_at: string;
  release_tracks: Track[];
};

export const RELEASE_STATUSES = ["Başvuru alındı", "İncelemede", "Düzeltme gerekli", "Onaylandı", "Dağıtıma gönderildi", "Yayında", "Reddedildi"];
const FORMAT_LABEL: Record<string, string> = { single: "Tekli", ep: "EP", album: "Albüm" };

function ReleaseEditor({ sb, notify, r, owner, onSaved }: { sb: SB; notify: Notify; r: Release; owner: string; onSaved: () => void }) {
  const tracks = useMemo(() => [...(r.release_tracks || [])].sort((a, b) => a.position - b.position), [r.release_tracks]);
  const [upc, setUpc] = useState(r.upc || "");
  const [isrc, setIsrc] = useState<Record<string, string>>(() => Object.fromEntries(tracks.map((t) => [t.id, t.isrc || ""])));
  const [status, setStatus] = useState(r.status);
  const [note, setNote] = useState(r.admin_note || "");
  const [busy, setBusy] = useState("");
  const links = (r.meta?.links || {}) as Record<string, string>;

  async function saveCodes() {
    setBusy("codes");
    const res = await rpcCall(sb, "h7_yayin_kod", {
      p_yayin: r.id,
      p_upc: upc.trim() || null,
      p_isrc: tracks.map((t) => ({ id: t.id, isrc: (isrc[t.id] || "").trim() })),
    });
    setBusy("");
    if (!res.ok) return notify(res.error || "Kodlar kaydedilemedi.");
    notify("ISRC / UPC kodları kaydedildi. Müşteri panelinde görünür.");
    onSaved();
  }

  async function saveStatus() {
    setBusy("status");
    const res = await rpcCall(sb, "h7_yayin_durum", { p_yayin: r.id, p_durum: status, p_not: note });
    setBusy("");
    if (!res.ok) return notify(res.error || "Durum kaydedilemedi.");
    notify("Yayın durumu güncellendi.");
    onSaved();
  }

  return (
    <div className="space-y-5 border-t-2 border-dashed border-[#111]/30 bg-[#f5f5f5] p-5">
      <div className="grid gap-4 sm:grid-cols-[120px_1fr]">
        {r.cover_url ? (
          <a href={r.cover_url} target="_blank" rel="noreferrer" className="block">
            {/* eslint-disable-next-line @next/next/no-img-element */}
            <img src={r.cover_url} alt={`${r.title} kapağı`} className="aspect-square w-full rounded-2xl border-[2.5px] border-[#111] object-cover" />
            <span className="mt-1 block text-center text-[11px] font-bold underline">Kapağı indir ↓</span>
          </a>
        ) : (
          <div className="grid aspect-square place-items-center rounded-2xl border-[2.5px] border-dashed border-[#111] text-xs text-[#686868]">Kapak yok</div>
        )}
        <dl className="grid gap-x-6 gap-y-2 text-sm sm:grid-cols-2">
          <div><dt className="text-[11px] font-bold uppercase tracking-[0.12em] text-[#686868]">Sanatçı hesabı</dt><dd className="font-semibold">{owner}</dd></div>
          <div><dt className="text-[11px] font-bold uppercase tracking-[0.12em] text-[#686868]">Çıkış tarihi</dt><dd className="font-semibold">{r.release_date ? new Date(r.release_date).toLocaleDateString("tr-TR") : "Belirtilmedi"}</dd></div>
          <div><dt className="text-[11px] font-bold uppercase tracking-[0.12em] text-[#686868]">Tür / dil</dt><dd className="font-semibold">{[r.genre, r.language].filter(Boolean).join(" / ") || "—"}</dd></div>
          <div><dt className="text-[11px] font-bold uppercase tracking-[0.12em] text-[#686868]">Eser türü</dt><dd className="font-semibold">{r.release_type === "cover" ? "Cover" : "Orijinal"} · {r.explicit ? "Açık içerik" : "Temiz"}</dd></div>
          <div className="sm:col-span-2"><dt className="text-[11px] font-bold uppercase tracking-[0.12em] text-[#686868]">Platformlar</dt><dd className="font-semibold">{(r.stores || []).join(", ") || "—"}</dd></div>
          {Object.values(links).some(Boolean) && (
            <div className="sm:col-span-2">
              <dt className="text-[11px] font-bold uppercase tracking-[0.12em] text-[#686868]">Sanatçı profilleri</dt>
              <dd className="flex flex-wrap gap-2">
                {Object.entries(links).filter(([, v]) => v).map(([k, v]) => (
                  <a key={k} href={/^https?:\/\//.test(v) ? v : `https://${v}`} target="_blank" rel="noreferrer" className={btnGhost}>{k} ↗</a>
                ))}
              </dd>
            </div>
          )}
        </dl>
      </div>

      <div className="rounded-2xl border-[2.5px] border-[#111] bg-white p-4">
        <p className="text-sm font-bold">Kodlar</p>
        <p className="mb-3 text-xs text-[#686868]">ISRC her şarkıya, UPC yayın paketine HITY7 yönetimi tarafından atanır; sanatçıdan istenmez.</p>
        <label className="block max-w-sm">
          <span className="mb-1 block text-[11px] font-bold uppercase tracking-[0.12em] text-[#686868]">UPC / EAN (12–13 hane)</span>
          <input className={inputCls + " !py-2 font-mono"} value={upc} onChange={(e) => setUpc(e.target.value)} placeholder="Örn. 0123456789012" inputMode="numeric" />
        </label>
        <ol className="mt-4 space-y-2">
          {tracks.map((t) => (
            <li key={t.id} className="flex flex-col gap-2 rounded-xl border-2 border-[#111] p-3 sm:flex-row sm:items-center">
              <div className="min-w-0 flex-1">
                <p className="truncate text-sm font-bold">{String(t.position).padStart(2, "0")} · {t.title}</p>
                <p className="truncate text-xs text-[#686868]">
                  {[t.songwriter && `Söz: ${t.songwriter}`, t.composer && `Beste: ${t.composer}`, t.explicit && "Açık içerik", t.instrumental && "Enstrümantal"].filter(Boolean).join(" · ") || "—"}
                </p>
              </div>
              {t.audio_url && (
                <a href={t.audio_url} target="_blank" rel="noreferrer" className={btnGhost + " flex-none"}>Ses ↓</a>
              )}
              <input
                className={inputCls + " !w-full !py-2 font-mono uppercase sm:!w-[190px]"}
                value={isrc[t.id] || ""}
                onChange={(e) => setIsrc((m) => ({ ...m, [t.id]: e.target.value }))}
                placeholder="ISRC (TRA1B2600001)"
                aria-label={`${t.title} ISRC`}
              />
            </li>
          ))}
        </ol>
        <button type="button" className={btnPrimary + " mt-4"} disabled={busy === "codes"} onClick={saveCodes}>
          {busy === "codes" ? "Kaydediliyor…" : "Kodları kaydet"}
        </button>
      </div>

      <div className="rounded-2xl border-[2.5px] border-[#111] bg-white p-4">
        <p className="mb-3 text-sm font-bold">Durum ve müşteriye not</p>
        <div className="grid gap-3 sm:grid-cols-[240px_1fr]">
          <select className={inputCls + " !py-2 font-bold"} value={status} onChange={(e) => setStatus(e.target.value)} aria-label="Yayın durumu">
            {RELEASE_STATUSES.map((s) => <option key={s}>{s}</option>)}
          </select>
          <input className={inputCls + " !py-2"} value={note} onChange={(e) => setNote(e.target.value)} placeholder="Örn: Kapak 3000×3000 olmalı, yeniden yükle." />
        </div>
        <button type="button" className={btnPrimary + " mt-3"} disabled={busy === "status"} onClick={saveStatus}>
          {busy === "status" ? "Kaydediliyor…" : "Durumu kaydet"}
        </button>
        <p className="mt-2 text-xs text-[#686868]">“Yayında” seçildiğinde bağlı sipariş otomatik olarak Tamamlandı olur.</p>
      </div>
    </div>
  );
}

export function ReleasesTab({ sb, notify }: { sb: SB; notify: Notify }) {
  const [rows, setRows] = useState<Release[]>([]);
  const [names, setNames] = useState<Record<string, string>>({});
  const [filter, setFilter] = useState("all");
  const [q, setQ] = useState("");
  const [open, setOpen] = useState<string | null>(null);
  const [err, setErr] = useState("");
  const [ready, setReady] = useState(false);

  const fetchAll = useCallback(
    () =>
      Promise.all([
        sb.from("releases").select("*, release_tracks(*)").order("created_at", { ascending: false }).limit(300),
        sb.from("profiles").select("id,full_name,email").limit(5000),
      ]),
    [sb]
  );
  const apply = useCallback(([r, p]: Awaited<ReturnType<typeof fetchAll>>) => {
    setErr(r.error ? "Yayınlar okunamadı. Veritabanı kurulumu (migration 03) yapıldı mı?" : "");
    setRows((r.data as Release[]) || []);
    setNames(Object.fromEntries(((p.data as { id: string; full_name: string | null; email: string | null }[]) || []).map((x) => [x.id, x.full_name || x.email || "Üye"])));
    setReady(true);
  }, []);
  const load = useCallback(async () => apply(await fetchAll()), [apply, fetchAll]);

  useEffect(() => {
    let alive = true;
    fetchAll().then((r) => {
      if (alive) apply(r);
    });
    return () => {
      alive = false;
    };
  }, [fetchAll, apply]);

  const qq = q.trim().toLowerCase();
  const shown = rows.filter(
    (r) =>
      (filter === "all" || (filter === "kodsuz" ? !r.upc || r.release_tracks.some((t) => !t.isrc) : r.status === filter)) &&
      (!qq || r.title.toLowerCase().includes(qq) || r.artist.toLowerCase().includes(qq) || (r.upc || "").includes(qq) || r.release_tracks.some((t) => (t.isrc || "").toLowerCase().includes(qq)))
  );
  const missing = rows.filter((r) => !r.upc || r.release_tracks.some((t) => !t.isrc)).length;

  return (
    <>
      <Head eyebrow="Müzik kataloğu" title="Dijital Yayınlar" desc="Single, EP ve albüm başvuruları. Durumu güncelle, her şarkıya ISRC ve her yayına UPC ata." />
      {err && <Note>{err}</Note>}
      <input className={inputCls + " mb-4 max-w-md"} placeholder="Yayın, sanatçı, ISRC veya UPC ara" value={q} onChange={(e) => setQ(e.target.value)} />
      <div className="mb-5 flex flex-wrap gap-2">
        <Chip active={filter === "all"} onClick={() => setFilter("all")}>Tümü · {rows.length}</Chip>
        <Chip active={filter === "kodsuz"} onClick={() => setFilter("kodsuz")}>Kodu eksik · {missing}</Chip>
        {RELEASE_STATUSES.map((s) => (
          <Chip key={s} active={filter === s} onClick={() => setFilter(s)}>
            {s} · {rows.filter((r) => r.status === s).length}
          </Chip>
        ))}
      </div>

      {!ready ? (
        <p className="text-sm font-bold tracking-[0.14em] text-[#686868]">YÜKLENİYOR…</p>
      ) : shown.length === 0 ? (
        <div className="rounded-3xl border-[2.5px] border-dashed border-[#111] bg-white px-6 py-14 text-center">
          <h3 className="hd text-lg font-extrabold">Bu filtrede yayın yok</h3>
          <p className="mx-auto mt-2 max-w-sm text-sm text-[#686868]">Sanatçılar Dijital Yayın sayfasından başvurdukça burada listelenir.</p>
        </div>
      ) : (
        <div className={`${card} overflow-hidden`}>
          {shown.map((r) => {
            const isOpen = open === r.id;
            const codesDone = !!r.upc && r.release_tracks.every((t) => !!t.isrc);
            return (
              <div key={r.id} className="border-b border-[#111]/10 last:border-0">
                <button type="button" className="flex w-full items-center gap-4 p-5 text-left hover:bg-[#fffdf2]" onClick={() => setOpen(isOpen ? null : r.id)} aria-expanded={isOpen}>
                  {r.cover_url ? (
                    // eslint-disable-next-line @next/next/no-img-element
                    <img src={r.cover_url} alt="" className="h-14 w-14 flex-none rounded-xl border-2 border-[#111] object-cover" />
                  ) : (
                    <span className="grid h-14 w-14 flex-none place-items-center rounded-xl border-2 border-[#111] bg-[#f5c518]">♪</span>
                  )}
                  <span className="min-w-0 flex-1">
                    <span className="block truncate font-bold">{r.title} <span className="font-normal text-[#686868]">· {r.artist}</span></span>
                    <span className="mt-0.5 block truncate text-xs text-[#686868]">
                      {FORMAT_LABEL[r.format]} · {r.release_tracks.length} şarkı · {names[r.user_id] || "Üye"} · {new Date(r.created_at).toLocaleDateString("tr-TR")}
                    </span>
                  </span>
                  <span className="hidden flex-none flex-col items-end gap-1 sm:flex">
                    <span className="rounded-full border-2 border-[#111] bg-white px-2.5 py-0.5 text-[11px] font-bold">{r.status}</span>
                    <span className={`rounded-full px-2.5 py-0.5 text-[11px] font-bold ${codesDone ? "bg-[#111] text-[#f5c518]" : "bg-[#fff6cf] text-[#111]"}`}>
                      {codesDone ? "Kodlar tamam" : "Kod bekliyor"}
                    </span>
                  </span>
                </button>
                {isOpen && <ReleaseEditor sb={sb} notify={notify} r={r} owner={names[r.user_id] || "Üye"} onSaved={load} />}
              </div>
            );
          })}
        </div>
      )}
    </>
  );
}

/* ================================================================== */
/*  SİPARİŞ İŞ MASASI (Siparişler bölümünde, sipariş detayında)        */
/* ================================================================== */

type OrderEvent = {
  id: number;
  kind: "durum" | "teslimat" | "revizyon" | "not" | "iade";
  status: string | null;
  note: string | null;
  file_name: string | null;
  file_url: string | null;
  actor_id: string | null;
  created_at: string;
};
type SmmState = {
  provider_name?: string;
  provider_order_id?: string;
  status?: string;
  remains?: string | number | null;
  start_count?: string | number | null;
  error?: string | null;
  attention?: boolean;
  sent_at?: string;
  last_check?: string;
};
export type WorkOrder = { id: number; code: string | null; type: string | null; status: string; payload: Record<string, unknown> | null };

const EVENT_LABEL: Record<OrderEvent["kind"], string> = {
  durum: "Durum",
  teslimat: "Teslimat",
  revizyon: "Revizyon talebi",
  not: "Not",
  iade: "İade",
};

const safeFile = (n: string) => n.normalize("NFKD").replace(/[̀-ͯ]/g, "").replace(/[^\w.\-]+/g, "-").slice(-80);

export async function smmBulkRefresh(sb: SB) {
  const r = await authedPost(sb, "/api/admin-secure", { action: "smm_order_status_all" });
  return { ok: r.ok, message: String(r.json.message || r.json.error || (r.ok ? "Güncellendi." : "Güncellenemedi.")) };
}

export function OrderWorkbench({ sb, notify, order, onChanged }: { sb: SB; notify: Notify; order: WorkOrder; onChanged: () => void }) {
  const [events, setEvents] = useState<OrderEvent[]>([]);
  const [evErr, setEvErr] = useState("");
  const [file, setFile] = useState<File | null>(null);
  const [note, setNote] = useState("");
  const [complete, setComplete] = useState(true);
  const [busy, setBusy] = useState("");
  const smm = (order.payload?.smm || null) as SmmState | null;

  const fetchEvents = useCallback(() => sb.from("order_events").select("*").eq("order_id", order.id).order("created_at", { ascending: true }), [sb, order.id]);
  const apply = useCallback(({ data, error }: Awaited<ReturnType<typeof fetchEvents>>) => {
    setEvErr(error ? "Sipariş geçmişi okunamadı (migration 02 çalıştırıldı mı?)." : "");
    setEvents((data as OrderEvent[]) || []);
  }, []);
  const load = useCallback(async () => apply(await fetchEvents()), [apply, fetchEvents]);

  useEffect(() => {
    let alive = true;
    fetchEvents().then((r) => {
      if (alive) apply(r);
    });
    return () => {
      alive = false;
    };
  }, [fetchEvents, apply]);

  async function deliver() {
    if (!file && !note.trim()) return notify("Teslim dosyası seç veya bir not yaz.");
    if (file && file.size > 50 * 1024 * 1024) return notify("Dosya 50 MB'tan büyük. ZIP olarak sıkıştırıp tekrar dene.");
    setBusy("deliver");
    try {
      let url = "";
      if (file) {
        const path = `teslimat/${safeFile(order.code || String(order.id))}/${Date.now()}-${safeFile(file.name)}`;
        const up = await sb.storage.from("site-media").upload(path, file, { contentType: file.type || undefined });
        if (up.error) throw new Error(up.error.message);
        url = sb.storage.from("site-media").getPublicUrl(path).data.publicUrl;
      }
      const r = await rpcCall(sb, "h7_teslimat_ekle", {
        p_siparis: order.id,
        p_dosya_adi: file?.name || null,
        p_dosya_url: url || null,
        p_not: note.trim() || null,
        p_tamamla: complete,
      });
      if (!r.ok) throw new Error(r.error);
      setFile(null);
      setNote("");
      notify(complete ? "Teslimat eklendi, sipariş tamamlandı." : "Teslimat eklendi.");
      await load();
      onChanged();
    } catch (e) {
      notify("Teslimat eklenemedi: " + (e instanceof Error ? e.message : "bilinmeyen hata"));
    } finally {
      setBusy("");
    }
  }

  async function smmAction(action: "smm_order_send" | "smm_order_status") {
    setBusy(action);
    const r = await authedPost(sb, "/api/admin-secure", { action, orderId: order.id });
    setBusy("");
    notify(String(r.json.message || r.json.error || (r.ok ? "Tamam." : "İşlem başarısız.")));
    onChanged();
    load();
  }

  return (
    <div className="space-y-4">
      {order.type === "smm" && (
        <div className="rounded-2xl border-2 border-[#111] bg-white p-4">
          <p className="mb-2 text-[11px] font-bold uppercase tracking-[0.12em] text-[#686868]">SMM sağlayıcı</p>
          {smm?.provider_order_id ? (
            <p className="text-sm">
              <b>{smm.provider_name || "Sağlayıcı"}</b> · sipariş no <b className="font-mono">{smm.provider_order_id}</b> · durum <b>{smm.status || "—"}</b>
              {smm.remains !== undefined && smm.remains !== null && smm.remains !== "" ? ` · kalan ${smm.remains}` : ""}
              {smm.last_check ? <span className="text-[#686868]"> · son kontrol {dateTime(smm.last_check)}</span> : null}
            </p>
          ) : (
            <p className="text-sm text-[#686868]">Henüz sağlayıcıya gönderilmedi.{smm?.error ? "" : " Sağlayıcı yoksa veya manuel hizmetse elle işle."}</p>
          )}
          {smm?.error && <p className="mt-2 rounded-xl bg-[#fff6cf] px-3 py-2 text-sm font-semibold">Son hata: {smm.error}</p>}
          {smm?.attention && !smm.error && <p className="mt-2 rounded-xl bg-[#fff6cf] px-3 py-2 text-sm font-semibold">Sağlayıcı siparişi iptal etti veya kısmi tamamladı; gerekirse iade et.</p>}
          <div className="mt-3 flex flex-wrap gap-2">
            {!smm?.provider_order_id && (
              <button type="button" className={btnGhost} disabled={!!busy} onClick={() => smmAction("smm_order_send")}>
                {busy === "smm_order_send" ? "Gönderiliyor…" : "Sağlayıcıya gönder"}
              </button>
            )}
            {smm?.provider_order_id && (
              <button type="button" className={btnGhost} disabled={!!busy} onClick={() => smmAction("smm_order_status")}>
                {busy === "smm_order_status" ? "Sorgulanıyor…" : "↻ Durumu sorgula"}
              </button>
            )}
          </div>
        </div>
      )}

      <div className="rounded-2xl border-2 border-[#111] bg-white p-4">
        <p className="mb-3 text-[11px] font-bold uppercase tracking-[0.12em] text-[#686868]">Sipariş geçmişi</p>
        {evErr && <p className="text-sm text-[#686868]">{evErr}</p>}
        {!evErr && events.length === 0 && <p className="text-sm text-[#686868]">Kayıt yok.</p>}
        <ol className="space-y-2">
          {events.map((e) => (
            <li key={e.id} className="flex gap-3 text-sm">
              <span className="w-[110px] flex-none text-xs tabular-nums text-[#686868]">{dateTime(e.created_at)}</span>
              <span className="min-w-0">
                <b>{EVENT_LABEL[e.kind]}</b>
                {e.status ? ` · ${e.status}` : ""}
                {e.note ? <span className="text-[#242424]"> · {e.note}</span> : null}
                {e.file_url && (
                  <a href={e.file_url} target="_blank" rel="noreferrer" className="ml-2 font-bold underline">
                    {e.file_name || "Dosya"} ↓
                  </a>
                )}
              </span>
            </li>
          ))}
        </ol>
      </div>

      {order.type !== "smm" && order.status !== "İptal Edildi" && order.status !== "İptal" && (
        <div className="rounded-2xl border-2 border-[#111] bg-white p-4">
          <p className="mb-3 text-[11px] font-bold uppercase tracking-[0.12em] text-[#686868]">Teslimat ekle</p>
          <div className="grid gap-3 sm:grid-cols-2">
            <label className="flex cursor-pointer items-center justify-between gap-3 rounded-2xl border-[2.5px] border-dashed border-[#111] p-3 text-sm font-semibold hover:bg-[#fffdf2]">
              <span className="min-w-0 truncate">{file ? file.name : "Teslim dosyası seç (WAV, MP3, ZIP…)"}</span>
              <span className="grid h-8 w-8 flex-none place-items-center rounded-full border-2 border-[#111] bg-[#f5c518]">＋</span>
              <input type="file" className="hidden" onChange={(e) => setFile(e.target.files?.[0] || null)} />
            </label>
            <input className={inputCls + " !py-2 !text-sm"} value={note} onChange={(e) => setNote(e.target.value)} placeholder="Müşteriye not (isteğe bağlı)" />
          </div>
          <label className="mt-3 inline-flex items-center gap-2 text-sm font-semibold">
            <input type="checkbox" className="h-5 w-5 accent-[#f5c518]" checked={complete} onChange={(e) => setComplete(e.target.checked)} />
            Siparişi “Tamamlandı” yap
          </label>
          <div>
            <button type="button" className={btnPrimary + " mt-3 !px-4 !py-2 !text-xs"} disabled={busy === "deliver"} onClick={deliver}>
              {busy === "deliver" ? "Yükleniyor…" : "Teslimatı gönder →"}
            </button>
          </div>
          <p className="mt-2 text-xs text-[#686868]">Müşteri teslim dosyasını panelindeki Siparişlerim bölümünden indirir; isterse revizyon talep eder.</p>
        </div>
      )}
    </div>
  );
}

/* ================================================================== */
/*  İŞLEM KAYITLARI                                                     */
/* ================================================================== */

type Audit = { id: number; actor_id: string | null; action: string; target: string | null; details: Record<string, unknown> | null; created_at: string };
type SmmLog = { id: number; level: string; event: string; message: string | null; provider_id: string | null; order_id: number | null; created_at: string };

const ACTION_LABEL: Record<string, string> = {
  "siparis.olusturuldu": "Sipariş oluşturuldu",
  "siparis.durum": "Sipariş durumu değişti",
  "siparis.teslimat": "Teslimat eklendi",
  "siparis.revizyon_talebi": "Müşteri revizyon istedi",
  "cuzdan.havale_bildirimi": "Havale bildirimi",
  "cuzdan.yukleme_onaylandi": "Bakiye yüklemesi onaylandı",
  "cuzdan.yukleme_reddedildi": "Bakiye yüklemesi reddedildi",
  "cuzdan.manuel_duzeltme": "Manuel bakiye düzeltme",
  "odeme.paytr.basarili": "Kart ödemesi başarılı",
  "odeme.paytr.basarisiz": "Kart ödemesi başarısız",
  "odeme.paytr.gecersiz_imza": "Geçersiz imzalı ödeme bildirimi",
  "odeme.paytr.kayit_yok": "Eşleşmeyen ödeme bildirimi",
  "odeme.paytr.baslatilamadi": "Kart ödemesi başlatılamadı",
  "odeme.saglayici_eklendi": "Ödeme sağlayıcısı eklendi",
  "odeme.saglayici_silindi": "Ödeme sağlayıcısı silindi",
  "uye.rol_degisti": "Rol değişti",
  "uye.engellendi": "Üye engellendi",
  "uye.engel_kaldirildi": "Üye engeli kaldırıldı",
  "uye.basvuru_reddedildi": "Yönetici başvurusu reddedildi",
  "uye.ceo_atandi": "CEO atandı",
  "yayin.kod_atandi": "ISRC / UPC atandı",
  "yayin.durum": "Yayın durumu değişti",
  "yayin.kayit_hatasi": "Yayın kaydı oluşturulamadı",
  "yayin.sarki_kayit_hatasi": "Şarkı kayıtları oluşturulamadı",
  "smm.saglayici_eklendi": "SMM sağlayıcısı eklendi",
  "smm.saglayici_silindi": "SMM sağlayıcısı silindi",
  "smm.siparis_gonderildi": "SMM siparişi sağlayıcıya gönderildi",
  "smm.durum_guncellendi": "SMM sipariş durumu güncellendi",
};
const SENSITIVE = new Set(["cuzdan.manuel_duzeltme", "uye.rol_degisti", "uye.engellendi", "uye.ceo_atandi", "odeme.paytr.gecersiz_imza", "odeme.saglayici_eklendi", "odeme.saglayici_silindi"]);
const GROUPS: [string, string][] = [
  ["all", "Tümü"],
  ["siparis.", "Siparişler"],
  ["cuzdan.", "Cüzdan"],
  ["odeme.", "Ödemeler"],
  ["uye.", "Üyeler & roller"],
  ["yayin.", "Yayınlar"],
  ["smm.", "SMM"],
];

const detailText = (d: Record<string, unknown> | null) =>
  Object.entries(d || {})
    .filter(([, v]) => v !== null && v !== "" && v !== undefined)
    .map(([k, v]) => `${k}: ${typeof v === "object" ? JSON.stringify(v) : String(v)}`)
    .join(" · ");

export function AuditTab({ sb }: { sb: SB }) {
  const [rows, setRows] = useState<Audit[]>([]);
  const [logs, setLogs] = useState<SmmLog[]>([]);
  const [names, setNames] = useState<Record<string, string>>({});
  const [group, setGroup] = useState("all");
  const [onlySensitive, setOnlySensitive] = useState(false);
  const [q, setQ] = useState("");
  const [err, setErr] = useState("");
  const [ready, setReady] = useState(false);

  const fetchAll = useCallback(
    () =>
      Promise.all([
        sb.from("audit_log").select("*").order("created_at", { ascending: false }).limit(500),
        sb.from("smm_logs").select("*").order("created_at", { ascending: false }).limit(50),
        sb.from("profiles").select("id,full_name,email").limit(5000),
      ]),
    [sb]
  );

  useEffect(() => {
    let alive = true;
    fetchAll().then(([a, l, p]) => {
      if (!alive) return;
      setErr(a.error ? "İşlem kayıtları okunamadı. Veritabanı kurulumu (migration 01) yapıldı mı?" : "");
      setRows((a.data as Audit[]) || []);
      setLogs((l.data as SmmLog[]) || []);
      setNames(Object.fromEntries(((p.data as { id: string; full_name: string | null; email: string | null }[]) || []).map((x) => [x.id, x.full_name || x.email || "Üye"])));
      setReady(true);
    });
    return () => {
      alive = false;
    };
  }, [fetchAll]);

  const qq = q.trim().toLowerCase();
  const shown = rows.filter(
    (r) =>
      (group === "all" || r.action.startsWith(group)) &&
      (!onlySensitive || SENSITIVE.has(r.action)) &&
      (!qq || r.action.includes(qq) || (r.target || "").toLowerCase().includes(qq) || (names[r.actor_id || ""] || "").toLowerCase().includes(qq) || detailText(r.details).toLowerCase().includes(qq))
  );

  return (
    <>
      <Head eyebrow="Güvenlik" title="İşlem Kayıtları" desc="Kim, ne zaman, ne yaptı? Bakiye düzeltmeleri, rol değişiklikleri, ödemeler ve sipariş işlemleri. Kayıtlar değiştirilemez ve silinemez." />
      {err && <Note>{err}</Note>}
      <div className="mb-4 flex flex-wrap items-center gap-2">
        {GROUPS.map(([id, label]) => (
          <Chip key={id} active={group === id} onClick={() => setGroup(id)}>{label}</Chip>
        ))}
        <label className="ml-1 inline-flex items-center gap-2 text-sm font-semibold">
          <input type="checkbox" className="h-5 w-5 accent-[#f5c518]" checked={onlySensitive} onChange={(e) => setOnlySensitive(e.target.checked)} />
          Yalnızca kritik işlemler
        </label>
      </div>
      <input className={inputCls + " mb-5 max-w-md"} placeholder="Kişi, sipariş kodu veya ayrıntı ara" value={q} onChange={(e) => setQ(e.target.value)} />

      {!ready ? (
        <p className="text-sm font-bold tracking-[0.14em] text-[#686868]">YÜKLENİYOR…</p>
      ) : shown.length === 0 ? (
        <div className="rounded-3xl border-[2.5px] border-dashed border-[#111] bg-white px-6 py-14 text-center">
          <h3 className="hd text-lg font-extrabold">Kayıt yok</h3>
          <p className="mx-auto mt-2 max-w-sm text-sm text-[#686868]">Yönetim ve ödeme işlemleri yapıldıkça burada listelenir.</p>
        </div>
      ) : (
        <div className={`${card} mb-8 overflow-hidden`}>
          {shown.slice(0, 300).map((r) => (
            <div key={r.id} className="flex flex-col gap-1 border-b border-[#111]/10 p-4 last:border-0 sm:flex-row sm:items-start sm:gap-4">
              <span className="w-[120px] flex-none text-xs tabular-nums text-[#686868]">{dateTime(r.created_at)}</span>
              <div className="min-w-0 flex-1">
                <p className="text-sm font-bold">
                  {SENSITIVE.has(r.action) && <span className="mr-2 rounded-full bg-[#111] px-2 py-0.5 text-[10px] font-bold tracking-[0.1em] text-[#f5c518]">KRİTİK</span>}
                  {ACTION_LABEL[r.action] || r.action}
                  {r.target ? <span className="font-normal text-[#686868]"> · {r.target}</span> : null}
                </p>
                <p className="mt-0.5 text-xs text-[#686868]">
                  {r.actor_id ? names[r.actor_id] || "Bilinmeyen hesap" : "Sistem"}
                  {detailText(r.details) ? ` · ${detailText(r.details)}` : ""}
                </p>
              </div>
            </div>
          ))}
        </div>
      )}

      <h2 className="hd mb-3 text-xl font-extrabold">SMM hata kayıtları</h2>
      {logs.length === 0 ? (
        <p className="text-sm text-[#686868]">Sağlayıcı hatası yok.</p>
      ) : (
        <div className={`${card} overflow-hidden`}>
          {logs.map((l) => (
            <div key={l.id} className="flex flex-col gap-1 border-b border-[#111]/10 p-4 text-sm last:border-0 sm:flex-row sm:gap-4">
              <span className="w-[120px] flex-none text-xs tabular-nums text-[#686868]">{dateTime(l.created_at)}</span>
              <span className="min-w-0 flex-1">
                <b>{l.event}</b> · {l.message}
                {l.order_id ? <span className="text-[#686868]"> · sipariş #{l.order_id}</span> : null}
              </span>
            </div>
          ))}
        </div>
      )}
    </>
  );
}
