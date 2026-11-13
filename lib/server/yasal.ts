/**
 * lib/server/yasal.ts
 * Sözleşme onaylarının kaydı için yardımcılar (yalnızca sunucu).
 * Onaylanan sürüm: yönetim panelinde metin düzenlendiyse panelin kaydettiği tarih, yoksa varsayılan metin sürümü.
 */
import { db } from "./supa";
import { LEGAL_VERSION, type LegalSlug } from "../yasal-belgeler";

export async function legalVersion(): Promise<string> {
  try {
    const r = await db<{ v: string | null }[]>("site_content?key=eq.legal&select=v:value->>updatedAt");
    const v = Array.isArray(r.body) ? r.body[0]?.v : null;
    if (typeof v === "string" && /^\d{4}-\d{2}-\d{2}/.test(v)) return v.slice(0, 10);
  } catch {
    /* sürüm okunamazsa varsayılan */
  }
  return LEGAL_VERSION;
}

/** Kayıtlara eklenecek onay bilgisi */
export async function consentRecord(belgeler: LegalSlug[], extra: Record<string, unknown> = {}) {
  return { zaman: new Date().toISOString(), surum: await legalVersion(), belgeler, ...extra };
}
