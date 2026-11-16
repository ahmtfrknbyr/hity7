"use client";

/**
 * components/BakiyeChip.tsx
 * Her sayfanın üst menüsünde görünen bakiye kutusu: "₺1.250,00 | Cüzdanım" (5. aşama).
 * - Bakiye sunucuda, kullanıcının yalnızca KENDİ hareketlerinden hesaplanır (/api/bakiye → wallet_balance).
 * - Bakiye okunamazsa yanlışlıkla "0 TL" gösterilmez: "Bakiye okunamadı ↻" ile yeniden denenir.
 * - Sipariş, yükleme veya iade sonrası ("hity7:bakiye" olayı) ve sekmeye geri dönüldüğünde yenilenir.
 * - Ziyaretçiye bakiye gösterilmez. Stil kendi içindedir.
 */
import { useCallback, useEffect, useState } from "react";
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
    const b = Number(j.balance);
    return Number.isFinite(b) ? b : "err";
  } catch {
    return "err";
  }
}

export default function BakiyeChip({ dark = false, hideWhenOut = false }: { dark?: boolean; hideWhenOut?: boolean }) {
  const [state, setState] = useState<ChipState>("load");

  const refresh = useCallback(() => {
    loadBalance().then(setState);
  }, []);

  useEffect(() => {
    let alive = true;
    const run = () => loadBalance().then((s) => alive && setState(s));
    run();
    // Sipariş / yükleme / iade sonrası ve sekmeye geri dönüldüğünde bakiye yenilenir
    window.addEventListener("hity7:bakiye", run);
    const vis = () => document.visibilityState === "visible" && run();
    document.addEventListener("visibilitychange", vis);
    return () => {
      alive = false;
      window.removeEventListener("hity7:bakiye", run);
      document.removeEventListener("visibilitychange", vis);
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
    letterSpacing: ".04em",
    background: dark ? "#111" : "#f5c518",
    color: dark ? "#f5c518" : "#111",
    textDecoration: "none",
    whiteSpace: "nowrap",
    cursor: "pointer",
  };

  if (state === "out") {
    return <a href={`/giris?next=${encodeURIComponent(typeof window !== "undefined" ? window.location.pathname : "/")}`} style={base}>GİRİŞ YAP</a>;
  }
  if (state === "err") {
    return (
      <span style={{ display: "inline-flex", gap: 6, alignItems: "center" }}>
        <button type="button" onClick={refresh} style={{ ...base, background: dark ? "#111" : "#fff" }} title="Bakiye okunamadı, yeniden dene">
          BAKİYE OKUNAMADI ↻
        </button>
        <a href="/bakiye" style={{ ...base, background: dark ? "#111" : "#fff" }}>CÜZDANIM</a>
      </span>
    );
  }
  const tl = state.toLocaleString("tr-TR", { minimumFractionDigits: 2, maximumFractionDigits: 2 });
  return (
    <a href="/bakiye" style={base} title="Cüzdanım · bakiye yükle">
      ₺{tl}
      <span aria-hidden="true" style={{ opacity: 0.55 }}>|</span>
      CÜZDANIM
    </a>
  );
}
