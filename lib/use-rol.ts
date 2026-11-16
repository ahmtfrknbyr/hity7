"use client";

/**
 * lib/use-rol.ts
 * Tarayıcıdaki oturumun rolünü tüm bileşenlerle paylaşır ve sunucu oturum çerezini (h7_oturum) günceller.
 * - Oturum açılınca / yenilenince /api/oturum'a erişim anahtarı gönderilir; sunucu rolü veritabanından doğrular
 *   ve imzalı çerezi yazar (proxy bakım modu ve gizli hizmet kararlarını bu çerezle verir).
 * - Çıkışta çerez silinir.
 * Rol yalnızca görünüm içindir; hiçbir yetki tarayıcıdaki bu değere dayanmaz.
 */
import { useEffect, useState } from "react";
import { getSupabase } from "./supabase";

export type RolDurumu = "load" | "visitor" | "member" | "mod" | "amele" | "admin" | "ceo" | "banned";

let mevcut: RolDurumu = "load";
let basladi = false;
const dinleyiciler = new Set<(r: RolDurumu) => void>();

function yay(r: RolDurumu) {
  mevcut = r;
  for (const f of dinleyiciler) f(r);
}

async function esitle(token: string | null) {
  try {
    if (!token) {
      await fetch("/api/oturum", { method: "DELETE" }).catch(() => {});
      yay("visitor");
      return;
    }
    const res = await fetch("/api/oturum", { method: "POST", headers: { Authorization: `Bearer ${token}` } });
    const j = (await res.json().catch(() => ({}))) as { rol?: string };
    const r = String(j.rol || (res.ok ? "member" : "visitor")) as RolDurumu;
    yay(["visitor", "member", "mod", "amele", "admin", "ceo", "banned"].includes(r) ? r : "member");
  } catch {
    yay(token ? "member" : "visitor");
  }
}

function basla() {
  if (basladi || typeof window === "undefined") return;
  basladi = true;
  let sb: ReturnType<typeof getSupabase>;
  try {
    sb = getSupabase();
  } catch {
    yay("visitor");
    return;
  }
  let sonToken: string | null | undefined;
  sb.auth.onAuthStateChange((_event, session) => {
    const t = session?.access_token || null;
    // Aynı anahtarla tekrar istek atma (sekme odaklanınca vb.)
    if (t === sonToken) return;
    sonToken = t;
    void esitle(t);
  });
}

/** Mevcut rol (yüklenirken "load"). */
export function useRol(): RolDurumu {
  const [rol, setRol] = useState<RolDurumu>(mevcut);
  useEffect(() => {
    basla();
    dinleyiciler.add(setRol);
    setRol(mevcut);
    return () => {
      dinleyiciler.delete(setRol);
    };
  }, []);
  return rol;
}

/** Rol değiştiğinde (ör. panelde yetki değişince) çerezi ve rolü yeniden doğrular. */
export async function rolYenile() {
  try {
    const { data } = await getSupabase().auth.getSession();
    await esitle(data.session?.access_token || null);
  } catch {
    /* sessizce geç */
  }
}
