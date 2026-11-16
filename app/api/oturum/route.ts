/**
 * app/api/oturum/route.ts
 * POST   (Authorization: Bearer <Supabase erişim anahtarı>): kimlik + rol veritabanından doğrulanır, imzalı
 *        h7_oturum çerezi yazılır. Yanıt: { ok, rol }.
 * DELETE : çerez silinir (çıkış).
 * Ayrıntı: lib/server/oturum.ts
 */
import { fail, getRole, getUser } from "../../../lib/server/supa";
import { OTURUM_SURESI_SN, cerezBasligi, oturumImzala, oturumImzalanabilir } from "../../../lib/server/oturum";

const guvenli = (req: Request) => new URL(req.url).protocol === "https:";

export async function POST(req: Request) {
  const user = await getUser(req);
  if (!user) {
    return new Response(JSON.stringify({ ok: false, rol: "visitor" }), {
      status: 401,
      headers: { "content-type": "application/json", "set-cookie": cerezBasligi("", 0, guvenli(req)) },
    });
  }
  const rol = (await getRole(user.id, req.headers.get("authorization") || undefined)) || "banned";
  if (!oturumImzalanabilir()) return Response.json({ ok: true, rol, cerez: false });
  const deger = await oturumImzala({ u: user.id, r: rol, e: Math.floor(Date.now() / 1000) + OTURUM_SURESI_SN });
  if (!deger) return fail("Oturum çerezi oluşturulamadı.", 500);
  return new Response(JSON.stringify({ ok: true, rol, cerez: true }), {
    headers: { "content-type": "application/json", "cache-control": "no-store", "set-cookie": cerezBasligi(deger, OTURUM_SURESI_SN, guvenli(req)) },
  });
}

export async function DELETE(req: Request) {
  return new Response(JSON.stringify({ ok: true }), {
    headers: { "content-type": "application/json", "cache-control": "no-store", "set-cookie": cerezBasligi("", 0, guvenli(req)) },
  });
}
