"use client";

/**
 * components/YasalBelge.tsx
 * /yasal/[belge] sayfalarının görünümü. Metin, yönetim panelinde düzenlendiyse oradan; yoksa varsayılan şablondan gelir.
 * Şirket bilgileri (unvan, adres, vergi no…) yönetim paneli › Site Yazıları › Şirket bilgileri bölümünden doldurulur.
 */
import Link from "next/link";
import { useSyncExternalStore, type ReactNode } from "react";
import { LEGAL_DOCS, LEGAL_VERSION, type LegalSlug } from "../lib/yasal-belgeler";
import { LEGAL_TEMPLATES, fillTemplate, parseDoc, type Inline } from "../lib/yasal-metinler";
import { useLegalContent, useSiteContent } from "../lib/use-site-content";

const CSS = `
.yb-root{flex:1;color:#111;font-family:Inter,"Helvetica Neue",Arial,sans-serif;background-color:#fff;background-image:radial-gradient(#d9d9d9 1.4px,transparent 1.5px);background-size:28px 28px;-webkit-font-smoothing:antialiased}
.yb-root *,.yb-root *::before,.yb-root *::after{box-sizing:border-box}
.yb-wrap{max-width:1200px;margin:0 auto;padding:44px 24px 72px}
.yb-pill{display:inline-block;border:2.5px solid #111;border-radius:999px;background:#fff;padding:6px 14px;font-size:11px;font-weight:800;letter-spacing:.14em}
.yb-head h1{font-size:clamp(32px,5vw,56px);line-height:1;letter-spacing:-.045em;font-weight:900;margin:18px 0 10px;max-width:900px}
.yb-date{margin:0;color:#686868;font-size:13px;font-weight:600}
.yb-grid{display:grid;grid-template-columns:260px minmax(0,1fr);gap:28px;margin-top:32px;align-items:start}
.yb-nav{position:sticky;top:96px;display:flex;flex-direction:column;gap:8px}
.yb-nav a{display:block;border:2.5px solid #111;border-radius:16px;background:#fff;padding:11px 14px;font-size:13px;font-weight:700;line-height:1.35;color:#111;text-decoration:none}
.yb-nav a:hover{background:#fffdf2}
.yb-nav a.on{background:#f5c518;box-shadow:0 4px 0 #111}
.yb-card{background:#fff;border:3px solid #111;border-radius:28px;padding:34px 38px;box-shadow:0 10px 0 #111;min-width:0}
.yb-card h2{font-size:21px;line-height:1.25;letter-spacing:-.02em;font-weight:900;margin:30px 0 10px;scroll-margin-top:96px}
.yb-card h3{font-size:16px;line-height:1.3;font-weight:800;margin:22px 0 8px;scroll-margin-top:96px}
.yb-card > :first-child{margin-top:0}
.yb-card p,.yb-card li{font-size:15px;line-height:1.75;color:#242424;overflow-wrap:anywhere}
.yb-card p{margin:0 0 12px}
.yb-card ul{margin:0 0 14px;padding-left:22px;list-style:disc}
.yb-card li{margin:4px 0}
.yb-card li::marker{color:#111}
.yb-card a{color:#111;font-weight:700;text-decoration:underline;text-decoration-color:#f5c518;text-decoration-thickness:3px;text-underline-offset:3px}
.yb-miss{background:#fff6cf;color:#111;border:1.5px dashed #111;border-radius:6px;padding:0 5px;font-weight:700;white-space:normal}
.yb-foot{margin-top:24px;border-top:2px solid #e6e6e6;padding-top:16px;font-size:12px;line-height:1.6;color:#686868}
@media (max-width:900px){
  .yb-grid{grid-template-columns:minmax(0,1fr);gap:18px}
  .yb-nav{position:static;flex-direction:row;overflow-x:auto;padding:2px 2px 8px;-webkit-overflow-scrolling:touch}
  .yb-nav a{flex:none;white-space:nowrap;font-size:12px;padding:9px 12px}
}
@media (max-width:560px){.yb-wrap{padding:30px 16px 56px}.yb-card{padding:22px 18px;border-radius:24px}.yb-card p,.yb-card li{font-size:14.5px}}
`;

const MONTHS = ["Ocak", "Şubat", "Mart", "Nisan", "Mayıs", "Haziran", "Temmuz", "Ağustos", "Eylül", "Ekim", "Kasım", "Aralık"];
const fmtDate = (iso: string) => {
  const m = /^(\d{4})-(\d{2})-(\d{2})/.exec(iso);
  return m ? `${Number(m[3])} ${MONTHS[Number(m[2]) - 1] || ""} ${m[1]}` : "";
};

const noSubscribe = () => () => {};

function renderInline(items: Inline[], key = ""): ReactNode[] {
  return items.map((it, i) => {
    const k = `${key}${i}`;
    if (it.t === "text") return it.v;
    if (it.t === "b") return <strong key={k}>{renderInline(it.c, `${k}-`)}</strong>;
    if (it.t === "a") {
      return it.href.startsWith("/") ? (
        <Link key={k} href={it.href}>
          {it.v}
        </Link>
      ) : (
        <a key={k} href={it.href} target={it.href.startsWith("https://") ? "_blank" : undefined} rel="noopener noreferrer">
          {it.v}
        </a>
      );
    }
    return (
      <mark key={k} className="yb-miss" title="Yönetim panelindeki şirket bilgilerinden doldurulacak">
        {it.v} · doldurulacak
      </mark>
    );
  });
}

export default function YasalBelge({ slug }: { slug: LegalSlug }) {
  const content = useSiteContent();
  const legal = useLegalContent();
  // Sunucuda boş, tarayıcıda sitenin gerçek adresi (hydration uyumlu)
  const host = useSyncExternalStore(noSubscribe, () => window.location.host, () => "");

  const doc = LEGAL_DOCS.find((d) => d.slug === slug) || LEGAL_DOCS[0];
  const custom = legal?.docs[slug];
  const text = custom && custom.trim() ? custom : LEGAL_TEMPLATES[slug];
  const c = content.company;
  const blocks = parseDoc(
    fillTemplate(text, {
      unvan: c.title,
      adres: c.address,
      telefon: c.phone,
      eposta: content.general.contactEmail,
      vergiDairesi: c.taxOffice,
      vergiNo: c.taxNumber,
      mersis: c.mersis,
      kep: c.kep,
      marka: content.general.siteName || "HITY7",
      site: host,
    })
  );
  const updated = fmtDate((custom && legal?.updatedAt) || LEGAL_VERSION);

  return (
    <main className="yb-root">
      <style dangerouslySetInnerHTML={{ __html: CSS }} />
      <div className="yb-wrap">
        <header className="yb-head">
          <span className="yb-pill">{(content.general.siteName || "HITY7").toLocaleUpperCase("tr")} / YASAL</span>
          <h1>{doc.title}</h1>
          {updated && <p className="yb-date">Son güncelleme: {updated}</p>}
        </header>

        <div className="yb-grid">
          <nav className="yb-nav" aria-label="Yasal metinler">
            {LEGAL_DOCS.map((d) => (
              <Link key={d.slug} href={`/yasal/${d.slug}`} className={d.slug === slug ? "on" : ""} aria-current={d.slug === slug ? "page" : undefined}>
                {d.title}
              </Link>
            ))}
          </nav>

          <article className="yb-card">
            {blocks.map((b, i) => {
              if (b.t === "h2") return <h2 key={i} id={b.id}>{renderInline(b.v)}</h2>;
              if (b.t === "h3") return <h3 key={i} id={b.id}>{renderInline(b.v)}</h3>;
              if (b.t === "ul")
                return (
                  <ul key={i}>
                    {b.items.map((li, j) => (
                      <li key={j}>{renderInline(li)}</li>
                    ))}
                  </ul>
                );
              return <p key={i}>{renderInline(b.v)}</p>;
            })}
            <p className="yb-foot">
              Sorularını <Link href="/destek">Destek</Link> sayfasından veya
              {content.general.contactEmail ? (
                <>
                  {" "}
                  <a href={`mailto:${content.general.contactEmail}`}>{content.general.contactEmail}</a> adresinden
                </>
              ) : (
                " e-posta ile"
              )}{" "}
              iletebilirsin.
            </p>
          </article>
        </div>
      </div>
    </main>
  );
}
