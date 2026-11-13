/**
 * app/api/destek/route.ts
 * Müşteri destek mesajları: oluştur / sorgula / yanıtla. Giriş zorunlu değil.
 * Sorgu ve yanıt için talep numarası + iletişim bilgisi birlikte gerekir.
 */
import { clean, db, fail, getUser, serverReady } from "../../../lib/server/supa";

type Ticket = { id: string; no: string; subject: string; status: string; contact: string | null; created_at: string };

async function findTicket(no: string, contact: string): Promise<Ticket | null> {
  if (!/^T-\d{4,}$/i.test(no) || !contact) return null;
  const r = await db<Ticket[]>(`support_tickets?no=eq.${encodeURIComponent(no.toUpperCase())}&select=id,no,subject,status,contact,created_at`);
  const t = Array.isArray(r.body) ? r.body[0] : null;
  if (!t || (t.contact || "").trim().toLowerCase() !== contact.trim().toLowerCase()) return null;
  return t;
}

export async function POST(req: Request) {
  if (!serverReady()) return fail("Destek sistemi henüz kurulmamış (sunucu anahtarı eksik).", 503);
  let b: Record<string, unknown> = {};
  try {
    b = await req.json();
  } catch {
    return fail("Geçersiz istek.");
  }

  if (b.action === "create") {
    const name = clean(b.name, 120),
      contact = clean(b.contact, 160);
    const subject = clean(b.subject, 160),
      body = clean(b.message, 4000);
    const code = clean(b.code, 40);
    if (!name || !contact || !subject || !body) return fail("Ad, iletişim, konu ve mesaj gerekli.");

    const user = await getUser(req);
    const t = await db<{ id: string; no: string }[]>("support_tickets", {
      method: "POST",
      prefer: "return=representation",
      body: JSON.stringify({ user_id: user?.id ?? null, customer_name: name, contact, subject, service_code: code, status: "Yeni" }),
    });
    const created = Array.isArray(t.body) ? t.body[0] : null;
    if (!t.ok || !created) return fail("Mesaj kaydedilemedi. Lütfen tekrar dene.", 500);
    const m = await db("support_messages", { method: "POST", prefer: "return=minimal", body: JSON.stringify({ ticket_id: created.id, sender: "customer", body }) });
    if (!m.ok) return fail("Mesaj kaydedilemedi. Lütfen tekrar dene.", 500);
    return Response.json({ ok: true, no: created.no });
  }

  if (b.action === "lookup" || b.action === "reply") {
    const t = await findTicket(clean(b.no, 20), clean(b.contact, 160));
    if (!t) return fail("Talep numarası veya iletişim bilgisi eşleşmedi.", 404);
    if (b.action === "reply") {
      const body = clean(b.message, 4000);
      if (!body) return fail("Mesaj boş olamaz.");
      if (t.status === "Kapandı") return fail("Bu talep kapatılmış. Yeni bir talep oluştur.");
      const m = await db("support_messages", { method: "POST", prefer: "return=minimal", body: JSON.stringify({ ticket_id: t.id, sender: "customer", body }) });
      await db(`support_tickets?id=eq.${t.id}`, { method: "PATCH", body: JSON.stringify({ status: "Yeni", updated_at: new Date().toISOString() }) });
      if (!m.ok) return fail("Gönderilemedi.", 500);
    }
    const msgs = await db(`support_messages?ticket_id=eq.${t.id}&select=sender,body,created_at&order=created_at.asc`);
    return Response.json({ ok: true, ticket: { no: t.no, subject: t.subject, status: t.status }, messages: msgs.body || [] });
  }
  return fail("Bilinmeyen işlem.");
}
