"use client";

/**
 * app/teslim/[teslimatKodu]/page.tsx — Tek teslimat (müşteri)
 * Bağlantı tahmin edilemez bir koddur; yine de dosyalar YALNIZCA siparişin sahibi giriş yapmışken görünür.
 * İndirme kısa süreli imzalı bağlantıyla yapılır ve kayda geçer. Müşteri teslimatı onaylayabilir veya revizyon isteyebilir.
 */
import { useCallback, useEffect, useState } from "react";
import Link from "next/link";
import { useParams } from "next/navigation";
import { getSupabase } from "../../../lib/supabase";
import { boyut, dosyaIndir } from "../../../lib/dosya";
import { DURUM_ADI, TESLIM_CSS } from "../../../components/teslim-stil";

type Teslimat = {
  code: string;
  status: string;
  current_version: number;
  published_version?: number;
  note: string | null;
  delivered_at: string | null;
  orders: { code: string; type: string; service: string; title: string; status: string } | null;
};
type Dosya = { id: string; version: number; name: string; size: number; mime: string | null; created_at: string };

async function token() {
  return (await getSupabase().auth.getSession()).data.session?.access_token || null;
}

export default function TeslimatDetay() {
  const params = useParams<{ teslimatKodu: string }>();
  const kod = String(params?.teslimatKodu || "");
  const [durum, setDurum] = useState<"load" | "giris" | "ok" | "yok">("load");
  const [t, setT] = useState<Teslimat | null>(null);
  const [dosyalar, setDosyalar] = useState<Dosya[]>([]);
  const [mesaj, setMesaj] = useState("");
  const [indiriliyor, setIndiriliyor] = useState("");
  const [revNot, setRevNot] = useState("");
  const [isleniyor, setIsleniyor] = useState(false);

  const yukle = useCallback(async () => {
    const tk = await token();
    if (!tk) return setDurum("giris");
    const res = await fetch("/api/teslim", { method: "POST", headers: { "content-type": "application/json", Authorization: `Bearer ${tk}` }, body: JSON.stringify({ action: "detay", kod }) });
    const j = await res.json().catch(() => ({}));
    if (!res.ok) {
      setMesaj(j.error || "Teslimat bulunamadı.");
      return setDurum("yok");
    }
    setT(j.teslimat);
    setDosyalar(j.dosyalar || []);
    setDurum("ok");
  }, [kod]);

  useEffect(() => {
    yukle().catch(() => {
      setMesaj("Bağlantı hatası. Sayfayı yenile.");
      setDurum("yok");
    });
  }, [yukle]);

  async function indir(d: Dosya) {
    setMesaj("");
    setIndiriliyor(d.id);
    try {
      await dosyaIndir({ tur: "teslim", dosyaId: d.id, kod });
    } catch (e) {
      setMesaj(e instanceof Error ? e.message : "Dosya indirilemedi.");
    }
    setIndiriliyor("");
  }

  async function islem(tur: "onay" | "revizyon") {
    if (tur === "revizyon" && revNot.trim().length < 5) return setMesaj("Lütfen revizyon isteğini birkaç kelimeyle anlat.");
    if (tur === "onay" && !confirm("Teslimatı onaylıyor musun? Onaydan sonra sipariş tamamlanmış sayılır.")) return;
    setIsleniyor(true);
    setMesaj("");
    const tk = await token();
    const res = await fetch("/api/teslim", {
      method: "POST",
      headers: { "content-type": "application/json", Authorization: `Bearer ${tk}` },
      body: JSON.stringify({ action: tur, kod, not: tur === "revizyon" ? revNot.trim() : null }),
    });
    const j = await res.json().catch(() => ({}));
    setIsleniyor(false);
    if (!res.ok) return setMesaj(j.error || "İşlem yapılamadı.");
    setMesaj(tur === "onay" ? "Teslimatı onayladın. Teşekkürler!" : "Revizyon isteğin iletildi. Yeni sürüm hazır olunca bildirim alacaksın.");
    setRevNot("");
    await yukle();
  }

  const surumler = Array.from(new Set(dosyalar.map((d) => d.version))).sort((a, b) => b - a);

  return (
    <main className="tl-root">
      <style dangerouslySetInnerHTML={{ __html: TESLIM_CSS }} />
      <div className="tl-wrap">
        <Link href="/teslim" className="tl-pill">← TESLİMAT MERKEZİ</Link>
        {durum === "load" && <p className="tl-bos">Teslimat yükleniyor…</p>}
        {durum === "giris" && (
          <p className="tl-bos">
            Teslim dosyalarını görmek için siparişi veren hesapla giriş yapmalısın.
            <br />
            <a className="tl-btn" style={{ marginTop: 14 }} href={`/giris?next=/teslim/${encodeURIComponent(kod)}`}>GİRİŞ YAP ↗</a>
          </p>
        )}
        {durum === "yok" && <p className="tl-bos">{mesaj || "Teslimat bulunamadı veya bağlantı kapatılmış."}</p>}
        {durum === "ok" && t && (
          <>
            <h1 className="tl-h1" style={{ fontSize: "clamp(34px,5.5vw,60px)" }}>
              {t.orders?.service || "Teslimat"}
            </h1>
            <p className="tl-lead">
              <span className={`tl-durum ${t.status}`}>{DURUM_ADI[t.status] || t.status}</span> · Sipariş <b>{t.orders?.code}</b>
              {t.delivered_at ? ` · teslim tarihi ${new Date(t.delivered_at).toLocaleDateString("tr-TR")}` : ""}
            </p>

            <div className="tl-iki">
              <section className="tl-kart">
                <h2 style={{ fontSize: 22, fontWeight: 900, letterSpacing: "-.03em" }}>Dosyalar</h2>
                {t.status === "hazirlaniyor" || !dosyalar.length ? (
                  <p className="tl-meta" style={{ marginTop: 10 }}>
                    Siparişin hazırlanıyor. Dosyalar teslim edildiğinde burada görünecek ve sana bildirim gelecek.
                  </p>
                ) : (
                  surumler.map((v) => (
                    <div key={v}>
                      <p className="tl-surum">
                        SÜRÜM {v}
                        {v === (t.published_version || 0) ? " · GÜNCEL" : ""}
                      </p>
                      <div style={{ display: "grid", gap: 10, marginTop: 8 }}>
                        {dosyalar
                          .filter((d) => d.version === v)
                          .map((d) => (
                            <div className="tl-dosya" key={d.id}>
                              <div>
                                <b>{d.name}</b>
                                <small>
                                  {boyut(d.size)} · {new Date(d.created_at).toLocaleString("tr-TR")}
                                </small>
                              </div>
                              <button type="button" className="tl-btn" onClick={() => indir(d)} disabled={indiriliyor === d.id}>
                                {indiriliyor === d.id ? "HAZIRLANIYOR…" : "İNDİR ↓"}
                              </button>
                            </div>
                          ))}
                      </div>
                    </div>
                  ))
                )}
                {t.note && <p className="tl-not">{t.note}</p>}
              </section>

              <aside className="tl-kart">
                <h2 style={{ fontSize: 22, fontWeight: 900, letterSpacing: "-.03em" }}>Teslimatı değerlendir</h2>
                {t.status === "teslim_edildi" ? (
                  <>
                    <p className="tl-meta" style={{ marginTop: 8 }}>Her şey istediğin gibiyse teslimatı onayla. Değişiklik istiyorsan ne istediğini yaz.</p>
                    <button type="button" className="tl-btn siyah" style={{ width: "100%", marginTop: 14 }} onClick={() => islem("onay")} disabled={isleniyor}>
                      TESLİMATI ONAYLA ✓
                    </button>
                    <textarea className="tl-in" rows={4} style={{ marginTop: 14 }} placeholder="Revizyon isteğin (ör. vokal biraz daha önde olsun)…" value={revNot} onChange={(e) => setRevNot(e.target.value)} />
                    <button type="button" className="tl-btn beyaz" style={{ width: "100%", marginTop: 10 }} onClick={() => islem("revizyon")} disabled={isleniyor}>
                      REVİZYON İSTE
                    </button>
                  </>
                ) : (
                  <p className="tl-meta" style={{ marginTop: 8 }}>
                    {t.status === "revizyon"
                      ? "Revizyon isteğin ekibimize iletildi. Yeni sürüm yüklenince bildirim alacaksın."
                      : t.status === "tamamlandi"
                        ? "Bu teslimatı onayladın. Dosyaları istediğin zaman tekrar indirebilirsin."
                        : "Siparişin hazırlanıyor."}
                  </p>
                )}
                {mesaj && <p className="tl-msg" role="status">{mesaj}</p>}
                <p className="tl-meta" style={{ marginTop: 14 }}>
                  Sorun mu var? <Link href="/destek" style={{ fontWeight: 800, textDecoration: "underline" }}>Destek talebi oluştur</Link>
                </p>
              </aside>
            </div>
          </>
        )}
      </div>
    </main>
  );
}
