/**
 * app/yasal/[belge]/page.tsx
 * Yasal sayfalar: /yasal/kvkk, /yasal/gizlilik-cerez, /yasal/on-bilgilendirme,
 * /yasal/mesafeli-satis, /yasal/iade-iptal, /yasal/kullanim-kosullari
 * Sayfalar derleme sırasında hazırlanır; şirket bilgileri ve panelden düzenlenen metinler tarayıcıda yüklenir.
 * Adres bilgisi (params) Suspense içinde okunur: sayfalar arası geçiş beklemeden açılır (Partial Prefetching).
 */
import { Suspense } from "react";
import type { Metadata } from "next";
import { notFound } from "next/navigation";
import YasalBelge from "../../../components/YasalBelge";
import { LEGAL_DOCS, isLegalSlug } from "../../../lib/yasal-belgeler";

type Props = { params: Promise<{ belge: string }> };

export function generateStaticParams() {
  return LEGAL_DOCS.map((d) => ({ belge: d.slug }));
}

export async function generateMetadata({ params }: Props): Promise<Metadata> {
  const { belge } = await params;
  const doc = LEGAL_DOCS.find((d) => d.slug === belge);
  return doc ? { title: `${doc.title} — HITY7`, description: `HITY7 ${doc.title}` } : { title: "HITY7" };
}

export default function YasalSayfa({ params }: Props) {
  return (
    <Suspense fallback={<YasalIskelet />}>
      <Belge params={params} />
    </Suspense>
  );
}

async function Belge({ params }: Props) {
  const { belge } = await params;
  if (!isLegalSlug(belge)) notFound();
  return <YasalBelge slug={belge} />;
}

/** Belge yüklenirken görünen boş zemin (sayfanın noktalı arka planıyla aynı) */
function YasalIskelet() {
  return (
    <main
      aria-busy="true"
      style={{
        flex: 1,
        minHeight: "70vh",
        backgroundColor: "#fff",
        backgroundImage: "radial-gradient(#d9d9d9 1.4px, transparent 1.5px)",
        backgroundSize: "28px 28px",
      }}
    />
  );
}
