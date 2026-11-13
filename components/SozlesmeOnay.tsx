"use client";

/**
 * components/SozlesmeOnay.tsx
 * Sipariş, bakiye yükleme ve üyelik formlarındaki sözleşme onay kutusu (Mesafeli Sözleşmeler Yönetmeliği).
 * Bağlantılar yeni sekmede açılır; form doldurulmuş hâliyle kalır.
 * Stil kendi içindedir. sade: çerçevesiz (bakiye sayfası gibi farklı tasarımlı sayfalar için).
 */
import type { CSSProperties, ReactNode } from "react";
import { legalHref, type LegalSlug } from "../lib/yasal-belgeler";

export type OnayTuru = "siparis" | "bakiye" | "kayit";

const linkStyle: CSSProperties = {
  color: "#111",
  fontWeight: 800,
  textDecoration: "underline",
  textDecorationColor: "#f5c518",
  textDecorationThickness: 3,
  textUnderlineOffset: 3,
};

function L({ slug, children }: { slug: LegalSlug; children: ReactNode }) {
  return (
    <a href={legalHref(slug)} target="_blank" rel="noopener noreferrer" style={linkStyle}>
      {children}
    </a>
  );
}

function Metin({ tur }: { tur: OnayTuru }) {
  if (tur === "kayit")
    return (
      <>
        <L slug="kullanim-kosullari">Kullanım Koşulları</L>’nı okudum, kabul ediyorum. Kişisel verilerimin işlenmesine ilişkin{" "}
        <L slug="kvkk">Aydınlatma Metni</L>’ni okudum.
      </>
    );
  if (tur === "bakiye")
    return (
      <>
        <L slug="on-bilgilendirme">Ön Bilgilendirme Formu</L>’nu ve <L slug="mesafeli-satis">Mesafeli Satış Sözleşmesi</L>’ni okudum,
        kabul ediyorum. Kullanmadığım bakiye için cayma ve iade koşullarını <L slug="iade-iptal">İade ve İptal Koşulları</L>’ndan
        öğrendim.
      </>
    );
  return (
    <>
      <L slug="kullanim-kosullari">Kullanım Koşulları ve Hizmet Sözleşmesi</L>’ni, <L slug="on-bilgilendirme">Ön Bilgilendirme Formu</L>’nu
      ve <L slug="mesafeli-satis">Mesafeli Satış Sözleşmesi</L>’ni okudum, kabul ediyorum. Siparişimin hemen işleme alınmasını
      istiyorum; hizmetin ifasına başlandıktan sonra cayma hakkımın sona ereceğini biliyorum.
    </>
  );
}

export default function SozlesmeOnay({
  tur,
  checked,
  onChange,
  sade = false,
}: {
  tur: OnayTuru;
  checked: boolean;
  onChange: (v: boolean) => void;
  sade?: boolean;
}) {
  const box: CSSProperties = sade
    ? { display: "flex", gap: 10, alignItems: "flex-start", marginTop: 16, cursor: "pointer", textAlign: "left" }
    : {
        display: "flex",
        gap: 12,
        alignItems: "flex-start",
        marginTop: 18,
        padding: "12px 14px",
        border: "2.5px solid #111",
        borderRadius: 16,
        background: checked ? "#fffdf2" : "#fff",
        cursor: "pointer",
        textAlign: "left",
      };
  return (
    <label style={box}>
      <input
        type="checkbox"
        checked={checked}
        onChange={(e) => onChange(e.target.checked)}
        style={{ width: 18, height: 18, marginTop: 2, flex: "none", accentColor: "#111", cursor: "pointer" }}
      />
      <span style={{ fontFamily: "Inter, 'Helvetica Neue', Arial, sans-serif", fontSize: 12.5, lineHeight: 1.55, fontWeight: 500, color: "#242424", letterSpacing: 0 }}>
        <Metin tur={tur} />
      </span>
    </label>
  );
}
