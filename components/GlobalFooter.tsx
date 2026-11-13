"use client";

/**
 * components/GlobalFooter.tsx
 * Kök layout'ta tüm sayfaların en altına eklenen site altı: yasal sayfa bağlantıları + satıcı bilgileri.
 * Ödeme kuruluşları (PayTR vb.) başvuruda bu bağlantıların sitede görünmesini ister.
 * Yönetim panelinde (/ceo) gösterilmez.
 */
import Link from "next/link";
import { usePathname } from "next/navigation";
import { useSiteContent } from "../lib/use-site-content";
import { LEGAL_DOCS } from "../lib/yasal-belgeler";

const HIDE_ON = ["/ceo"];

const CSS = `
.h7-ft{background:#fff;border-top:3px solid #111;color:#111;font-family:Inter,"Helvetica Neue",Arial,sans-serif;-webkit-font-smoothing:antialiased}
.h7-ft *{box-sizing:border-box}
.h7-ft-in{max-width:1360px;margin:0 auto;padding:26px 24px 30px;display:grid;gap:16px}
.h7-ft-top{display:flex;flex-wrap:wrap;align-items:baseline;gap:8px 22px}
.h7-ft-logo{font-size:22px;font-weight:900;letter-spacing:-1.2px;color:#111;text-decoration:none;display:inline-flex;align-items:baseline;gap:3px}
.h7-ft-dot{width:8px;height:8px;border-radius:50%;background:#f5c518;border:2px solid #111;display:inline-block}
.h7-ft-co{margin:0;font-size:12px;line-height:1.6;color:#686868;overflow-wrap:anywhere}
.h7-ft-links{display:flex;flex-wrap:wrap;gap:8px 20px;margin:0;padding:0;list-style:none}
.h7-ft-links a{font-size:11px;font-weight:800;letter-spacing:.06em;color:#242424;text-decoration:none;text-transform:uppercase}
.h7-ft-links a:hover{color:#111;box-shadow:0 2px 0 #f5c518}
.h7-ft-copy{margin:0;font-size:11px;color:#686868}
@media (max-width:560px){.h7-ft-in{padding:22px 16px 26px}.h7-ft-links{gap:10px 16px}}
`;

export default function GlobalFooter() {
  const path = usePathname() || "/";
  const content = useSiteContent();
  if (HIDE_ON.some((p) => path === p || path.startsWith(p + "/"))) return null;

  const g = content.general;
  const c = content.company;
  const brand = g.siteName || "HITY7";
  const info = [c.title, c.address, g.contactEmail, c.phone].map((s) => String(s || "").trim()).filter(Boolean);

  return (
    <footer className="h7-ft" id="site-alti">
      <style dangerouslySetInnerHTML={{ __html: CSS }} />
      <div className="h7-ft-in">
        <div className="h7-ft-top">
          <Link href="/" className="h7-ft-logo">
            {brand}
            <span className="h7-ft-dot" />
          </Link>
          {info.length > 0 && <p className="h7-ft-co">{info.join(" · ")}</p>}
        </div>
        <nav aria-label="Yasal bilgiler">
          <ul className="h7-ft-links">
            {LEGAL_DOCS.map((d) => (
              <li key={d.slug}>
                <Link href={`/yasal/${d.slug}`}>{d.short}</Link>
              </li>
            ))}
            <li>
              <Link href="/destek">Destek</Link>
            </li>
          </ul>
        </nav>
        <p className="h7-ft-copy">© {c.title || brand}. Tüm hakları saklıdır.</p>
      </div>
    </footer>
  );
}
