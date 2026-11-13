
"use client";

import { useRef, useState } from "react";
import { uploadOrderFiles } from "../../lib/siparis";
import { useSiteContent } from "../../lib/use-site-content";
import EkHizmetKarti from "../../components/EkHizmetKarti";
import { addMain, addonKey, currentUserId, mainKey, openCart, releaseFiles, useCart, type CartAddon, type CartMain } from "../../lib/sepet";
import { addonFor } from "../../lib/sepet-hesap";

// Fiyatlar yönetim panelindeki "Sipariş fiyatları"ndan gelir; buradaki değerler yalnızca varsayılandır.
const options = [
  { id: "free", name: "FREE BEAT", price: 0, description: "Hazır beat seçimi", tag: "ÜCRETSİZ", notes: [110, 130, 146, 130] },
  { id: "birebir", name: "BİREBİR REMAKE", price: 3000, description: "Referans parçaya yakın altyapı", tag: "CLASSIC", notes: [98, 110, 123, 110] },
  { id: "modern", name: "MODERN REMAKE", price: 4000, description: "Güncel sound ve modern prodüksiyon", tag: "MODERN", notes: [130, 146, 164, 146] },
  { id: "ozgun", name: "ÖZGÜN REMAKE", price: 5000, description: "Özgün dokunuşlarla yeniden tasarlanan altyapı", tag: "PREMIUM", notes: [146, 164, 185, 164] },
];

export default function RemakeBeatPage() {
  const [selected, setSelected] = useState("ozgun");
  const [songName, setSongName] = useState("");
  const [artistName, setArtistName] = useState("");
  const [notes, setNotes] = useState("");
  const [file, setFile] = useState<File | null>(null);
  const [playing, setPlaying] = useState<string | null>(null);
  const [added, setAdded] = useState<"" | "added" | "replaced">("");
  const [notice, setNotice] = useState("");
  const [needLogin, setNeedLogin] = useState(false);
  const [sending, setSending] = useState(false);
  const audioRef = useRef<AudioContext | null>(null);

  const content = useSiteContent();
  const pricing = content.pricing.remake;
  const priceOf = (id: string) => Number(pricing[id as keyof typeof pricing] ?? options.find((o) => o.id === id)?.price ?? 0);
  const fileName = file?.name || "";
  const activeOption = { ...options.find((item) => item.id === selected)!, price: priceOf(selected) };

  // Sepet: bu hizmet sepette mi, yanında ek hizmet var mı (fiyatlar güncel içerikten)
  const cart = useCart();
  const inCart = cart.lines.find((l): l is CartMain => l.key === mainKey("remake")) || null;
  const addonLine = cart.lines.find((l): l is CartAddon => l.key === addonKey("remake")) || null;
  const addonItem = addonLine ? addonFor(content, "remake", addonLine.addonId) : null;
  const addonTotal = addonItem && addonLine ? addonItem.price * addonLine.qty : 0;
  const total = activeOption.price + addonTotal;

  const playOption = async (item: typeof options[number]) => {
    if (playing === item.id) {
      setPlaying(null);
      return;
    }

    try {
      const AudioContextClass =
        window.AudioContext ||
        (window as typeof window & { webkitAudioContext?: typeof AudioContext }).webkitAudioContext;

      if (!AudioContextClass) return;

      const context = audioRef.current || new AudioContextClass();
      audioRef.current = context;

      if (context.state === "suspended") await context.resume();

      setPlaying(item.id);
      const start = context.currentTime;

      item.notes.forEach((frequency, index) => {
        const oscillator = context.createOscillator();
        const gain = context.createGain();

        oscillator.type = "triangle";
        oscillator.frequency.setValueAtTime(frequency, start + index * 0.35);

        gain.gain.setValueAtTime(0.0001, start + index * 0.35);
        gain.gain.exponentialRampToValueAtTime(0.12, start + index * 0.35 + 0.03);
        gain.gain.exponentialRampToValueAtTime(0.0001, start + index * 0.35 + 0.3);

        oscillator.connect(gain);
        gain.connect(context.destination);

        oscillator.start(start + index * 0.35);
        oscillator.stop(start + index * 0.35 + 0.32);
      });

      window.setTimeout(() => {
        setPlaying((current) => current === item.id ? null : current);
      }, 1700);
    } catch {
      setPlaying(null);
    }
  };

  /**
   * Hizmeti sepete ekler (sepette varsa bu formla günceller; aynı hizmet iki kez eklenmez).
   * Sipariş ve ödeme sepette yapılır: sözleşme onayı, bakiye kontrolü ve tek seferde bakiye düşümü.
   */
  const handleAdd = async () => {
    setNotice("");
    setNeedLogin(false);
    setAdded("");
    if (!songName.trim()) return setNotice("Lütfen şarkı / referans adını yaz.");
    setSending(true);
    try {
      const owner = await currentUserId();
      if (file && !owner) {
        setNeedLogin(true);
        setNotice("Referans dosyasını eklemek için giriş yapmalısın. Dosyasız da sepete ekleyebilirsin.");
        setSending(false);
        return;
      }
      // Yeni dosya seçilmediyse sepetteki referans dosyası korunur
      const files = file ? await uploadOrderFiles([file], { kind: "reference" }) : inCart?.order.files || [];
      const r = addMain(
        "remake",
        {
          optionId: selected,
          songName: songName.trim(),
          artistName: artistName.trim() || undefined,
          details: notes.trim() ? [["Proje notu", notes.trim()]] : [],
          files,
        },
        [songName.trim(), artistName.trim()].filter(Boolean).join(" · ") + (files.length ? " · referans dosyası" : ""),
        { replace: true, owner }
      );
      // Değiştirilen eski referans dosyası depodan silinir
      if (r.previous && file) releaseFiles(r.previous.order.files.filter((f) => !files.some((n) => n.url === f.url)));
      setAdded(r.result === "replaced" ? "replaced" : "added");
      setFile(null);
      openCart();
    } catch (e) {
      setNotice(e instanceof Error ? e.message : "Dosya yüklenemedi. Lütfen tekrar dene.");
    }
    setSending(false);
  };

  return (
    <main className="dots min-h-screen bg-white text-[#111]">
      <link rel="preconnect" href="https://fonts.googleapis.com" />
      <link rel="preconnect" href="https://fonts.gstatic.com" crossOrigin="" />
      <link
        href="https://fonts.googleapis.com/css2?family=Bricolage+Grotesque:opsz,wght@12..96,700;12..96,800&family=Inter:wght@400;500;600;700&display=swap"
        rel="stylesheet"
      />
      <style jsx global>{`
        * { box-sizing: border-box; }
        body { margin: 0; }
        button, input, textarea { font: inherit; }
        .editorial { font-family: "Inter", system-ui, -apple-system, "Segoe UI", Roboto, Arial, sans-serif; -webkit-font-smoothing: antialiased; }
        .hd { font-family: "Bricolage Grotesque", "Helvetica Neue", Arial, sans-serif; }
        .dots { background-color: #ffffff; background-image: radial-gradient(#d9d9d9 1.4px, transparent 1.5px); background-size: 28px 28px; }
        .option-card { transition: transform .15s ease, box-shadow .15s ease, background .2s ease; }
        .option-card:hover { transform: translateY(-2px); box-shadow: 0 4px 0 #111; }
        .option-card.active { border-color: #111; background: #f5c518; box-shadow: 0 4px 0 #111; transform: translateY(-2px); }
        .field:focus { background: #fffdf2; box-shadow: 0 0 0 4px #f5c518; }
        .editorial :focus-visible { outline: 3px solid #111; outline-offset: 3px; }
        @media (prefers-reduced-motion: reduce) { .option-card { transition: none; } }
      `}</style>

      <div className="editorial mx-auto max-w-[1440px] px-4 pb-20 pt-6 md:px-10">
        <section className="grid gap-8 pb-10 pt-12 lg:grid-cols-[1fr_430px] lg:items-start">
          <div>
            <div className="mb-5 inline-flex items-center gap-2.5 rounded-full border-[2.5px] border-[#111] bg-white px-3.5 py-1.5 text-[12px] font-bold tracking-[0.14em]">
              <span className="h-[9px] w-[9px] rounded-full border-2 border-[#111] bg-[#f5c518]" /> HITY7 / REMAKE BEAT
            </div>
            <h1 className="hd max-w-3xl text-[44px] font-extrabold leading-[0.98] tracking-[-0.045em] md:text-7xl">
              SOUNDUNU<br />YENİDEN <span className="underline decoration-[#f5c518] decoration-wavy decoration-[0.09em] underline-offset-[0.14em]">YARAT.</span>
            </h1>
            <p className="mt-5 max-w-xl text-base leading-7 text-[#686868]">
              İstediğin hizmeti seç. Projeni oluştur. Müziğini 24 saat içinde teslim al.
            </p>
            <div className="mt-7 inline-block rounded-3xl border-[3px] border-[#111] bg-[#f5c518] px-6 py-4 text-left shadow-[0_6px_0_#111]">
              <div className="text-[11px] font-bold tracking-[0.14em]">TESLİM SÜRESİ</div>
              <div className="hd mt-1 text-3xl font-extrabold tracking-tight">24 SAAT</div>
            </div>
          </div>
          <EkHizmetKarti service="remake" />
        </section>

        <div className="grid gap-8 lg:grid-cols-[1fr_430px]">
          <section className="min-w-0">
            <div className="mb-6 flex items-center justify-between border-b-[3px] border-[#111] pb-3">
              <h2 className="text-sm font-bold tracking-[0.12em]">01 — PROJE BİLGİLERİ</h2>
              <span className="text-[11px] font-semibold tracking-[0.1em] text-[#686868]">PROJE DETAYLARI</span>
            </div>

            <div className="grid gap-5 sm:grid-cols-2">
              <label className="block">
                <span className="mb-2 block text-[11px] font-bold tracking-[0.12em] text-[#242424]">ŞARKI / REFERANS ADI</span>
                <input
                  value={songName}
                  onChange={(e) => setSongName(e.target.value)}
                  placeholder="Şarkı adı veya referans"
                  className="field w-full rounded-2xl border-[2.5px] border-[#111] bg-white px-4 py-4 text-base outline-none transition"
                />
              </label>
              <label className="block">
                <span className="mb-2 block text-[11px] font-bold tracking-[0.12em] text-[#242424]">SANATÇI ADI</span>
                <input
                  value={artistName}
                  onChange={(e) => setArtistName(e.target.value)}
                  placeholder="Sanatçı adı"
                  className="field w-full rounded-2xl border-[2.5px] border-[#111] bg-white px-4 py-4 text-base outline-none transition"
                />
              </label>
            </div>

            <label className="mt-5 block">
              <span className="mb-2 block text-[11px] font-bold tracking-[0.12em] text-[#242424]">REFERANS SES DOSYASI</span>
              <span className="flex cursor-pointer items-center justify-between rounded-2xl border-[2.5px] border-dashed border-[#111] bg-white p-5 transition hover:bg-[#fffdf2]">
                <span>
                  <span className="block text-base font-semibold">Ses dosyanı yükle</span>
                  <span className="mt-1 block text-[12px] text-[#686868]">MP3, WAV veya M4A</span>
                </span>
                <span className="grid h-10 w-10 place-items-center rounded-full border-[2.5px] border-[#111] bg-[#f5c518] text-xl">＋</span>
                <input
                  type="file"
                  accept=".mp3,.wav,.m4a,audio/*"
                  className="hidden"
                  onChange={(e) => {
                    setFile(e.target.files?.[0] || null);
                    e.target.value = "";
                  }}
                />
              </span>
              {fileName && <span className="mt-2 block text-sm font-medium text-[#242424]">Seçilen dosya: {fileName} (en fazla 50 MB)</span>}
              {!fileName && inCart && inCart.order.files.length > 0 && (
                <span className="mt-2 block text-sm font-medium text-[#242424]">
                  Sepette yüklü referans: {inCart.order.files[0].name} (değiştirmek için yeni dosya seç)
                </span>
              )}
            </label>

            <label className="mt-5 block">
              <span className="mb-2 block text-[11px] font-bold tracking-[0.12em] text-[#242424]">PROJE NOTU</span>
              <textarea
                value={notes}
                onChange={(e) => setNotes(e.target.value)}
                rows={4}
                placeholder="İstediğin sound, tempo veya özel detayları anlat..."
                className="field w-full resize-none rounded-2xl border-[2.5px] border-[#111] bg-white px-4 py-4 text-base outline-none transition"
              />
            </label>

            <div className="mt-7 rounded-3xl border-[3px] border-[#111] bg-[#fff6cf] p-5 shadow-[0_6px_0_#111]">
              <div className="flex items-start gap-3">
                <span className="grid h-9 w-9 flex-none place-items-center rounded-full border-[2.5px] border-[#111] bg-[#f5c518] text-base">⚠</span>
                <div>
                  <h3 className="text-sm font-bold tracking-[0.08em]">TELİF HAKKI BİLGİLENDİRMESİ</h3>
                  <p className="mt-2 text-sm leading-6 text-[#242424]">
                    Birebir veya mevcut bir esere çok yakın yeniden yapımlar telif hakkı iddialarına konu olabilir. Gerekli kullanım izinlerinin ve lisansların alınması müşterinin sorumluluğundadır. İzinsiz kullanım nedeniyle hak talepleri veya içerik kaldırma işlemleri yaşanabilir.
                  </p>
                </div>
              </div>
            </div>
          </section>

          <aside className="min-w-0">
            <div className="rounded-[32px] border-[3px] border-[#111] bg-white p-5 shadow-[0_10px_0_#111] md:p-6">
              <div className="mb-5">
                <div className="inline-block rounded-full border-[2.5px] border-[#111] bg-[#f5c518] px-3 py-1 text-[11px] font-bold tracking-[0.14em]">HITY7 PRODUCTION</div>
                <h2 className="hd mt-3 text-3xl font-extrabold tracking-[-0.04em]">HİZMETİNİ SEÇ</h2>
                <p className="mt-2 text-sm text-[#686868]">İhtiyacına uygun seçeneği belirle.</p>
              </div>

              <div className="space-y-3">
                {options.map((item) => (
                  <div
                    key={item.id}
                    className={`option-card rounded-2xl border-[2.5px] p-4 ${selected === item.id ? "active" : "border-[#111] bg-white"}`}
                  >
                    <button
                      onClick={() => {
                        setSelected(item.id);
                        setAdded("");
                      }}
                      className="w-full text-left"
                    >
                      <div className="flex items-center justify-between">
                        <span className="text-[11px] font-bold tracking-[0.12em] text-[#242424]">{item.tag}</span>
                        <span className={`flex h-5 w-5 items-center justify-center rounded-full border-2 ${selected === item.id ? "border-[#111] bg-[#111] text-[#f5c518]" : "border-[#111] bg-white"}`}>
                          {selected === item.id && <span className="text-[10px]">✓</span>}
                        </span>
                      </div>
                      <div className="mt-3 flex items-center justify-between gap-2">
                        <h3 className="text-sm font-extrabold">{item.name}</h3>
                        <span className="hd text-xl font-extrabold">{priceOf(item.id) === 0 ? "ÜCRETSİZ" : `${priceOf(item.id).toLocaleString("tr-TR")} ₺`}</span>
                      </div>
                      <p className="mt-2 text-[13px] leading-5 text-[#686868]">{item.description}</p>
                    </button>
                    <div className="mt-3 flex items-center justify-between border-t-2 border-[#111]/15 pt-3">
                      <span className="text-[11px] font-bold tracking-[0.1em] text-[#242424]">TESLİM: 24 SAAT</span>
                      <button
                        onClick={() => playOption(item)}
                        className="rounded-full border-2 border-[#111] bg-[#111] px-4 py-2 text-[11px] font-bold text-[#f5c518] transition hover:-translate-y-0.5"
                      >
                        {playing === item.id ? "Ⅱ DURDUR" : "▶ DİNLE"}
                      </button>
                    </div>
                  </div>
                ))}
              </div>

              <div className="my-6 border-t-2 border-[#e6e6e6]" />

              <div className="mb-4 flex items-center justify-between">
                <h3 className="text-sm font-bold tracking-[0.12em]">SİPARİŞ ÖZETİ</h3>
                <span className="text-[11px] font-bold text-[#686868]">HITY7</span>
              </div>

              <div className="space-y-3 text-sm">
                <div className="flex justify-between gap-3">
                  <span className="text-[#686868]">Seçilen hizmet</span>
                  <span className="text-right font-semibold">{activeOption.name}</span>
                </div>
                <div className="flex justify-between gap-3">
                  <span className="text-[#686868]">Teslim süresi</span>
                  <span className="font-semibold">24 saat</span>
                </div>
                <div className="flex justify-between gap-3">
                  <span className="text-[#686868]">Proje</span>
                  <span className="max-w-[160px] truncate text-right font-semibold">{songName || "Belirtilmedi"}</span>
                </div>
                {addonItem && addonLine && (
                  <div className="flex justify-between gap-3">
                    <span className="text-[#686868]">Ek hizmet</span>
                    <span className="text-right font-semibold">
                      + {addonItem.name}
                      {addonLine.qty > 1 ? ` ×${addonLine.qty}` : ""} · {addonTotal.toLocaleString("tr-TR")} ₺
                    </span>
                  </div>
                )}
              </div>

              <div className="my-5 border-t-2 border-[#e6e6e6]" />

              <div className="flex items-end justify-between">
                <span className="text-[12px] font-bold tracking-[0.12em] text-[#686868]">TOPLAM</span>
                <span className="hd text-4xl font-extrabold tracking-tight">
                  {total === 0 ? "0" : total.toLocaleString("tr-TR")} <span className="text-xl">₺</span>
                </span>
              </div>

              {inCart && (
                <p className="mt-4 rounded-2xl border-2 border-dashed border-[#111]/40 bg-[#f5f5f5] px-4 py-3 text-[13px] leading-5 text-[#242424]">
                  Sepetinde bir Remake Beat var{inCart.info ? <> (<b>{inCart.info}</b>)</> : null}. Aynı hizmet iki kez eklenmez; bu formla
                  sepettekini güncelleyebilirsin. Adet ve ek hizmet korunur.
                </p>
              )}

              <button
                onClick={handleAdd}
                disabled={sending}
                className="mt-5 w-full rounded-full border-[2.5px] border-[#111] bg-[#f5c518] px-5 py-4 text-sm font-bold tracking-[0.1em] shadow-[0_5px_0_#111] transition hover:-translate-y-0.5 hover:bg-[#e5b600] hover:shadow-[0_7px_0_#111] active:translate-y-[3px] active:shadow-[0_1px_0_#111] disabled:cursor-wait disabled:opacity-60"
              >
                {sending ? "SEPETE EKLENİYOR…" : inCart ? "SEPETTEKİNİ GÜNCELLE →" : activeOption.price > 0 ? `${activeOption.price.toLocaleString("tr-TR")} ₺ · SEPETE EKLE →` : "SEPETE EKLE →"}
              </button>

              {notice && (
                <div role="alert" className="mt-5 rounded-2xl border-[2.5px] border-[#111] bg-[#fff6cf] p-4 text-sm font-semibold leading-6 text-[#111]">
                  {notice}
                  {needLogin && (
                    <>
                      {" "}
                      <a href="/giris?next=/remake-beat" className="font-bold underline">
                        Giriş yap →
                      </a>
                    </>
                  )}
                </div>
              )}

              {added && (
                <div role="status" className="mt-5 rounded-2xl border-[2.5px] border-[#111] bg-[#f5c518] p-4 text-sm leading-6 text-[#111]">
                  <strong>{added === "replaced" ? "Sepetteki Remake Beat güncellendi ✓" : "Sepete eklendi ✓"}</strong>
                  <br />
                  Siparişi sepette sözleşme onayıyla tamamlarsın; tutar bakiyenden tek seferde düşülür.{" "}
                  <button type="button" onClick={openCart} className="font-bold underline">
                    Sepeti aç →
                  </button>
                </div>
              )}

              <p className="mt-4 text-center text-[12px] leading-5 text-[#686868]">
                Teslim sonrası revizyon taleplerini hesabındaki Siparişlerim bölümünden iletebilirsin.
              </p>
            </div>
          </aside>
        </div>

        <footer className="mt-16 flex flex-col justify-between gap-3 rounded-3xl bg-[#111] px-6 py-5 text-[12px] font-bold tracking-[0.08em] text-white sm:flex-row">
          <span>HITY7 — MUSIC PRODUCTION & DIGITAL SERVICES</span>
          <span className="text-[#f5c518]">CREATE YOUR SOUND.</span>
        </footer>
      </div>
    </main>
  );
}
