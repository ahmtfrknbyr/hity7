"use client";

/**
 * app/teslim/page.tsx — HITY7 Teslimat Merkezi (müşteri)
 * Yalnızca giriş yapmış müşterinin KENDİ Remake Beat ve Mix & Mastering teslimatları listelenir.
 */
import { useEffect, useState } from "react";
import { getSupabase } from "../../lib/supabase";
import { DURUM_ADI, TESLIM_CSS } from "../../components/teslim-stil";

type Teslimat = {
  code: string;
  status: string;
  current_version: number;
  published_version?: number;
  delivered_at: string | null;
  updated_at: string;
  orders: { code: string; service: string; title: string } | null;
};

export default function TeslimPage() {
  const [durum, setDurum] = useState<"load" | "giris" | "ok" | "hata">("load");
  const [hata, setHata] = useState("");
  const [liste, setListe] = useState<Teslimat[]>([]);

  useEffect(() => {
    (async () => {
      const { data } = await getSupabase().auth.getSession();
      const t = data.session?.access_token;
      if (!t) return setDurum("giris");
      const res = await fetch("/api/teslim", { method: "POST", headers: { "content-type": "application/json", Authorization: `Bearer ${t}` }, body: JSON.stringify({ action: "liste" }) });
      const j = await res.json().catch(() => ({}));
      if (!res.ok) {
        setHata(j.error || "Teslimatlar okunamadı.");
        return setDurum("hata");
      }
      setListe(j.teslimatlar || []);
      setDurum("ok");
    })().catch(() => {
      setHata("Bağlantı hatası. Sayfayı yenile.");
      setDurum("hata");
    });
  }, []);

  return (
    <main className="tl-root">
      <style dangerouslySetInnerHTML={{ __html: TESLIM_CSS }} />
      <div className="tl-wrap">
        <span className="tl-pill">HITY7 / TESLİMAT MERKEZİ</span>
        <h1 className="tl-h1">
          DOSYALARIN <span>HAZIR.</span>
        </h1>
        <p className="tl-lead">Remake Beat ve Mix &amp; Mastering siparişlerinin teslim dosyaları burada. Dosyaları indirebilir, teslimatı onaylayabilir veya revizyon isteyebilirsin.</p>

        {durum === "load" && <p className="tl-bos">Teslimatlar yükleniyor…</p>}
        {durum === "giris" && (
          <p className="tl-bos">
            Teslimatlarını görmek için giriş yapmalısın.
            <br />
            <a className="tl-btn" style={{ marginTop: 14 }} href="/giris?next=/teslim">GİRİŞ YAP ↗</a>
          </p>
        )}
        {durum === "hata" && <p className="tl-bos">{hata}</p>}
        {durum === "ok" && liste.length === 0 && (
          <p className="tl-bos">Henüz bir teslimatın yok. Siparişin hazır olduğunda burada ve Siparişlerim bölümünde görünür.</p>
        )}
        {durum === "ok" && liste.length > 0 && (
          <div className="tl-liste">
            {liste.map((t) => (
              <article className="tl-kart tl-satir" key={t.code}>
                <div>
                  <span className={`tl-durum ${t.status}`}>{DURUM_ADI[t.status] || t.status}</span>
                  <h3 style={{ marginTop: 10 }}>{t.orders?.title || t.orders?.service || "Sipariş"}</h3>
                  <p className="tl-meta">
                    Sipariş {t.orders?.code || "—"} · {t.orders?.service || ""}
                    {t.delivered_at ? ` · teslim: ${new Date(t.delivered_at).toLocaleDateString("tr-TR")}` : ""}
                    {(t.published_version || 0) > 1 ? ` · sürüm ${t.published_version}` : ""}
                  </p>
                </div>
                <a className="tl-btn" href={`/teslim/${t.code}`}>
                  {t.status === "hazirlaniyor" ? "DURUMU GÖR" : "DOSYALARI AÇ ↗"}
                </a>
              </article>
            ))}
          </div>
        )}
      </div>
    </main>
  );
}
