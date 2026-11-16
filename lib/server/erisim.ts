/**
 * lib/server/erisim.ts
 * Sunucu tarafı: hizmet erişim ayarı ve site yayın durumu (veritabanından, her istekte taze).
 */
import { db, SUPA_SERVICE, anonDb } from "./supa";
import { bakimdaGirebilir, hizmetSiparisVerilebilir, mergeErisim, type ErisimAyar, type HizmetId } from "../erisim";

export async function erisimOku(): Promise<{ bakim: boolean; erisim: ErisimAyar }> {
  let rows: { key: string; value: Record<string, unknown> | null }[] = [];
  if (SUPA_SERVICE) {
    const r = await db<typeof rows>("site_content?key=in.(general,erisim)&select=key,value");
    rows = Array.isArray(r.body) ? r.body : [];
  } else {
    const r = await anonDb("site_content?key=in.(general,erisim)&select=key,value");
    rows = r.ok ? await r.json() : [];
  }
  const genel = rows.find((x) => x.key === "general")?.value || {};
  return { bakim: genel.maintenance === true, erisim: mergeErisim(rows.find((x) => x.key === "erisim")?.value) };
}

export type SiparisIzni = { ok: true } | { ok: false; status: number; error: string };

/** Bu rol bu hizmetten şu an sipariş verebilir mi? (site kapalıysa yalnızca izinli roller) */
export async function siparisIzni(hizmet: HizmetId, rol: string | null): Promise<SiparisIzni> {
  const { bakim, erisim } = await erisimOku();
  if (bakim && !bakimdaGirebilir(erisim, rol)) return { ok: false, status: 503, error: "Site şu an bakımda. Lütfen daha sonra tekrar dene." };
  if (!hizmetSiparisVerilebilir(erisim, hizmet, rol)) return { ok: false, status: 403, error: "Bu hizmet şu an sipariş almıyor." };
  return { ok: true };
}
