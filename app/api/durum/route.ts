/**
 * app/api/durum/route.ts
 * CEO / admin için entegrasyon durumu. Gizli değerleri ASLA döndürmez; yalnızca "tanımlı mı / aktif mi" bilgisi.
 * Amaç: çalışmayan bir entegrasyonun panelde çalışıyormuş gibi görünmesini engellemek.
 */
import { SUPA_SERVICE, db, fail, getStaff } from "../../../lib/server/supa";

export async function POST(req: Request) {
  const staff = await getStaff(req);
  if (!staff || (staff.role !== "ceo" && staff.role !== "admin")) return fail("Bu işlem için yetkin yok.", 403);

  const out: Record<string, unknown> = {
    sunucuAnahtari: !!SUPA_SERVICE,
    yapayZeka: !!process.env.ANTHROPIC_API_KEY,
    yapayZekaModel: process.env.ANTHROPIC_MODEL || "claude-sonnet-5-5",
    dagitim: "manuel", // dijital dağıtım ortağı (DSP / distribütör) API'si bağlı değil; yayınlar elle iletilir
  };

  if (SUPA_SERVICE) {
    const pay = await db<{ kind: string; active: boolean; mode: string }[]>("payment_providers?select=kind,active,mode");
    const p = Array.isArray(pay.body) ? pay.body : [];
    const paytr = p.find((x) => x.kind === "paytr" && x.active);
    out.kartOdeme = paytr ? { aktif: true, mod: paytr.mode === "live" ? "canli" : "test" } : { aktif: false };
    out.havale = p.some((x) => x.kind === "havale" && x.active);
    out.digerOdeme = p.filter((x) => x.kind !== "paytr" && x.kind !== "havale").map((x) => x.kind);

    const smm = await db<{ active: boolean }[]>("smm_providers?select=active");
    const s = Array.isArray(smm.body) ? smm.body : [];
    out.smm = { toplam: s.length, aktif: s.filter((x) => x.active).length };

    // Veritabanı kurulumu (migration) kontrolü
    const rel = await db("releases?select=id&limit=1");
    const aud = await db("audit_log?select=id&limit=1");
    out.veritabani = { yayinTablosu: rel.ok, islemKaydi: aud.ok };
  }

  return Response.json({ ok: true, ...out });
}
