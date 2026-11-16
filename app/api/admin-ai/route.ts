/**
 * app/api/admin-ai/route.ts
 * Yönetim panelinin yapay zekâ asistanı (Claude). Resmi Anthropic SDK'sı ile çalışır.
 * - Yalnızca CEO / admin ve "AI Asistan" yetkisi verilmiş personel kullanabilir.
 * - Asistan değişiklikleri yalnızca ÖNERİ olarak döndürür (araç çağrısı); hiçbir şey burada uygulanmaz.
 *   Öneriyi panelde yalnızca CEO "Uygula" diyerek siteye yansıtabilir.
 * Ortam değişkenleri: ANTHROPIC_API_KEY (zorunlu), ANTHROPIC_MODEL (isteğe bağlı).
 */
import Anthropic from "@anthropic-ai/sdk";
import { fail, getStaff } from "../../../lib/server/supa";

const TOOLS: Anthropic.Beta.BetaTool[] = [
  {
    name: "update_content",
    description:
      "Site genel ayarlarını veya ana sayfa yazılarını değiştirmek için ÖNERİ oluşturur. CEO onaylayınca uygulanır.",
    input_schema: {
      type: "object",
      properties: {
        section: { type: "string", enum: ["general", "home"] },
        field: {
          type: "string",
          description:
            "general: siteName, slogan, announcementEnabled, announcementText, maintenance, contactEmail, instagram, tiktok, youtube, whatsapp. home: heroTitle, heroSub, ctaPrimary, ctaSecondary.",
        },
        value: { type: ["string", "boolean"] },
      },
      required: ["section", "field", "value"],
    },
  },
  {
    name: "update_service",
    description: "Bir hizmetin adını, açıklamasını, fiyat yazısını, bağlantısını veya yayın durumunu değiştirme önerisi.",
    input_schema: {
      type: "object",
      properties: {
        id: { type: "string", description: "Hizmet kimliği (bağlamdaki services listesinden)." },
        field: { type: "string", enum: ["name", "desc", "price", "href", "active"] },
        value: { type: ["string", "boolean"] },
      },
      required: ["id", "field", "value"],
    },
  },
  {
    name: "update_access",
    description:
      "Bir hizmetin kimlere görüneceğini ve kimlerin sipariş verebileceğini değiştirme önerisi. Hizmeti tamamen kapatmak için field=active kullan; group gerekmez.",
    input_schema: {
      type: "object",
      properties: {
        service: { type: "string", enum: ["influencer", "smm", "remake", "mix", "yayin"] },
        field: { type: "string", enum: ["active", "visible", "orderable"] },
        group: {
          type: "string",
          enum: ["visitor", "member", "mod", "ceo"],
          description: "visible için visitor/member/mod/ceo, orderable için member/mod/ceo. active için boş bırak.",
        },
        value: { type: "boolean" },
      },
      required: ["service", "field", "value"],
    },
  },
  {
    name: "update_producer",
    description: "Bir prodüktörün bilgisini veya mix/stems fiyatını değiştirme önerisi.",
    input_schema: {
      type: "object",
      properties: {
        id: { type: "string", description: "Prodüktör kimliği (bağlamdaki producers listesinden)." },
        field: { type: "string", enum: ["name", "role", "desc", "mixPrice", "stemsPrice", "active"] },
        value: { type: ["string", "number", "boolean"] },
      },
      required: ["id", "field", "value"],
    },
  },
];

const SYSTEM = `Sen HITY7 müzik-teknoloji platformunun yönetim panelindeki yapay zekâ asistanısın.
Konuştuğun kişi platformun sahibi (CEO) ya da yetkili bir yöneticidir; CEO'ya "patron" diye hitap edebilirsin ama abartma. Türkçe, net ve kısa yaz.

Platform: Influencer Marketing, SMM Panel, Remake Beat, Dijital Yayın, Mix & Mastering hizmetleri. Üyelik türleri: Sanatçı, Yapımcı, Reklamcı. Slogan: "Müziğin Geleceğini Şekillendir".

Yapabileceklerin:
- Satış analizi: ciro, sipariş sayıları, hizmetlere göre dağılım, bekleyen işler, iadeler ve cüzdan yüklemeleri.
- Trafik analizi: düşüşleri/yükselişleri açıklamak, kaynak ve sayfa bazında aksiyon önermek.
- Fiyat önerileri ve kampanya planlama (bağlamdaki gerçek verilere dayanarak).
- Sipariş istatistiklerini yorumlamak.
- Site yazıları, slogan, duyuru, hizmet açıklamaları ve fiyat metinleri için öneri yazmak.
- Değişiklik gerekiyorsa update_content / update_service / update_producer / update_access (hizmet görünürlüğü ve sipariş izni) araçlarıyla ÖNERİ oluşturmak. Araç çağırmak değişikliği uygulamaz; CEO "Uygula" demeden hiçbir şey değişmez. Bunu asla "değiştirdim" diye anlatma, "öneri hazırladım" de.
- Her araç çağrısından önce kısa bir açıklama yaz.

Kurallar:
- Sadece sana verilen bağlamdaki (context) verilere dayan. Veri yoksa uydurma, "veri yok" de.
- Fiyatı kullanıcı söylemediyse kendin kesin rakam uydurma; gerekçeli bir aralık öner ve onay iste.
- Bakım modunu açmak, hizmeti kapatmak veya fiyat değiştirmek kritik değişikliktir: öneriyi hazırla ama etkisini açıkça yaz.
- Bağlam dışında kalan sistem ayarlarını (üyeler, roller, bakiyeler, siparişler, veritabanı) değiştiremezsin; bunun için panelin ilgili bölümünü göstermelisin.
- Renkler marka paletinde kalmalı: beyaz, siyah, sarı #F5C518.`;

/** Sunucu tarafı yedek model (fallbacks) parametresini destekleyen modeller. */
const FALLBACK_MODELS = new Set(["claude-fable-5-2", "claude-fable-5-1", "claude-opus-5-5", "claude-opus-5", "claude-sonnet-5-5"]);

type Msg = { role: "user" | "assistant"; content: string };

export async function POST(req: Request) {
  // 1) Oturum + yetki (CEO / admin her zaman; mod / personel "ai" yetkisiyle)
  const staff = await getStaff(req, "ai");
  if (!staff) return fail("Bu işlem için yetkin yok.", 403);

  // 2) Anthropic API anahtarı
  const apiKey = process.env.ANTHROPIC_API_KEY;
  if (!apiKey) return fail("ANTHROPIC_API_KEY_MISSING", 503);
  const model = process.env.ANTHROPIC_MODEL || "claude-sonnet-5-5";

  // 3) İsteği temizle
  let body: { messages?: Msg[]; context?: unknown } = {};
  try {
    body = await req.json();
  } catch {
    return fail("Geçersiz istek.");
  }
  const messages: Anthropic.Beta.BetaMessageParam[] = (body.messages || [])
    .filter((m) => (m.role === "user" || m.role === "assistant") && typeof m.content === "string" && m.content.trim())
    .slice(-20)
    .map((m) => ({ role: m.role, content: m.content.slice(0, 6000) }));
  while (messages.length > 0 && messages[0].role !== "user") messages.shift();
  if (!messages.length) return fail("Mesaj boş.");

  const context = JSON.stringify(body.context ?? {}).slice(0, 24000);

  // 4) Claude isteği
  const client = new Anthropic({ apiKey });
  let response: Anthropic.Beta.BetaMessage;
  try {
    response = await client.beta.messages.create({
      model,
      max_tokens: 16000,
      system: [
        // Sabit talimatlar önbelleğe alınır; değişen panel bağlamı en sonda
        { type: "text", text: SYSTEM, cache_control: { type: "ephemeral" } },
        { type: "text", text: `Kullanıcının rolü: ${staff.role}.\n\nGÜNCEL PANEL BAĞLAMI (JSON):\n${context}` },
      ],
      tools: TOOLS,
      messages,
      // Güvenlik sınıflandırıcısı reddederse istek aynı çağrı içinde yedek modelle yeniden denenir
      ...(FALLBACK_MODELS.has(model) ? { betas: ["server-side-fallback-2026-07-01"], fallbacks: "default" as const } : {}),
    });
  } catch (e) {
    if (e instanceof Anthropic.AuthenticationError) return fail("Yapay zekâ anahtarı geçersiz (ANTHROPIC_API_KEY).", 502);
    if (e instanceof Anthropic.RateLimitError) return fail("Yapay zekâ şu an yoğun. Biraz sonra tekrar dene.", 429);
    if (e instanceof Anthropic.APIError) return fail("Yapay zekâ isteği başarısız oldu.", 502, { detail: String(e.message).slice(0, 400) });
    return fail("Yapay zekâya ulaşılamadı.", 502);
  }

  // 5) Yanıtı işle (yanıt biçimi panel tarafıyla aynı: { text, proposals })
  if (response.stop_reason === "refusal") {
    return Response.json({ text: "Bu isteğe yanıt veremiyorum. Soruyu farklı şekilde sormayı dene.", proposals: [] });
  }
  let text = response.content
    .filter((b): b is Anthropic.Beta.BetaTextBlock => b.type === "text")
    .map((b) => b.text)
    .join("\n")
    .trim();
  if (response.stop_reason === "max_tokens") text += (text ? "\n\n" : "") + "(Yanıt uzunluk sınırına takıldı; soruyu daraltırsan tamamını yazabilirim.)";

  const proposals = response.content
    .filter((b): b is Anthropic.Beta.BetaToolUseBlock => b.type === "tool_use")
    .map((b) => ({ id: b.id, name: b.name, input: b.input }));

  return Response.json({ text, proposals });
}
