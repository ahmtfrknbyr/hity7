"use client";

/**
 * components/BakiyeChip.tsx
 * Her sayfanın üst menüsünde görünen küçük bakiye kutusu.
 * Girişliyse bakiyeyi gösterir ve tıklayınca bakiye yükleme sayfasına götürür.
 * Girişli ama bakiye okunamıyorsa (ör. sunucu kurulumu eksik) "CÜZDANIM" bağlantısı gösterir.
 * Giriş yoksa "GİRİŞ YAP" yazar. Stil kendi içindedir, projedeki CSS'e bağlı değildir.
 */
import { useEffect, useState } from "react";
import { getSupabase } from "../lib/supabase";

type ChipState = "load" | "out" | "err" | number;

/** Bakiyeyi okur: giriş yoksa "out", okunamazsa "err", yoksa bakiye tutarı. */
async function loadBalance(): Promise<ChipState> {
  let sb: ReturnType<typeof getSupabase>;
  try {
    sb = getSupabase();
  } catch {
    return "out";
  }
  const { data } = await sb.auth.getSession();
  const token = data.session?.access_token;
  if (!token) return "out";
  try {
    const res = await fetch("/api/bakiye", {
      method: "POST",
      headers: { "content-type": "application/json", Authorization: `Bearer ${token}` },
      body: JSON.stringify({ action: "summary" }),
    });
    if (!res.ok) return "err";
    const j = await res.json();
    return Number(j.balance) || 0;
  } catch {
    return "err";
  }
}

export default function BakiyeChip({ dark = false, hideWhenOut = false }: { dark?: boolean; hideWhenOut?: boolean }) {
  const [state, setState] = useState<ChipState>("load");

  useEffect(() => {
    let alive = true;
    const refresh = () => {
      loadBalance().then((s) => {
        if (alive) setState(s);
      });
    };
    refresh();
    // Sipariş verilince bakiye hemen yenilenir
    window.addEventListener("hity7:bakiye", refresh);
    return () => {
      alive = false;
      window.removeEventListener("hity7:bakiye", refresh);
    };
  }, []);

  if (state === "load") return null;
  if (state === "out" && hideWhenOut) return null;

  const base: React.CSSProperties = {
    display: "inline-flex",
    alignItems: "center",
    gap: 8,
    border: `2.5px solid ${dark ? "#f5c518" : "#111"}`,
    borderRadius: 999,
    padding: "7px 14px",
    fontFamily: "Inter, Arial, sans-serif",
    fontSize: 11,
    fontWeight: 800,
    letterSpacing: ".06em",
    background: dark ? "#111" : "#f5c518",
    color: dark ? "#f5c518" : "#111",
    textDecoration: "none",
    whiteSpace: "nowrap",
  };

  if (state === "out") {
    return <a href={`/giris?next=${encodeURIComponent(typeof window !== "undefined" ? window.location.pathname : "/")}`} style={base}>GİRİŞ YAP</a>;
  }
  if (state === "err") {
    return (
      <a href="/panel?tab=wallet" style={base} title="Cüzdanım">
        CÜZDANIM
      </a>
    );
  }
  const tl = state.toLocaleString("tr-TR", { minimumFractionDigits: 2, maximumFractionDigits: 2 });
  return (
    <a href="/bakiye" style={base} title="Bakiye yükle">
      BAKİYE: {tl} TL <span style={{ fontSize: 14, lineHeight: 1 }}>+</span>
    </a>
  );
}
