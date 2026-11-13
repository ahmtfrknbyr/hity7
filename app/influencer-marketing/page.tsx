"use client";

import { useEffect, useMemo, useRef, useState } from "react";
import Link from "next/link";
import { getSupabase } from "../../lib/supabase";
import { istekKimligi, sendOrder } from "../../lib/siparis";
import SozlesmeOnay from "../../components/SozlesmeOnay";
import { INFLUENCER_MAX, REELS, TIKTOK, TIKTOK_MIN, accountKey, minInfluencers } from "../../lib/influencer-kural";

type Creator = {
  id: string;
  name: string;
  username: string;
  followerCount: number;
  price: number;
  image: string;
  tiktokUrl: string;
  instagramUrl?: string;
  youtubeUrl?: string;
};

const SAMPLE_CREATORS: Creator[] = [
  { id: "ornek-1", name: "Creator 01", username: "@ornekcreator1", followerCount: 125000, price: 4500, image: "https://images.unsplash.com/photo-1534528741775-53994a69daeb?w=700", tiktokUrl: "https://www.tiktok.com/@ornekcreator1" },
  { id: "ornek-2", name: "Creator 02", username: "@ornekcreator2", followerCount: 86000, price: 3500, image: "https://images.unsplash.com/photo-1500648767791-00dcc994a43e?w=700", tiktokUrl: "https://www.tiktok.com/@ornekcreator2" },
  { id: "ornek-3", name: "Creator 03", username: "@ornekcreator3", followerCount: 210000, price: 7000, image: "https://images.unsplash.com/photo-1531123897727-8f129e1688ce?w=700", tiktokUrl: "https://www.tiktok.com/@ornekcreator3" },
  { id: "ornek-4", name: "Creator 04", username: "@ornekcreator4", followerCount: 6400, price: 3000, image: "https://images.unsplash.com/photo-1506794778202-cad84cf45f1d?w=700", tiktokUrl: "https://www.tiktok.com/@ornekcreator4" },
  { id: "ornek-5", name: "Creator 05", username: "@ornekcreator5", followerCount: 1340000, price: 9500, image: "https://images.unsplash.com/photo-1524504388940-b1c1722653e1?w=700", tiktokUrl: "https://www.tiktok.com/@ornekcreator5" },
  { id: "ornek-6", name: "Creator 06", username: "@ornekcreator6", followerCount: 92000, price: 4000, image: "https://images.unsplash.com/photo-1504593811423-6dd665756598?w=700", tiktokUrl: "https://www.tiktok.com/@ornekcreator6" },
];

type DbInfluencer = {
  id: string;
  name: string;
  username: string | null;
  followers: number | null;
  price: number | null;
  tiktok: string | null;
  instagram: string | null;
  youtube: string | null;
  photo_url: string | null;
};

function levelOf(count: number) {
  if (count <= 10000) return "NANO";
  if (count <= 100000) return "MİKRO";
  if (count <= 1000000) return "MAKRO";
  return "MEGA";
}

function fmtFollowers(count: number) {
  if (count >= 1000000) return `${(count / 1000000).toLocaleString("tr-TR", { maximumFractionDigits: 1 })}M`;
  if (count >= 1000) return `${(count / 1000).toLocaleString("tr-TR", { maximumFractionDigits: 1 })}K`;
  return count.toLocaleString("tr-TR");
}

const tl = (n: number) => n.toLocaleString("tr-TR") + " TL";

const CSS = `
.im-root { min-height:100vh; color:#111; font-family:Inter,"Helvetica Neue",Arial,sans-serif; background-color:#fff; background-image:radial-gradient(#d9d9d9 1.4px,transparent 1.5px); background-size:28px 28px; -webkit-font-smoothing:antialiased; }
.im-root *, .im-root *::before, .im-root *::after { box-sizing:border-box; }
.im-root :where(a) { color:inherit; text-decoration:none; }
.im-root :where(button,input,textarea) { font:inherit; color:inherit; }
.im-root :where(h1,h2,h3,p) { margin:0; }
.im-wrap { max-width:1360px; margin:0 auto; padding:0 24px; }
.im-header { position:sticky; top:0; z-index:20; background:rgba(255,255,255,.92); backdrop-filter:blur(8px); border-bottom:3px solid #111; }
.im-header-in { height:68px; display:flex; align-items:center; justify-content:space-between; gap:16px; }
.im-logo { font-size:26px; font-weight:900; letter-spacing:-1.5px; display:inline-flex; align-items:baseline; gap:3px; }
.im-dot { width:9px; height:9px; border-radius:50%; background:#f5c518; border:2px solid #111; display:inline-block; }
.im-nav { display:flex; gap:22px; }
.im-nav a { font-size:11px; font-weight:800; letter-spacing:1px; color:#686868; padding:6px 0; }
.im-nav a.on, .im-nav a:hover { color:#111; box-shadow:0 3px 0 #f5c518; }
.im-acc { border:2.5px solid #111; border-radius:999px; padding:9px 16px; font-size:11px; font-weight:800; letter-spacing:.8px; background:#fff; }
.im-acc:hover { background:#f5c518; }
.im-hero { padding:64px 0 40px; display:flex; align-items:flex-end; justify-content:space-between; gap:28px; flex-wrap:wrap; }
.im-pill { display:inline-block; border:2px solid #111; border-radius:999px; padding:6px 14px; font-size:11px; font-weight:800; letter-spacing:.14em; background:#fff; }
.im-hero h1 { font-size:clamp(52px,9vw,112px); line-height:.9; letter-spacing:-.05em; font-weight:900; margin:22px 0 18px; }
.im-hero h1 span { background:#f5c518; padding:0 .12em; border:3px solid #111; border-radius:18px; display:inline-block; transform:rotate(-1.5deg); }
.im-hero p { max-width:460px; color:#686868; font-size:16px; line-height:1.7; }
.im-count { border:3px solid #111; border-radius:28px; background:#fff; padding:18px 28px; box-shadow:0 7px 0 #111; text-align:center; }
.im-count strong { display:block; font-size:44px; letter-spacing:-.04em; line-height:1; }
.im-count span { font-size:10px; font-weight:800; letter-spacing:.14em; color:#686868; }
.im-layout { display:grid; grid-template-columns:minmax(0,1fr) 400px; gap:28px; align-items:start; padding-bottom:90px; }
.im-sec-title { display:flex; align-items:end; justify-content:space-between; gap:12px; margin-bottom:18px; }
.im-sec-title h2 { font-size:30px; letter-spacing:-.04em; font-weight:900; }
.im-sec-title small { font-size:11px; font-weight:800; letter-spacing:.12em; color:#686868; }
.im-grid { display:grid; grid-template-columns:repeat(auto-fill,minmax(210px,1fr)); gap:18px; }
.im-card { background:#fff; border:3px solid #111; border-radius:26px; overflow:hidden; display:flex; flex-direction:column; transition:transform .15s, box-shadow .15s; }
.im-card:hover { transform:translateY(-3px); box-shadow:0 8px 0 #111; }
.im-card.sel { background:#fff9db; box-shadow:0 6px 0 #f5c518, 0 0 0 3px #111; }
.im-photo { position:relative; aspect-ratio:1/1; background:#f5f5f5 center/cover no-repeat; border-bottom:3px solid #111; display:grid; place-items:center; font-size:46px; font-weight:900; color:#d0d0d0; }
.im-photo img { position:absolute; inset:0; width:100%; height:100%; object-fit:cover; display:block; }
.im-lvl { position:absolute; left:10px; top:10px; background:#111; color:#f5c518; font-size:10px; font-weight:900; letter-spacing:.1em; padding:6px 10px; border-radius:999px; }
.im-chk { color:#111; position:absolute; right:10px; top:10px; background:#f5c518; border:2px solid #111; font-size:10px; font-weight:900; letter-spacing:.08em; padding:5px 9px; border-radius:999px; }
.im-body { padding:14px 14px 16px; display:flex; flex-direction:column; gap:12px; flex:1; }
.im-name { display:flex; justify-content:space-between; gap:8px; }
.im-name h3 { font-size:17px; font-weight:800; letter-spacing:-.03em; }
.im-name span { font-size:12px; color:#686868; overflow-wrap:anywhere; }
.im-fol { text-align:right; flex:none; }
.im-fol strong { display:block; font-size:17px; font-weight:800; }
.im-fol small { font-size:9px; letter-spacing:.1em; color:#686868; font-weight:700; }
.im-price { display:flex; align-items:center; justify-content:space-between; gap:8px; border:2.5px solid #111; border-radius:16px; padding:8px 8px 8px 14px; background:#f5f5f5; }
.im-price b { font-size:20px; letter-spacing:-.04em; font-weight:900; }
.im-price small { display:block; font-size:9px; letter-spacing:.1em; color:#686868; font-weight:700; }
.im-btn { border:2.5px solid #111; border-radius:999px; background:#f5c518; font-size:12px; font-weight:800; padding:10px 16px; cursor:pointer; box-shadow:0 3px 0 #111; transition:transform .1s, box-shadow .1s; }
.im-btn:hover { transform:translateY(-1px); box-shadow:0 5px 0 #111; }
.im-btn:active { transform:translateY(2px); box-shadow:0 1px 0 #111; }
.im-btn.rm { background:#fff; }
.im-socials { display:flex; gap:6px; flex-wrap:wrap; }
.im-soc { flex:1; min-width:0; text-align:center; border:2px solid #111; border-radius:999px; padding:7px 4px; font-size:10px; font-weight:800; letter-spacing:.04em; background:#fff; }
.im-soc:hover { background:#111; color:#f5c518; }
.im-side { position:sticky; top:92px; background:#fff; border:3px solid #111; border-radius:30px; padding:26px; box-shadow:0 9px 0 #111; }
.im-side h2 { font-size:30px; letter-spacing:-.04em; font-weight:900; margin:12px 0 6px; }
.im-side > p { color:#686868; font-size:14px; line-height:1.6; }
.im-lab { display:block; font-size:11px; font-weight:800; letter-spacing:.12em; margin:20px 0 8px; }
.im-opts { display:grid; grid-template-columns:1fr 1fr; gap:10px; }
.im-opt { text-align:left; border:2.5px solid #111; border-radius:18px; background:#fff; padding:12px; cursor:pointer; display:flex; flex-direction:column; gap:3px; }
.im-opt.on { background:#f5c518; box-shadow:0 4px 0 #111; }
.im-opt strong { font-size:13px; }
.im-opt small { font-size:10px; color:#444; line-height:1.4; }
.im-note { font-size:12px; color:#686868; line-height:1.6; margin-top:10px; }
.im-in { width:100%; border:2.5px solid #111; border-radius:16px; background:#fff; padding:13px 15px; font-size:15px; outline:none; }
.im-in:focus { background:#fffdf2; box-shadow:0 0 0 4px #f5c518; }
textarea.im-in { resize:vertical; }
.im-sum { margin-top:22px; border-top:2.5px dashed #111; padding-top:16px; }
.im-line { display:flex; justify-content:space-between; gap:10px; font-size:14px; padding:5px 0; }
.im-line span { color:#686868; }
.im-total { display:flex; justify-content:space-between; align-items:baseline; margin-top:10px; padding:14px 16px; background:#111; color:#f5c518; border-radius:18px; }
.im-total span { font-size:12px; font-weight:800; letter-spacing:.1em; }
.im-total strong { font-size:30px; letter-spacing:-.04em; }
.im-submit { width:100%; margin-top:16px; padding:17px; font-size:14px; }
.im-submit:disabled { opacity:.55; cursor:not-allowed; }
.im-msg { margin-top:14px; border:2.5px solid #111; border-radius:16px; background:#fff6cf; padding:12px 14px; font-size:13px; line-height:1.6; font-weight:600; }
.im-foot { border-top:3px solid #111; background:#fff; }
.im-foot-in { display:flex; justify-content:space-between; gap:12px; flex-wrap:wrap; padding:26px 24px; font-size:11px; font-weight:700; letter-spacing:.1em; color:#686868; }
.im-count.ok { background:#f5c518; }
.im-count em { font-style:normal; font-size:22px; color:#686868; letter-spacing:-.02em; }
.im-count.ok em { color:#111; }
.im-tt { position:relative; overflow:hidden; display:grid; grid-template-columns:minmax(0,1fr) 340px; gap:28px; align-items:center; margin:0 0 44px; padding:30px 32px; background:#111; color:#fff; border:3px solid #111; border-radius:32px; box-shadow:0 9px 0 #f5c518; animation:imIn .7s cubic-bezier(.16,1,.3,1) both; }
.im-tt::after { content:""; position:absolute; right:-90px; top:-90px; width:280px; height:280px; border-radius:50%; background:radial-gradient(circle,rgba(245,197,24,.26),rgba(245,197,24,0) 70%); pointer-events:none; }
.im-tt-eye { display:inline-flex; align-items:center; gap:8px; border:2px solid #f5c518; color:#f5c518; border-radius:999px; padding:6px 12px; font-size:10.5px; font-weight:800; letter-spacing:.14em; }
.im-tt h2 { font-size:clamp(34px,5.4vw,66px); line-height:.95; letter-spacing:-.05em; font-weight:900; margin:16px 0 14px; }
.im-tt h2 span { color:#f5c518; }
.im-tt p { color:#cfcfcf; font-size:15px; line-height:1.65; max-width:640px; }
.im-tt p b { color:#fff; }
.im-tt-rules { display:flex; flex-wrap:wrap; gap:8px; margin-top:16px; }
.im-tt-rules span { border:1.5px solid rgba(255,255,255,.3); border-radius:999px; padding:6px 11px; font-size:11.5px; font-weight:700; color:#eee; }
.im-tt-meter { position:relative; z-index:1; background:#fff; color:#111; border:3px solid #111; border-radius:26px; padding:20px; box-shadow:0 0 0 3px #f5c518; }
.im-tt-meter small { display:block; font-size:10.5px; font-weight:800; letter-spacing:.14em; color:#686868; }
.im-tt-num { display:flex; align-items:baseline; gap:4px; margin:8px 0 12px; font-weight:900; letter-spacing:-.05em; }
.im-tt-num strong { font-size:64px; line-height:.9; }
.im-tt-num span { font-size:28px; color:#686868; }
.im-bar { height:14px; border:2.5px solid #111; border-radius:999px; background:#f5f5f5; overflow:hidden; }
.im-bar i { display:block; height:100%; background:#f5c518; box-shadow:2.5px 0 0 #111; transition:width .45s cubic-bezier(.2,.8,.2,1); }
.im-tt-status { margin-top:12px; font-size:13px; font-weight:700; line-height:1.5; }
.im-tt .im-tt-meter p { color:#111; }
.im-tt .im-tt-meter .im-note { color:#686868; font-weight:500; }
.im-tt-add { margin-top:12px; width:100%; }
.im-card.dup { opacity:.55; }
.im-dup { position:absolute; right:10px; top:10px; background:#fff; color:#111; border:2px solid #111; font-size:10px; font-weight:900; letter-spacing:.06em; padding:5px 9px; border-radius:999px; }
.im-btn:disabled { opacity:.5; cursor:not-allowed; transform:none; box-shadow:0 3px 0 #111; }
.im-req { margin-top:16px; border:2.5px solid #111; border-radius:18px; padding:14px; background:#fff6cf; transition:background .3s ease; }
.im-req.ok { background:#f5c518; }
.im-req-top { display:flex; justify-content:space-between; align-items:baseline; gap:10px; font-size:11px; font-weight:800; letter-spacing:.1em; }
.im-req-top b { font-size:22px; letter-spacing:-.03em; }
.im-req .im-bar { margin-top:10px; height:10px; background:#fff; }
.im-req p { margin-top:8px; font-size:12.5px; line-height:1.5; font-weight:600; }
@keyframes imIn { from { opacity:0; transform:translateY(12px); } to { opacity:1; transform:none; } }
@media (max-width:1020px) { .im-layout { grid-template-columns:1fr; } .im-side { position:static; order:-1; } .im-tt { grid-template-columns:1fr; } }
@media (max-width:640px) { .im-nav { display:none; } .im-wrap { padding:0 16px; } .im-hero { padding:40px 0 26px; } .im-grid { grid-template-columns:repeat(2,minmax(0,1fr)); gap:12px; } .im-opts { grid-template-columns:1fr; } .im-body { padding:10px; } .im-name { flex-direction:column; } .im-fol { text-align:left; } .im-price b { font-size:16px; } .im-btn { padding:9px 11px; font-size:11px; } .im-tt { padding:22px 18px; border-radius:26px; gap:18px; margin-bottom:32px; } .im-tt-num strong { font-size:52px; } }
@media (prefers-reduced-motion:reduce) { .im-card, .im-btn, .im-tt, .im-bar i, .im-req { transition:none; animation:none; } }
`;

export default function InfluencerMarketingPage() {
  const [campaignTypes, setCampaignTypes] = useState<string[]>(["TikTok Video"]);
  const [selected, setSelected] = useState<string[]>([]);
  const [creators, setCreators] = useState<Creator[]>(SAMPLE_CREATORS);
  const [isSample, setIsSample] = useState(true);
  const [link, setLink] = useState("");
  const [name, setName] = useState("");
  const [contact, setContact] = useState("");
  const [brief, setBrief] = useState("");
  const [notice, setNotice] = useState("");
  const [sending, setSending] = useState(false);
  const [onay, setOnay] = useState(false);
  const [doneCode, setDoneCode] = useState("");
  // Tekrar koruması: aynı kampanya yeniden gönderilirse ikinci kez ücretlendirilmez
  const istekRef = useRef<{ key: string; sig: string } | null>(null);

  // Panelden eklenen gerçek influencerlar (yoksa örnek profiller görünür)
  useEffect(() => {
    const sb = getSupabase();
    if (!sb) return;
    sb.from("influencers")
      .select("id,name,username,followers,price,tiktok,instagram,youtube,photo_url")
      .eq("active", true)
      .order("sort", { ascending: true })
      .then(({ data, error }) => {
        if (error || !data || !data.length) return;
        setCreators(
          (data as DbInfluencer[]).map(d => ({
            id: d.id,
            name: d.name,
            username: d.username ? (d.username.startsWith("@") ? d.username : "@" + d.username) : "",
            followerCount: Number(d.followers) || 0,
            price: Number(d.price) || 0,
            image: d.photo_url || "",
            tiktokUrl: d.tiktok || "",
            instagramUrl: d.instagram || "",
            youtubeUrl: d.youtube || "",
          }))
        );
        setIsSample(false);
        setSelected([]);
      });
  }, []);

  const selectedCreators = creators.filter(c => selected.includes(c.id));
  const total = useMemo(() => selectedCreators.reduce((sum, c) => sum + c.price, 0), [selectedCreators]);

  // Kampanya kuralı (sunucuda da aynısı uygulanır): TikTok'ta en az 30 FARKLI hesap; aynı hesap iki kez seçilemez
  const accountOf = (c: Creator) => accountKey({ id: c.id, tiktok: c.tiktokUrl, username: c.username });
  const selectedAccounts = new Set(selectedCreators.map(accountOf));
  const count = selectedAccounts.size;
  const tiktokOn = campaignTypes.includes(TIKTOK);
  const need = minInfluencers(campaignTypes);
  const missing = Math.max(0, need - count);
  const availableAccounts = new Set(creators.map(accountOf)).size;
  const pct = Math.min(100, Math.round((count / TIKTOK_MIN) * 100));

  const toggleCampaign = (type: string) =>
    setCampaignTypes(cur => (cur.includes(type) ? cur.filter(t => t !== type) : [...cur, type]));

  const toggleCreator = (c: Creator) => {
    setNotice("");
    if (selected.includes(c.id)) return setSelected(cur => cur.filter(x => x !== c.id));
    if (selectedAccounts.has(accountOf(c))) {
      return setNotice(`${c.username || c.name} hesabı zaten seçili. Aynı hesap bir kampanyada iki kez yer alamaz.`);
    }
    if (selected.length >= INFLUENCER_MAX) return setNotice(`Bir kampanyada en fazla ${INFLUENCER_MAX} influencer seçebilirsin.`);
    setSelected(cur => (cur.includes(c.id) ? cur : [...cur, c.id]));
  };

  const submitOrder = async () => {
    if (!campaignTypes.length) return setNotice("Lütfen TikTok Video veya Instagram Reels seç.");
    if (!selected.length) return setNotice("Lütfen en az bir influencer seç.");
    if (tiktokOn && count < TIKTOK_MIN) return setNotice(`TikTok kampanyası için en az ${TIKTOK_MIN} farklı influencer seçmelisin. Şu an ${count}/${TIKTOK_MIN}.`);
    if (!/^https?:\/\/\S+\.\S+/i.test(link.trim())) return setNotice("Lütfen tanıtılacak içeriğin linkini gir (https:// ile başlamalı).");
    if (!name.trim() || !contact.trim()) return setNotice("Lütfen adını ve iletişim bilgini (e-posta veya telefon) yaz.");
    if (isSample) return setNotice("Gerçek influencerlar henüz eklenmemiş; sipariş şimdilik gönderilemez.");
    if (!onay) return setNotice("Siparişi oluşturmak için sözleşme onay kutusunu işaretle.");

    setSending(true);
    setNotice("");
    try {
      const istekId = istekKimligi(istekRef, JSON.stringify([[...campaignTypes].sort(), [...selected].sort(), link.trim()]));
      const r = await sendOrder({
        type: "influencer",
        accept: onay,
        istekId,
        name: name.trim(),
        contact: contact.trim(),
        details: [],
        link: link.trim(),
        brief: brief.trim(),
        campaignTypes,
        influencerIds: selected,
      });
      if (!r.ok) setNotice(r.error || "Sipariş gönderilemedi. Lütfen tekrar dene.");
      else {
        istekRef.current = null;
        setDoneCode(r.code || "");
        setSelected([]);
        setLink("");
        setBrief("");
        setOnay(false);
      }
    } catch {
      setNotice("Bağlantı hatası. Lütfen tekrar dene.");
    }
    setSending(false);
  };

  return (
    <main className="im-root">
      <style dangerouslySetInnerHTML={{ __html: CSS }} />


      <div className="im-wrap">
        <section className="im-hero">
          <div>
            <span className="im-pill">HITY7 / CREATOR MARKETPLACE</span>
            <h1>ETKİYİ<br /><span>BAŞLAT.</span></h1>
            <p>Projeni doğru içerik üreticileriyle buluştur. Influencer’larını seç, linkini ekle, siparişini oluştur.</p>
          </div>
          <div className={`im-count ${tiktokOn && count >= TIKTOK_MIN ? "ok" : ""}`} aria-live="polite">
            <strong>
              {String(count).padStart(2, "0")}
              {tiktokOn && <em>/{TIKTOK_MIN}</em>}
            </strong>
            <span>{tiktokOn ? "TIKTOK İÇİN SEÇİLEN" : "SEÇİLEN INFLUENCER"}</span>
          </div>
        </section>

        <section className="im-tt" aria-labelledby="im-tt-baslik">
          <div style={{ position: "relative", zIndex: 1 }}>
            <span className="im-tt-eye">♪ TIKTOK KAMPANYASI · MİNİMUM {TIKTOK_MIN} INFLUENCER</span>
            <h2 id="im-tt-baslik">
              TIKTOK’TA <span>AKIM</span> BAŞLAT!
            </h2>
            <p>
              Bir içeriğin TikTok’ta akıma dönüşmesi için aynı dönemde çok sayıda farklı hesapta yayınlanması gerekir. Bu yüzden TikTok
              Video kampanyaları <b>en az {TIKTOK_MIN} farklı influencer</b> ile oluşturulur; {TIKTOK_MIN} hesap seçilmeden sipariş
              verilemez.
            </p>
            <div className="im-tt-rules">
              <span>✓ En az {TIKTOK_MIN} farklı hesap</span>
              <span>✓ Aynı hesap iki kez seçilemez</span>
              <span>✓ Instagram Reels için en az 1 hesap yeterli</span>
            </div>
          </div>
          <div className="im-tt-meter" aria-live="polite">
            <small>{tiktokOn ? "TIKTOK İÇİN SEÇİLEN" : "TIKTOK SEÇİLİ DEĞİL"}</small>
            <div className="im-tt-num">
              <strong>{count}</strong>
              <span>/{TIKTOK_MIN}</span>
            </div>
            <div
              className="im-bar"
              role="progressbar"
              aria-label="TikTok için seçilen influencer"
              aria-valuemin={0}
              aria-valuemax={TIKTOK_MIN}
              aria-valuenow={Math.min(count, TIKTOK_MIN)}
            >
              <i style={{ width: `${pct}%` }} />
            </div>
            <p className="im-tt-status">
              {!tiktokOn
                ? `Şu an yalnızca Instagram Reels seçili. TikTok Video eklersen en az ${TIKTOK_MIN} farklı influencer gerekir.`
                : count >= TIKTOK_MIN
                  ? "✓ Minimum sağlandı. TikTok kampanyan siparişe hazır."
                  : `${TIKTOK_MIN - count} farklı influencer daha seçmelisin.`}
            </p>
            {tiktokOn && availableAccounts < TIKTOK_MIN && (
              <p className="im-note" style={{ marginTop: 8 }}>
                {isSample
                  ? "Şu an örnek profiller gösteriliyor. Gerçek influencerlar eklendiğinde TikTok kampanyası oluşturabilirsin."
                  : `Listede şu an ${availableAccounts} farklı hesap var. ${TIKTOK_MIN} hesaba ulaşıldığında TikTok kampanyası oluşturulabilir.`}
              </p>
            )}
            {!tiktokOn && (
              <button type="button" className="im-btn im-tt-add" onClick={() => toggleCampaign(TIKTOK)}>
                TIKTOK VIDEO EKLE +
              </button>
            )}
          </div>
        </section>

        <div className="im-layout">
          <section>
            <div className="im-sec-title">
              <h2>Influencer’lar</h2>
              <small>{String(creators.length).padStart(2, "0")} CREATOR</small>
            </div>

            <div className="im-grid">
              {creators.map(c => {
                const on = selected.includes(c.id);
                // Aynı hesap başka bir kayıtla zaten seçiliyse bu kart seçilemez
                const dup = !on && selectedAccounts.has(accountOf(c));
                return (
                  <article key={c.id} className={`im-card ${on ? "sel" : ""} ${dup ? "dup" : ""}`}>
                    <div className="im-photo">
                      {c.image ? <img src={c.image} alt={c.name} loading="lazy" /> : c.name.slice(0, 1).toUpperCase()}
                      <span className="im-lvl">{levelOf(c.followerCount)}</span>
                      {on && <span className="im-chk">SEÇİLDİ ✓</span>}
                      {dup && <span className="im-dup">AYNI HESAP SEÇİLİ</span>}
                    </div>
                    <div className="im-body">
                      <div className="im-name">
                        <div>
                          <h3>{c.name}</h3>
                          <span>{c.username}</span>
                        </div>
                        <div className="im-fol">
                          <strong>{fmtFollowers(c.followerCount)}</strong>
                          <small>TAKİPÇİ</small>
                        </div>
                      </div>

                      <div className="im-price">
                        <div>
                          <b>{tl(c.price)}</b>
                          <small>{isSample ? "ÖRNEK ÜCRET" : "PAYLAŞIM ÜCRETİ"}</small>
                        </div>
                        <button
                          type="button"
                          className={`im-btn ${on ? "rm" : ""}`}
                          onClick={() => toggleCreator(c)}
                          disabled={dup}
                          aria-pressed={on}
                          title={dup ? "Bu hesap başka bir kayıtla zaten seçili" : undefined}
                        >
                          {on ? "ÇIKAR −" : dup ? "SEÇİLİ HESAP" : "SEÇ +"}
                        </button>
                      </div>

                      {(c.tiktokUrl || c.instagramUrl || c.youtubeUrl) && (
                        <div className="im-socials">
                          {c.tiktokUrl && <a className="im-soc" href={c.tiktokUrl} target="_blank" rel="noopener noreferrer">♪ TikTok</a>}
                          {c.instagramUrl && <a className="im-soc" href={c.instagramUrl} target="_blank" rel="noopener noreferrer">◎ Instagram</a>}
                          {c.youtubeUrl && <a className="im-soc" href={c.youtubeUrl} target="_blank" rel="noopener noreferrer">▶ YouTube</a>}
                        </div>
                      )}
                    </div>
                  </article>
                );
              })}
            </div>
            {isSample && <p className="im-note" style={{ marginTop: 18 }}>Fotoğraflar ve profiller şimdilik örnek veridir. Gerçek influencerlar admin panelinden eklenince burada görünür.</p>}
          </section>

          <aside className="im-side">
            <span className="im-pill">SİPARİŞ OLUŞTUR</span>
            <h2>Kampanyan</h2>
            <p>Paylaşım türünü seç, linkini ekle. Tutar, seçtiğin influencer’ların ücretlerinin toplamıdır.</p>

            <label className="im-lab">PAYLAŞIM TÜRÜ</label>
            <div className="im-opts">
              {["TikTok Video", "Instagram Reels"].map(t => (
                <button key={t} type="button" className={`im-opt ${campaignTypes.includes(t) ? "on" : ""}`} onClick={() => toggleCampaign(t)}>
                  <strong>{campaignTypes.includes(t) ? "✓ " : ""}{t}</strong>
                  <small>{t === "TikTok Video" ? "TikTok’ta video paylaşımı" : "Instagram’da Reels paylaşımı"}</small>
                </button>
              ))}
            </div>
            <p className="im-note">Bazı TikTok içerik üreticileri Reels paylaşmayabilir. Sipariş öncesi influencer’ın seçtiğin platformda paylaşım yaptığını kontrol et.</p>

            <label className="im-lab" htmlFor="im-link">TANITILACAK İÇERİK LİNKİ</label>
            <input id="im-link" className="im-in" type="url" placeholder="Şarkı, video veya profil linki (https://…)" value={link} onChange={e => setLink(e.target.value)} />

            <label className="im-lab" htmlFor="im-name">ADIN SOYADIN</label>
            <input id="im-name" className="im-in" type="text" placeholder="Adın Soyadın" value={name} onChange={e => setName(e.target.value)} />

            <label className="im-lab" htmlFor="im-contact">E-POSTA VEYA TELEFON</label>
            <input id="im-contact" className="im-in" type="text" placeholder="Sana ulaşabilmemiz için" value={contact} onChange={e => setContact(e.target.value)} />

            <label className="im-lab" htmlFor="im-brief">KAMPANYA DETAYI (isteğe bağlı)</label>
            <textarea id="im-brief" className="im-in" rows={3} placeholder="Tanıtılacak şarkı, ürün veya kampanya hakkında bilgi yaz…" value={brief} onChange={e => setBrief(e.target.value)} />

            <div className="im-sum">
              <div className="im-line"><span>Paylaşım türü</span><strong>{campaignTypes.length ? campaignTypes.join(" + ") : "—"}</strong></div>
              <div className="im-line">
                <span>Influencer sayısı</span>
                <strong>{tiktokOn ? `${count} / ${TIKTOK_MIN}` : count}</strong>
              </div>
              {selectedCreators.map(c => (
                <div className="im-line" key={c.id}><span>{c.name}</span><strong>{tl(c.price)}</strong></div>
              ))}
              <div className="im-total"><span>TOPLAM</span><strong>{tl(total)}</strong></div>
            </div>

            {doneCode ? (
              <p className="im-msg">
                <strong>Siparişin alındı ✓</strong><br />
                Sipariş kodun: <strong>{doneCode}</strong><br />
                Destek ekibiyle yazışırken bu kodu kullanabilirsin.
              </p>
            ) : (
              <>
                {tiktokOn && (
                  <div className={`im-req ${count >= TIKTOK_MIN ? "ok" : ""}`} aria-live="polite">
                    <div className="im-req-top">
                      <span>TIKTOK MİNİMUMU</span>
                      <b>
                        {count}/{TIKTOK_MIN}
                      </b>
                    </div>
                    <div className="im-bar" aria-hidden="true">
                      <i style={{ width: `${pct}%` }} />
                    </div>
                    <p>
                      {count >= TIKTOK_MIN
                        ? `✓ ${count} farklı hesap seçildi (en az ${TIKTOK_MIN}). Siparişi oluşturabilirsin.`
                        : `TikTok kampanyası için ${TIKTOK_MIN - count} farklı influencer daha seçmelisin. Aynı hesap iki kez sayılmaz.`}
                    </p>
                  </div>
                )}
                <SozlesmeOnay tur="siparis" checked={onay} onChange={setOnay} />
                <button
                  type="button"
                  className="im-btn im-submit"
                  onClick={submitOrder}
                  disabled={sending || missing > 0}
                  title={missing > 0 ? (tiktokOn ? `TikTok için en az ${TIKTOK_MIN} farklı influencer seçmelisin` : "En az 1 influencer seç") : undefined}
                >
                  {sending
                    ? "GÖNDERİLİYOR…"
                    : missing > 0
                      ? tiktokOn
                        ? `${missing} INFLUENCER DAHA SEÇ (${count}/${TIKTOK_MIN})`
                        : "EN AZ 1 INFLUENCER SEÇ"
                      : "SİPARİŞİ OLUŞTUR ↗"}
                </button>
                {!tiktokOn && campaignTypes.includes(REELS) && (
                  <p className="im-note">Yalnızca Instagram Reels kampanyalarında {TIKTOK_MIN} influencer şartı yoktur; 1 influencer yeterlidir.</p>
                )}
              </>
            )}
            {notice && <p className="im-msg" role="alert">{notice}</p>}
          </aside>
        </div>
      </div>

      <footer className="im-foot">
        <div className="im-wrap im-foot-in">
          <Link href="/" className="im-logo">HITY7<span className="im-dot" /></Link>
          <span>DIGITAL CULTURE / 2026</span>
          <span>CREATE YOUR IMPACT.</span>
        </div>
      </footer>
    </main>
  );
}
