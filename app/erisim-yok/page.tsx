/**
 * app/erisim-yok/page.tsx
 * Rolüne kapalı (CEO panelinden gizlenmiş) bir hizmet sayfası doğrudan adresle açılmak istendiğinde gösterilir.
 */
import Link from "next/link";

export const metadata = { title: "Sayfa bulunamadı · HITY7", robots: { index: false } };

export default function ErisimYok() {
  return (
    <main
      style={{
        minHeight: "calc(100vh - 71px)",
        display: "grid",
        placeItems: "center",
        padding: "24px 16px",
        fontFamily: 'Inter,"Helvetica Neue",Arial,sans-serif',
        backgroundColor: "#fff",
        backgroundImage: "radial-gradient(#d9d9d9 1.4px,transparent 1.5px)",
        backgroundSize: "28px 28px",
        color: "#111",
      }}
    >
      <div style={{ maxWidth: 480, width: "100%", background: "#fff", border: "3px solid #111", borderRadius: 32, padding: 32, boxShadow: "0 10px 0 #111", textAlign: "center" }}>
        <span style={{ display: "inline-block", border: "2.5px solid #111", borderRadius: 999, background: "#f5c518", padding: "5px 14px", fontSize: 11, fontWeight: 800, letterSpacing: ".14em" }}>
          HITY7 / 404
        </span>
        <h1 style={{ fontSize: 34, lineHeight: 1, letterSpacing: "-.04em", fontWeight: 900, margin: "18px 0 10px" }}>Bu hizmet şu an kullanılamıyor.</h1>
        <p style={{ color: "#686868", fontSize: 15, lineHeight: 1.6, margin: 0 }}>Aradığın sayfa yayında değil veya hesabına açık değil.</p>
        <p style={{ marginTop: 18 }}>
          <Link href="/" style={{ color: "#111", fontWeight: 800 }}>
            Ana sayfaya dön →
          </Link>
        </p>
      </div>
    </main>
  );
}
