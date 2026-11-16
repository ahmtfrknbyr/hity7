"use client";

/**
 * app/ceo/ceo-ek.tsx
 * 18 aşamalık geliştirmenin CEO paneli bölümleri. Panelin mevcut tasarım parçaları (extra.tsx) kullanılır.
 *   ErisimMatrisi   (1)      hizmet görünürlüğü / sipariş izni — yalnızca CEO değiştirir (veritabanı tetikleyicisi de korur)
 *   SiteYayinda     (9A)     siteyi sunucuda gerçekten kapatan anahtar + kapalıyken girebilecek roller
 *   UyeYetkileri    (3)      moderatör / personel için kişiye özel bölüm yetkisi (yalnızca CEO)
 *   PaketlerTab     (13, 14) iki tür hazır paket, süreli kampanya, kârlılık (güncel önizleme ve geçmiş satış ayrı)
 *   FinansTab       (11)     brüt kâr raporu (yalnızca CEO; veritabanı da yalnızca CEO'ya döndürür)
 *   TeslimatlarTab  (8)      teslimat merkezi (dosya yükleme, sürüm, bağlantı, indirme takibi)
 *   DepolamaDurumu  (7)      depolama / yedek durumu, bütünlük kontrolü, R2 aktarımı
 *   SiteMetinleri   (16)     ana sayfa kartları, menü başlıkları, site altı, sekme başlığı ve paylaşım bilgileri
 * Maliyet, kâr ve yetki verileri yalnızca arayüzde gizlenmez: tablolar RLS ile, fonksiyonlar rol kontrolüyle korunur.
 */
import { useCallback, useEffect, useMemo, useState } from "react";
import { ERISIM_GRUPLARI, GRUP_ADI, HIZMETLER, type ErisimAyar, type HizmetErisim, type HizmetId } from "../../lib/erisim";
import type { FooterContent, HomeCard, HomeCardId, HomeContent, NavContent, SeoContent } from "../../lib/site-content";
import { LEGAL_DOCS, type LegalSlug } from "../../lib/yasal-belgeler";
import { boyut, dosyaIndir } from "../../lib/dosya";
import { uploadOrderFiles } from "../../lib/siparis";
import { sunucuSaatFarki } from "../../lib/paket";
import { rpcCall } from "./ceo-extra";
import {
  Badge,
  Empty,
  Field,
  Head,
  PERM_TABS,
  SetupNote,
  StatBox,
  btnGhost,
  btnPrimary,
  card,
  inputCls,
  karOnizleme,
  tl,
  uploadMedia,
  type Notify,
  type SB,
} from "./extra";

/* ================================================================== */
/*  ORTAK                                                              */
/* ================================================================== */

const IST = "Europe/Istanbul";

export const tarihSaat = (iso?: string | null) =>
  iso
    ? new Date(iso).toLocaleString("tr-TR", { timeZone: IST, day: "2-digit", month: "short", year: "numeric", hour: "2-digit", minute: "2-digit" })
    : "—";

/** ISO → <input type="datetime-local"> değeri (İstanbul saatiyle) */
function istanbulYerel(iso: string): string {
  const p: Record<string, string> = {};
  const f = new Intl.DateTimeFormat("en-GB", { timeZone: IST, year: "numeric", month: "2-digit", day: "2-digit", hour: "2-digit", minute: "2-digit", hourCycle: "h23" });
  for (const x of f.formatToParts(new Date(iso))) p[x.type] = x.value;
  return `${p.year}-${p.month}-${p.day}T${p.hour}:${p.minute}`;
}
/** <input type="datetime-local"> (İstanbul saati; Türkiye 2016'dan beri sürekli UTC+3) → ISO */
const yereldenISO = (v: string) => (/^\d{4}-\d{2}-\d{2}T\d{2}:\d{2}$/.test(v) ? new Date(`${v}:00+03:00`).toISOString() : "");
/** İstanbul'a göre bugünün tarihi (YYYY-MM-DD) */
const istanbulGun = (d = new Date()) => new Intl.DateTimeFormat("en-CA", { timeZone: IST }).format(d);
const yuzde = (n: number | null | undefined) =>
  n === null || n === undefined || !Number.isFinite(Number(n)) ? "—" : "%" + Number(n).toLocaleString("tr-TR", { maximumFractionDigits: 2 });
const kurus = (n: number) => Math.round(Number(n || 0) * 100);
/** "1.250,50" / "1250.5" → sayı (geçersizse NaN) */
const sayi = (v: string) => {
  const t = String(v || "").trim();
  if (!t) return NaN;
  return Number(t.includes(",") ? t.replace(/\./g, "").replace(",", ".") : t);
};
/** En fazla 2 ondalık (kuruş) */
const ikiOndalik = (n: number) => Number.isFinite(n) && Math.abs(n * 100 - Math.round(n * 100)) < 1e-6;
const tabloYok = (code?: string) => code === "PGRST205" || code === "42P01" || code === "PGRST202" || code === "42883";

/** Oturum anahtarıyla yönetim API'sine istek */
async function yetkiliIstek<T = Record<string, unknown>>(sb: SB, url: string, body: unknown): Promise<{ ok: boolean; data: T; error?: string }> {
  const { data } = await sb.auth.getSession();
  const t = data.session?.access_token;
  if (!t) return { ok: false, data: {} as T, error: "Oturum bulunamadı, tekrar giriş yap." };
  try {
    const res = await fetch(url, { method: "POST", headers: { "content-type": "application/json", Authorization: `Bearer ${t}` }, body: JSON.stringify(body) });
    const j = (await res.json().catch(() => ({}))) as T & { error?: string };
    return res.ok ? { ok: true, data: j } : { ok: false, data: j, error: j.error || `İşlem başarısız (${res.status}).` };
  } catch {
    return { ok: false, data: {} as T, error: "Sunucuya ulaşılamadı." };
  }
}

function Kutu({ checked, onChange, disabled, label }: { checked: boolean; onChange: (v: boolean) => void; disabled?: boolean; label: string }) {
  return (
    <input
      type="checkbox"
      className="h-5 w-5 accent-[#f5c518] disabled:opacity-40"
      checked={checked}
      disabled={disabled}
      onChange={(e) => onChange(e.target.checked)}
      aria-label={label}
    />
  );
}

function Uyari({ children, ton = "sari" }: { children: React.ReactNode; ton?: "sari" | "kirmizi" }) {
  return (
    <p
      role="alert"
      className={`rounded-2xl border-[2.5px] border-[#111] p-3 text-sm font-semibold ${ton === "kirmizi" ? "bg-[#ffe1dc] text-[#7a1b0f]" : "bg-[#fff6cf]"}`}
    >
      {children}
    </p>
  );
}

/* ================================================================== */
/*  1) HİZMET GÖRÜNÜRLÜĞÜ / SİPARİŞ İZNİ                               */
/* ================================================================== */

const SIPARIS_GRUPLARI = ["member", "mod", "ceo"] as const;

export function ErisimMatrisi({ value, onChange, isCeo }: { value: ErisimAyar; onChange: (v: ErisimAyar) => void; isCeo: boolean }) {
  const set = (h: HizmetId, s: HizmetErisim) => onChange({ ...value, services: { ...value.services, [h]: s } });
  return (
    <div className={`${card} border-[3px] p-5 sm:p-7`}>
      <h2 className="hd text-xl font-extrabold">Hizmet görünürlüğü ve sipariş izni</h2>
      <p className="mb-4 mt-1 text-sm leading-6 text-[#686868]">
        Görünürlük ve sipariş verebilme ayrı ayarlardır (ör. hizmet görünsün ama sipariş alınmasın). Bir role gizlenen hizmet o
        kişiye ana sayfada, menülerde ve listelerde görünmez; adresi doğrudan yazılsa da açılmaz ve sipariş isteği sunucuda
        reddedilir. Pasif hizmeti yalnızca CEO / Admin görür, kimse sipariş veremez. Değişiklik “Kaydet” ile en geç 15 saniyede
        canlıya yansır.
      </p>
      {!isCeo && <Uyari>Bu ayarları yalnızca CEO değiştirebilir.</Uyari>}
      <div className="mt-3 overflow-x-auto">
        <table className="w-full min-w-[760px] text-sm">
          <thead>
            <tr className="border-b-2 border-[#111] text-left align-bottom">
              <th className="py-2 pr-3">Hizmet</th>
              <th className="px-2 py-2 text-center">Aktif</th>
              {ERISIM_GRUPLARI.map((g) => (
                <th key={"v" + g} className="px-2 py-2 text-center text-[12px]">
                  Görür
                  <span className="block text-[11px] font-semibold text-[#686868]">{GRUP_ADI[g]}</span>
                </th>
              ))}
              {SIPARIS_GRUPLARI.map((g) => (
                <th key={"o" + g} className="px-2 py-2 text-center text-[12px]">
                  Sipariş verir
                  <span className="block text-[11px] font-semibold text-[#686868]">{GRUP_ADI[g]}</span>
                </th>
              ))}
            </tr>
          </thead>
          <tbody>
            {HIZMETLER.map((h) => {
              const s = value.services[h.id];
              return (
                <tr key={h.id} className={`border-b border-[#111]/10 ${s.active ? "" : "bg-[#f5f5f5]"}`}>
                  <td className="py-2 pr-3 font-semibold">
                    {h.ad}
                    <span className="block text-[11px] font-normal text-[#686868]">{h.yol}</span>
                  </td>
                  <td className="px-2 py-2 text-center">
                    <Kutu checked={s.active} disabled={!isCeo} label={`${h.ad} aktif`} onChange={(v) => set(h.id, { ...s, active: v })} />
                  </td>
                  {ERISIM_GRUPLARI.map((g) => (
                    <td key={"v" + g} className="px-2 py-2 text-center">
                      <Kutu
                        checked={s.active && s.visible[g]}
                        disabled={!isCeo || !s.active}
                        label={`${h.ad} · ${GRUP_ADI[g]} görür`}
                        onChange={(v) => set(h.id, { ...s, visible: { ...s.visible, [g]: v } })}
                      />
                    </td>
                  ))}
                  {SIPARIS_GRUPLARI.map((g) => (
                    <td key={"o" + g} className="px-2 py-2 text-center">
                      <Kutu
                        checked={s.active && s.visible[g] && s.orderable[g]}
                        disabled={!isCeo || !s.active || !s.visible[g]}
                        label={`${h.ad} · ${GRUP_ADI[g]} sipariş verir`}
                        onChange={(v) => set(h.id, { ...s, orderable: { ...s.orderable, [g]: v } })}
                      />
                    </td>
                  ))}
                </tr>
              );
            })}
          </tbody>
        </table>
      </div>
      <p className="mt-3 text-xs text-[#686868]">
        Ziyaretçi sipariş veremez (önce giriş yapar). Bir rol hizmeti göremiyorsa o rol sipariş de veremez. Ayar yalnızca CEO
        hesabıyla kaydedilir; veritabanı başka hesaplardan gelen değişikliği reddeder ve işlem kaydına yazar.
      </p>
    </div>
  );
}

/* ================================================================== */
/*  9A) SİTE YAYINDA                                                   */
/* ================================================================== */

const BAKIM_ROLLERI = [
  ["admin", "Admin"],
  ["mod", "Moderatör"],
  ["amele", "Personel"],
] as const;

export function SiteYayinda({
  bakim,
  onBakim,
  izinli,
  onIzinli,
  isCeo,
}: {
  bakim: boolean;
  onBakim: (v: boolean) => void;
  izinli: ErisimAyar["bakimdaGirebilir"];
  onIzinli: (v: ErisimAyar["bakimdaGirebilir"]) => void;
  isCeo: boolean;
}) {
  const yayinda = !bakim;
  return (
    <div className={`${card} space-y-4 border-[3px] p-5 sm:p-7 ${yayinda ? "" : "bg-[#fff6cf]"}`}>
      <div className="flex flex-wrap items-center justify-between gap-4">
        <div className="max-w-xl">
          <h2 className="hd text-xl font-extrabold">Site Yayında</h2>
          <p className="mt-1 text-sm leading-6 text-[#686868]">
            Kapatınca site sunucuda kapanır: ziyaretçiler ve üyeler bakım ekranını görür; sipariş, ödeme başlatma ve dosya
            işlemleri 503 ile reddedilir (PayTR ödeme bildirimi çalışmaya devam eder). CEO her zaman girer. Giriş, kayıt ve yasal
            sayfalar açık kalır.
          </p>
        </div>
        <button
          type="button"
          role="switch"
          aria-checked={yayinda}
          aria-label="Site Yayında"
          disabled={!isCeo}
          onClick={() => {
            if (yayinda) {
              if (!confirm("Site kapatılsın mı?\n\nZiyaretçiler ve üyeler bakım ekranını görür, yeni sipariş ve ödeme alınmaz.\n“Kaydet”e bastıktan sonra en geç 15 saniyede uygulanır.")) return;
              onBakim(true);
            } else {
              if (!confirm("Site yeniden yayına alınsın mı? (“Kaydet”e bastıktan sonra uygulanır)")) return;
              onBakim(false);
            }
          }}
          className={`relative h-10 w-[74px] flex-none rounded-full border-[2.5px] border-[#111] transition disabled:opacity-50 ${yayinda ? "bg-[#f5c518]" : "bg-[#d9d9d9]"}`}
        >
          <span className={`absolute top-1 h-6 w-6 rounded-full border-[2.5px] border-[#111] bg-white transition-all ${yayinda ? "left-[38px]" : "left-1"}`} />
        </button>
      </div>
      <p className="text-sm font-extrabold">{yayinda ? "● Site yayında" : "■ Site KAPALI — bakım ekranı gösteriliyor"}</p>
      <div>
        <p className="mb-2 text-sm font-bold">Site kapalıyken CEO’ya ek olarak girebilecek roller</p>
        <div className="flex flex-wrap gap-5">
          {BAKIM_ROLLERI.map(([r, ad]) => (
            <label key={r} className="inline-flex items-center gap-2 text-sm font-semibold">
              <Kutu
                checked={izinli.includes(r)}
                disabled={!isCeo}
                label={`${ad} site kapalıyken girebilir`}
                onChange={(v) => onIzinli(v ? Array.from(new Set([...izinli, r])) : izinli.filter((x) => x !== r))}
              />
              {ad}
            </label>
          ))}
        </div>
        <p className="mt-2 text-xs text-[#686868]">İşaretlenmeyen roller site kapalıyken bakım ekranını görür ve sipariş veremez.</p>
      </div>
      {!isCeo && <p className="text-xs font-bold text-[#686868]">Siteyi açıp kapatmayı yalnızca CEO yapabilir.</p>}
    </div>
  );
}

/* ================================================================== */
/*  3) KİŞİYE ÖZEL YÖNETİCİ YETKİSİ                                    */
/* ================================================================== */

export function UyeYetkileri({
  sb,
  notify,
  uyeId,
  uyeAdi,
  rolVarsayilani,
  onKapat,
}: {
  sb: SB;
  notify: Notify;
  uyeId: string;
  uyeAdi: string;
  rolVarsayilani: string[];
  onKapat: () => void;
}) {
  const [ozel, setOzel] = useState<boolean | null>(null);
  const [tabs, setTabs] = useState<string[]>([]);
  const [hata, setHata] = useState("");
  const [mesgul, setMesgul] = useState(false);

  useEffect(() => {
    let canli = true;
    (async () => {
      const r = await sb.from("user_permission_sets").select("tabs").eq("user_id", uyeId).maybeSingle();
      if (!canli) return;
      if (r.error) {
        setHata(tabloYok(r.error.code) ? "Kişiye özel yetki tablosu henüz kurulmamış (veritabanı: migration 08)." : "Yetkiler okunamadı: " + r.error.message);
        setOzel(false);
        setTabs(rolVarsayilani);
        return;
      }
      const row = r.data as { tabs: string[] } | null;
      setOzel(!!row);
      setTabs(row ? row.tabs : rolVarsayilani);
    })();
    return () => {
      canli = false;
    };
  }, [sb, uyeId, rolVarsayilani]);

  async function kaydet() {
    setMesgul(true);
    const r = await rpcCall(sb, "h7_uye_yetki_ayarla", { p_uye: uyeId, p_tabs: ozel ? tabs : null });
    setMesgul(false);
    if (!r.ok) return notify("Yetki kaydedilemedi: " + r.error);
    notify(ozel ? `${uyeAdi} için kişiye özel yetkiler kaydedildi.` : `${uyeAdi} artık rolünün varsayılan yetkilerini kullanıyor.`);
    onKapat();
  }

  return (
    <div className="mt-3 w-full rounded-2xl border-[2.5px] border-[#111] bg-[#fffdf2] p-4">
      {hata && <Uyari>{hata}</Uyari>}
      {ozel === null ? (
        <p className="text-sm text-[#686868]">Yükleniyor…</p>
      ) : (
        <>
          <div className="mb-3 flex flex-wrap gap-4 text-sm font-semibold">
            <label className="inline-flex items-center gap-2">
              <input type="radio" className="accent-[#f5c518]" checked={!ozel} onChange={() => {
                  setOzel(false);
                  setTabs(rolVarsayilani);
                }} />
              Rolün varsayılan yetkileri
            </label>
            <label className="inline-flex items-center gap-2">
              <input type="radio" className="accent-[#f5c518]" checked={ozel} onChange={() => setOzel(true)} />
              Bu kişiye özel
            </label>
          </div>
          <div className="grid gap-2 sm:grid-cols-2 lg:grid-cols-3">
            {PERM_TABS.map((t) => (
              <label key={t.id} className={`inline-flex items-center gap-2 text-sm ${ozel ? "" : "opacity-60"}`}>
                <Kutu
                  checked={tabs.includes(t.id)}
                  disabled={!ozel}
                  label={`${uyeAdi} · ${t.label}`}
                  onChange={(v) => setTabs((c) => (v ? Array.from(new Set([...c, t.id])) : c.filter((x) => x !== t.id)))}
                />
                {t.label}
              </label>
            ))}
          </div>
          <p className="mt-3 text-xs text-[#686868]">
            Kişi yalnızca işaretli bölümleri görür; API ve veritabanı da aynı listeyi uygular. CEO Merkezi, finans ve maliyet
            bilgileri hiçbir moderatöre açılmaz.
          </p>
          <div className="mt-3 flex flex-wrap gap-2">
            <button type="button" className={btnPrimary} disabled={mesgul} onClick={kaydet}>
              {mesgul ? "Kaydediliyor…" : "Yetkileri kaydet"}
            </button>
            <button type="button" className={btnGhost} onClick={onKapat}>
              Vazgeç
            </button>
          </div>
        </>
      )}
    </div>
  );
}

/* ================================================================== */
/*  13–14) INFLUENCER PAKETLERİ + SÜRELİ KAMPANYALAR                    */
/* ================================================================== */

type PaketTuru = "liste" | "bagimsiz";
type Paket = {
  id: string;
  kind: PaketTuru;
  name: string;
  description: string;
  content: string;
  unit_count: number | null;
  unit_label: string;
  image_url: string | null;
  price: number;
  active: boolean;
  sort: number;
  archived_at: string | null;
  created_at: string;
};
type Kamp = { id: string; package_id: string; price: number; starts_at: string; ends_at: string; cancelled_at: string | null; created_at: string };
type InfMini = { id: string; name: string; username: string | null; price: number; active: boolean; photo_url: string | null };
type Karlilik = {
  id: string;
  satis: { adet: number; gelir: number; kar: number; maliyetsiz_adet: number } | null;
};
type KampDurum = "Planlandı" | "Aktif" | "Sona Erdi" | "İptal Edildi";

export function kampanyaDurumu(c: Pick<Kamp, "starts_at" | "ends_at" | "cancelled_at">, simdi: number): KampDurum {
  if (c.cancelled_at) return "İptal Edildi";
  if (simdi < Date.parse(c.starts_at)) return "Planlandı";
  if (simdi < Date.parse(c.ends_at)) return "Aktif";
  return "Sona Erdi";
}

const TUR_ADI: Record<PaketTuru, string> = { liste: "Listeden Oluşturulan", bagimsiz: "Bağımsız" };

export function PaketlerTab({ sb, notify, isCeo }: { sb: SB; notify: Notify; isCeo: boolean }) {
  const [paketler, setPaketler] = useState<Paket[]>([]);
  const [kalemler, setKalemler] = useState<Record<string, string[]>>({});
  const [infl, setInfl] = useState<InfMini[]>([]);
  const [inflMaliyet, setInflMaliyet] = useState<Record<string, number>>({});
  const [paketMaliyet, setPaketMaliyet] = useState<Record<string, number>>({});
  const [kampanyalar, setKampanyalar] = useState<Kamp[]>([]);
  const [karlilik, setKarlilik] = useState<Record<string, Karlilik>>({});
  const [hata, setHata] = useState("");
  const [hazir, setHazir] = useState(false);
  const [duzen, setDuzen] = useState<{ paket: Paket | null; kind: PaketTuru; anahtar: number } | null>(null);
  const [acikKampanya, setAcikKampanya] = useState<string | null>(null);
  const [fark, setFark] = useState(0);
  const [simdi, setSimdi] = useState(0);
  const [arsivGoster, setArsivGoster] = useState(false);

  const yukle = useCallback(async () => {
    const [p, k, i, c] = await Promise.all([
      sb.from("influencer_packages").select("*").order("sort", { ascending: true }).order("created_at", { ascending: true }),
      sb.from("influencer_package_items").select("package_id,influencer_id"),
      sb.from("influencers").select("id,name,username,price,active,photo_url").order("sort", { ascending: true }),
      sb.from("package_campaigns").select("*").order("starts_at", { ascending: false }),
    ]);
    if (p.error) {
      setHata(tabloYok(p.error.code) ? "Paket tabloları henüz kurulmamış (veritabanı: migration 09)." : "Paketler okunamadı: " + p.error.message);
      setHazir(true);
      return;
    }
    setHata("");
    setPaketler((p.data as Paket[]) || []);
    const km: Record<string, string[]> = {};
    for (const r of (k.data as { package_id: string; influencer_id: string }[]) || []) (km[r.package_id] ||= []).push(r.influencer_id);
    setKalemler(km);
    setInfl((i.data as InfMini[]) || []);
    setKampanyalar((c.data as Kamp[]) || []);
    if (isCeo) {
      const [ic, pc, kr] = await Promise.all([
        sb.from("influencer_costs").select("influencer_id,cost"),
        sb.from("influencer_package_costs").select("package_id,cost"),
        rpcCall<Karlilik[]>(sb, "h7_paket_karlilik"),
      ]);
      setInflMaliyet(Object.fromEntries(((ic.data as { influencer_id: string; cost: number }[]) || []).map((x) => [x.influencer_id, Number(x.cost)])));
      setPaketMaliyet(Object.fromEntries(((pc.data as { package_id: string; cost: number }[]) || []).map((x) => [x.package_id, Number(x.cost)])));
      if (kr.ok && Array.isArray(kr.data)) setKarlilik(Object.fromEntries(kr.data.map((x) => [x.id, x])));
    }
    setSimdi(Date.now());
    setHazir(true);
  }, [sb, isCeo]);

  useEffect(() => {
    void yukle();
    void sunucuSaatFarki().then(setFark);
    const t = setInterval(() => setSimdi(Date.now()), 30_000);
    return () => clearInterval(t);
  }, [yukle]);

  const an = simdi + fark;

  /** Paketin GÜNCEL maliyeti (liste: influencer maliyetleri toplamı; bağımsız: elle girilen). Eksikse null. */
  const maliyetOf = useCallback(
    (p: Paket): { maliyet: number | null; eksik: number } => {
      if (p.kind === "bagimsiz") return paketMaliyet[p.id] === undefined ? { maliyet: null, eksik: 1 } : { maliyet: paketMaliyet[p.id], eksik: 0 };
      const ids = kalemler[p.id] || [];
      const eksik = ids.filter((id) => inflMaliyet[id] === undefined).length;
      return { maliyet: ids.length && !eksik ? ids.reduce((s, id) => s + kurus(inflMaliyet[id]), 0) / 100 : null, eksik };
    },
    [paketMaliyet, kalemler, inflMaliyet]
  );

  async function guncelle(p: Paket, patch: Partial<Paket>, mesaj: string) {
    const { error } = await sb.from("influencer_packages").update(patch).eq("id", p.id);
    if (error) return notify("İşlem yapılamadı: " + error.message);
    notify(mesaj);
    void yukle();
  }

  async function kopyala(p: Paket) {
    const { data, error } = await sb
      .from("influencer_packages")
      .insert({
        kind: p.kind,
        name: `${p.name} (kopya)`.slice(0, 120),
        description: p.description,
        content: p.content,
        unit_count: p.unit_count,
        unit_label: p.unit_label,
        image_url: p.image_url,
        price: p.price,
        active: false,
        sort: p.sort + 1,
      })
      .select("id")
      .single();
    if (error || !data) return notify("Kopyalanamadı: " + (error?.message || ""));
    const yeni = (data as { id: string }).id;
    if (p.kind === "liste" && (kalemler[p.id] || []).length) {
      const r = await sb.from("influencer_package_items").insert((kalemler[p.id] || []).map((id) => ({ package_id: yeni, influencer_id: id })));
      if (r.error) notify("Paket kopyalandı ama influencer listesi kopyalanamadı: " + r.error.message);
    }
    if (p.kind === "bagimsiz" && isCeo && paketMaliyet[p.id] !== undefined) {
      await sb.from("influencer_package_costs").upsert({ package_id: yeni, cost: paketMaliyet[p.id] });
    }
    notify("Paket kopyalandı (pasif). Düzenleyip yayına alabilirsin.");
    void yukle();
  }

  async function sil(p: Paket) {
    if (!confirm(`“${p.name}” kalıcı olarak silinsin mi?\nBu paket hiç satılmadı; geçmiş siparişler etkilenmez.`)) return;
    const { error } = await sb.from("influencer_packages").delete().eq("id", p.id);
    if (error) return notify("Silinemedi: " + error.message);
    notify("Paket silindi.");
    void yukle();
  }

  const gorunen = paketler.filter((p) => arsivGoster || !p.archived_at);

  return (
    <>
      <Head
        eyebrow="Hizmetler"
        title="Influencer Paketleri"
        desc="Hazır paketler. Müşteri paketi tek fiyattan satın alır; bireysel kademeli indirim paketlere uygulanmaz. Sipariş anında paket bilgisi ve maliyeti kopyalanır, sonradan yapılan değişiklik eski siparişleri etkilemez."
      />
      {hata && <SetupNote message={hata} />}
      <div className="mb-6 flex flex-wrap gap-3">
        <button type="button" className={btnPrimary} onClick={() => setDuzen({ paket: null, kind: "liste", anahtar: Date.now() })}>
          ＋ Listeden paket oluştur
        </button>
        <button type="button" className={btnPrimary} onClick={() => setDuzen({ paket: null, kind: "bagimsiz", anahtar: Date.now() })}>
          ＋ Bağımsız paket oluştur
        </button>
        <label className="ml-auto inline-flex items-center gap-2 text-sm font-semibold">
          <Kutu checked={arsivGoster} onChange={setArsivGoster} label="Arşivdekileri göster" />
          Arşivdekileri göster
        </label>
      </div>

      {duzen && (
        <PaketEditor
          key={duzen.anahtar}
          sb={sb}
          notify={notify}
          isCeo={isCeo}
          paket={duzen.paket}
          kind={duzen.kind}
          infl={infl}
          secili0={duzen.paket ? kalemler[duzen.paket.id] || [] : []}
          inflMaliyet={inflMaliyet}
          maliyet0={duzen.paket ? paketMaliyet[duzen.paket.id] : undefined}
          kampanyalar={duzen.paket ? kampanyalar.filter((c) => c.package_id === duzen.paket!.id) : []}
          an={an}
          onKapat={() => setDuzen(null)}
          onKaydet={() => {
            setDuzen(null);
            void yukle();
          }}
        />
      )}

      {!hazir ? (
        <p className="text-sm text-[#686868]">Yükleniyor…</p>
      ) : gorunen.length === 0 && !hata ? (
        <Empty title="Henüz paket yok" text="Listeden (mevcut influencerlardan) veya bağımsız (elle içerik ve maliyet) paket oluştur." />
      ) : (
        <div className="grid gap-5 xl:grid-cols-2">
          {gorunen.map((p) => {
            const kamps = kampanyalar.filter((c) => c.package_id === p.id);
            const aktif = kamps.find((c) => kampanyaDurumu(c, an) === "Aktif") || null;
            const planli = kamps.filter((c) => kampanyaDurumu(c, an) === "Planlandı").sort((a, b) => Date.parse(a.starts_at) - Date.parse(b.starts_at))[0] || null;
            const m = maliyetOf(p);
            const normal = karOnizleme(Number(p.price), m.maliyet);
            const kampKar = aktif ? karOnizleme(Number(aktif.price), m.maliyet) : null;
            const satis = karlilik[p.id]?.satis;
            const adet = p.kind === "liste" ? (kalemler[p.id] || []).length : p.unit_count || 0;
            return (
              <div key={p.id} className={`${card} p-5 ${p.archived_at ? "opacity-60" : ""}`}>
                <div className="flex gap-4">
                  {p.image_url ? (
                    // eslint-disable-next-line @next/next/no-img-element
                    <img src={p.image_url} alt="" className="h-20 w-20 flex-none rounded-2xl border-[2.5px] border-[#111] object-cover" />
                  ) : (
                    <div className="grid h-20 w-20 flex-none place-items-center rounded-2xl border-[2.5px] border-[#111] bg-[#f5c518] text-2xl">★</div>
                  )}
                  <div className="min-w-0 flex-1">
                    <div className="flex flex-wrap items-center gap-2">
                      <Badge tone="plain">{TUR_ADI[p.kind]}</Badge>
                      {p.archived_at ? <Badge tone="ink">Arşivde</Badge> : p.active ? <Badge tone="yellow">Satışta</Badge> : <Badge tone="plain">Pasif</Badge>}
                      {aktif && <Badge tone="ink">Süreli Fırsat · Aktif</Badge>}
                      {!aktif && planli && <Badge tone="plain">Kampanya planlandı</Badge>}
                    </div>
                    <h3 className="hd mt-2 truncate text-lg font-extrabold">{p.name}</h3>
                    <p className="text-sm text-[#686868]">
                      {p.kind === "liste" ? `${adet} influencer` : `${adet} ${p.unit_label}`} ·{" "}
                      {aktif ? (
                        <>
                          <s>{tl(p.price)}</s> <b className="text-[#111]">{tl(aktif.price)}</b> (−{yuzde(((p.price - aktif.price) * 100) / p.price)})
                        </>
                      ) : (
                        <b className="text-[#111]">{tl(p.price)}</b>
                      )}
                    </p>
                    {aktif && <p className="text-xs text-[#686868]">Kampanya bitişi: {tarihSaat(aktif.ends_at)}</p>}
                    {!aktif && planli && <p className="text-xs text-[#686868]">Kampanya başlangıcı: {tarihSaat(planli.starts_at)} · {tl(planli.price)}</p>}
                  </div>
                </div>

                {isCeo && (
                  <div className="mt-4 grid gap-3 sm:grid-cols-2">
                    <div className="rounded-2xl border-2 border-[#111] bg-[#fffdf2] p-3 text-sm">
                      <p className="text-[11px] font-bold uppercase tracking-[0.12em] text-[#686868]">Güncel önizleme</p>
                      {m.maliyet === null ? (
                        <p className="mt-1 font-bold">
                          ⚠ Maliyet girilmedi
                          {p.kind === "liste" && m.eksik > 0 ? ` (${m.eksik} influencer)` : ""} — kâr hesaplanamaz
                        </p>
                      ) : (
                        <>
                          <p className="mt-1">Maliyet: {tl(m.maliyet)}</p>
                          <p>
                            Normal fiyatta brüt kâr: <b className={normal && normal.kar < 0 ? "text-[#b42318]" : ""}>{normal ? tl(normal.kar) : "—"}</b> ({yuzde(normal?.marj)})
                          </p>
                          {aktif && kampKar && (
                            <p>
                              Kampanya fiyatında: <b className={kampKar.kar < 0 ? "text-[#b42318]" : ""}>{tl(kampKar.kar)}</b> ({yuzde(kampKar.marj)})
                            </p>
                          )}
                          {((normal && normal.kar < 0) || (kampKar && kampKar.kar < 0)) && <p className="mt-1 font-bold text-[#b42318]">Dikkat: zararına satış.</p>}
                        </>
                      )}
                    </div>
                    <div className="rounded-2xl border-2 border-[#111] bg-white p-3 text-sm">
                      <p className="text-[11px] font-bold uppercase tracking-[0.12em] text-[#686868]">Geçmiş satışlar (iadeler hariç)</p>
                      {satis ? (
                        <>
                          <p className="mt-1">
                            {satis.adet} satış · gelir {tl(satis.gelir)}
                          </p>
                          <p>
                            Brüt kâr: <b>{tl(satis.kar)}</b>
                            {satis.maliyetsiz_adet > 0 ? ` (${satis.maliyetsiz_adet} satışta maliyet yoktu, kâra katılmadı)` : ""}
                          </p>
                        </>
                      ) : (
                        <p className="mt-1 text-[#686868]">Satış verisi okunamadı veya henüz satış yok.</p>
                      )}
                    </div>
                  </div>
                )}

                <div className="mt-4 flex flex-wrap gap-2">
                  <button type="button" className={btnGhost} onClick={() => setDuzen({ paket: p, kind: p.kind, anahtar: Date.now() })}>
                    Düzenle
                  </button>
                  <button type="button" className={btnGhost} onClick={() => kopyala(p)}>
                    Kopyala
                  </button>
                  {!p.archived_at && (
                    <button
                      type="button"
                      className={btnGhost}
                      onClick={() => {
                        if (!p.active && p.kind === "liste" && !(kalemler[p.id] || []).length) return notify("Listede influencer olmayan paket satışa açılamaz.");
                        void guncelle(p, { active: !p.active }, p.active ? "Paket satıştan kaldırıldı." : "Paket satışa açıldı.");
                      }}
                    >
                      {p.active ? "Pasife al" : "Satışa aç"}
                    </button>
                  )}
                  <button type="button" className={btnGhost} onClick={() => setAcikKampanya(acikKampanya === p.id ? null : p.id)}>
                    Kampanyalar ({kamps.length})
                  </button>
                  {p.archived_at ? (
                    <button type="button" className={btnGhost} onClick={() => guncelle(p, { archived_at: null }, "Paket arşivden çıkarıldı (pasif).")}>
                      Arşivden çıkar
                    </button>
                  ) : (
                    <button
                      type="button"
                      className={btnGhost}
                      onClick={() => {
                        if (confirm(`“${p.name}” arşive kaldırılsın mı? Satıştan kalkar; geçmiş siparişler ve raporlar korunur.`))
                          void guncelle(p, { archived_at: new Date().toISOString() }, "Paket arşive kaldırıldı.");
                      }}
                    >
                      Arşivle
                    </button>
                  )}
                  {isCeo && satis && satis.adet === 0 && (
                    <button type="button" className={btnGhost} onClick={() => sil(p)}>
                      Sil
                    </button>
                  )}
                </div>

                {acikKampanya === p.id && (
                  <KampanyaPaneli sb={sb} notify={notify} isCeo={isCeo} paket={p} kampanyalar={kamps} an={an} maliyet={m.maliyet} onDegisti={yukle} />
                )}
              </div>
            );
          })}
        </div>
      )}
    </>
  );
}

function PaketEditor({
  sb,
  notify,
  isCeo,
  paket,
  kind,
  infl,
  secili0,
  inflMaliyet,
  maliyet0,
  kampanyalar,
  an,
  onKapat,
  onKaydet,
}: {
  sb: SB;
  notify: Notify;
  isCeo: boolean;
  paket: Paket | null;
  kind: PaketTuru;
  infl: InfMini[];
  secili0: string[];
  inflMaliyet: Record<string, number>;
  maliyet0: number | undefined;
  kampanyalar: Kamp[];
  an: number;
  onKapat: () => void;
  onKaydet: () => void;
}) {
  const [f, setF] = useState({
    name: paket?.name || "",
    description: paket?.description || "",
    content: paket?.content || "",
    unitCount: paket?.unit_count ? String(paket.unit_count) : "",
    unitLabel: paket?.unit_label || "video",
    price: paket ? String(paket.price) : "",
    sort: paket ? String(paket.sort) : "0",
    active: paket ? paket.active : false,
    cost: maliyet0 === undefined ? "" : String(maliyet0),
  });
  const [secili, setSecili] = useState<string[]>(secili0);
  const [ara, setAra] = useState("");
  const [foto, setFoto] = useState<File | null>(null);
  const [mesgul, setMesgul] = useState(false);
  const set = (p: Partial<typeof f>) => setF((c) => ({ ...c, ...p }));

  const fiyat = sayi(f.price);
  const listeToplami = secili.reduce((s, id) => s + kurus(infl.find((x) => x.id === id)?.price || 0), 0) / 100;
  const eksikler = secili.filter((id) => inflMaliyet[id] === undefined);
  const maliyet =
    kind === "liste"
      ? secili.length && !eksikler.length
        ? secili.reduce((s, id) => s + kurus(inflMaliyet[id]), 0) / 100
        : null
      : f.cost.trim() === ""
        ? null
        : sayi(f.cost);
  const onizleme = karOnizleme(Number.isFinite(fiyat) ? fiyat : 0, maliyet !== null && Number.isFinite(maliyet) ? maliyet : null);
  const enYuksekKampanya = kampanyalar
    .filter((c) => !c.cancelled_at && Date.parse(c.ends_at) > an)
    .reduce<number | null>((m, c) => (m === null || c.price > m ? Number(c.price) : m), null);

  const bulunan = useMemo(() => {
    const q = ara.trim().toLocaleLowerCase("tr");
    return infl.filter((x) => !q || x.name.toLocaleLowerCase("tr").includes(q) || (x.username || "").toLocaleLowerCase("tr").includes(q));
  }, [infl, ara]);

  async function kaydet() {
    const ad = f.name.trim();
    if (ad.length < 2 || ad.length > 120) return notify("Paket adı 2–120 karakter olmalı.");
    if (!(Number.isFinite(fiyat) && fiyat > 0) || !ikiOndalik(fiyat)) return notify("Satış fiyatı 0'dan büyük olmalı (en fazla 2 ondalık).");
    if (enYuksekKampanya !== null && fiyat <= enYuksekKampanya)
      return notify(`Bu pakette ${tl(enYuksekKampanya)} fiyatlı aktif/planlı kampanya var. Normal fiyat kampanya fiyatından yüksek kalmalı.`);
    const birim = kind === "bagimsiz" ? Number(f.unitCount) : null;
    if (kind === "bagimsiz" && !(Number.isInteger(birim) && (birim as number) >= 1)) return notify("İçerik / birim adedi en az 1 olmalı.");
    if (kind === "liste" && !secili.length) return notify("Listeden pakette en az bir influencer seçilmeli.");
    if (kind === "bagimsiz" && isCeo && f.cost.trim() !== "") {
      const c = sayi(f.cost);
      if (!(Number.isFinite(c) && c >= 0) || !ikiOndalik(c)) return notify("Toplam maliyet 0 veya daha büyük olmalı (en fazla 2 ondalık).");
    }
    setMesgul(true);
    try {
      let image = paket?.image_url || null;
      if (foto) image = await uploadMedia(sb, foto, "paketler", foto.name, foto.type);
      const row = {
        name: ad,
        description: f.description.trim().slice(0, 2000),
        content: f.content.trim().slice(0, 4000),
        unit_count: birim,
        unit_label: (f.unitLabel.trim() || "video").slice(0, 40),
        image_url: image,
        price: Math.round(fiyat * 100) / 100,
        active: f.active,
        sort: Number(f.sort) || 0,
      };
      const res = paket
        ? await sb.from("influencer_packages").update(row).eq("id", paket.id).select("id").single()
        : await sb.from("influencer_packages").insert({ ...row, kind }).select("id").single();
      if (res.error || !res.data) throw new Error(res.error?.message || "Paket kaydedilemedi.");
      const id = (res.data as { id: string }).id;

      if (kind === "liste") {
        const cikan = secili0.filter((x) => !secili.includes(x));
        const eklenen = secili.filter((x) => !secili0.includes(x));
        if (cikan.length) {
          const d = await sb.from("influencer_package_items").delete().eq("package_id", id).in("influencer_id", cikan);
          if (d.error) throw new Error("Paket kaydedildi ama influencer listesi güncellenemedi: " + d.error.message);
        }
        if (eklenen.length) {
          const i = await sb.from("influencer_package_items").insert(eklenen.map((x) => ({ package_id: id, influencer_id: x })));
          if (i.error) throw new Error("Paket kaydedildi ama influencer listesi güncellenemedi: " + i.error.message);
        }
      } else if (isCeo) {
        const c =
          f.cost.trim() === ""
            ? await sb.from("influencer_package_costs").delete().eq("package_id", id)
            : await sb.from("influencer_package_costs").upsert({ package_id: id, cost: Math.round(sayi(f.cost) * 100) / 100 });
        if (c.error) throw new Error("Paket kaydedildi ama maliyet kaydedilemedi: " + c.error.message);
      }
      notify(paket ? "Paket güncellendi." : f.active ? "Paket oluşturuldu ve satışa açıldı." : "Paket oluşturuldu (pasif).");
      onKaydet();
    } catch (e) {
      notify(e instanceof Error ? e.message : "Kaydedilemedi.");
    } finally {
      setMesgul(false);
    }
  }

  return (
    <div className={`${card} mb-7 border-[3px] p-5 sm:p-7`}>
      <div className="mb-5 flex flex-wrap items-center justify-between gap-3">
        <h2 className="hd text-xl font-extrabold">
          {paket ? "Paketi düzenle" : "Yeni paket"} · {TUR_ADI[kind]}
        </h2>
        <button type="button" className={btnGhost} onClick={onKapat}>
          Kapat
        </button>
      </div>
      <div className="grid gap-5 sm:grid-cols-2">
        <Field label="Paket adı" value={f.name} onChange={(v) => set({ name: v })} placeholder="Örn: Rap Starter 10'lu" />
        <Field label="Satış fiyatı (TL)" type="number" value={f.price} onChange={(v) => set({ price: v })} placeholder="10000" hint="Müşterinin ödeyeceği normal fiyat. İndirim için kampanya oluştur." />
        <label className="block sm:col-span-2">
          <span className="mb-2 block text-sm font-bold">Kısa açıklama</span>
          <textarea className={`${inputCls} min-h-[80px]`} value={f.description} maxLength={2000} onChange={(e) => set({ description: e.target.value })} />
        </label>
        <label className="block sm:col-span-2">
          <span className="mb-2 block text-sm font-bold">İçerik (pakete neler dahil)</span>
          <textarea
            className={`${inputCls} min-h-[100px]`}
            value={f.content}
            maxLength={4000}
            onChange={(e) => set({ content: e.target.value })}
            placeholder={"Her satır bir madde:\n10 TikTok videosu\nŞarkı ilk 15 saniyede kullanılır"}
          />
        </label>
        {kind === "bagimsiz" && (
          <>
            <Field label="İçerik / birim adedi" type="number" value={f.unitCount} onChange={(v) => set({ unitCount: v })} placeholder="10" />
            <Field label="Birim adı" value={f.unitLabel} onChange={(v) => set({ unitLabel: v })} placeholder="video" />
          </>
        )}
        <Field label="Sıra" type="number" value={f.sort} onChange={(v) => set({ sort: v })} hint="Küçük sayı önde görünür." />
        <label className="block">
          <span className="mb-2 block text-sm font-bold">Görsel</span>
          <input type="file" accept="image/jpeg,image/png,image/webp" className="text-sm" onChange={(e) => setFoto(e.target.files?.[0] || null)} />
          {paket?.image_url && !foto && <span className="mt-1 block text-xs text-[#686868]">Mevcut görsel korunur.</span>}
        </label>
        <label className="inline-flex items-center gap-2 text-sm font-bold sm:col-span-2">
          <Kutu checked={f.active} onChange={(v) => set({ active: v })} label="Satışta" />
          Satışta (müşteriler görür ve satın alabilir)
        </label>
      </div>

      {kind === "liste" && (
        <div className="mt-6">
          <p className="mb-2 text-sm font-bold">
            Pakete dahil influencerlar · {secili.length} seçili
            {secili.length > 0 && <span className="font-normal text-[#686868]"> · ayrı ayrı alınsa {tl(listeToplami)}</span>}
          </p>
          <input className={inputCls} value={ara} onChange={(e) => setAra(e.target.value)} placeholder="İsim veya kullanıcı adı ara" />
          <div className="mt-3 grid max-h-[320px] gap-2 overflow-y-auto pr-1 sm:grid-cols-2">
            {bulunan.map((x) => (
              <label key={x.id} className={`flex items-center gap-3 rounded-2xl border-2 border-[#111] p-2 text-sm ${secili.includes(x.id) ? "bg-[#fff6cf]" : "bg-white"}`}>
                <Kutu
                  checked={secili.includes(x.id)}
                  label={x.name}
                  onChange={(v) => setSecili((c) => (v ? [...c, x.id] : c.filter((y) => y !== x.id)))}
                />
                <span className="min-w-0 flex-1 truncate font-semibold">
                  {x.name}
                  {!x.active && <span className="font-normal text-[#686868]"> (listede gizli)</span>}
                </span>
                <span className="text-xs">{tl(x.price)}</span>
                {isCeo && inflMaliyet[x.id] === undefined && <span className="text-xs font-bold text-[#b42318]">maliyet yok</span>}
              </label>
            ))}
          </div>
        </div>
      )}

      {isCeo && (
        <div className="mt-6 rounded-2xl border-[2.5px] border-[#111] bg-[#fffdf2] p-4 text-sm">
          <p className="text-[11px] font-bold uppercase tracking-[0.12em] text-[#686868]">Yalnızca CEO · maliyet ve brüt kâr</p>
          {kind === "liste" ? (
            eksikler.length ? (
              <p className="mt-2 font-bold">
                ⚠ Maliyet girilmedi: {eksikler.map((id) => infl.find((x) => x.id === id)?.name || "?").join(", ")} — Influencerlar bölümünden gir.
              </p>
            ) : secili.length ? (
              <p className="mt-2">Toplam maliyet (otomatik): <b>{tl(maliyet || 0)}</b></p>
            ) : (
              <p className="mt-2 text-[#686868]">Influencer seçince maliyet otomatik toplanır.</p>
            )
          ) : (
            <div className="mt-2 max-w-xs">
              <Field label="Toplam gerçek maliyet (TL)" type="number" value={f.cost} onChange={(v) => set({ cost: v })} placeholder="Boş: maliyet girilmedi" />
            </div>
          )}
          {onizleme ? (
            <p className="mt-2">
              Normal fiyatta brüt kâr: <b className={onizleme.kar < 0 ? "text-[#b42318]" : ""}>{tl(onizleme.kar)}</b> · marj {yuzde(onizleme.marj)}
              {onizleme.kar < 0 && <b className="ml-2 text-[#b42318]">Zararına satış!</b>}
            </p>
          ) : (
            <p className="mt-2 font-semibold">Maliyet eksik olduğu için kâr hesaplanmıyor (0 kabul edilmez).</p>
          )}
        </div>
      )}

      <div className="mt-6 flex flex-wrap gap-3">
        <button type="button" className={btnPrimary} disabled={mesgul} onClick={kaydet}>
          {mesgul ? "Kaydediliyor…" : paket ? "Değişiklikleri kaydet" : "Paketi oluştur"}
        </button>
        <button type="button" className={btnGhost} onClick={onKapat}>
          Vazgeç
        </button>
      </div>
    </div>
  );
}

function KampanyaPaneli({
  sb,
  notify,
  isCeo,
  paket,
  kampanyalar,
  an,
  maliyet,
  onDegisti,
}: {
  sb: SB;
  notify: Notify;
  isCeo: boolean;
  paket: Paket;
  kampanyalar: Kamp[];
  an: number;
  maliyet: number | null;
  onDegisti: () => void;
}) {
  const [fiyat, setFiyat] = useState("");
  const [bas, setBas] = useState("");
  const [bit, setBit] = useState("");
  const [mesgul, setMesgul] = useState(false);
  const normal = Number(paket.price);
  const f = sayi(fiyat);
  const gecerliFiyat = Number.isFinite(f) && f > 0 && f < normal && ikiOndalik(f);
  const basISO = yereldenISO(bas);
  const bitISO = yereldenISO(bit);
  const indirim = gecerliFiyat ? (kurus(normal) - kurus(f)) / 100 : 0;
  const kar = gecerliFiyat ? karOnizleme(f, maliyet) : null;

  async function olustur() {
    if (!gecerliFiyat) return notify(`Kampanya fiyatı 0'dan büyük ve normal fiyattan (${tl(normal)}) düşük olmalı.`);
    if (!basISO || !bitISO) return notify("Başlangıç ve bitiş tarihini seç.");
    if (Date.parse(bitISO) <= Date.parse(basISO)) return notify("Bitiş, başlangıçtan sonra olmalı.");
    if (Date.parse(bitISO) <= an) return notify("Bitiş zamanı geçmişte olamaz.");
    if (isCeo && kar && kar.kar < 0 && !confirm(`Bu kampanya fiyatında brüt kâr NEGATİF: ${tl(kar.kar)}.\nYine de oluşturulsun mu?`)) return;
    setMesgul(true);
    const { error } = await sb.from("package_campaigns").insert({ package_id: paket.id, price: Math.round(f * 100) / 100, starts_at: basISO, ends_at: bitISO });
    setMesgul(false);
    if (error) return notify("Kampanya oluşturulamadı: " + error.message.replace(/^.*?:\s*/, ""));
    notify("Kampanya oluşturuldu.");
    setFiyat("");
    setBas("");
    setBit("");
    onDegisti();
  }

  async function iptal(c: Kamp) {
    if (!confirm("Kampanya iptal edilsin mi? İptal edilen kampanya geri açılamaz.")) return;
    const { error } = await sb.from("package_campaigns").update({ cancelled_at: new Date().toISOString() }).eq("id", c.id);
    if (error) return notify("İptal edilemedi: " + error.message);
    notify("Kampanya iptal edildi.");
    onDegisti();
  }

  return (
    <div className="mt-4 rounded-2xl border-[2.5px] border-[#111] bg-[#fffdf2] p-4">
      <p className="text-sm font-extrabold">Süreli kampanyalar · {paket.name}</p>
      <p className="mt-1 text-xs text-[#686868]">
        Saatler İstanbul saatidir. Aynı anda tek kampanya geçerlidir; bireysel indirimle birleşmez. Siparişte fiyatı sunucu
        saati belirler; kampanya bitmişse müşteriden yeni fiyatla tekrar onay istenir.
      </p>
      {kampanyalar.length > 0 && (
        <div className="mt-3 overflow-x-auto">
          <table className="w-full min-w-[640px] text-sm">
            <thead>
              <tr className="border-b-2 border-[#111] text-left">
                <th className="py-1.5 pr-2">Durum</th>
                <th className="px-2">Fiyat</th>
                <th className="px-2">İndirim</th>
                <th className="px-2">Başlangıç</th>
                <th className="px-2">Bitiş</th>
                {isCeo && <th className="px-2">Brüt kâr</th>}
                <th />
              </tr>
            </thead>
            <tbody>
              {kampanyalar.map((c) => {
                const d = kampanyaDurumu(c, an);
                const k = karOnizleme(Number(c.price), maliyet);
                return (
                  <tr key={c.id} className="border-b border-[#111]/10">
                    <td className="py-1.5 pr-2">
                      <Badge tone={d === "Aktif" ? "ink" : d === "Planlandı" ? "yellow" : "plain"}>{d}</Badge>
                    </td>
                    <td className="px-2">
                      <s className="text-[#686868]">{tl(normal)}</s> <b>{tl(c.price)}</b>
                    </td>
                    <td className="px-2">
                      {tl((kurus(normal) - kurus(c.price)) / 100)} ({yuzde(((normal - c.price) * 100) / normal)})
                    </td>
                    <td className="px-2">{tarihSaat(c.starts_at)}</td>
                    <td className="px-2">{tarihSaat(c.ends_at)}</td>
                    {isCeo && (
                      <td className="px-2">
                        {k ? (
                          <b className={k.kar < 0 ? "text-[#b42318]" : ""}>
                            {tl(k.kar)} ({yuzde(k.marj)})
                          </b>
                        ) : (
                          "Maliyet girilmedi"
                        )}
                      </td>
                    )}
                    <td className="px-2 text-right">
                      {(d === "Aktif" || d === "Planlandı") && (
                        <button type="button" className={btnGhost} onClick={() => iptal(c)}>
                          İptal et
                        </button>
                      )}
                    </td>
                  </tr>
                );
              })}
            </tbody>
          </table>
        </div>
      )}
      <div className="mt-4 grid gap-3 sm:grid-cols-3">
        <Field label="Kampanya fiyatı (TL)" type="number" value={fiyat} onChange={setFiyat} placeholder={String(Math.round(normal * 0.75))} />
        <label className="block">
          <span className="mb-2 block text-sm font-bold">Başlangıç</span>
          <input type="datetime-local" className={inputCls} value={bas} onChange={(e) => setBas(e.target.value)} />
        </label>
        <label className="block">
          <span className="mb-2 block text-sm font-bold">Bitiş</span>
          <input type="datetime-local" className={inputCls} value={bit} onChange={(e) => setBit(e.target.value)} />
        </label>
      </div>
      {gecerliFiyat && (
        <p className="mt-2 text-sm">
          Müşteri görür: <s>{tl(normal)}</s> <b>{tl(f)}</b> · %{Math.round((indirim * 100) / normal)} indirim · “Süreli Fırsat” + geri sayım
          {isCeo && (
            <>
              {" · "}
              {kar ? (
                <b className={kar.kar < 0 ? "text-[#b42318]" : ""}>
                  brüt kâr {tl(kar.kar)} ({yuzde(kar.marj)}){kar.kar < 0 ? " — ZARAR" : ""}
                </b>
              ) : (
                "maliyet girilmedi, kâr hesaplanamaz"
              )}
            </>
          )}
        </p>
      )}
      {bas && bit && basISO && bitISO && Date.parse(bitISO) <= Date.parse(basISO) && <p className="mt-2 text-sm font-bold text-[#b42318]">Bitiş başlangıçtan sonra olmalı.</p>}
      <button type="button" className={`${btnPrimary} mt-4`} disabled={mesgul} onClick={olustur}>
        {mesgul ? "Kaydediliyor…" : "Kampanya oluştur"}
      </button>
    </div>
  );
}

/* ================================================================== */
/*  11) FİNANS — BRÜT KÂR RAPORU (yalnızca CEO)                         */
/* ================================================================== */

type RaporSiparis = {
  kod: string;
  tarih: string;
  tur: string;
  durum: string;
  musteri: string | null;
  paket: string | null;
  kampanya: boolean;
  brut: number;
  oran: number;
  indirim: number;
  gelir: number;
  maliyet: number | null;
  kar: number | null;
  marj: number | null;
  iade: boolean;
};
type Rapor = {
  siparis_adet: number;
  satis_geliri: number;
  indirimsiz_toplam: number;
  toplam_indirim: number;
  maliyetli_gelir: number;
  gercek_maliyet: number;
  brut_kar: number;
  brut_kar_marji: number | null;
  maliyetsiz_siparis_adet: number;
  maliyetsiz_gelir: number;
  iade_adet: number;
  iade_tutar: number;
  siparisler: RaporSiparis[];
  influencerlar: { id: string; ad: string; adet: number; satis: number; gelir: number; maliyet: number; maliyetsiz_adet: number; kar: number | null; marj: number | null }[];
  paketler: { id: string; ad: string; tur: string; adet: number; gelir: number; indirim: number; kampanyali_adet: number; maliyet: number; maliyetsiz_adet: number; kar: number | null; marj: number | null }[];
};
type Aralik = "bugun" | "7" | "30" | "ay" | "tum" | "ozel";

export function FinansTab({ sb }: { sb: SB }) {
  const [aralik, setAralik] = useState<Aralik>("30");
  const [ozelBas, setOzelBas] = useState("");
  const [ozelBit, setOzelBit] = useState("");
  const [rapor, setRapor] = useState<Rapor | null>(null);
  const [hata, setHata] = useState("");
  const [yukleniyor, setYukleniyor] = useState(false);
  const [gorunum, setGorunum] = useState<"influencer" | "paket" | "siparis">("influencer");

  const sinir = useMemo((): { bas: string | null; bit: string | null } | null => {
    const gun = istanbulGun();
    const gunBasi = (g: string) => new Date(`${g}T00:00:00+03:00`);
    if (aralik === "tum") return { bas: null, bit: null };
    if (aralik === "bugun") return { bas: gunBasi(gun).toISOString(), bit: null };
    if (aralik === "7" || aralik === "30") return { bas: new Date(gunBasi(gun).getTime() - (Number(aralik) - 1) * 86_400_000).toISOString(), bit: null };
    if (aralik === "ay") return { bas: gunBasi(`${gun.slice(0, 8)}01`).toISOString(), bit: null };
    if (!/^\d{4}-\d{2}-\d{2}$/.test(ozelBas) || !/^\d{4}-\d{2}-\d{2}$/.test(ozelBit) || ozelBit < ozelBas) return null;
    return { bas: gunBasi(ozelBas).toISOString(), bit: new Date(gunBasi(ozelBit).getTime() + 86_400_000).toISOString() };
  }, [aralik, ozelBas, ozelBit]);

  const yukle = useCallback(async () => {
    if (!sinir) return;
    setYukleniyor(true);
    const r = await rpcCall<Rapor>(sb, "h7_finans_rapor", { p_bas: sinir.bas, p_bit: sinir.bit });
    setYukleniyor(false);
    if (!r.ok || !r.data) {
      setRapor(null);
      setHata(/h7_finans_rapor|function|schema cache/i.test(r.error || "") ? "Finans raporu henüz kurulmamış (veritabanı: migration 09)." : r.error || "Rapor okunamadı.");
      return;
    }
    setHata("");
    setRapor(r.data);
  }, [sb, sinir]);

  useEffect(() => {
    void yukle();
  }, [yukle]);

  const ARALIKLAR: [Aralik, string][] = [
    ["bugun", "Bugün"],
    ["7", "Son 7 gün"],
    ["30", "Son 30 gün"],
    ["ay", "Bu ay"],
    ["tum", "Tümü"],
    ["ozel", "Tarih aralığı"],
  ];

  return (
    <>
      <Head
        eyebrow="Yalnızca CEO"
        title="Finans · Brüt Kâr"
        desc="Influencer siparişlerinde müşterinin gerçekten ödediği tutar, girilen gerçek maliyet ve brüt kâr. Maliyetler sipariş anında kopyalanır; sonradan değişen maliyet geçmiş siparişleri etkilemez."
      />
      <div className="mb-5 flex flex-wrap items-end gap-2">
        {ARALIKLAR.map(([id, ad]) => (
          <button
            key={id}
            type="button"
            onClick={() => setAralik(id)}
            className={`rounded-full border-[2.5px] border-[#111] px-4 py-2 text-sm font-semibold ${aralik === id ? "bg-[#f5c518] shadow-[0_3px_0_#111]" : "bg-white hover:bg-[#fffdf2]"}`}
          >
            {ad}
          </button>
        ))}
        {aralik === "ozel" && (
          <span className="flex flex-wrap gap-2">
            <input type="date" className={`${inputCls} !w-auto !py-2`} value={ozelBas} onChange={(e) => setOzelBas(e.target.value)} aria-label="Başlangıç tarihi" />
            <input type="date" className={`${inputCls} !w-auto !py-2`} value={ozelBit} onChange={(e) => setOzelBit(e.target.value)} aria-label="Bitiş tarihi" />
          </span>
        )}
        <button type="button" className={`${btnGhost} ml-auto`} onClick={() => yukle()} disabled={yukleniyor || !sinir}>
          {yukleniyor ? "Yükleniyor…" : "↻ Yenile"}
        </button>
      </div>
      {aralik === "ozel" && !sinir && <Uyari>Başlangıç ve bitiş tarihini seç (bitiş başlangıçtan önce olamaz).</Uyari>}
      {hata && <SetupNote message={hata} />}

      {rapor && (
        <>
          <div className="mb-5 grid gap-4 sm:grid-cols-2 xl:grid-cols-3">
            <StatBox label="Satış geliri (ödenen)" value={tl(rapor.satis_geliri)} sub={`${rapor.siparis_adet} sipariş · iadeler hariç`} />
            <StatBox label="Verilen indirim" value={tl(rapor.toplam_indirim)} sub={`indirimsiz toplam ${tl(rapor.indirimsiz_toplam)}`} />
            <StatBox label="Gerçek maliyet" value={tl(rapor.gercek_maliyet)} sub={`maliyeti girilen siparişlerde (${tl(rapor.maliyetli_gelir)} gelir)`} />
            <StatBox label="Brüt kâr" value={tl(rapor.brut_kar)} sub={`brüt kâr marjı ${yuzde(rapor.brut_kar_marji)}`} />
            <StatBox label="Maliyet girilmemiş" value={`${rapor.maliyetsiz_siparis_adet} sipariş`} sub={`${tl(rapor.maliyetsiz_gelir)} gelir kâra katılmadı`} />
            <StatBox label="İadeler" value={`${rapor.iade_adet} sipariş`} sub={`${tl(rapor.iade_tutar)} gelirden düşüldü`} />
          </div>
          <p className="mb-6 rounded-2xl border-2 border-[#111] bg-white p-4 text-xs leading-5 text-[#686868]">
            <b className="text-[#111]">Brüt kâr</b> = müşterinin gerçekten ödediği tutar − girilen gerçek influencer maliyeti. Vergi,
            ödeme komisyonu ve diğer giderler düşülmediği için “net kâr” değildir. Maliyeti girilmemiş siparişler kâr ve marj
            hesabına katılmaz (maliyet 0 kabul edilmez). İade edilen siparişler gelirden çıkarılır ve ayrıca gösterilir.
          </p>
          {rapor.maliyetsiz_siparis_adet > 0 && (
            <div className="mb-5">
              <Uyari>{rapor.maliyetsiz_siparis_adet} siparişte maliyeti girilmemiş kalem vardı; bu siparişler brüt kâra katılmadı.</Uyari>
            </div>
          )}
          <div className="mb-4 flex flex-wrap gap-2">
            {(
              [
                ["influencer", "Influencer bazında"],
                ["paket", "Paket bazında"],
                ["siparis", "Sipariş bazında"],
              ] as const
            ).map(([id, ad]) => (
              <button
                key={id}
                type="button"
                onClick={() => setGorunum(id)}
                className={`rounded-full border-[2.5px] border-[#111] px-4 py-2 text-sm font-semibold ${gorunum === id ? "bg-[#f5c518]" : "bg-white"}`}
              >
                {ad}
              </button>
            ))}
          </div>
          <div className={`${card} overflow-x-auto p-4`}>
            {gorunum === "influencer" && (
              <table className="w-full min-w-[680px] text-sm">
                <thead>
                  <tr className="border-b-2 border-[#111] text-left">
                    <th className="py-2 pr-2">Influencer</th>
                    <th className="px-2">Adet</th>
                    <th className="px-2">Liste fiyatı</th>
                    <th className="px-2">Gelir payı</th>
                    <th className="px-2">Maliyet</th>
                    <th className="px-2">Brüt kâr</th>
                    <th className="px-2">Marj</th>
                  </tr>
                </thead>
                <tbody>
                  {rapor.influencerlar.map((x) => (
                    <tr key={x.id} className="border-b border-[#111]/10">
                      <td className="py-2 pr-2 font-semibold">{x.ad}</td>
                      <td className="px-2">{x.adet}</td>
                      <td className="px-2">{tl(x.satis)}</td>
                      <td className="px-2">{tl(x.gelir)}</td>
                      <td className="px-2">{x.maliyetsiz_adet > 0 ? `Maliyet girilmedi (${x.maliyetsiz_adet})` : tl(x.maliyet)}</td>
                      <td className={`px-2 font-bold ${x.kar !== null && x.kar < 0 ? "text-[#b42318]" : ""}`}>{x.kar === null ? "—" : tl(x.kar)}</td>
                      <td className="px-2">{yuzde(x.marj)}</td>
                    </tr>
                  ))}
                  {!rapor.influencerlar.length && (
                    <tr>
                      <td colSpan={7} className="py-6 text-center text-[#686868]">
                        Bu dönemde bireysel influencer satışı yok.
                      </td>
                    </tr>
                  )}
                </tbody>
              </table>
            )}
            {gorunum === "paket" && (
              <table className="w-full min-w-[680px] text-sm">
                <thead>
                  <tr className="border-b-2 border-[#111] text-left">
                    <th className="py-2 pr-2">Paket (satış anındaki adı)</th>
                    <th className="px-2">Satış</th>
                    <th className="px-2">Kampanyalı</th>
                    <th className="px-2">Gelir</th>
                    <th className="px-2">İndirim</th>
                    <th className="px-2">Maliyet</th>
                    <th className="px-2">Brüt kâr</th>
                    <th className="px-2">Marj</th>
                  </tr>
                </thead>
                <tbody>
                  {rapor.paketler.map((x) => (
                    <tr key={x.id} className="border-b border-[#111]/10">
                      <td className="py-2 pr-2 font-semibold">
                        {x.ad} <span className="text-xs font-normal text-[#686868]">({x.tur === "liste" ? "listeden" : "bağımsız"})</span>
                      </td>
                      <td className="px-2">{x.adet}</td>
                      <td className="px-2">{x.kampanyali_adet}</td>
                      <td className="px-2">{tl(x.gelir)}</td>
                      <td className="px-2">{tl(x.indirim)}</td>
                      <td className="px-2">{x.maliyetsiz_adet > 0 ? `Maliyet girilmedi (${x.maliyetsiz_adet})` : tl(x.maliyet)}</td>
                      <td className={`px-2 font-bold ${x.kar !== null && x.kar < 0 ? "text-[#b42318]" : ""}`}>{x.kar === null ? "—" : tl(x.kar)}</td>
                      <td className="px-2">{yuzde(x.marj)}</td>
                    </tr>
                  ))}
                  {!rapor.paketler.length && (
                    <tr>
                      <td colSpan={8} className="py-6 text-center text-[#686868]">
                        Bu dönemde paket satışı yok.
                      </td>
                    </tr>
                  )}
                </tbody>
              </table>
            )}
            {gorunum === "siparis" && (
              <table className="w-full min-w-[900px] text-sm">
                <thead>
                  <tr className="border-b-2 border-[#111] text-left">
                    <th className="py-2 pr-2">Sipariş</th>
                    <th className="px-2">Tarih</th>
                    <th className="px-2">Tür</th>
                    <th className="px-2">İndirimsiz</th>
                    <th className="px-2">İndirim</th>
                    <th className="px-2">Ödenen</th>
                    <th className="px-2">Maliyet</th>
                    <th className="px-2">Brüt kâr</th>
                    <th className="px-2">Marj</th>
                  </tr>
                </thead>
                <tbody>
                  {rapor.siparisler.map((x) => (
                    <tr key={x.kod} className={`border-b border-[#111]/10 ${x.iade ? "text-[#686868] line-through" : ""}`}>
                      <td className="py-2 pr-2 font-semibold">
                        {x.kod}
                        <span className="block text-xs font-normal text-[#686868]">{x.musteri || ""}</span>
                      </td>
                      <td className="px-2">{tarihSaat(x.tarih)}</td>
                      <td className="px-2">
                        {x.tur === "paket" ? `Paket: ${x.paket || "?"}` : "Bireysel"}
                        {x.kampanya ? " · kampanya" : ""}
                        {x.iade ? " · İADE" : ""}
                      </td>
                      <td className="px-2">{tl(x.brut)}</td>
                      <td className="px-2">
                        {tl(x.indirim)}
                        {x.oran ? ` (%${x.oran})` : ""}
                      </td>
                      <td className="px-2">{tl(x.gelir)}</td>
                      <td className="px-2">{x.maliyet === null ? "Maliyet girilmedi" : tl(x.maliyet)}</td>
                      <td className={`px-2 font-bold ${x.kar !== null && x.kar < 0 ? "text-[#b42318]" : ""}`}>{x.kar === null ? "—" : tl(x.kar)}</td>
                      <td className="px-2">{yuzde(x.marj)}</td>
                    </tr>
                  ))}
                  {!rapor.siparisler.length && (
                    <tr>
                      <td colSpan={9} className="py-6 text-center text-[#686868]">
                        Bu dönemde influencer siparişi yok.
                      </td>
                    </tr>
                  )}
                </tbody>
              </table>
            )}
          </div>
        </>
      )}
    </>
  );
}

/* ================================================================== */
/*  8) TESLİMATLAR                                                     */
/* ================================================================== */

type TTeslimat = {
  id: string;
  code: string;
  status: string;
  access_enabled: boolean;
  current_version: number;
  published_version: number;
  delivered_at: string | null;
  updated_at: string;
};
type TSiparis = {
  id: number;
  code: string;
  customer_name: string | null;
  type: string;
  service: string | null;
  title: string | null;
  status: string;
  created_at: string;
  user_id: string;
  deliveries: TTeslimat | TTeslimat[] | null;
};
type TDosya = { id: string; version: number; name: string; size: number; mime: string | null; storage_provider: string; created_at: string };
type TOlay = { id: number; kind: string; file_id: string | null; actor_id: string | null; note: string | null; created_at: string };

export const TESLIM_DURUM: Record<string, string> = {
  hazirlaniyor: "Hazırlanıyor",
  teslim_edildi: "Teslim Edildi",
  revizyon: "Revizyon İstendi",
  tamamlandi: "Tamamlandı",
};
const OLAY: Record<string, string> = {
  olusturuldu: "Teslimat açıldı",
  yukleme: "Dosya yüklendi",
  yayinlandi: "Müşteriye teslim edildi",
  indirme: "İndirildi",
  erisim_reddi: "Yetkisiz erişim denemesi",
  revizyon: "Müşteri revizyon istedi",
  onay: "Müşteri onayladı",
  baglanti_kapatildi: "Bağlantı kapatıldı",
  baglanti_acildi: "Bağlantı açıldı",
  baglanti_yenilendi: "Bağlantı yenilendi",
};
const teslimatOf = (s: TSiparis): TTeslimat | null => (Array.isArray(s.deliveries) ? s.deliveries[0] || null : s.deliveries);

export function TeslimatlarTab({ sb, notify }: { sb: SB; notify: Notify }) {
  const [q, setQ] = useState("");
  const [liste, setListe] = useState<TSiparis[]>([]);
  const [hata, setHata] = useState("");
  const [yukleniyor, setYukleniyor] = useState(false);
  const [secili, setSecili] = useState<number | null>(null);

  const yukle = useCallback(
    async (ara = "") => {
      setYukleniyor(true);
      const r = await yetkiliIstek<{ siparisler?: TSiparis[] }>(sb, "/api/yonetim/teslimat", { action: "liste", q: ara });
      setYukleniyor(false);
      if (!r.ok) return setHata(r.error || "Liste okunamadı.");
      setHata("");
      setListe(r.data.siparisler || []);
    },
    [sb]
  );

  useEffect(() => {
    void yukle("");
  }, [yukle]);

  const sec = liste.find((s) => s.id === secili) || null;

  return (
    <>
      <Head
        eyebrow="Siparişler"
        title="Teslimatlar"
        desc="Remake Beat ve Mix & Mastering teslim dosyaları. Dosyalar özel depoda saklanır; müşteri yalnızca kendi hesabıyla, kısa süreli bağlantıyla indirir."
      />
      <form
        className="mb-5 flex flex-wrap gap-2"
        onSubmit={(e) => {
          e.preventDefault();
          void yukle(q);
        }}
      >
        <input className={`${inputCls} max-w-md`} value={q} onChange={(e) => setQ(e.target.value)} placeholder="Sipariş kodu, müşteri adı veya başlık ara" />
        <button type="submit" className={btnPrimary} disabled={yukleniyor}>
          {yukleniyor ? "Aranıyor…" : "Ara"}
        </button>
      </form>
      {hata && <SetupNote message={hata} />}

      {sec && <TeslimatDetay key={sec.id} sb={sb} notify={notify} siparis={sec} onKapat={() => setSecili(null)} onDegisti={() => yukle(q)} />}

      <div className={`${card} overflow-hidden`}>
        {liste.length === 0 && !yukleniyor && <p className="p-6 text-sm text-[#686868]">Kayıt yok.</p>}
        {liste.map((s) => {
          const t = teslimatOf(s);
          return (
            <div key={s.id} className="flex flex-col gap-2 border-b border-[#111]/10 p-4 last:border-0 sm:flex-row sm:items-center sm:justify-between">
              <div className="min-w-0">
                <p className="truncate font-bold">
                  {s.code} · {s.title || s.service || s.type}
                </p>
                <p className="text-xs text-[#686868]">
                  {s.customer_name || "—"} · {s.type === "mix" ? "Mix & Mastering" : "Remake Beat"} · {tarihSaat(s.created_at)} · sipariş: {s.status}
                </p>
              </div>
              <div className="flex flex-wrap items-center gap-2">
                {t ? <Badge tone={t.status === "tamamlandi" ? "ink" : t.status === "revizyon" ? "yellow" : "plain"}>{TESLIM_DURUM[t.status] || t.status}</Badge> : <Badge tone="plain">Teslimat yok</Badge>}
                {t && !t.access_enabled && <Badge tone="plain">Bağlantı kapalı</Badge>}
                <button type="button" className={btnGhost} onClick={() => setSecili(s.id)}>
                  {t ? "Yönet" : "Teslimat aç"}
                </button>
              </div>
            </div>
          );
        })}
      </div>
    </>
  );
}

function TeslimatDetay({ sb, notify, siparis, onKapat, onDegisti }: { sb: SB; notify: Notify; siparis: TSiparis; onKapat: () => void; onDegisti: () => void }) {
  const [t, setT] = useState<TTeslimat | null>(teslimatOf(siparis));
  const [dosyalar, setDosyalar] = useState<TDosya[]>([]);
  const [gecmis, setGecmis] = useState<TOlay[]>([]);
  const [yeni, setYeni] = useState<File[]>([]);
  const [yeniSurum, setYeniSurum] = useState(false);
  const [ilerleme, setIlerleme] = useState<{ yuklenen: number; toplam: number } | null>(null);
  const [not, setNot] = useState("");
  const [mesgul, setMesgul] = useState(false);

  const detay = useCallback(
    async (id: string) => {
      const r = await yetkiliIstek<{ dosyalar?: TDosya[]; gecmis?: TOlay[] }>(sb, "/api/yonetim/teslimat", { action: "detay", teslimatId: id });
      if (!r.ok) return notify(r.error || "Teslimat okunamadı.");
      setDosyalar(r.data.dosyalar || []);
      setGecmis(r.data.gecmis || []);
    },
    [sb, notify]
  );

  useEffect(() => {
    if (t?.id) void detay(t.id);
  }, [t?.id, detay]);

  async function islem(body: Record<string, unknown>, basarili: string) {
    setMesgul(true);
    const r = await yetkiliIstek<{ teslimat?: TTeslimat }>(sb, "/api/yonetim/teslimat", body);
    setMesgul(false);
    if (!r.ok) {
      notify(r.error || "İşlem yapılamadı.");
      return false;
    }
    if (r.data.teslimat) setT((c) => ({ ...(c || ({} as TTeslimat)), ...(r.data.teslimat as TTeslimat) }));
    notify(basarili);
    onDegisti();
    return true;
  }

  async function ac() {
    await islem({ action: "ac", siparisId: siparis.id }, "Teslimat açıldı. Dosyaları yükleyebilirsin.");
  }

  async function yukle() {
    if (!t || !yeni.length) return;
    setMesgul(true);
    try {
      const toplam = yeni.reduce((s, f) => s + f.size, 0);
      setIlerleme({ yuklenen: 0, toplam });
      const yuklenen = await uploadOrderFiles(yeni, {
        amac: "teslim",
        siparisId: siparis.id,
        hizmet: siparis.type,
        onBytes: (l, tp) => setIlerleme({ yuklenen: l, toplam: tp }),
      });
      const r = await yetkiliIstek<{ surum?: number }>(sb, "/api/yonetim/teslimat", {
        action: "dosya_ekle",
        teslimatId: t.id,
        yeniSurum: yeniSurum,
        dosyalar: yuklenen.map((u, i) => ({ name: u.name, key: u.key, provider: u.provider, size: u.size, mime: yeni[i]?.type || "" })),
      });
      if (!r.ok) throw new Error(r.error || "Dosyalar kaydedilemedi.");
      notify(`${yuklenen.length} dosya yüklendi${yeniSurum ? " (yeni sürüm)" : ""}. Müşteriye göstermek için “Müşteriye teslim et”e bas.`);
      setYeni([]);
      setYeniSurum(false);
      if (typeof r.data.surum === "number") setT((c) => (c ? { ...c, current_version: r.data.surum as number } : c));
      await detay(t.id);
      onDegisti();
    } catch (e) {
      notify(e instanceof Error ? e.message : "Yükleme başarısız.");
    } finally {
      setMesgul(false);
      setIlerleme(null);
    }
  }

  const link = t ? `${typeof window !== "undefined" ? window.location.origin : "https://hity7.net"}/teslim/${t.code}` : "";
  const surumler = Array.from(new Set(dosyalar.map((d) => d.version))).sort((a, b) => b - a);
  const indirmeler = gecmis.filter((g) => g.kind === "indirme");
  const musteriIndirme = indirmeler.filter((g) => g.actor_id === siparis.user_id).length;
  const guncelDosyaVar = !!t && dosyalar.some((d) => d.version === t.current_version);

  return (
    <div className={`${card} mb-6 border-[3px] p-5 sm:p-7`}>
      <div className="mb-4 flex flex-wrap items-start justify-between gap-3">
        <div>
          <h2 className="hd text-xl font-extrabold">
            {siparis.code} · {siparis.title || siparis.service || siparis.type}
          </h2>
          <p className="text-sm text-[#686868]">
            {siparis.customer_name || "—"} · sipariş durumu: {siparis.status}
          </p>
        </div>
        <button type="button" className={btnGhost} onClick={onKapat}>
          Kapat
        </button>
      </div>

      {!t ? (
        <div>
          <p className="mb-3 text-sm">Bu sipariş için henüz teslimat açılmadı. Açınca tahmin edilemez 16 karakterlik bir teslimat kodu oluşur.</p>
          <button type="button" className={btnPrimary} disabled={mesgul} onClick={ac}>
            Teslimat aç
          </button>
        </div>
      ) : (
        <div className="space-y-5">
          <div className="flex flex-wrap items-center gap-2">
            <Badge tone={t.status === "tamamlandi" ? "ink" : "yellow"}>{TESLIM_DURUM[t.status] || t.status}</Badge>
            <Badge tone="plain">Sürüm {t.current_version}</Badge>
            <Badge tone="plain">{t.published_version ? `Müşteri sürüm ${t.published_version}'i görüyor` : "Müşteriye henüz teslim edilmedi"}</Badge>
            <Badge tone="plain">
              İndirme: müşteri {musteriIndirme} · toplam {indirmeler.length}
            </Badge>
          </div>

          <div className="rounded-2xl border-2 border-[#111] bg-[#fffdf2] p-3">
            <p className="text-xs font-bold uppercase tracking-[0.12em] text-[#686868]">Teslimat bağlantısı (yalnızca müşterinin hesabıyla açılır)</p>
            <p className="mt-1 break-all font-mono text-sm">{link}</p>
            <div className="mt-2 flex flex-wrap gap-2">
              <button
                type="button"
                className={btnGhost}
                onClick={async () => {
                  try {
                    await navigator.clipboard.writeText(link);
                    notify("Bağlantı kopyalandı.");
                  } catch {
                    notify("Kopyalanamadı; bağlantıyı elle seç.");
                  }
                }}
              >
                Bağlantıyı kopyala
              </button>
              {t.access_enabled ? (
                <button
                  type="button"
                  className={btnGhost}
                  disabled={mesgul}
                  onClick={() => confirm("Bağlantı kapatılsın mı? Müşteri dosyalara erişemez.") && islem({ action: "baglanti", teslimatId: t.id, islem: "kapat" }, "Bağlantı kapatıldı.")}
                >
                  Bağlantıyı kapat
                </button>
              ) : (
                <button type="button" className={btnGhost} disabled={mesgul} onClick={() => islem({ action: "baglanti", teslimatId: t.id, islem: "ac" }, "Bağlantı açıldı.")}>
                  Bağlantıyı aç
                </button>
              )}
              <button
                type="button"
                className={btnGhost}
                disabled={mesgul}
                onClick={() =>
                  confirm("Yeni bağlantı oluşturulsun mu? Eski bağlantı çalışmaz hâle gelir.") &&
                  islem({ action: "baglanti", teslimatId: t.id, islem: "yenile" }, "Yeni bağlantı oluşturuldu.")
                }
              >
                Bağlantıyı yenile
              </button>
            </div>
          </div>

          <div>
            <p className="mb-2 text-sm font-bold">Dosya yükle (MP3, WAV, ZIP, proje dosyaları · birden fazla seçilebilir)</p>
            <input
              type="file"
              multiple
              accept=".mp3,.wav,.zip,.rar,.7z,.flac,.aiff,.aif,.als,.flp,.ptx,.rpp,.cpr"
              className="text-sm"
              onChange={(e) => {
                setYeni(Array.from(e.target.files || []));
                e.target.value = "";
              }}
            />
            {yeni.length > 0 && (
              <ul className="mt-2 space-y-1 text-sm">
                {yeni.map((f, i) => (
                  <li key={`${f.name}-${i}`}>
                    {f.name} · {boyut(f.size)}
                  </li>
                ))}
              </ul>
            )}
            <label className="mt-2 inline-flex items-center gap-2 text-sm font-semibold">
              <Kutu checked={yeniSurum} onChange={setYeniSurum} label="Yeni sürüm olarak yükle" />
              Yeni sürüm olarak yükle (revizyon) — işaretsizse mevcut sürüm {t.current_version}’e eklenir
            </label>
            {ilerleme && (
              <div className="mt-3">
                <div className="h-3 overflow-hidden rounded-full border-2 border-[#111] bg-white">
                  <div className="h-full bg-[#f5c518] transition-all" style={{ width: `${ilerleme.toplam ? Math.round((ilerleme.yuklenen * 100) / ilerleme.toplam) : 0}%` }} />
                </div>
                <p className="mt-1 text-xs text-[#686868]">
                  {boyut(ilerleme.yuklenen)} / {boyut(ilerleme.toplam)} · %{ilerleme.toplam ? Math.round((ilerleme.yuklenen * 100) / ilerleme.toplam) : 0}
                </p>
              </div>
            )}
            <button type="button" className={`${btnPrimary} mt-3`} disabled={mesgul || !yeni.length} onClick={yukle}>
              {mesgul && ilerleme ? "Yükleniyor…" : "Yükle"}
            </button>
          </div>

          <div>
            <p className="mb-2 text-sm font-bold">Dosyalar</p>
            {!dosyalar.length && <p className="text-sm text-[#686868]">Henüz dosya yok.</p>}
            {surumler.map((v) => (
              <div key={v} className="mb-3 rounded-2xl border-2 border-[#111] p-3">
                <p className="mb-2 text-xs font-bold uppercase tracking-[0.12em]">
                  Sürüm {v}
                  {v <= (t.published_version || 0) ? " · müşteriye teslim edildi" : " · müşteri henüz göremiyor"}
                </p>
                {dosyalar
                  .filter((d) => d.version === v)
                  .map((d) => {
                    const n = indirmeler.filter((g) => g.file_id === d.id).length;
                    return (
                      <div key={d.id} className="flex flex-wrap items-center justify-between gap-2 py-1 text-sm">
                        <span className="min-w-0 break-all">
                          {d.name} · {boyut(d.size)} · {tarihSaat(d.created_at)} · {n} indirme
                        </span>
                        <button
                          type="button"
                          className={btnGhost}
                          onClick={() => dosyaIndir({ tur: "teslim", dosyaId: d.id }).catch((e) => notify(e instanceof Error ? e.message : "İndirilemedi."))}
                        >
                          İndir ↓
                        </button>
                      </div>
                    );
                  })}
              </div>
            ))}
          </div>

          <div className="rounded-2xl border-2 border-[#111] p-3">
            <p className="mb-2 text-sm font-bold">Müşteriye teslim et (sürüm {t.current_version})</p>
            <textarea
              className={`${inputCls} min-h-[70px]`}
              value={not}
              maxLength={1500}
              onChange={(e) => setNot(e.target.value)}
              placeholder="Müşteriye not (isteğe bağlı): ör. Revizyon notlarını uyguladık."
            />
            <button
              type="button"
              className={`${btnPrimary} mt-3`}
              disabled={mesgul || !guncelDosyaVar || t.published_version >= t.current_version}
              onClick={async () => {
                if (!confirm(`Sürüm ${t.current_version} müşteriye teslim edilsin mi? Müşteriye bildirim gider.`)) return;
                if (await islem({ action: "yayinla", teslimatId: t.id, not }, "Teslim edildi. Müşteriye bildirim gönderildi.")) {
                  setNot("");
                  setT((c) => (c ? { ...c, published_version: c.current_version, status: "teslim_edildi" } : c));
                  await detay(t.id);
                }
              }}
            >
              Müşteriye teslim et
            </button>
            {!guncelDosyaVar && <p className="mt-2 text-xs text-[#686868]">Teslim etmek için önce sürüm {t.current_version}’e dosya yükle.</p>}
            {guncelDosyaVar && t.published_version >= t.current_version && <p className="mt-2 text-xs text-[#686868]">Bu sürüm zaten teslim edildi. Revizyon için yeni sürüm yükle.</p>}
          </div>

          <div>
            <p className="mb-2 text-sm font-bold">Geçmiş</p>
            <ul className="max-h-[260px] space-y-1 overflow-y-auto text-sm">
              {gecmis.map((g) => (
                <li key={g.id} className="border-b border-[#111]/10 pb-1">
                  <b>{OLAY[g.kind] || g.kind}</b>
                  {g.kind === "indirme" ? (g.actor_id === siparis.user_id ? " · müşteri" : " · personel") : ""} · {tarihSaat(g.created_at)}
                  {g.file_id ? ` · ${dosyalar.find((d) => d.id === g.file_id)?.name || "dosya"}` : ""}
                  {g.note ? <span className="block text-[#686868]">“{g.note}”</span> : null}
                </li>
              ))}
              {!gecmis.length && <li className="text-[#686868]">Kayıt yok.</li>}
            </ul>
          </div>
        </div>
      )}
    </div>
  );
}

/* ================================================================== */
/*  7) DEPOLAMA / YEDEK DURUMU                                          */
/* ================================================================== */

type DepoDurum = {
  saglayici: string;
  eksikler: string[];
  r2: { hazir: boolean; aktif: boolean };
  kovalar: { ad: string; amac: string; var: boolean | null; ozel: boolean | null; adet: number | null; boyut: number | null; kesik: boolean }[];
  kopyalar: { amac: string; durum: string; adet: number }[];
  kopyaTablosu: boolean;
};
type Butunluk = { kontrol: number; eksik: { tur: string; ad: string; key: string }[]; boyutHatali: { tur: string; ad: string; key: string }[]; kesik: boolean };

export function DepolamaDurumu({ sb, notify }: { sb: SB; notify: Notify }) {
  const [d, setD] = useState<DepoDurum | null>(null);
  const [hata, setHata] = useState("");
  const [mesgul, setMesgul] = useState("");
  const [b, setB] = useState<Butunluk | null>(null);
  const [sonuc, setSonuc] = useState("");

  const yukle = useCallback(async () => {
    const r = await yetkiliIstek<DepoDurum>(sb, "/api/yonetim/depo", { action: "durum" });
    if (!r.ok) return setHata(r.error || "Depolama durumu okunamadı.");
    setHata("");
    setD(r.data);
  }, [sb]);

  useEffect(() => {
    void yukle();
  }, [yukle]);

  async function calistir(action: string, ekstra: Record<string, unknown> = {}) {
    setMesgul(action);
    setSonuc("");
    const r = await yetkiliIstek<Record<string, unknown>>(sb, "/api/yonetim/depo", { action, ...ekstra });
    setMesgul("");
    if (!r.ok) return notify(r.error || "İşlem yapılamadı.");
    if (action === "butunluk") setB(r.data as unknown as Butunluk);
    else {
      const x = r.data as { kopyalandi?: number; dogrulandi?: number; hata?: number; atlandi?: number; kalan?: boolean };
      setSonuc(`Kopyalandı ve doğrulandı: ${x.dogrulandi ?? 0} · hata: ${x.hata ?? 0} · zaten kopyalanmış: ${x.atlandi ?? 0}${x.kalan ? " · devamı var, tekrar çalıştır" : ""}`);
    }
    void yukle();
  }

  return (
    <div className={`${card} space-y-4 p-5 sm:p-7`}>
      <div>
        <h2 className="hd text-xl font-extrabold">Depolama ve yedek</h2>
        <p className="mt-1 text-sm text-[#686868]">
          Müşteri dosyaları, teslimatlar ve destek ekleri özel depolarda tutulur. Aktarım ve yedekleme kaynak dosyayı asla
          silmez; kopya, boyut ve içerik özeti (ETag) eşleşince “doğrulandı” sayılır.
        </p>
      </div>
      {hata && <Uyari>{hata}</Uyari>}
      {d && (
        <>
          <div className="flex flex-wrap gap-2 text-sm">
            <Badge tone="yellow">Aktif depo: {d.saglayici === "r2" ? "Cloudflare R2" : "Supabase Storage"}</Badge>
            <Badge tone={d.r2.hazir ? "ink" : "plain"}>{d.r2.hazir ? "R2 anahtarları tanımlı" : "R2 yapılandırılmamış"}</Badge>
          </div>
          {d.eksikler.length > 0 && <Uyari ton="kirmizi">Eksik sunucu ayarı: {d.eksikler.join(", ")}</Uyari>}
          <div className="overflow-x-auto">
            <table className="w-full min-w-[560px] text-sm">
              <thead>
                <tr className="border-b-2 border-[#111] text-left">
                  <th className="py-1.5 pr-2">Depo</th>
                  <th className="px-2">Amaç</th>
                  <th className="px-2">Durum</th>
                  <th className="px-2">Dosya</th>
                  <th className="px-2">Boyut</th>
                </tr>
              </thead>
              <tbody>
                {d.kovalar.map((k) => (
                  <tr key={k.ad} className="border-b border-[#111]/10">
                    <td className="py-1.5 pr-2 font-mono text-xs">{k.ad}</td>
                    <td className="px-2">{k.amac}</td>
                    <td className="px-2">{k.var === null ? "okunamadı" : !k.var ? "oluşturulmamış" : k.ozel ? "özel ✓" : "HERKESE AÇIK"}</td>
                    <td className="px-2">
                      {k.adet ?? "—"}
                      {k.kesik ? "+" : ""}
                    </td>
                    <td className="px-2">{k.boyut === null ? "—" : boyut(k.boyut)}</td>
                  </tr>
                ))}
              </tbody>
            </table>
          </div>
          {d.kopyaTablosu ? (
            d.kopyalar.length > 0 && (
              <p className="text-sm">
                Kopya kayıtları: {d.kopyalar.map((k) => `${k.amac === "yedek" ? "yedek" : "R2 aktarımı"} · ${k.durum}: ${k.adet}`).join(" · ")}
              </p>
            )
          ) : (
            <p className="text-xs text-[#686868]">Aktarım kayıt tablosu henüz kurulmamış (veritabanı: migration 11).</p>
          )}
          <div className="flex flex-wrap gap-2">
            <button type="button" className={btnGhost} disabled={!!mesgul} onClick={() => calistir("butunluk")}>
              {mesgul === "butunluk" ? "Kontrol ediliyor…" : "Bütünlük kontrolü"}
            </button>
            <button
              type="button"
              className={btnGhost}
              disabled={!!mesgul || !d.r2.hazir || !d.kopyaTablosu}
              onClick={() => confirm("Supabase'teki özel dosyalar R2'ye kopyalansın mı? (kaynak silinmez, 8 dosyalık parti)") && calistir("kopyala", { amac: "aktarim" })}
            >
              {mesgul === "kopyala" ? "Kopyalanıyor…" : "R2'ye aktar (8 dosya)"}
            </button>
            <button
              type="button"
              className={btnGhost}
              disabled={!!mesgul || !d.r2.hazir || !d.kopyaTablosu}
              onClick={() => confirm("Özel dosyaların yedeği ayrı yedek deposuna (R2 · hity7-backups) alınsın mı? (8 dosyalık parti)") && calistir("kopyala", { amac: "yedek" })}
            >
              Yedekle (8 dosya)
            </button>
            <button type="button" className={btnGhost} disabled={!!mesgul || !d.kopyaTablosu} onClick={() => calistir("kopyala", { amac: "aktarim", yeniden: true })}>
              Hatalıları yeniden dene
            </button>
          </div>
          {!d.r2.hazir && (
            <p className="text-xs leading-5 text-[#686868]">
              R2 aktarımı ve ayrı yedek için Cloudflare’de R2 etkinleştirilmeli ve şu secret’lar eklenmeli: R2_ACCOUNT_ID,
              R2_ACCESS_KEY_ID, R2_SECRET_ACCESS_KEY (yeni yüklemeleri R2’ye almak için ayrıca DEPO_SAGLAYICI=r2). Bu ayarlar
              yapılana kadar dosyalar Supabase’in özel depolarında kalır.
            </p>
          )}
          {sonuc && <p className="text-sm font-semibold">{sonuc}</p>}
          {b && (
            <div className="rounded-2xl border-2 border-[#111] p-3 text-sm">
              <p className="font-bold">
                Bütünlük: {b.kontrol} kayıtlı dosya kontrol edildi{b.kesik ? " (ilk parti)" : ""} · eksik {b.eksik.length} · boyut uyuşmayan {b.boyutHatali.length}
              </p>
              {[...b.eksik.map((x) => ({ ...x, s: "depoda yok" })), ...b.boyutHatali.map((x) => ({ ...x, s: "boyut farklı" }))].slice(0, 30).map((x) => (
                <p key={x.tur + x.key} className="break-all text-xs">
                  {x.s} · {x.tur} · {x.ad} · <span className="font-mono">{x.key}</span>
                </p>
              ))}
            </div>
          )}
        </>
      )}
    </div>
  );
}

/* ================================================================== */
/*  16) SİTE METİNLERİ: ana sayfa kartları, menü, site altı, SEO         */
/* ================================================================== */

const KART_ADI: Record<HomeCardId, string> = { smm: "SMM Panel kartı", influencer: "Influencer kartı", remake: "Remake Beat kartı", yayin: "Dijital Yayın kartı" };
const NAV_ADI: Record<keyof NavContent, string> = {
  home: "Ana sayfa",
  smm: "SMM Panel",
  influencer: "Influencer",
  remake: "Remake Beat",
  mix: "Mix & Mastering",
  yayin: "Dijital Yayın",
  destek: "Destek",
  account: "Hesabım düğmesi",
};

function BolumKaydet({ degisti, kaydediliyor, onKaydet, onGeriAl }: { degisti: boolean; kaydediliyor: boolean; onKaydet: () => void; onGeriAl: () => void }) {
  return (
    <div className="flex flex-wrap items-center gap-3 border-t-2 border-dashed border-[#111]/20 pt-4">
      <button type="button" className={btnPrimary} disabled={!degisti || kaydediliyor} onClick={onKaydet}>
        {kaydediliyor ? "Kaydediliyor…" : "Bu bölümü kaydet"}
      </button>
      {degisti && (
        <>
          <button type="button" className={btnGhost} disabled={kaydediliyor} onClick={onGeriAl}>
            Geri al
          </button>
          <span className="text-xs font-bold text-[#b42318]">Kaydedilmemiş değişiklik var</span>
        </>
      )}
    </div>
  );
}

export function SiteMetinleri({
  home,
  nav,
  footer,
  seo,
  kayitli,
  onHome,
  onNav,
  onFooter,
  onSeo,
  onKaydet,
  onGeriAl,
  kaydediliyor,
  onOnizle,
}: {
  home: HomeContent;
  nav: NavContent;
  footer: FooterContent;
  seo: SeoContent;
  kayitli: { home: HomeContent; nav: NavContent; footer: FooterContent; seo: SeoContent };
  onHome: (v: HomeContent) => void;
  onNav: (v: NavContent) => void;
  onFooter: (v: FooterContent) => void;
  onSeo: (v: SeoContent) => void;
  onKaydet: (key: "home" | "nav" | "footer" | "seo") => void;
  onGeriAl: (key: "home" | "nav" | "footer" | "seo") => void;
  kaydediliyor: boolean;
  onOnizle: () => void;
}) {
  const degisti = (k: "home" | "nav" | "footer" | "seo", v: unknown) => JSON.stringify(v) !== JSON.stringify(kayitli[k]);
  const setKart = (id: HomeCardId, p: Partial<HomeCard>) => onHome({ ...home, cards: { ...home.cards, [id]: { ...home.cards[id], ...p } } });
  const setOzellik = (id: HomeCardId, i: 0 | 1 | 2, v: string) => {
    const feats = [...home.cards[id].feats] as [string, string, string];
    feats[i] = v;
    setKart(id, { feats });
  };
  const alan = (label: string, value: string, onChange: (v: string) => void, opts: { multiline?: boolean; hint?: string; max?: number } = {}) =>
    opts.multiline ? (
      <label className="block">
        <span className="mb-2 block text-sm font-bold">{label}</span>
        <textarea className={`${inputCls} min-h-[80px]`} value={value} maxLength={opts.max || 400} onChange={(e) => onChange(e.target.value)} />
        {opts.hint && <span className="mt-1.5 block text-xs text-[#686868]">{opts.hint}</span>}
      </label>
    ) : (
      <Field label={label} value={value} onChange={(v) => onChange(v.slice(0, opts.max || 200))} hint={opts.hint} />
    );

  return (
    <div className="space-y-6">
      <div className={`${card} space-y-5 p-5 sm:p-7`}>
        <div className="flex flex-wrap items-center justify-between gap-3">
          <h2 className="hd text-xl font-extrabold">Ana sayfa yazıları</h2>
          <button type="button" className={btnGhost} onClick={onOnizle}>
            Önizle ↗ (kaydetmeden)
          </button>
        </div>
        <p className="text-sm text-[#686868]">Boş bırakılan alanda varsayılan yazı görünür. Büyük başlıkta son kelime sarı vurguyla gösterilir.</p>
        {alan("Üst etiket", home.kicker, (v) => onHome({ ...home, kicker: v }), { max: 80 })}
        {alan("Büyük başlık", home.heroTitle, (v) => onHome({ ...home, heroTitle: v }), { max: 120 })}
        {alan("Alt yazı", home.heroSub, (v) => onHome({ ...home, heroSub: v }), { multiline: true, max: 400 })}
        <div className="grid gap-5 sm:grid-cols-2">
          {alan("Ana buton", home.ctaPrimary, (v) => onHome({ ...home, ctaPrimary: v }), { max: 40 })}
          {alan("İkinci buton", home.ctaSecondary, (v) => onHome({ ...home, ctaSecondary: v }), { max: 40 })}
        </div>
        {(Object.keys(KART_ADI) as HomeCardId[]).map((id) => (
          <div key={id} className="rounded-2xl border-2 border-[#111] p-4">
            <p className="mb-3 text-sm font-extrabold">{KART_ADI[id]}</p>
            <div className="grid gap-4 sm:grid-cols-2">
              {alan("Etiket", home.cards[id].tag, (v) => setKart(id, { tag: v }), { max: 80 })}
              {alan("Başlık", home.cards[id].title, (v) => setKart(id, { title: v }), { max: 80 })}
              <div className="sm:col-span-2">{alan("Açıklama", home.cards[id].desc, (v) => setKart(id, { desc: v }), { multiline: true, max: 300 })}</div>
              {([0, 1, 2] as const).map((i) => (
                <div key={i}>{alan(`Özellik ${i + 1}`, home.cards[id].feats[i], (v) => setOzellik(id, i, v), { max: 60 })}</div>
              ))}
              {alan("Buton yazısı", home.cards[id].button, (v) => setKart(id, { button: v }), { max: 40 })}
            </div>
          </div>
        ))}
        <div className="grid gap-5 sm:grid-cols-2">
          {alan("Son bölüm başlığı", home.finalTitle, (v) => onHome({ ...home, finalTitle: v }), { max: 120 })}
          {alan("Son bölüm butonu", home.finalButton, (v) => onHome({ ...home, finalButton: v }), { max: 40 })}
        </div>
        {alan("Ana sayfa alt yazısı", home.footerText, (v) => onHome({ ...home, footerText: v }), { max: 200 })}
        <BolumKaydet degisti={degisti("home", home)} kaydediliyor={kaydediliyor} onKaydet={() => onKaydet("home")} onGeriAl={() => onGeriAl("home")} />
      </div>

      <div className={`${card} space-y-5 p-5 sm:p-7`}>
        <h2 className="hd text-xl font-extrabold">Menü başlıkları</h2>
        <p className="text-sm text-[#686868]">Yalnızca görünen yazı değişir; sayfa adresleri (URL) değişmez.</p>
        <div className="grid gap-4 sm:grid-cols-2">
          {(Object.keys(NAV_ADI) as (keyof NavContent)[]).map((k) => (
            <div key={k}>{alan(NAV_ADI[k], nav[k], (v) => onNav({ ...nav, [k]: v }), { max: 30 })}</div>
          ))}
        </div>
        <BolumKaydet degisti={degisti("nav", nav)} kaydediliyor={kaydediliyor} onKaydet={() => onKaydet("nav")} onGeriAl={() => onGeriAl("nav")} />
      </div>

      <div className={`${card} space-y-5 p-5 sm:p-7`}>
        <h2 className="hd text-xl font-extrabold">Site altı (footer)</h2>
        <div className="grid gap-4 sm:grid-cols-2">
          {alan("Telif yazısı", footer.copyright, (v) => onFooter({ ...footer, copyright: v }), { hint: "Boşsa “© yıl site adı” gösterilir.", max: 160 })}
          {alan("Destek bağlantısı yazısı", footer.destek, (v) => onFooter({ ...footer, destek: v }), { max: 40 })}
          {LEGAL_DOCS.map((d) => (
            <div key={d.slug}>
              {alan(`Bağlantı: ${d.short}`, footer.legal[d.slug as LegalSlug] || "", (v) => {
                const legal = { ...footer.legal };
                if (v.trim()) legal[d.slug as LegalSlug] = v;
                else delete legal[d.slug as LegalSlug];
                onFooter({ ...footer, legal });
              }, { hint: `Boşsa: ${d.short}`, max: 60 })}
            </div>
          ))}
        </div>
        <BolumKaydet degisti={degisti("footer", footer)} kaydediliyor={kaydediliyor} onKaydet={() => onKaydet("footer")} onGeriAl={() => onGeriAl("footer")} />
      </div>

      <div className={`${card} space-y-5 p-5 sm:p-7`}>
        <h2 className="hd text-xl font-extrabold">Sekme başlığı, açıklama ve paylaşım görünümü</h2>
        <p className="text-sm text-[#686868]">
          Tarayıcı sekmesinde, Google sonuçlarında ve WhatsApp / Instagram paylaşımlarında görünür. Görsel adresleri https:// ile
          başlamalı (ör. Site Yazıları’ndan yüklenen bir görselin adresi).
        </p>
        {alan("Sekme başlığı (title)", seo.title, (v) => onSeo({ ...seo, title: v }), { max: 70 })}
        {alan("Açıklama (meta description)", seo.description, (v) => onSeo({ ...seo, description: v }), { multiline: true, max: 160, hint: `${seo.description.length}/160` })}
        {alan("Site simgesi adresi (favicon)", seo.favicon, (v) => onSeo({ ...seo, favicon: v.trim() }), { hint: "Boşsa mevcut simge kullanılır. PNG / ICO / SVG.", max: 500 })}
        <div className="grid gap-4 sm:grid-cols-2">
          {alan("Paylaşım başlığı (OG)", seo.ogTitle, (v) => onSeo({ ...seo, ogTitle: v }), { hint: "Boşsa sekme başlığı kullanılır.", max: 90 })}
          {alan("Paylaşım görseli adresi (OG)", seo.ogImage, (v) => onSeo({ ...seo, ogImage: v.trim() }), { hint: "1200×630 önerilir.", max: 500 })}
        </div>
        {alan("Paylaşım açıklaması (OG)", seo.ogDescription, (v) => onSeo({ ...seo, ogDescription: v }), { multiline: true, max: 200, hint: "Boşsa açıklama kullanılır." })}
        {(seo.favicon && !/^https:\/\//.test(seo.favicon)) || (seo.ogImage && !/^https:\/\//.test(seo.ogImage)) ? (
          <Uyari ton="kirmizi">Görsel adresleri https:// ile başlamalı; aksi hâlde kullanılmaz.</Uyari>
        ) : null}
        <BolumKaydet degisti={degisti("seo", seo)} kaydediliyor={kaydediliyor} onKaydet={() => onKaydet("seo")} onGeriAl={() => onGeriAl("seo")} />
      </div>
    </div>
  );
}
