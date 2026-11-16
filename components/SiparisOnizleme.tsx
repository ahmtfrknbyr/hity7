"use client";

/**
 * components/SiparisOnizleme.tsx
 * Doğrudan sipariş (sepet yok) — onay ekranı (6. aşama).
 * Hizmet kalemleri, ara toplam, varsa indirim, ödenecek tutar, kullanılacak bakiye ve sipariş sonrası kalan bakiye
 * gösterilir. Bakiye yetmiyorsa "Yetersiz Bakiye — Bakiye Yükle" düğmesi çıkar ve sipariş gönderilmez.
 * Tutarlar yalnızca bilgilendirmedir: asıl hesap sunucuda / veritabanında yapılır ve onaylanan tutar sunucuya
 * gönderilir; fiyat bu arada değiştiyse sipariş oluşmaz ve güncel tutar gösterilir.
 */
import { useEffect, useState } from "react";
import { getSupabase } from "../lib/supabase";
import { bakiyeYukleAdresi } from "../lib/siparis";

export type OnizlemeKalem = { ad: string; tutar?: number; not?: string };

const fmt = (n: number) => Number(n || 0).toLocaleString("tr-TR", { minimumFractionDigits: 2, maximumFractionDigits: 2 }) + " TL";

const CSS = `
.so-perde{position:fixed;inset:0;z-index:80;background:rgba(17,17,17,.55);display:grid;place-items:center;padding:16px;font-family:Inter,"Helvetica Neue",Arial,sans-serif;animation:soIn .18s ease both}
.so-kart{width:100%;max-width:480px;max-height:calc(100vh - 32px);overflow:auto;background:#fff;color:#111;border:3px solid #111;border-radius:28px;box-shadow:0 10px 0 #111;padding:24px}
.so-kart *{box-sizing:border-box}
.so-ust{display:flex;justify-content:space-between;align-items:flex-start;gap:12px}
.so-pill{display:inline-block;border:2px solid #111;border-radius:999px;padding:5px 12px;font-size:10.5px;font-weight:800;letter-spacing:.14em;background:#f5c518}
.so-kapat{border:2.5px solid #111;border-radius:12px;background:#fff;width:38px;height:38px;font-size:16px;cursor:pointer;flex:none}
.so-kart h2{font-size:26px;letter-spacing:-.04em;font-weight:900;margin:12px 0 4px}
.so-alt{color:#686868;font-size:13px;line-height:1.5;margin:0}
.so-satir{display:flex;justify-content:space-between;gap:12px;font-size:14px;padding:7px 0;border-bottom:1.5px dashed #ddd}
.so-satir span{color:#444}
.so-satir small{display:block;color:#888;font-size:11.5px}
.so-satir b{white-space:nowrap}
.so-ara{margin-top:10px}
.so-cizik{text-decoration:line-through;color:#888;font-weight:600}
.so-ind{color:#0a7a32;font-weight:800}
.so-toplam{display:flex;justify-content:space-between;align-items:baseline;margin-top:12px;padding:14px 16px;background:#111;color:#f5c518;border-radius:18px}
.so-toplam span{font-size:12px;font-weight:800;letter-spacing:.1em}
.so-toplam strong{font-size:28px;letter-spacing:-.04em}
.so-bakiye{margin-top:12px;border:2.5px solid #111;border-radius:16px;padding:12px 14px;font-size:13.5px;line-height:1.6;background:#f5f5f5}
.so-bakiye.yetersiz{background:#ffe8e6}
.so-bakiye b{white-space:nowrap}
.so-btn{display:block;width:100%;text-align:center;margin-top:14px;border:2.5px solid #111;border-radius:999px;background:#f5c518;font-size:14px;font-weight:800;padding:15px 18px;cursor:pointer;box-shadow:0 3px 0 #111;color:#111;text-decoration:none}
.so-btn:disabled{opacity:.55;cursor:not-allowed}
.so-btn.ikincil{background:#fff;box-shadow:none;margin-top:10px;font-size:13px;padding:12px}
.so-hata{margin-top:12px;border:2.5px solid #111;border-radius:14px;background:#fff6cf;padding:11px 13px;font-size:13px;line-height:1.55;font-weight:600}
@keyframes soIn{from{opacity:0}to{opacity:1}}
@media (max-width:520px){.so-kart{padding:18px;border-radius:24px}.so-kart h2{font-size:22px}.so-toplam strong{font-size:24px}}
`;

async function bakiyeOku(): Promise<number | null> {
  try {
    const { data } = await getSupabase().auth.getSession();
    const t = data.session?.access_token;
    if (!t) return null;
    const res = await fetch("/api/bakiye", { method: "POST", headers: { "content-type": "application/json", Authorization: `Bearer ${t}` }, body: JSON.stringify({ action: "summary" }) });
    if (!res.ok) return null;
    const j = await res.json();
    const b = Number(j.balance);
    return Number.isFinite(b) ? b : null;
  } catch {
    return null;
  }
}

export default function SiparisOnizleme(props: {
  acik: boolean;
  baslik: string;
  kalemler: OnizlemeKalem[];
  /** İndirimsiz toplam */
  araToplam: number;
  /** Varsa indirim (bireysel influencer kademesi veya paket kampanyası) */
  indirim?: { etiket: string; tutar: number } | null;
  /** Ödenecek tutar */
  toplam: number;
  gonderiliyor: boolean;
  hata?: string;
  /** Sunucu yetersiz bakiye dediyse eksik tutar */
  eksik?: number | null;
  onOnayla: () => void;
  onKapat: () => void;
}) {
  const { acik } = props;
  const [bakiye, setBakiye] = useState<number | null | "load">("load");

  useEffect(() => {
    if (!acik) return;
    let alive = true;
    setBakiye("load");
    bakiyeOku().then((b) => alive && setBakiye(b));
    const tazele = () => bakiyeOku().then((b) => alive && setBakiye(b));
    window.addEventListener("hity7:bakiye", tazele);
    return () => {
      alive = false;
      window.removeEventListener("hity7:bakiye", tazele);
    };
  }, [acik]);

  useEffect(() => {
    if (!acik) return;
    const esc = (e: KeyboardEvent) => e.key === "Escape" && !props.gonderiliyor && props.onKapat();
    window.addEventListener("keydown", esc);
    return () => window.removeEventListener("keydown", esc);
  }, [acik, props]);

  if (!acik) return null;
  const yetersiz = (typeof bakiye === "number" && bakiye < props.toplam) || (props.eksik ?? 0) > 0;
  const eksik = props.eksik && props.eksik > 0 ? props.eksik : typeof bakiye === "number" ? Math.max(0, Math.round((props.toplam - bakiye) * 100) / 100) : 0;

  return (
    <div className="so-perde" role="dialog" aria-modal="true" aria-labelledby="so-baslik" onClick={(e) => e.target === e.currentTarget && !props.gonderiliyor && props.onKapat()}>
      <style dangerouslySetInnerHTML={{ __html: CSS }} />
      <div className="so-kart">
        <div className="so-ust">
          <div>
            <span className="so-pill">SİPARİŞ ÖNİZLEME</span>
            <h2 id="so-baslik">{props.baslik}</h2>
            <p className="so-alt">Onayladığında sipariş oluşturulur ve tutar bakiyenden düşülür.</p>
          </div>
          <button type="button" className="so-kapat" aria-label="Kapat" onClick={props.onKapat} disabled={props.gonderiliyor}>
            ✕
          </button>
        </div>

        <div style={{ marginTop: 14 }}>
          {props.kalemler.map((k, i) => (
            <div className="so-satir" key={i}>
              <span>
                {k.ad}
                {k.not ? <small>{k.not}</small> : null}
              </span>
              {k.tutar !== undefined ? <b>{fmt(k.tutar)}</b> : null}
            </div>
          ))}
        </div>

        <div className="so-ara">
          <div className="so-satir">
            <span>Ara toplam</span>
            <b className={props.indirim && props.indirim.tutar > 0 ? "so-cizik" : ""}>{fmt(props.araToplam)}</b>
          </div>
          {props.indirim && props.indirim.tutar > 0 && (
            <div className="so-satir">
              <span>{props.indirim.etiket}</span>
              <b className="so-ind">−{fmt(props.indirim.tutar)}</b>
            </div>
          )}
        </div>
        <div className="so-toplam">
          <span>ÖDENECEK</span>
          <strong>{fmt(props.toplam)}</strong>
        </div>

        <div className={`so-bakiye ${yetersiz ? "yetersiz" : ""}`} aria-live="polite">
          {bakiye === "load" ? (
            "Bakiyen kontrol ediliyor…"
          ) : bakiye === null ? (
            "Bakiyen şu an okunamadı. Sipariş sırasında sunucu bakiyeni kontrol eder; yetmezse sipariş oluşmaz."
          ) : (
            <>
              Kullanılacak bakiye: <b>{fmt(props.toplam)}</b> · Mevcut bakiye: <b>{fmt(bakiye)}</b>
              <br />
              {yetersiz ? (
                <>
                  <strong>Yetersiz Bakiye</strong> — <b>{fmt(eksik)}</b> daha yüklemelisin.
                </>
              ) : (
                <>
                  Sipariş sonrası kalan: <b>{fmt(Math.round((bakiye - props.toplam) * 100) / 100)}</b>
                </>
              )}
            </>
          )}
        </div>

        {props.hata && (
          <p className="so-hata" role="alert">
            {props.hata}
          </p>
        )}

        {yetersiz ? (
          <a className="so-btn" href={bakiyeYukleAdresi(eksik)}>
            YETERSİZ BAKİYE — BAKİYE YÜKLE ↗
          </a>
        ) : (
          <button type="button" className="so-btn" onClick={props.onOnayla} disabled={props.gonderiliyor || bakiye === "load"}>
            {props.gonderiliyor ? "SİPARİŞ OLUŞTURULUYOR…" : "ONAYLA VE SİPARİŞİ OLUŞTUR"}
          </button>
        )}
        <button type="button" className="so-btn ikincil" onClick={props.onKapat} disabled={props.gonderiliyor}>
          Vazgeç
        </button>
      </div>
    </div>
  );
}
