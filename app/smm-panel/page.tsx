
"use client";

import { useEffect, useMemo, useRef, useState } from "react";
import Link from "next/link";
import { getSupabase } from "../../lib/supabase";
import { istekKimligi, sendOrder } from "../../lib/siparis";
import SozlesmeOnay from "../../components/SozlesmeOnay";

const categories = [
  { id: "all", name: "Tüm Hizmetler", icon: "✳" },
  { id: "instagram", name: "Instagram", icon: "◎" },
  { id: "tiktok", name: "TikTok", icon: "♪" },
  { id: "youtube", name: "YouTube", icon: "▷" },
  { id: "spotify", name: "Spotify", icon: "♫" },
  { id: "diger", name: "Diğer", icon: "✦" },
];

/** Satıştaki hizmet (smm_catalog). Fiyat 1.000 adet başınadır; tutar sunucuda yeniden hesaplanır. */
type Svc = { id: number; code: string; platform: string; name: string; detail: string; price: number; min: number; max: number; tag: string };

function platformOf(text: string) {
  const t = text.toLocaleLowerCase("tr");
  if (t.includes("instagram") || t.includes("insta")) return "instagram";
  if (t.includes("tiktok") || t.includes("tik tok")) return "tiktok";
  if (t.includes("youtube")) return "youtube";
  if (t.includes("spotify")) return "spotify";
  return "diger";
}

const platformIcon = (p: string) => (p === "instagram" ? "◎" : p === "tiktok" ? "♪" : p === "youtube" ? "▷" : p === "spotify" ? "♫" : "✦");
const lira = (n: number) => n.toLocaleString("tr-TR", { minimumFractionDigits: 2, maximumFractionDigits: 2 });

export default function SmmPanelPage() {
  const [services, setServices] = useState<Svc[]>([]);
  const [loading, setLoading] = useState(true);
  const [category, setCategory] = useState("all");
  const [search, setSearch] = useState("");
  const [selectedId, setSelectedId] = useState<number | null>(null);
  const [quantity, setQuantity] = useState("1000");
  const [target, setTarget] = useState("");
  const [notice, setNotice] = useState("");
  const [sending, setSending] = useState(false);
  const [doneCode, setDoneCode] = useState("");
  const [onay, setOnay] = useState(false);
  // Tekrar koruması: aynı sipariş yeniden gönderilirse ikinci kez ücretlendirilmez
  const istekRef = useRef<{ key: string; sig: string } | null>(null);

  // Satıştaki gerçek hizmetler (yönetim panelinde "Satışta" işaretlenenler)
  useEffect(() => {
    let alive = true;
    (async () => {
      try {
        const sb = getSupabase();
        const { data } = await sb.from("smm_catalog").select("*").limit(2000);
        if (!alive) return;
        const rows = ((data as Record<string, unknown>[]) || []).map((r) => {
          const name = String(r.name ?? "");
          const cat = String(r.category ?? "");
          return {
            id: Number(r.id),
            code: String(r.code ?? ""),
            platform: platformOf(`${cat} ${name}`),
            name,
            detail: String(r.descr ?? r.description ?? cat ?? ""),
            price: Number(r.price) || 0,
            min: Number(r.min_qty) || 1,
            max: Number(r.max_qty) || 10000000,
            tag: "",
          } as Svc;
        }).filter((s) => Number.isFinite(s.id) && s.price > 0);
        setServices(rows);
      } catch {
        if (alive) setServices([]);
      }
      if (alive) setLoading(false);
    })();
    return () => {
      alive = false;
    };
  }, []);

  const filteredServices = useMemo(() => {
    const q = search.toLocaleLowerCase("tr");
    return services.filter((service) => {
      const matchesCategory = category === "all" || service.platform === category;
      const matchesSearch = !q || service.name.toLocaleLowerCase("tr").includes(q) || service.code.toLowerCase().includes(q);
      return matchesCategory && matchesSearch;
    });
  }, [services, category, search]);

  const selected = services.find((s) => s.id === selectedId) || filteredServices[0] || null;
  const amount = Math.max(0, Math.floor(Number(quantity) || 0));
  // Sunucuyla aynı hesap: 1.000 adet fiyatı × miktar, kuruşa yuvarlanır
  const total = selected ? Math.round((selected.price * amount) / 10) / 100 : 0;

  function chooseCategory(id: string) {
    setCategory(id);
    setNotice("");
  }

  function chooseService(service: Svc) {
    setSelectedId(service.id);
    setNotice("");
    setDoneCode("");
    const q = Number(quantity) || 0;
    if (q < service.min) setQuantity(String(service.min));
    if (q > service.max) setQuantity(String(service.max));
  }

  async function createOrder() {
    setNotice("");
    setDoneCode("");
    if (!selected) return setNotice("Lütfen bir hizmet seç.");
    if (!/^https?:\/\/\S+\.\S+/i.test(target.trim())) return setNotice("Lütfen gönderi veya profil bağlantısını https:// ile gir.");
    if (amount < selected.min || amount > selected.max) {
      return setNotice(`Miktar ${selected.min.toLocaleString("tr-TR")} ile ${selected.max.toLocaleString("tr-TR")} arasında olmalı.`);
    }
    if (!onay) return setNotice("Siparişi oluşturmak için sözleşme onay kutusunu işaretle.");
    setSending(true);
    const istekId = istekKimligi(istekRef, `${selected.id}|${amount}|${target.trim()}`);
    const r = await sendOrder({ type: "smm", accept: onay, istekId, serviceId: selected.id, quantity: amount, target: target.trim(), details: [] });
    setSending(false);
    if (!r.ok) return setNotice(r.error || "Sipariş gönderilemedi.");
    istekRef.current = null;
    setDoneCode(r.code || "");
    setTarget("");
    setOnay(false);
  }

  return (
    <main className="smm-page">
      <link rel="preconnect" href="https://fonts.googleapis.com" />
      <link rel="preconnect" href="https://fonts.gstatic.com" crossOrigin="" />
      <link
        href="https://fonts.googleapis.com/css2?family=Bricolage+Grotesque:opsz,wght@12..96,700;12..96,800&family=Inter:wght@400;500;600;700&display=swap"
        rel="stylesheet"
      />
      <style jsx global>{`
        * { box-sizing: border-box; }
        body { margin: 0; background: #ffffff; color: #111111; }
        button, input { font: inherit; }
        a { color: inherit; text-decoration: none; }
      `}</style>

      <section className="hero">
        <div className="hero-copy">
          <div className="eyebrow"><span className="live-dot" /> HITY7 / SOCIAL GROWTH</div>
          <h1>İSTEDİĞİN<br /><span>MİKTARI YAZ.</span></h1>
          <p>Hizmetini seç, istediğin miktarı belirle ve siparişini oluştur.</p>
          <div className="hero-bottom">
            <span>01 — HİZMETİNİ SEÇ</span>
            <span>02 — MİKTARINI BELİRLE</span>
            <span>03 — SİPARİŞİNİ OLUŞTUR</span>
          </div>
        </div>
        <div className="hero-art">
          <div className="orbit orbit-one" />
          <div className="orbit orbit-two" />
          <div className="orbit orbit-three" />
          <div className="art-center">
            <span className="art-symbol">H</span>
            <span className="art-caption">DIGITAL<br />CULTURE</span>
          </div>
          <div className="floating-label label-one">SOCIAL<br />MEDIA</div>
          <div className="floating-label label-two">GROW<br />FASTER ↗</div>
          <div className="art-index">H7 / 001</div>
        </div>
      </section>

      <section className="workspace">
        <div className="section-heading">
          <div>
            <span className="eyebrow">HİZMET MERKEZİ / 001</span>
            <h2>Hizmetini keşfet.</h2>
          </div>
          <span className="service-count">{filteredServices.length} HİZMET LİSTELENİYOR</span>
        </div>

        <div className="category-bar">
          {categories.map((item) => (
            <button
              key={item.id}
              onClick={() => chooseCategory(item.id)}
              className={`category-button ${category === item.id ? "selected" : ""}`}
            >
              <span className="category-icon">{item.icon}</span>
              {item.name}
            </button>
          ))}
          <div className="search-box">
            <span>⌕</span>
            <input
              value={search}
              onChange={(e) => setSearch(e.target.value)}
              placeholder="Hizmet ara..."
            />
          </div>
        </div>

        <div className="content-grid">
          <div className="service-area">
            <div className="table-head">
              <span>HİZMET</span>
              <span>BİRİM FİYAT</span>
              <span>SEÇ</span>
            </div>

            <div className="service-list">
              {filteredServices.map((service) => (
                <button
                  key={service.id}
                  onClick={() => chooseService(service)}
                  className={`service-row ${selected?.id === service.id ? "chosen" : ""}`}
                >
                  <div className="service-info">
                    <span className={`platform-mark ${service.platform}`}>{platformIcon(service.platform)}</span>
                    <span>
                      <strong>{service.name}</strong>
                      <small>{service.detail || `Kod ${service.code}`}</small>
                    </span>
                    {service.tag && <span className="service-tag">{service.tag}</span>}
                  </div>
                  <div className="service-price">
                    <strong>{lira(service.price)} ₺</strong>
                    <small>/ 1.000 adet</small>
                  </div>
                  <span className="select-circle">{selected?.id === service.id ? "✓" : "+"}</span>
                </button>
              ))}
              {!loading && filteredServices.length === 0 && (
                <div className="empty-state">
                  {services.length === 0 ? "Şu an satışta hizmet yok. Yakında burada olacak." : "Aradığın hizmet bulunamadı."}
                </div>
              )}
              {loading && <div className="empty-state">Hizmetler yükleniyor…</div>}
            </div>
            <p className="disclaimer">Fiyatlar 1.000 adet içindir; sipariş tutarı miktara göre hesaplanır ve bakiyenden düşülür.</p>
          </div>

          <aside className="order-card">
            <div className="order-top">
              <span className="eyebrow">HIZLI SİPARİŞ / 002</span>
              <span className="order-number">H7—01</span>
            </div>
            <h3>Siparişini<br />oluştur.</h3>
            <p className="order-intro">Seçtiğin hizmetin detaylarını doldur.</p>

            <label className="field-label">SEÇİLEN HİZMET</label>
            <div className="selected-service">
              <span className={`platform-mark ${selected?.platform || "diger"}`}>{platformIcon(selected?.platform || "diger")}</span>
              <span>
                <strong>{selected ? selected.name : "Hizmet seç"}</strong>
                <small>{selected ? `${lira(selected.price)} ₺ / 1.000 adet · kod ${selected.code}` : "Soldaki listeden bir hizmet seç"}</small>
              </span>
            </div>

            <label className="field-label" htmlFor="target">BAĞLANTI / URL</label>
            <input
              id="target"
              className="form-input"
              value={target}
              onChange={(e) => setTarget(e.target.value)}
              placeholder="https://..."
            />

            <label className="field-label" htmlFor="quantity">İSTEDİĞİN MİKTARI YAZ</label>
            <input
              id="quantity"
              className="form-input quantity-input"
              type="number"
              min={selected?.min || 1}
              max={selected?.max || undefined}
              value={quantity}
              onChange={(e) => setQuantity(e.target.value)}
              placeholder="İstediğin miktarı gir..."
            />

            <div className="quantity-hint">
              <span>En az: {(selected?.min || 1).toLocaleString("tr-TR")}</span>
              <span>En çok: {(selected?.max || 0).toLocaleString("tr-TR")}</span>
            </div>

            <div className="total-row">
              <span>TOPLAM</span>
              <strong>{lira(total)} ₺</strong>
            </div>

            {notice && <div className="notice" role="alert">{notice}</div>}
            {doneCode && (
              <div className="notice" role="status">
                Siparişin alındı ✓ Kod: <b>{doneCode}</b>. Durumunu <Link href="/panel?tab=orders"><u>Siparişlerim</u></Link> bölümünden takip edebilirsin.
              </div>
            )}

            <SozlesmeOnay tur="siparis" checked={onay} onChange={setOnay} />

            <button className="order-button" onClick={createOrder} disabled={sending || !selected}>
              {sending ? "Gönderiliyor…" : "Siparişi Oluştur"} <span>↗</span>
            </button>
            <div className="secure-note"><span>◇</span> Tutar bakiyenden düşülür. Bakiyen yetersizse bakiye yükleme sayfasına yönlendirilirsin.</div>
          </aside>
        </div>
      </section>

      <section className="bottom-banner">
        <div>
          <span className="eyebrow">HITY7 / YOUR DIGITAL PARTNER</span>
          <h2>BÜYÜMEK İÇİN<br />DOĞRU YERDESİN.</h2>
        </div>
        <Link href="/bakiye">BAKİYE YÜKLE <span>↗</span></Link>
      </section>

      <footer className="footer">
        <Link href="/" className="brand">HITY<span>7</span></Link>
        <span>© 2026 HITY7 DIGITAL CULTURE</span>
        <span>ÜRET. BÜYÜT. YAYINLA.</span>
      </footer>

      <style jsx>{`
        .smm-page {
          --ink: #111111;
          --ink-2: #242424;
          --muted: #686868;
          --yellow: #f5c518;
          --yellow-h: #e5b600;
          --display: "Bricolage Grotesque", "Helvetica Neue", Arial, sans-serif;
          min-height: 100vh;
          background-color: #ffffff;
          background-image: radial-gradient(#d9d9d9 1.4px, transparent 1.5px);
          background-size: 28px 28px;
          color: var(--ink);
          font-family: "Inter", system-ui, -apple-system, "Segoe UI", Roboto, Arial, sans-serif;
          -webkit-font-smoothing: antialiased;
          overflow-x: clip;
        }
        .topbar {
          min-height: 80px;
          padding: 0 6.5%;
          display: flex;
          align-items: center;
          justify-content: space-between;
          gap: 16px;
          background: #ffffff;
          border-bottom: 3px solid var(--ink);
        }
        .brand {
          display: inline-flex;
          align-items: baseline;
          font-family: var(--display);
          font-size: 28px;
          font-weight: 800;
          letter-spacing: -0.05em;
          line-height: 1;
        }
        .brand span {
          margin-left: 2px;
          padding: 0 6px 2px;
          background: var(--yellow);
          border: 2.5px solid var(--ink);
          border-radius: 9px;
        }
        .main-nav { display: flex; gap: 6px; align-items: center; }
        .main-nav a {
          position: relative;
          padding: 10px 14px;
          font-size: 15px;
          font-weight: 500;
          color: var(--ink-2);
          transition: color 0.2s ease;
        }
        .main-nav a::after {
          content: "";
          position: absolute;
          left: 14px;
          right: 14px;
          bottom: 4px;
          height: 3px;
          border-radius: 3px;
          background: var(--yellow);
          transform: scaleX(0);
          transform-origin: left;
          transition: transform 0.25s ease;
        }
        .main-nav a:hover::after, .main-nav .active::after { transform: scaleX(1); }
        .main-nav .active { color: var(--ink); font-weight: 700; }
        .top-actions { display: flex; align-items: center; gap: 12px; }
        .login-link {
          padding: 10px 18px;
          font-size: 14px;
          font-weight: 600;
          border: 2.5px solid rgba(17, 17, 17, 0.25);
          border-radius: 999px;
          background: #ffffff;
          transition: border-color 0.2s ease;
        }
        .login-link:hover { border-color: var(--ink); }
        .signup-link {
          padding: 10px 18px;
          font-size: 14px;
          font-weight: 600;
          background: var(--yellow);
          color: var(--ink);
          border: 2.5px solid var(--ink);
          border-radius: 999px;
          box-shadow: 0 3px 0 var(--ink);
          transition: transform 0.15s ease, box-shadow 0.15s ease, background 0.2s ease;
        }
        .signup-link:hover { background: var(--yellow-h); transform: translateY(-2px); box-shadow: 0 5px 0 var(--ink); }
        .signup-link span { margin-left: 8px; }
        .hero {
          min-height: 460px;
          padding: 64px 9% 56px;
          display: grid;
          grid-template-columns: 1.1fr 0.9fr;
          gap: 24px;
          align-items: center;
          overflow: hidden;
          border-bottom: 3px solid var(--ink);
        }
        .eyebrow {
          display: inline-flex;
          align-items: center;
          gap: 9px;
          padding: 7px 14px;
          font-size: 11px;
          font-weight: 700;
          letter-spacing: 0.14em;
          color: var(--ink);
          background: #ffffff;
          border: 2.5px solid var(--ink);
          border-radius: 999px;
        }
        .live-dot {
          flex: none;
          display: inline-block;
          width: 9px;
          height: 9px;
          background: var(--yellow);
          border: 2px solid var(--ink);
          border-radius: 50%;
          margin-right: 0;
        }
        .hero h1 {
          font-family: var(--display);
          font-size: clamp(42px, 6.2vw, 86px);
          line-height: 0.95;
          letter-spacing: -0.045em;
          margin: 26px 0 22px;
          font-weight: 800;
        }
        .hero h1 span {
          color: var(--ink);
          background: linear-gradient(transparent 62%, var(--yellow) 62% 92%, transparent 92%);
        }
        .hero-copy > p { color: var(--muted); font-size: 19px; line-height: 1.6; max-width: 440px; margin: 0; }
        .hero-bottom { display: flex; flex-wrap: wrap; gap: 10px; margin-top: 36px; font-size: 11px; font-weight: 700; letter-spacing: 0.1em; }
        .hero-bottom span {
          padding: 8px 14px;
          background: #ffffff;
          border: 2.5px solid var(--ink);
          border-radius: 999px;
        }
        .hero-art { height: 340px; position: relative; display: grid; place-items: center; }
        .orbit { position: absolute; border: 2.5px dashed rgba(17, 17, 17, 0.35); border-radius: 50%; transform: rotate(-25deg); }
        .orbit-one { width: 255px; height: 255px; }
        .orbit-two { width: 320px; height: 160px; transform: rotate(35deg); }
        .orbit-three { width: 190px; height: 310px; transform: rotate(60deg); }
        .art-center {
          width: 160px;
          height: 160px;
          border-radius: 50%;
          background: repeating-radial-gradient(circle at 50% 50%, #161616 0 2px, #0b0b0b 2px 4px);
          color: var(--ink);
          display: flex;
          align-items: center;
          justify-content: center;
          flex-direction: column;
          border: 3px solid var(--ink);
          box-shadow: 0 10px 0 var(--ink);
          z-index: 1;
          position: relative;
        }
        .art-center::before {
          content: "";
          position: absolute;
          width: 92px;
          height: 92px;
          border-radius: 50%;
          background: var(--yellow);
          z-index: -1;
          top: 50%;
          left: 50%;
          transform: translate(-50%, -50%);
        }
        .art-symbol { font-family: var(--display); font-size: 58px; line-height: 0.9; font-weight: 800; z-index: 1; }
        .art-caption { display: none; }
        .floating-label {
          position: absolute;
          background: #ffffff;
          padding: 12px 16px;
          font-size: 12px;
          line-height: 1.4;
          letter-spacing: 0.08em;
          font-weight: 800;
          border: 2.5px solid var(--ink);
          border-radius: 16px;
          box-shadow: 0 5px 0 var(--ink);
          z-index: 2;
        }
        .label-one { top: 42px; left: 8%; transform: rotate(-8deg); }
        .label-two { bottom: 45px; right: 3%; transform: rotate(7deg); background: var(--yellow); }
        .art-index { position: absolute; bottom: 0; left: 12%; font-size: 12px; font-weight: 700; color: var(--muted); letter-spacing: 0.14em; }
        .workspace { padding: 72px 9% 88px; }
        .section-heading { display: flex; justify-content: space-between; align-items: end; gap: 12px; margin-bottom: 26px; }
        .section-heading h2 { font-family: var(--display); font-size: clamp(32px, 4vw, 48px); letter-spacing: -0.04em; margin: 14px 0 0; font-weight: 800; }
        .service-count { font-size: 12px; font-weight: 700; letter-spacing: 0.1em; color: var(--muted); }
        .category-bar { display: flex; align-items: center; gap: 10px; flex-wrap: wrap; padding-bottom: 20px; border-bottom: 3px solid var(--ink); }
        .category-button {
          border: 2.5px solid var(--ink);
          background: #ffffff;
          color: var(--ink);
          padding: 10px 16px;
          font-size: 14px;
          font-weight: 600;
          border-radius: 999px;
          cursor: pointer;
          transition: transform 0.15s ease, box-shadow 0.15s ease, background 0.2s ease;
        }
        .category-button:hover { transform: translateY(-2px); box-shadow: 0 3px 0 var(--ink); }
        .category-button.selected { background: var(--yellow); box-shadow: 0 3px 0 var(--ink); transform: translateY(-2px); }
        .category-icon { font-size: 16px; margin-right: 7px; vertical-align: -1px; }
        .search-box {
          margin-left: auto;
          display: flex;
          align-items: center;
          gap: 9px;
          background: #ffffff;
          border: 2.5px solid var(--ink);
          border-radius: 999px;
          padding: 6px 16px;
          transition: box-shadow 0.2s ease;
        }
        .search-box:focus-within { box-shadow: 0 0 0 4px var(--yellow); }
        .search-box span { font-size: 21px; color: var(--ink); }
        .search-box input { background: transparent; border: 0; outline: 0; width: 160px; font-size: 14px; color: var(--ink); }
        .content-grid { display: grid; grid-template-columns: minmax(0, 1fr) 380px; gap: 36px; align-items: start; margin-top: 30px; }
        .table-head { display: grid; grid-template-columns: 1fr 135px 45px; padding: 0 18px 12px; color: var(--muted); font-size: 11px; font-weight: 700; letter-spacing: 0.14em; }
        .table-head span:nth-child(2), .table-head span:nth-child(3) { text-align: right; }
        .service-list { display: flex; flex-direction: column; gap: 10px; }
        .service-row {
          width: 100%;
          display: grid;
          grid-template-columns: 1fr 135px 45px;
          align-items: center;
          padding: 14px 18px;
          text-align: left;
          border: 2.5px solid var(--ink);
          border-radius: 20px;
          background: #ffffff;
          cursor: pointer;
          transition: transform 0.15s ease, box-shadow 0.15s ease, background 0.2s ease;
          color: var(--ink);
        }
        .service-row:hover { transform: translateY(-2px); box-shadow: 0 4px 0 var(--ink); }
        .service-row.chosen { background: var(--yellow); box-shadow: 0 4px 0 var(--ink); transform: translateY(-2px); }
        .service-info { display: flex; align-items: center; gap: 13px; min-width: 0; }
        .platform-mark {
          width: 40px;
          height: 40px;
          display: grid;
          place-items: center;
          flex: 0 0 auto;
          border: 2.5px solid var(--ink);
          border-radius: 50%;
          font-size: 20px;
          background: #ffffff;
          color: var(--ink);
        }
        .platform-mark.instagram, .platform-mark.tiktok, .platform-mark.youtube, .platform-mark.spotify, .platform-mark.diger { color: var(--ink); }
        .service-info strong, .selected-service strong { display: block; font-size: 15px; font-weight: 700; }
        .service-info small, .selected-service small { display: block; margin-top: 3px; font-size: 12px; color: var(--muted); }
        .service-row.chosen .service-info small, .service-row.chosen .service-price small { color: var(--ink-2); }
        .service-tag {
          font-size: 11px;
          font-weight: 700;
          padding: 4px 10px;
          background: var(--yellow);
          color: var(--ink);
          border: 2px solid var(--ink);
          border-radius: 999px;
          white-space: nowrap;
        }
        .service-row.chosen .service-tag { background: #ffffff; }
        .service-price { text-align: right; }
        .service-price strong { display: block; font-size: 15px; font-weight: 700; }
        .service-price small { display: block; margin-top: 3px; color: var(--muted); font-size: 12px; }
        .select-circle {
          justify-self: end;
          width: 28px;
          height: 28px;
          border: 2.5px solid var(--ink);
          border-radius: 50%;
          display: grid;
          place-items: center;
          font-size: 14px;
          font-weight: 800;
          background: #ffffff;
        }
        .chosen .select-circle { background: var(--ink); color: var(--yellow); }
        .empty-state { padding: 45px; text-align: center; color: var(--muted); font-size: 15px; border: 2.5px dashed var(--ink); border-radius: 20px; background: #ffffff; }
        .disclaimer { color: var(--muted); font-size: 12px; line-height: 1.6; margin-top: 18px; }
        .order-card {
          background: #ffffff;
          border: 3px solid var(--ink);
          border-radius: 32px;
          padding: 28px;
          box-shadow: 0 10px 0 var(--ink);
          position: sticky;
          top: 24px;
        }
        .order-top { display: flex; justify-content: space-between; align-items: center; gap: 8px; }
        .order-number { color: var(--ink); font-size: 11px; font-weight: 700; letter-spacing: 0.1em; padding: 5px 10px; background: var(--yellow); border: 2.5px solid var(--ink); border-radius: 999px; }
        .order-card h3 { font-family: var(--display); font-size: 40px; line-height: 0.98; letter-spacing: -0.045em; margin: 22px 0 12px; font-weight: 800; }
        .order-intro { color: var(--muted); font-size: 15px; margin: 0 0 22px; }
        .field-label { display: block; font-size: 11px; letter-spacing: 0.12em; font-weight: 700; color: var(--ink-2); margin: 18px 0 9px; }
        .selected-service { display: flex; align-items: center; gap: 12px; background: #fffdf2; border: 2.5px solid var(--ink); border-radius: 18px; padding: 12px; }
        .form-input {
          width: 100%;
          border: 2.5px solid var(--ink);
          border-radius: 16px;
          background: #ffffff;
          outline: 0;
          padding: 14px 16px;
          font-size: 16px;
          color: var(--ink);
          transition: box-shadow 0.2s ease, background 0.2s ease;
        }
        .form-input:focus { background: #fffdf2; box-shadow: 0 0 0 4px var(--yellow); }
        .quantity-input { font-size: 20px; font-weight: 700; }
        .quantity-hint { display: flex; justify-content: space-between; gap: 8px; color: var(--muted); font-size: 12px; margin-top: 9px; }
        .total-row { display: flex; justify-content: space-between; align-items: center; border-top: 2px solid #e6e6e6; margin-top: 24px; padding-top: 20px; }
        .total-row span { color: var(--muted); font-size: 12px; font-weight: 700; letter-spacing: 0.12em; }
        .total-row strong { font-family: var(--display); font-size: 32px; letter-spacing: -0.03em; font-weight: 800; }
        .order-button {
          width: 100%;
          display: flex;
          justify-content: space-between;
          align-items: center;
          margin-top: 20px;
          padding: 10px 10px 10px 26px;
          min-height: 60px;
          border: 2.5px solid var(--ink);
          border-radius: 999px;
          background: var(--yellow);
          color: var(--ink);
          font-size: 15px;
          font-weight: 700;
          cursor: pointer;
          box-shadow: 0 5px 0 var(--ink);
          transition: transform 0.15s ease, box-shadow 0.15s ease, background 0.2s ease;
        }
        .order-button span {
          display: grid;
          place-items: center;
          width: 38px;
          height: 38px;
          border-radius: 50%;
          background: var(--ink);
          color: var(--yellow);
          font-size: 18px;
        }
        .order-button:hover { background: var(--yellow-h); transform: translateY(-2px); box-shadow: 0 7px 0 var(--ink); }
        .order-button:active { transform: translateY(3px); box-shadow: 0 1px 0 var(--ink); }
        .order-button:disabled { opacity: .55; cursor: not-allowed; transform: none; }
        .notice { background: #fff6cf; border: 2.5px solid var(--ink); border-radius: 16px; padding: 12px 14px; margin-top: 16px; font-size: 14px; line-height: 1.5; color: var(--ink); }
        .secure-note { text-align: center; color: var(--muted); font-size: 12px; margin-top: 16px; }
        .secure-note span { margin-right: 5px; }
        .bottom-banner {
          margin: 0 6.5% 56px;
          padding: 48px 5%;
          background: var(--yellow);
          border: 3px solid var(--ink);
          border-radius: 32px;
          box-shadow: 0 10px 0 var(--ink);
          display: flex;
          align-items: end;
          justify-content: space-between;
          gap: 24px;
        }
        .bottom-banner h2 { font-family: var(--display); font-size: clamp(32px, 4.4vw, 60px); letter-spacing: -0.045em; line-height: 0.98; margin: 16px 0 0; font-weight: 800; }
        .bottom-banner > a {
          background: var(--ink);
          color: var(--yellow);
          padding: 16px 24px;
          font-size: 14px;
          font-weight: 700;
          letter-spacing: 0.08em;
          border-radius: 999px;
          white-space: nowrap;
          transition: transform 0.15s ease;
        }
        .bottom-banner > a:hover { transform: translateY(-2px); }
        .bottom-banner > a span { margin-left: 14px; }
        .footer {
          padding: 28px 6.5%;
          display: flex;
          justify-content: space-between;
          align-items: center;
          gap: 12px;
          background: var(--ink);
          color: #ffffff;
          font-size: 12px;
          font-weight: 700;
          letter-spacing: 0.08em;
        }
        .footer .brand { color: #ffffff; font-size: 24px; }
        .footer .brand span { color: var(--ink); }
        :focus-visible { outline: 3px solid var(--ink); outline-offset: 3px; }
        @media (max-width: 1000px) {
          .main-nav a { padding: 10px 8px; font-size: 14px; }
          .content-grid { grid-template-columns: minmax(0, 1fr) 340px; gap: 24px; }
        }
        @media (max-width: 900px) {
          .main-nav { display: none; }
          .hero { padding-left: 6%; padding-right: 6%; grid-template-columns: 1fr; }
          .workspace { padding-left: 6%; padding-right: 6%; }
          .content-grid { grid-template-columns: 1fr; }
          .order-card { max-width: none; position: static; }
        }
        @media (max-width: 600px) {
          .topbar { padding: 0 5%; min-height: 68px; }
          .login-link { display: none; }
          .hero { padding-top: 44px; padding-bottom: 40px; }
          .hero-copy > p { font-size: 16px; }
          .hero-art { height: 280px; margin-top: 10px; }
          .hero-bottom { gap: 8px; font-size: 10px; margin-top: 26px; }
          .workspace { padding: 48px 5% 56px; }
          .section-heading { align-items: start; flex-direction: column; }
          .category-bar { gap: 8px; }
          .category-button { padding: 8px 12px; font-size: 13px; }
          .search-box { width: 100%; margin: 4px 0 0; }
          .search-box input { width: 100%; }
          .table-head { grid-template-columns: 1fr 100px 30px; padding-left: 8px; padding-right: 8px; }
          .service-row { grid-template-columns: 1fr 100px 30px; padding: 12px 10px; }
          .service-info { gap: 9px; }
          .service-info strong, .service-price strong { font-size: 13px; }
          .service-info small, .service-price small { font-size: 11px; }
          .service-tag { display: none; }
          .platform-mark { width: 34px; height: 34px; font-size: 17px; }
          .order-card { padding: 22px 20px; border-radius: 26px; box-shadow: 0 7px 0 var(--ink); }
          .order-card h3 { font-size: 34px; }
          .bottom-banner { margin: 0 5% 40px; align-items: start; flex-direction: column; padding: 32px 24px; border-radius: 26px; box-shadow: 0 7px 0 var(--ink); }
          .footer { padding: 24px 5%; flex-wrap: wrap; }
        }
        @media (prefers-reduced-motion: reduce) {
          .signup-link, .category-button, .service-row, .order-button, .form-input, .search-box, .bottom-banner > a { transition: none; }
        }
      `}</style>
    </main>
  );
}
