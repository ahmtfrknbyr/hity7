/**
 * app/api/destek/route.ts
 * Müşteri destek mesajları: oluştur / sorgula / yanıtla + dosya ekleri (8. aşama).
 * - Giriş yapmadan da talep açılabilir; sorgu ve yanıt için talep numarası + iletişim bilgisi birlikte gerekir.
 * - Giriş yapmış üye taleplerini listeleyebilir ve mesajlarına fotoğraf / video / ses dosyası ekleyebilir.
 *   Ekler özel depoya (/api/yukle amac=destek) yüklenir; yalnızca talep sahibi ve destek yetkili personel indirebilir.
 * - Durum değerleri değişmez (Yeni / Yanıtlandı / Kapandı); ekranda Açık / İşlemde / Çözüldü olarak gösterilir.
 * - Mevcut talepler ve mesaj geçmişi korunur.
 */
import { clean, db, fail, getUser, rpc, serverReady } from "../../../lib/server/supa";

type Ticket = { id: string; no: string; subject: string; status: string; contact: string | null; created_at: string; user_id: string | null };
type Ek = { name: string; key: string; size: number; mime?: string; provider: "supabase" | "r2"; depo: string };

async function findTicket(no: string, contact: string, userId?: string): Promise<Ticket | null> {
  if (!/^T-\d{4,}$/i.test(no)) return null;
  const r = await db<Ticket[]>(`support_tickets?no=eq.${encodeURIComponent(no.toUpperCase())}&select=id,no,subject,status,contact,created_at,user_id`);
  const t = Array.isArray(r.body) ? r.body[0] : null;
  if (!t) return null;
  // Talep sahibi (giriş yapmış) iletişim bilgisi olmadan da açabilir
  if (userId && t.user_id === userId) return t;
  if (!contact || (t.contact || "").trim().toLowerCase() !== contact.trim().toLowerCase()) return null;
  return t;
}

/** Ekleri doğrular: yalnızca giriş yapmış kullanıcının kendi destek klasöründeki dosyalar kabul edilir. */
function ekleriAl(raw: unknown, userId: string | null): Ek[] | { error: string } {
  const list = (Array.isArray(raw) ? raw : []).slice(0, 10) as Record<string, unknown>[];
  if (!list.length) return [];
  if (!userId) return { error: "Dosya eklemek için giriş yapmalısın." };
  const out: Ek[] = [];
  for (const f of list) {
    const key = clean(f.key, 400);
    if (!key.startsWith(`destek/${userId}/`) || key.includes("..")) return { error: "Ek dosya geçersiz. Dosyayı yeniden yükle." };
    out.push({ name: clean(f.name, 200) || "dosya", key, size: Number(f.size) || 0, mime: clean(f.mime, 100), provider: f.provider === "r2" ? "r2" : "supabase", depo: "hity7-uploads" });
  }
  return out;
}

async function mesajlar(ticketId: string) {
  const msgs = await db(`support_messages?ticket_id=eq.${ticketId}&select=id,sender,body,attachments,created_at&order=created_at.asc`);
  return Array.isArray(msgs.body) ? msgs.body : [];
}

export async function POST(req: Request) {
  if (!serverReady()) return fail("Destek sistemi henüz kurulmamış (eksik sunucu ayarı: SUPABASE_SECRET_KEY).", 503);
  let b: Record<string, unknown> = {};
  try {
    b = await req.json();
  } catch {
    return fail("Geçersiz istek.");
  }
  const user = await getUser(req);

  if (b.action === "create") {
    const name = clean(b.name, 120),
      contact = clean(b.contact, 160);
    const subject = clean(b.subject, 160),
      body = clean(b.message, 4000);
    const code = clean(b.code, 40);
    if (!name || !contact || !subject || !body) return fail("Ad, iletişim, konu ve mesaj gerekli.");
    const ekler = ekleriAl(b.ekler, user?.id ?? null);
    if ("error" in ekler) return fail(ekler.error);

    const t = await db<{ id: string; no: string }[]>("support_tickets", {
      method: "POST",
      prefer: "return=representation",
      body: JSON.stringify({ user_id: user?.id ?? null, customer_name: name, contact, subject, service_code: code, status: "Yeni" }),
    });
    const created = Array.isArray(t.body) ? t.body[0] : null;
    if (!t.ok || !created) return fail("Mesaj kaydedilemedi. Lütfen tekrar dene.", 500);
    const m = await db("support_messages", {
      method: "POST",
      prefer: "return=minimal",
      body: JSON.stringify({ ticket_id: created.id, sender: "customer", body, ...(ekler.length ? { attachments: ekler } : {}) }),
    });
    if (!m.ok) return fail("Mesaj kaydedilemedi. Lütfen tekrar dene.", 500);
    await rpc("h7_yonetime_bildir", { p_kind: "destek", p_title: "Yeni destek talebi", p_body: `${created.no} · ${subject}`, p_link: "/ceo" });
    return Response.json({ ok: true, no: created.no });
  }

  /* Giriş yapmış üyenin talepleri */
  if (b.action === "taleplerim") {
    if (!user) return fail("Giriş gerekli.", 401, { needLogin: true });
    const r = await db<{ id: string; no: string; subject: string; status: string; updated_at: string; customer_read_at: string | null }[]>(
      `support_tickets?user_id=eq.${user.id}&select=id,no,subject,status,updated_at,customer_read_at&order=updated_at.desc&limit=50`
    );
    const list = Array.isArray(r.body) ? r.body : [];
    // Okunmamış: müşterinin son okumasından sonra gelen ekip mesajları
    const out = [];
    for (const t of list) {
      const u = await db<{ id: string }[]>(
        `support_messages?ticket_id=eq.${t.id}&sender=eq.staff${t.customer_read_at ? `&created_at=gt.${encodeURIComponent(t.customer_read_at)}` : ""}&select=id`
      );
      out.push({ no: t.no, subject: t.subject, status: t.status, updated_at: t.updated_at, okunmamis: Array.isArray(u.body) ? u.body.length : 0 });
    }
    return Response.json({ ok: true, talepler: out });
  }

  if (b.action === "lookup" || b.action === "reply") {
    const t = await findTicket(clean(b.no, 20), clean(b.contact, 160), user?.id);
    if (!t) return fail("Talep numarası veya iletişim bilgisi eşleşmedi.", 404);
    if (b.action === "reply") {
      const body = clean(b.message, 4000);
      const ekler = ekleriAl(b.ekler, user && t.user_id === user.id ? user.id : null);
      if ("error" in ekler) return fail(ekler.error);
      if (!body && !ekler.length) return fail("Mesaj boş olamaz.");
      if (t.status === "Kapandı") return fail("Bu talep çözüldü olarak kapatılmış. Yeni bir talep oluştur.");
      const m = await db("support_messages", {
        method: "POST",
        prefer: "return=minimal",
        body: JSON.stringify({ ticket_id: t.id, sender: "customer", body: body || "(dosya eki)", ...(ekler.length ? { attachments: ekler } : {}) }),
      });
      if (!m.ok) return fail("Gönderilemedi.", 500);
      await db(`support_tickets?id=eq.${t.id}`, { method: "PATCH", body: JSON.stringify({ status: "Yeni", updated_at: new Date().toISOString() }) });
      await rpc("h7_yonetime_bildir", { p_kind: "destek", p_title: "Destek talebine yeni mesaj", p_body: `${t.no} · ${t.subject}`, p_link: "/ceo" });
    }
    // Talep sahibi açtıysa "okundu" işaretlenir
    if (user && t.user_id === user.id) {
      await db(`support_tickets?id=eq.${t.id}`, { method: "PATCH", body: JSON.stringify({ customer_read_at: new Date().toISOString() }) });
    }
    const st = b.action === "reply" ? "Yeni" : t.status;
    return Response.json({ ok: true, ticket: { no: t.no, subject: t.subject, status: st, sahibi: !!(user && t.user_id === user.id) }, messages: await mesajlar(t.id) });
  }
  return fail("Bilinmeyen işlem.");
}
