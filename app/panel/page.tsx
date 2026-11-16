"use client";

import Link from "next/link";
import { useCallback, useEffect, useMemo, useState } from "react";
import { getSupabase } from "../../lib/supabase";

type Tab = "overview" | "orders" | "releases" | "wallet" | "profile" | "support";
/** Sepetten verilen siparişin kalemleri (ana hizmet + ek hizmetler); eski siparişlerde yoktur. */
type OrderItem = { kind?: string; name?: string; qty?: number; total?: number };
type Order = { id: number; code: string; title: string; service: string; type: string; amount: number; status: string; created_at: string; items?: OrderItem[] | null };
/** Sipariş listesi sorgusu: kalemler payload içinden yalnızca okunur (dosya adresleri vb. çekilmez). */
const ORDER_COLS = "id,code,title,service,type,amount,status,created_at,items:payload->items";
type Tx = { id: number; kind: string; amount: number; status: string; provider: string | null; note: string | null; created_at: string };
type Wallet = { balance: number; pending: number; pendingCount?: number; totalTopup?: number; totalSpend?: number; transactions: Tx[] };
type OrderEvent = { id: number; order_id: number; kind: "durum" | "teslimat" | "revizyon" | "not" | "iade"; status: string | null; note: string | null; file_name: string | null; file_url: string | null; created_at: string };
type Track = { id: string; position: number; title: string; isrc: string | null };
type Release = {
  id: string;
  order_id: number | null;
  format: "single" | "ep" | "album";
  title: string;
  artist: string;
  release_date: string | null;
  cover_url: string | null;
  upc: string | null;
  status: string;
  admin_note: string | null;
  stores: string[] | null;
  created_at: string;
  release_tracks: Track[];
};

const MENU: { id: Tab; label: string; icon: string }[] = [
  { id: "overview", label: "Genel Bakış", icon: "⌂" },
  { id: "orders", label: "Siparişlerim", icon: "▤" },
  { id: "releases", label: "Dijital Yayınlarım", icon: "◉" },
  { id: "wallet", label: "Cüzdanım", icon: "▱" },
  { id: "profile", label: "Profilim", icon: "◎" },
  { id: "support", label: "Destek", icon: "?" },
];

const STATUSES = ["Ödeme Bekleniyor", "Alındı", "İşlemde", "Revizyon", "Tamamlandı", "İptal Edildi"];
/** Eski durum adlarını yenileriyle gösterir */
const norm = (s: string) => (s === "Beklemede" ? "Alındı" : s === "İptal" ? "İptal Edildi" : s);
const ACTIVE = new Set(["Ödeme Bekleniyor", "Alındı", "İşlemde", "Revizyon"]);
const FORMAT_LABEL: Record<string, string> = { single: "Tekli", ep: "EP", album: "Albüm" };
const PROVIDER_LABEL: Record<string, string> = { paytr: "Kart", havale: "Havale / EFT", admin: "Bakiye düzeltmesi", iade: "İade" };

const tl = (n: number) => Number(n || 0).toLocaleString("tr-TR", { minimumFractionDigits: 2, maximumFractionDigits: 2 }) + " TL";
const day = (s: string) => new Date(s).toLocaleDateString("tr-TR", { day: "2-digit", month: "long", year: "numeric" });
const dateTime = (s: string) => new Date(s).toLocaleString("tr-TR", { day: "2-digit", month: "short", hour: "2-digit", minute: "2-digit" });

const CSS = `
.pn{min-height:100vh;color:#111;font-family:Inter,"Helvetica Neue",Arial,sans-serif;background-color:#fff;background-image:radial-gradient(#d9d9d9 1.4px,transparent 1.5px);background-size:28px 28px;-webkit-font-smoothing:antialiased}
.pn *,.pn *::before,.pn *::after{box-sizing:border-box}
.pn :where(a){color:inherit;text-decoration:none}
.pn :where(button,input,select,textarea){font:inherit;color:inherit}
.pn :where(h1,h2,h3,p){margin:0}
.pn-shell{max-width:1360px;margin:0 auto;display:grid;grid-template-columns:250px minmax(0,1fr);gap:28px;padding:28px 24px 90px}
.pn-side{position:sticky;top:96px;align-self:start;background:#fff;border:3px solid #111;border-radius:28px;padding:14px;box-shadow:0 7px 0 #111}
.pn-nav{display:flex;flex-direction:column;gap:4px}
.pn-nb{display:flex;align-items:center;gap:12px;width:100%;border:0;background:transparent;border-radius:16px;padding:13px 14px;font-size:14px;font-weight:700;text-align:left;cursor:pointer}
.pn-nb i{font-style:normal;width:20px;text-align:center}
.pn-nb:hover{background:#f5f5f5}
.pn-nb.on{background:#f5c518;box-shadow:0 0 0 2.5px #111}
.pn-out{margin-top:10px;border-top:2px dashed #111;padding-top:10px}
.pn-out .pn-nb{color:#686868}
.pn-h{margin-bottom:22px}
.pn-pill{display:inline-block;border:2px solid #111;border-radius:999px;padding:5px 13px;font-size:10px;font-weight:800;letter-spacing:.14em;background:#fff}
.pn-h h1{font-size:clamp(36px,5vw,60px);line-height:.95;letter-spacing:-.05em;font-weight:900;margin:14px 0 8px}
.pn-h p{color:#686868;font-size:15px}
.pn-grid4{display:grid;grid-template-columns:repeat(4,minmax(0,1fr));gap:16px;margin-bottom:20px}
.pn-stat{background:#fff;border:3px solid #111;border-radius:24px;padding:18px}
.pn-stat span{display:block;font-size:11px;font-weight:800;letter-spacing:.1em;color:#686868}
.pn-stat strong{display:block;font-size:32px;letter-spacing:-.04em;font-weight:900;margin-top:10px}
.pn-stat.y{background:#f5c518}
.pn-stat.y span{color:#111}
.pn-card{background:#fff;border:3px solid #111;border-radius:28px;padding:22px;margin-bottom:20px}
.pn-card h2{font-size:20px;letter-spacing:-.03em;font-weight:900}
.pn-card-h{display:flex;justify-content:space-between;align-items:center;gap:10px;margin-bottom:14px}
.pn-link{border:0;background:none;font-size:12px;font-weight:800;text-decoration:underline;cursor:pointer}
.pn-two{display:grid;grid-template-columns:minmax(0,1.5fr) minmax(0,1fr);gap:20px}
.pn-wallet{background:#111;color:#fff;border-radius:28px;padding:24px;margin-bottom:20px;display:flex;flex-direction:column;justify-content:space-between;min-height:220px}
.pn-wallet small{font-size:11px;font-weight:800;letter-spacing:.14em;color:#f5c518}
.pn-wallet strong{display:block;font-size:42px;letter-spacing:-.04em;font-weight:900;margin:10px 0 4px}
.pn-wallet p{color:#aaa;font-size:13px}
.pn-btn{display:inline-block;border:2.5px solid #111;border-radius:999px;background:#f5c518;padding:13px 22px;font-size:13px;font-weight:800;cursor:pointer;box-shadow:0 4px 0 #111;text-align:center;transition:transform .1s,box-shadow .1s}
.pn-btn:hover{transform:translateY(-1px);box-shadow:0 6px 0 #111}
.pn-btn:active{transform:translateY(3px);box-shadow:0 1px 0 #111}
.pn-btn:disabled{opacity:.55;cursor:not-allowed}
.pn-btn.sm{padding:9px 16px;font-size:12px;box-shadow:0 3px 0 #111}
.pn-btn.w{background:#fff}
.pn-wallet .pn-btn{border-color:#f5c518;box-shadow:0 4px 0 #8a6d00;margin-top:18px}
.pn-row{display:flex;justify-content:space-between;align-items:center;gap:12px;flex-wrap:wrap;padding:16px 0;border-bottom:2px dashed #ddd}
.pn-row:last-child{border-bottom:0;padding-bottom:0}
.pn-row:first-child{padding-top:0}
.pn-row b{display:block;font-size:15px}
.pn-row small{display:block;margin-top:4px;font-size:12px;color:#686868}
.pn-orow{border-bottom:2px dashed #ddd}
.pn-orow:last-child{border-bottom:0}
.pn-otop{display:flex;justify-content:space-between;align-items:center;gap:12px;flex-wrap:wrap;width:100%;padding:16px 0;border:0;background:none;text-align:left;cursor:pointer}
.pn-otop b{display:block;font-size:15px}
.pn-otop small{display:block;margin-top:4px;font-size:12px;color:#686868}
.pn-detail{background:#f5f5f5;border:2.5px solid #111;border-radius:20px;padding:16px;margin:0 0 16px}
.pn-tl{list-style:none;margin:0;padding:0;display:flex;flex-direction:column;gap:10px}
.pn-tl li{display:flex;gap:12px;font-size:13px;line-height:1.5}
.pn-tl time{flex:none;width:118px;color:#686868;font-variant-numeric:tabular-nums}
.pn-file{display:flex;justify-content:space-between;align-items:center;gap:10px;background:#fff;border:2px solid #111;border-radius:14px;padding:10px 12px;margin-top:8px;font-size:13px;font-weight:700}
.pn-code{display:inline-block;background:#111;color:#f5c518;border-radius:999px;padding:3px 10px;font-size:11px;font-weight:800;letter-spacing:.06em;margin-bottom:6px}
.pn-badge{display:inline-block;border:2px solid #111;border-radius:999px;padding:5px 12px;font-size:11px;font-weight:800;background:#fff;white-space:nowrap}
.pn-badge.b1{background:#fff6cf}.pn-badge.b2{background:#dbeafe}.pn-badge.b3{background:#d1fae5}.pn-badge.b4{background:#ffe4d0}.pn-badge.b5{background:#eee;color:#686868}
.pn-chips{display:flex;gap:8px;flex-wrap:wrap;margin-bottom:16px}
.pn-chip{border:2.5px solid #111;border-radius:999px;background:#fff;padding:8px 16px;font-size:12px;font-weight:800;cursor:pointer}
.pn-chip.on{background:#f5c518;box-shadow:0 3px 0 #111}
.pn-empty{text-align:center;padding:40px 10px;color:#686868;font-size:14px}
.pn-empty b{display:block;color:#111;font-size:18px;margin-bottom:6px}
.pn-form{display:grid;grid-template-columns:1fr 1fr;gap:16px}
.pn-form label{display:block;font-size:11px;font-weight:800;letter-spacing:.1em}
.pn-in{width:100%;margin-top:8px;border:2.5px solid #111;border-radius:16px;background:#fff;padding:13px 15px;font-size:15px;outline:none}
.pn-in:focus{background:#fffdf2;box-shadow:0 0 0 4px #f5c518}
.pn-in:disabled{background:#f5f5f5;color:#686868}
textarea.pn-in{resize:vertical;min-height:84px;line-height:1.5}
.pn-msg{margin-top:14px;border:2.5px solid #111;border-radius:16px;background:#fff6cf;padding:12px 14px;font-size:13px;font-weight:600}
.pn-plus{color:#047857}.pn-minus{color:#b91c1c}
.pn-rel{display:grid;grid-template-columns:96px minmax(0,1fr);gap:16px;padding:18px 0;border-bottom:2px dashed #ddd}
.pn-rel:last-child{border-bottom:0;padding-bottom:0}
.pn-rel:first-child{padding-top:0}
.pn-cover{width:96px;height:96px;border-radius:18px;border:2.5px solid #111;object-fit:cover;background:#f5c518;display:grid;place-items:center;font-size:30px}
.pn-codes{display:flex;flex-wrap:wrap;gap:8px;margin-top:10px}
.pn-mono{font-family:ui-monospace,SFMono-Regular,Menlo,Consolas,monospace;font-size:12px;font-weight:700;background:#fff;border:2px solid #111;border-radius:10px;padding:3px 8px}
.pn-mono.wait{background:#f5f5f5;color:#686868;border-style:dashed}
.pn-tracks{margin-top:12px;display:flex;flex-direction:column;gap:6px}
.pn-track{display:flex;justify-content:space-between;align-items:center;gap:10px;font-size:13px}
.pn-mob{display:none}
@media (max-width:1020px){
  .pn-shell{grid-template-columns:1fr;padding:18px 16px 110px}
  .pn-side{display:none}
  .pn-grid4{grid-template-columns:repeat(2,minmax(0,1fr))}
  .pn-two{grid-template-columns:1fr}
  .pn-mob{display:flex;position:fixed;left:0;right:0;bottom:0;z-index:40;background:#fff;border-top:3px solid #111;justify-content:space-around;padding:8px 4px calc(8px + env(safe-area-inset-bottom))}
  .pn-mob button{border:0;background:none;display:flex;flex-direction:column;align-items:center;gap:3px;font-size:10px;font-weight:800;color:#686868;padding:4px 6px;cursor:pointer}
  .pn-mob button i{font-style:normal;font-size:20px}
  .pn-mob button.on{color:#111}
  .pn-mob button.on i{background:#f5c518;border-radius:10px;padding:0 10px;box-shadow:0 0 0 2px #111}
}
@media (max-width:560px){.pn-form{grid-template-columns:1fr}.pn-stat strong{font-size:26px}.pn-wallet strong{font-size:34px}.pn-rel{grid-template-columns:64px minmax(0,1fr)}.pn-cover{width:64px;height:64px}.pn-tl time{width:92px}}
`;

function badgeClass(raw: string) {
  const s = norm(raw);
  return s === "Alındı" || s === "Ödeme Bekleniyor" ? "b1" : s === "İşlemde" ? "b2" : s === "Tamamlandı" ? "b3" : s === "Revizyon" ? "b4" : "b5";
}
function releaseBadge(s: string) {
  return s === "Yayında" ? "b3" : s === "Düzeltme gerekli" || s === "Reddedildi" ? "b4" : s === "Başvuru alındı" ? "b1" : "b2";
}

/** Siparişin geçmişi, teslim dosyaları ve revizyon talebi */
function OrderDetail({ order, onChanged }: { order: Order; onChanged: () => void }) {
  const [events, setEvents] = useState<OrderEvent[] | null>(null);
  const [note, setNote] = useState("");
  const [msg, setMsg] = useState("");
  const [busy, setBusy] = useState(false);
  const status = norm(order.status);

  const fetchEvents = useCallback(
    () => getSupabase().from("order_events").select("*").eq("order_id", order.id).order("created_at", { ascending: true }),
    [order.id]
  );
  const load = useCallback(async () => {
    const { data } = await fetchEvents();
    setEvents((data as OrderEvent[]) || []);
  }, [fetchEvents]);

  useEffect(() => {
    let alive = true;
    fetchEvents().then(({ data }) => {
      if (alive) setEvents((data as OrderEvent[]) || []);
    });
    return () => {
      alive = false;
    };
  }, [fetchEvents]);

  const deliveries = (events || []).filter((e) => e.kind === "teslimat" && e.file_url);
  const canRevise = order.type !== "smm" && (status === "Tamamlandı" || status === "İşlemde");

  async function revise() {
    setMsg("");
    if (note.trim().length < 5) return setMsg("Lütfen revizyon isteğini birkaç kelimeyle anlat.");
    setBusy(true);
    const sb = getSupabase();
    const { error } = await sb.rpc("h7_revizyon_talep", { p_siparis: order.id, p_not: note.trim() });
    setBusy(false);
    if (error) return setMsg(error.message.includes("Could not find") ? "Revizyon sistemi henüz kurulmamış. Destek üzerinden iletebilirsin." : error.message);
    setNote("");
    setMsg("Revizyon talebin alındı ✓ Ekibimiz en kısa sürede dönecek.");
    await load();
    onChanged();
  }

  const label: Record<OrderEvent["kind"], string> = { durum: "Durum", teslimat: "Teslimat", revizyon: "Revizyon talebin", not: "Not", iade: "İade" };
  const items = (Array.isArray(order.items) ? order.items : []).filter((x) => x && x.name);

  return (
    <div className="pn-detail">
      {items.length > 0 && (
        <div style={{ marginBottom: 16 }}>
          <b style={{ fontSize: 13 }}>Sipariş içeriği</b>
          {items.map((x, i) => (
            <div
              key={i}
              style={{ display: "flex", justifyContent: "space-between", gap: 12, padding: "8px 0", borderBottom: "1px dashed #ddd", fontSize: 13 }}
            >
              <span style={{ minWidth: 0 }}>
                <small style={{ display: "block", fontSize: 10, fontWeight: 800, letterSpacing: ".12em", color: "#686868" }}>
                  {x.kind === "addon" ? "EK HİZMET" : "ANA HİZMET"}
                </small>
                {x.name}
                {Number(x.qty) > 1 ? ` ×${x.qty}` : ""}
              </span>
              <b style={{ whiteSpace: "nowrap" }}>{tl(Number(x.total) || 0)}</b>
            </div>
          ))}
        </div>
      )}
      {(order.type === "remake" || order.type === "mix") && (
        <div style={{ marginBottom: 16 }}>
          <Link className="pn-file" href="/teslim">
            <span>Teslimat Merkezi · dosyalar, sürümler ve onay</span>
            <span>Aç →</span>
          </Link>
        </div>
      )}
      {deliveries.length > 0 && (
        <div style={{ marginBottom: 16 }}>
          <b style={{ fontSize: 13 }}>Teslim edilen dosyalar</b>
          {deliveries.map((d) => (
            <a key={d.id} className="pn-file" href={d.file_url!} target="_blank" rel="noreferrer">
              <span style={{ minWidth: 0, overflow: "hidden", textOverflow: "ellipsis", whiteSpace: "nowrap" }}>{d.file_name || "Dosya"}</span>
              <span>İndir ↓</span>
            </a>
          ))}
        </div>
      )}

      <b style={{ fontSize: 13 }}>Sipariş geçmişi</b>
      {events === null ? (
        <p style={{ fontSize: 13, color: "#686868", marginTop: 8 }}>Yükleniyor…</p>
      ) : events.length === 0 ? (
        <p style={{ fontSize: 13, color: "#686868", marginTop: 8 }}>Siparişin alındı. Durum değiştikçe burada görünecek.</p>
      ) : (
        <ol className="pn-tl" style={{ marginTop: 10 }}>
          {events.map((e) => (
            <li key={e.id}>
              <time dateTime={e.created_at}>{dateTime(e.created_at)}</time>
              <span>
                <b>{label[e.kind]}</b>
                {e.status ? ` · ${norm(e.status)}` : ""}
                {e.note ? ` · ${e.note}` : ""}
              </span>
            </li>
          ))}
        </ol>
      )}

      {canRevise && (
        <div style={{ marginTop: 16, borderTop: "2px dashed #111", paddingTop: 14 }}>
          <label style={{ display: "block", fontSize: 11, fontWeight: 800, letterSpacing: ".1em" }}>
            REVİZYON İSTE
            <textarea className="pn-in" value={note} onChange={(e) => setNote(e.target.value)} placeholder="Neyin değişmesini istiyorsun? Örn: Vokal biraz daha önde olsun, nakaratta reverb azalsın." />
          </label>
          <button className="pn-btn sm" style={{ marginTop: 10 }} onClick={revise} disabled={busy}>
            {busy ? "GÖNDERİLİYOR…" : "REVİZYON TALEBİ GÖNDER"}
          </button>
        </div>
      )}
      {status === "Revizyon" && <p className="pn-msg">Revizyon talebin ekibimize iletildi; yeni dosya hazır olduğunda burada görünecek.</p>}
      {msg && <p className="pn-msg">{msg}</p>}
    </div>
  );
}

export default function PanelPage() {
  const [tab, setTab] = useState<Tab>("overview");
  const [ready, setReady] = useState(false);
  const [userId, setUserId] = useState("");
  const [email, setEmail] = useState("");
  const [fullName, setFullName] = useState("");
  const [nameDraft, setNameDraft] = useState("");
  const [orders, setOrders] = useState<Order[]>([]);
  const [releases, setReleases] = useState<Release[] | null>(null);
  const [wallet, setWallet] = useState<Wallet | null>(null);
  const [filter, setFilter] = useState("Tümü");
  const [txFilter, setTxFilter] = useState<"all" | "topup" | "spend" | "pending">("all");
  const [openOrder, setOpenOrder] = useState<number | null>(null);
  const [pmsg, setPmsg] = useState("");

  const loadOrders = useCallback(async (uid: string) => {
    const sb = getSupabase();
    const ord = await sb.from("orders").select(ORDER_COLS).eq("user_id", uid).order("created_at", { ascending: false }).limit(200);
    setOrders((ord.data as Order[]) || []);
  }, []);

  // Panel verisini toplar (state'e dokunmaz); sonuç effect içinde .then ile uygulanır
  const fetchPanel = useCallback(async () => {
    const sb = getSupabase();
    const { data } = await sb.auth.getSession();
    const session = data.session;
    if (!session) return null;
    const uid = session.user.id;
    const [prof, rel, ord, res] = await Promise.all([
      sb.from("profiles").select("full_name").eq("id", uid).maybeSingle(),
      sb.from("releases").select("id,order_id,format,title,artist,release_date,cover_url,upc,status,admin_note,stores,created_at,release_tracks(id,position,title,isrc)").eq("user_id", uid).order("created_at", { ascending: false }),
      sb.from("orders").select(ORDER_COLS).eq("user_id", uid).order("created_at", { ascending: false }).limit(200),
      fetch("/api/bakiye", { method: "POST", headers: { "content-type": "application/json", Authorization: `Bearer ${session.access_token}` }, body: JSON.stringify({ action: "summary" }) }),
    ]);
    return {
      uid,
      email: session.user.email || "",
      fullName: (prof.data as { full_name?: string } | null)?.full_name || "",
      releases: rel.error ? null : ((rel.data as Release[]) || []),
      orders: (ord.data as Order[]) || [],
      wallet: res.ok ? ((await res.json()) as Wallet) : null,
    };
  }, []);

  useEffect(() => {
    let alive = true;
    fetchPanel().then((d) => {
      if (!alive) return;
      if (!d) {
        window.location.replace("/giris?next=/panel");
        return;
      }
      setUserId(d.uid);
      setEmail(d.email);
      setFullName(d.fullName);
      setNameDraft(d.fullName);
      setReleases(d.releases);
      setOrders(d.orders);
      setWallet(d.wallet);
      try {
        const t = new URLSearchParams(window.location.search).get("tab") as Tab | null;
        if (t && MENU.some((m) => m.id === t)) setTab(t);
      } catch {}
      setReady(true);
    });
    return () => {
      alive = false;
    };
  }, [fetchPanel]);

  const shown = useMemo(() => (filter === "Tümü" ? orders : orders.filter((o) => norm(o.status) === filter)), [orders, filter]);
  const active = orders.filter((o) => ACTIVE.has(norm(o.status))).length;
  const done = orders.filter((o) => norm(o.status) === "Tamamlandı").length;
  const releaseOrders = orders.filter((o) => o.type === "yayin");
  const display = fullName || email.split("@")[0] || "Hesabım";
  const txs = wallet?.transactions || [];
  const shownTx = txs.filter((t) => txFilter === "all" || (txFilter === "pending" ? t.status === "pending" : t.kind === txFilter));
  const pendingTx = txs.filter((t) => t.status === "pending" && t.kind === "topup");

  async function saveName() {
    const sb = getSupabase();
    const { data } = await sb.auth.getSession();
    if (!data.session) return;
    setPmsg("");
    const { error } = await sb.from("profiles").update({ full_name: nameDraft.trim() }).eq("id", data.session.user.id);
    if (error) return setPmsg("Kaydedilemedi. Lütfen tekrar dene.");
    setFullName(nameDraft.trim());
    setPmsg("Bilgilerin kaydedildi ✓");
  }

  async function logout() {
    const sb = getSupabase();
    await sb.auth.signOut();
    window.location.href = "/giris";
  }

  const heads: Record<Tab, [string, string, string]> = {
    overview: ["HESAP MERKEZİ", `Merhaba, ${display.split(" ")[0]}`, "HITY7 hesabındaki her şey tek yerde."],
    orders: ["İŞLEM GEÇMİŞİ", "Siparişlerim", "Siparişlerinin durumunu takip et, teslim dosyalarını indir, gerekirse revizyon iste."],
    releases: ["MÜZİK KATALOĞUN", "Dijital Yayınlarım", "Yayın başvuruların, durumları ve HITY7'nin atadığı ISRC / UPC kodları."],
    wallet: ["HITY7 WALLET", "Cüzdanım", "Bakiyeni yönet. Siparişler bakiyenden ödenir."],
    profile: ["KİŞİSEL BİLGİLER", "Profilim", "Hesap bilgilerini güncelle."],
    support: ["HITY7 YARDIM", "Destek", "Sorunu bize ilet, en kısa sürede dönelim."],
  };

  const orderList = (list: Order[], expandable: boolean) =>
    list.map((o) => {
      const isOpen = expandable && openOrder === o.id;
      return (
        <div className="pn-orow" key={o.id}>
          <button type="button" className="pn-otop" onClick={() => expandable && setOpenOrder(isOpen ? null : o.id)} aria-expanded={expandable ? isOpen : undefined}>
            <div style={{ minWidth: 0 }}>
              <span className="pn-code">{o.code}</span>
              <b>{o.title || o.service}</b>
              <small>
                {o.service} · {day(o.created_at)}
                {expandable ? (isOpen ? " · Detayı gizle ▲" : " · Detay ▼") : ""}
              </small>
            </div>
            <div style={{ display: "flex", alignItems: "center", gap: 12 }}>
              <b>{Number(o.amount) > 0 ? tl(o.amount) : "—"}</b>
              <span className={`pn-badge ${badgeClass(o.status)}`}>{norm(o.status)}</span>
            </div>
          </button>
          {isOpen && <OrderDetail order={o} onChanged={() => loadOrders(userId)} />}
        </div>
      );
    });

  return (
    <main className="pn">
      <style dangerouslySetInnerHTML={{ __html: CSS }} />

      <div className="pn-shell">
        <aside className="pn-side">
          <nav className="pn-nav" aria-label="Hesap menüsü">
            {MENU.map((m) => (
              <button key={m.id} className={`pn-nb ${tab === m.id ? "on" : ""}`} onClick={() => setTab(m.id)}>
                <i>{m.icon}</i>
                {m.label}
              </button>
            ))}
          </nav>
          <div className="pn-out">
            <button className="pn-nb" onClick={logout}>
              <i>↗</i>Çıkış yap
            </button>
          </div>
        </aside>

        <section>
          <div className="pn-h">
            <span className="pn-pill">{heads[tab][0]}</span>
            <h1>{heads[tab][1]}</h1>
            <p>{heads[tab][2]}</p>
          </div>

          {!ready && (
            <div className="pn-card">
              <div className="pn-empty">Yükleniyor…</div>
            </div>
          )}

          {ready && tab === "overview" && (
            <>
              <div className="pn-grid4">
                <div className="pn-stat y"><span>BAKİYE</span><strong>{wallet ? tl(wallet.balance) : "—"}</strong></div>
                <div className="pn-stat"><span>AKTİF SİPARİŞ</span><strong>{String(active).padStart(2, "0")}</strong></div>
                <div className="pn-stat"><span>TAMAMLANAN</span><strong>{String(done).padStart(2, "0")}</strong></div>
                <div className="pn-stat"><span>YAYIN</span><strong>{String(releases ? releases.length : releaseOrders.length).padStart(2, "0")}</strong></div>
              </div>
              <div className="pn-two">
                <div className="pn-card">
                  <div className="pn-card-h">
                    <h2>Son siparişler</h2>
                    <button className="pn-link" onClick={() => setTab("orders")}>Tümünü gör →</button>
                  </div>
                  {orders.length === 0 ? (
                    <div className="pn-empty"><b>Henüz siparişin yok</b>İlk siparişini vermek için hizmetlere göz at.</div>
                  ) : (
                    orderList(orders.slice(0, 4), false)
                  )}
                </div>
                <div className="pn-wallet">
                  <div>
                    <small>HITY7 WALLET</small>
                    <strong>{wallet ? tl(wallet.balance) : "—"}</strong>
                    <p>{wallet && wallet.pending > 0 ? `Onay bekleyen yükleme: ${tl(wallet.pending)}` : "Kullanılabilir bakiye"}</p>
                  </div>
                  <a className="pn-btn" href="/bakiye">+ BAKİYE YÜKLE</a>
                </div>
              </div>
            </>
          )}

          {ready && tab === "orders" && (
            <div className="pn-card">
              <div className="pn-chips">
                {["Tümü", ...STATUSES].map((f) => (
                  <button key={f} className={`pn-chip ${filter === f ? "on" : ""}`} onClick={() => setFilter(f)}>
                    {f}
                    {f !== "Tümü" ? ` · ${orders.filter((o) => norm(o.status) === f).length}` : ""}
                  </button>
                ))}
              </div>
              {shown.length === 0 ? <div className="pn-empty"><b>Sipariş bulunamadı</b>Bu filtrede görüntülenecek siparişin yok.</div> : orderList(shown, true)}
            </div>
          )}

          {ready && tab === "releases" && (
            <div className="pn-card">
              {releases === null ? (
                // Yayın tablosu henüz kurulmadıysa sipariş kayıtlarını göster
                releaseOrders.length === 0 ? (
                  <div className="pn-empty"><b>Henüz yayın başvurun yok</b><a className="pn-btn" style={{ marginTop: 14 }} href="/dijital-yayin">DİJİTAL YAYIN BAŞVURUSU ↗</a></div>
                ) : (
                  orderList(releaseOrders, true)
                )
              ) : releases.length === 0 ? (
                <div className="pn-empty">
                  <b>Henüz yayın başvurun yok</b>
                  Single, EP veya albümünü tüm platformlarda yayınla.
                  <div><a className="pn-btn" style={{ marginTop: 14 }} href="/dijital-yayin">DİJİTAL YAYIN BAŞVURUSU ↗</a></div>
                </div>
              ) : (
                releases.map((r) => {
                  const tracks = [...(r.release_tracks || [])].sort((a, b) => a.position - b.position);
                  return (
                    <div className="pn-rel" key={r.id}>
                      {r.cover_url ? (
                        // eslint-disable-next-line @next/next/no-img-element
                        <img className="pn-cover" src={r.cover_url} alt={`${r.title} kapağı`} />
                      ) : (
                        <span className="pn-cover">♪</span>
                      )}
                      <div style={{ minWidth: 0 }}>
                        <div style={{ display: "flex", justifyContent: "space-between", gap: 10, flexWrap: "wrap", alignItems: "flex-start" }}>
                          <div style={{ minWidth: 0 }}>
                            <b style={{ display: "block", fontSize: 17 }}>{r.title}</b>
                            <small style={{ display: "block", color: "#686868", fontSize: 12, marginTop: 3 }}>
                              {r.artist} · {FORMAT_LABEL[r.format] || r.format} · {tracks.length} şarkı{r.release_date ? ` · çıkış ${day(r.release_date)}` : ""}
                            </small>
                          </div>
                          <span className={`pn-badge ${releaseBadge(r.status)}`}>{r.status}</span>
                        </div>
                        {r.admin_note && <p className="pn-msg" style={{ marginTop: 10 }}>HITY7: {r.admin_note}</p>}
                        <div className="pn-codes">
                          <span className={`pn-mono ${r.upc ? "" : "wait"}`}>UPC {r.upc || "· atanacak"}</span>
                        </div>
                        <div className="pn-tracks">
                          {tracks.map((t) => (
                            <div className="pn-track" key={t.id}>
                              <span style={{ minWidth: 0, overflow: "hidden", textOverflow: "ellipsis", whiteSpace: "nowrap" }}>
                                {String(t.position).padStart(2, "0")} · {t.title}
                              </span>
                              <span className={`pn-mono ${t.isrc ? "" : "wait"}`}>ISRC {t.isrc || "· atanacak"}</span>
                            </div>
                          ))}
                        </div>
                      </div>
                    </div>
                  );
                })
              )}
              <p style={{ marginTop: 18, fontSize: 12, color: "#686868", lineHeight: 1.6 }}>
                ISRC ve UPC kodları HITY7 tarafından atanır; senden istenmez. Kodlar atandığında burada görünür.
              </p>
            </div>
          )}

          {ready && tab === "wallet" && (
            <>
              <div className="pn-wallet">
                <div>
                  <small>TOPLAM KULLANILABİLİR BAKİYE</small>
                  <strong>{wallet ? tl(wallet.balance) : "—"}</strong>
                  <p>
                    {wallet && wallet.pending > 0 ? `Onay bekleyen yükleme: ${tl(wallet.pending)} · ` : ""}
                    {wallet?.totalTopup !== undefined ? `Toplam yüklenen ${tl(wallet.totalTopup)} · Toplam harcanan ${tl(wallet.totalSpend || 0)}` : "Siparişlerin bu bakiyeden ödenir."}
                  </p>
                </div>
                <a className="pn-btn" href="/bakiye" style={{ alignSelf: "flex-start" }}>+ BAKİYE EKLE</a>
              </div>

              {pendingTx.length > 0 && (
                <div className="pn-card" style={{ background: "#fff6cf" }}>
                  <div className="pn-card-h"><h2>Onay bekleyen yüklemeler</h2></div>
                  {pendingTx.map((t) => (
                    <div className="pn-row" key={t.id}>
                      <div>
                        <b>{PROVIDER_LABEL[t.provider || ""] || "Yükleme"} · onay bekliyor</b>
                        <small>{t.note || ""}{t.note ? " · " : ""}{day(t.created_at)}</small>
                      </div>
                      <b>+ {tl(Number(t.amount))}</b>
                    </div>
                  ))}
                  <p style={{ marginTop: 12, fontSize: 12, color: "#686868" }}>Havale bildirimleri dekont kontrolünden sonra ekibimiz tarafından onaylanır.</p>
                </div>
              )}

              <div className="pn-card">
                <div className="pn-card-h"><h2>Hesap hareketleri</h2></div>
                <div className="pn-chips">
                  {(
                    [
                      ["all", "Tümü"],
                      ["topup", "Yüklemeler"],
                      ["spend", "Harcamalar"],
                      ["pending", "Bekleyen"],
                    ] as const
                  ).map(([id, l]) => (
                    <button key={id} className={`pn-chip ${txFilter === id ? "on" : ""}`} onClick={() => setTxFilter(id)}>{l}</button>
                  ))}
                </div>
                {shownTx.length === 0 ? (
                  <div className="pn-empty"><b>Hareket yok</b>Bakiye yüklediğinde ve sipariş verdiğinde burada görünür.</div>
                ) : (
                  shownTx.map((t) => (
                    <div className="pn-row" key={t.id}>
                      <div>
                        <b>
                          {t.provider === "iade" ? "İade" : t.provider === "admin" ? "Bakiye düzeltmesi" : t.kind === "topup" ? `Bakiye yükleme${t.provider ? " · " + (PROVIDER_LABEL[t.provider] || t.provider) : ""}` : "Sipariş ödemesi"}
                          {t.status === "pending" ? " · onay bekliyor" : t.status === "failed" ? " · başarısız" : ""}
                        </b>
                        <small>{t.note || ""}{t.note ? " · " : ""}{day(t.created_at)}</small>
                      </div>
                      <b className={t.kind === "topup" ? "pn-plus" : "pn-minus"} style={t.status === "failed" ? { textDecoration: "line-through", opacity: 0.6 } : undefined}>
                        {t.kind === "topup" ? "+" : "−"} {tl(Number(t.amount))}
                      </b>
                    </div>
                  ))
                )}
              </div>
            </>
          )}

          {ready && tab === "profile" && (
            <div className="pn-card">
              <div className="pn-form">
                <label>AD SOYAD<input className="pn-in" value={nameDraft} onChange={(e) => setNameDraft(e.target.value)} /></label>
                <label>E-POSTA<input className="pn-in" value={email} disabled /></label>
              </div>
              <button className="pn-btn" style={{ marginTop: 20 }} onClick={saveName} disabled={nameDraft.trim() === fullName}>KAYDET</button>
              {pmsg && <p className="pn-msg">{pmsg}</p>}
              <div style={{ marginTop: 22, paddingTop: 18, borderTop: "2px dashed #111", display: "flex", gap: 10, flexWrap: "wrap" }}>
                <a className="pn-btn w" href="/destek">DESTEK ↗</a>
                <button className="pn-btn w" onClick={logout}>ÇIKIŞ YAP</button>
              </div>
            </div>
          )}

          {ready && tab === "support" && (
            <div className="pn-card">
              <h2>Destek talebi oluştur</h2>
              <p style={{ color: "#686868", fontSize: 14, margin: "8px 0 18px", lineHeight: 1.6 }}>Siparişinle ilgili yazarken sipariş kodunu (örn. 7777-3-48213) eklemen işimizi hızlandırır.</p>
              <a className="pn-btn" href="/destek">DESTEK SAYFASINA GİT ↗</a>
            </div>
          )}
        </section>
      </div>

      <nav className="pn-mob" aria-label="Hesap menüsü">
        {MENU.filter((m) => m.id !== "support").map((m) => (
          <button key={m.id} className={tab === m.id ? "on" : ""} onClick={() => setTab(m.id)}>
            <i>{m.icon}</i>
            {m.label.split(" ")[0]}
          </button>
        ))}
      </nav>
    </main>
  );
}
