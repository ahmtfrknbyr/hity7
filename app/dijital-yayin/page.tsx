
"use client";

import { useRef, useState } from "react";
import Link from "next/link";
import { istekKimligi, sendOrder, uploadOrderFiles, type UploadedFile } from "../../lib/siparis";
import { useSiteContent } from "../../lib/use-site-content";
import SozlesmeOnay from "../../components/SozlesmeOnay";
import SiparisOnizleme from "../../components/SiparisOnizleme";

// Fiyatlar yönetim panelindeki "Sipariş fiyatları"ndan gelir (0 = henüz belirlenmedi)
const PRICES = {
  single: "FİYAT EKLENECEK",
  ep: "FİYAT EKLENECEK",
  album: "FİYAT EKLENECEK",
};

const formats = [
  { id: "single", name: "TEKLİ", detail: "1 şarkılık dijital yayın", price: PRICES.single },
  { id: "ep", name: "EP", detail: "2–6 şarkılık dijital yayın", price: PRICES.ep },
  { id: "album", name: "ALBÜM", detail: "7 veya daha fazla şarkı", price: PRICES.album },
];

const platforms = [
  "Spotify",
  "Apple Music",
  "YouTube Music",
  "TikTok",
  "Instagram / Facebook",
  "Deezer",
  "TIDAL",
  "Amazon Music",
  "Diğer dijital platformlar",
];

const inputClass =
  "field w-full rounded-2xl border-[2.5px] border-[#111] bg-white px-4 py-4 text-base outline-none transition";

const labelClass =
  "mb-2 block text-[11px] font-bold tracking-[0.12em] text-[#242424]";

function Field({
  label,
  placeholder,
  required = false,
  type = "text",
  value,
  onChange,
}: {
  label: string;
  placeholder?: string;
  required?: boolean;
  type?: string;
  value?: string;
  onChange?: (value: string) => void;
}) {
  return (
    <label className="block">
      <span className={labelClass}>
        {label} {required && <span className="text-[#111]">*</span>}
      </span>
      <input
        className={inputClass}
        type={type}
        placeholder={placeholder}
        required={required}
        value={value}
        onChange={onChange ? (e) => onChange(e.target.value) : undefined}
      />
    </label>
  );
}

function Upload({
  label,
  description,
  accept,
  multiple = false,
  onChange,
}: {
  label: string;
  description: string;
  accept: string;
  multiple?: boolean;
  onChange?: (files: FileList | null) => void;
}) {
  const [names, setNames] = useState<string[]>([]);

  return (
    <label className="block cursor-pointer">
      <span className={labelClass}>{label}</span>
      <span className="flex min-h-[100px] items-center justify-between gap-4 rounded-2xl border-[2.5px] border-dashed border-[#111] bg-white p-5 transition hover:bg-[#fffdf2]">
        <span>
          <span className="block text-base font-semibold">
            {names.length ? names.join(", ") : "Dosya yüklemek için tıkla"}
          </span>
          <span className="mt-2 block text-[12px] text-[#686868]">
            {description}
          </span>
        </span>
        <span className="grid h-10 w-10 flex-none place-items-center rounded-full border-[2.5px] border-[#111] bg-[#f5c518] text-xl">＋</span>
      </span>
      <input
        type="file"
        accept={accept}
        multiple={multiple}
        className="hidden"
        onChange={(e) => {
          const files = e.target.files;
          setNames(files ? Array.from(files).map((f) => f.name) : []);
          onChange?.(files);
        }}
      />
    </label>
  );
}

export default function DigitalYayinPage() {
  const [format, setFormat] = useState("single");
  const [artistExists, setArtistExists] = useState("yes");
  const [releaseType, setReleaseType] = useState("original");
  const [explicit, setExplicit] = useState("no");
  const [stores, setStores] = useState(platforms);
  const [trackCount, setTrackCount] = useState("1");
  const [artistName, setArtistName] = useState("");
  const [releaseName, setReleaseName] = useState("");
  const [releaseDate, setReleaseDate] = useState("");
  const [songwriter, setSongwriter] = useState("");
  const [composer, setComposer] = useState("");
  const [producer, setProducer] = useState("");
  const [email, setEmail] = useState("");
  const [spotify, setSpotify] = useState("");
  const [appleMusic, setAppleMusic] = useState("");
  const [youtube, setYoutube] = useState("");
  const [instagram, setInstagram] = useState("");
  const [language, setLanguage] = useState("Türkçe");
  const [genre, setGenre] = useState("");
  const [country, setCountry] = useState("Türkiye");
  const [notes, setNotes] = useState("");
  const [accepted, setAccepted] = useState(false);
  const [onay, setOnay] = useState(false);
  const [submitted, setSubmitted] = useState(false);
  const [coverFile, setCoverFile] = useState<File | null>(null);
  const [singleAudio, setSingleAudio] = useState<File | null>(null);
  const [trackAudio, setTrackAudio] = useState<(File | null)[]>(() => Array.from({ length: 40 }, () => null));
  const [sending, setSending] = useState(false);
  const [progress, setProgress] = useState("");
  const [notice, setNotice] = useState("");
  const [doneCode, setDoneCode] = useState("");
  // Tekrar koruması: başvuru yeniden gönderilirse (ör. bağlantı koptuysa) ikinci kez ücretlendirilmez
  const istekRef = useRef<{ key: string; sig: string } | null>(null);
  // Sipariş önizlemesi (doğrudan sipariş: onaylanınca dosyalar yüklenir ve ücret bakiyeden düşülür)
  type Trk = { title: string; explicit: string; instrumental: string; songwriter: string; composer: string; language: string };
  const [onizleme, setOnizleme] = useState<{ list: Trk[]; audios: File[]; all: File[] } | null>(null);
  const [onizHata, setOnizHata] = useState("");
  const [eksik, setEksik] = useState<number | null>(null);
  const yayinPrices = useSiteContent().pricing.yayin;
  const priceLabel = (id: string) => {
    const n = Number(yayinPrices[id as keyof typeof yayinPrices]) || 0;
    return n > 0 ? `${n.toLocaleString("tr-TR")} ₺` : PRICES[id as keyof typeof PRICES];
  };
  const emptyTrack = { title: "", explicit: "no", instrumental: "no", songwriter: "", composer: "", language: "Türkçe" };
  const [tracks, setTracks] = useState(() => Array.from({ length: 40 }, () => ({ ...emptyTrack })));
  const minTracks = format === "ep" ? 2 : 7;
  const shownTracks = Math.min(40, Math.max(Number(trackCount) || 0, minTracks));
  const updateTrack = (i: number, patch: Partial<typeof emptyTrack>) =>
    setTracks((cur) => cur.map((t, idx) => (idx === i ? { ...t, ...patch } : t)));
  const addTrack = () => {
    const n = Math.min(40, shownTracks + 1);
    setTrackCount(String(n));
    if (n >= 7) setFormat("album");
    else if (n >= 2) setFormat("ep");
  };
  const removeLastTrack = () => {
    const n = shownTracks - 1;
    if (n < 1) return;
    setTracks((cur) => cur.map((t, idx) => (idx === n ? { ...emptyTrack } : t)));
    setTrackCount(String(n));
    if (n >= 7) setFormat("album");
    else if (n >= 2) setFormat("ep");
    else setFormat("single");
  };

  const activeFormat = formats.find((f) => f.id === format)!;
  const yayinUcreti = Math.round((Number(yayinPrices[format as keyof typeof yayinPrices]) || 0) * 100) / 100;

  const toggleStore = (store: string) => {
    setStores((current) =>
      current.includes(store)
        ? current.filter((item) => item !== store)
        : [...current, store]
    );
  };

  const submitOrder = async (e: React.FormEvent<HTMLFormElement>) => {
    e.preventDefault();
    setNotice("");
    setSubmitted(false);

    if (!accepted) return setNotice("Lütfen telif ve eser sahipliği onayını işaretle.");
    if (!onay) return setNotice("Başvuruyu göndermek için sözleşme onay kutusunu işaretle.");
    if (!stores.length) return setNotice("En az bir dağıtım platformu seç.");
    if (!coverFile) return setNotice("Kapak görselini (JPG veya PNG) yükle.");
    if (!/\.(jpe?g|png)$/i.test(coverFile.name)) return setNotice("Kapak görseli JPG veya PNG olmalı.");

    // Şarkı listesi ve ses dosyaları
    const count = format === "single" ? 1 : shownTracks;
    const list =
      format === "single"
        ? [{ title: releaseName.trim(), explicit, instrumental: "no", songwriter, composer, language }]
        : tracks.slice(0, count).map((t) => ({ ...t, title: t.title.trim() }));
    const audios = format === "single" ? [singleAudio] : trackAudio.slice(0, count);
    const missing = list.findIndex((t, i) => !t.title || !audios[i]);
    if (missing >= 0) return setNotice(`Şarkı ${missing + 1}: şarkı adı ve master ses dosyası gerekli.`);
    const all = [coverFile, ...(audios as File[])];
    // Dijital Yayın: ses WAV veya FLAC, kapak JPG veya PNG (aynı kural sunucuda da denetlenir)
    const yanlis = (audios as File[]).find((f) => !/\.(wav|flac)$/i.test(f.name));
    if (yanlis) return setNotice(`“${yanlis.name}”: master ses dosyası WAV veya FLAC olmalı.`);
    const big = all.find((f) => f.size > 50 * 1024 * 1024);
    if (big) return setNotice(`“${big.name}” 50 MB'tan büyük. Daha küçük bir WAV/FLAC dosyası yükle.`);
    setOnizHata("");
    setOnizleme({ list, audios: audios as File[], all });
  };

  /** Onay ekranında "Onayla": dosyaları özel depoya yükler, başvuruyu oluşturur ve ücreti bakiyeden düşer. */
  const gonder = async () => {
    if (!onizleme || !coverFile) return;
    const { list, audios, all } = onizleme;
    setSending(true);
    setOnizHata("");
    try {
      const uploaded: UploadedFile[] = [];
      setProgress(`Dosyalar yükleniyor… 0/${all.length}`);
      uploaded.push(...(await uploadOrderFiles([coverFile], { kind: "cover" })));
      for (let i = 0; i < audios.length; i++) {
        setProgress(`Dosyalar yükleniyor… ${i + 1}/${all.length}`);
        uploaded.push(...(await uploadOrderFiles([audios[i] as File], { kind: `track-${i + 1}` })));
      }
      setProgress("Başvuru oluşturuluyor…");
      // İmza: yayının kimliği (dosya adresleri her yüklemede değiştiği için dahil edilmez)
      const istekId = istekKimligi(
        istekRef,
        JSON.stringify([format, artistName.trim(), releaseName.trim(), releaseDate, list.map((t) => t.title), stores])
      );
      const r = await sendOrder({
        type: "yayin",
        accept: onay,
        istekId,
        contact: email.trim() || undefined,
        format,
        artist: artistName.trim(),
        releaseName: releaseName.trim(),
        releaseDate,
        genre,
        language,
        country,
        explicit,
        releaseType,
        artistExists,
        stores,
        spotify,
        appleMusic,
        youtube,
        instagram,
        songwriter,
        composer,
        producer,
        notes,
        tracks: list,
        details: notes.trim() ? [["Ek notlar", notes.trim()]] : [],
        files: uploaded,
        beklenenTutar: yayinUcreti,
        yonlendir: false,
      });
      if (r.ok) {
        istekRef.current = null;
        setOnizleme(null);
        setDoneCode(r.code || "");
        setSubmitted(true);
      } else if (r.needTopup) {
        setEksik(r.missing || null);
        setOnizHata(r.error || "Yetersiz bakiye.");
      } else if (r.fiyatDegisti) {
        setOnizleme(null);
        setNotice(r.error || "Fiyat değişti. Güncel tutarı kontrol edip yeniden onayla.");
      } else setOnizHata(r.error || "Başvuru gönderilemedi.");
    } catch (err) {
      setOnizHata(err instanceof Error ? err.message : "Dosyalar yüklenemedi. Lütfen tekrar dene.");
    }
    setProgress("");
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
        button, input, select, textarea { font: inherit; }
        .editorial { font-family: "Inter", system-ui, -apple-system, "Segoe UI", Roboto, Arial, sans-serif; -webkit-font-smoothing: antialiased; }
        .hd { font-family: "Bricolage Grotesque", "Helvetica Neue", Arial, sans-serif; }
        .dots { background-color: #ffffff; background-image: radial-gradient(#d9d9d9 1.4px, transparent 1.5px); background-size: 28px 28px; }
        .field:focus { background: #fffdf2; box-shadow: 0 0 0 4px #f5c518; }
        .editorial input[type="radio"], .editorial input[type="checkbox"] { accent-color: #111; width: 20px; height: 20px; flex: none; cursor: pointer; }
        .editorial :focus-visible { outline: 3px solid #111; outline-offset: 3px; }
        .format-card { transition: transform .15s ease, box-shadow .15s ease, background .2s ease; }
        .format-card:hover { transform: translateY(-2px); box-shadow: 0 4px 0 #111; }
        .format-card.active { border-color: #111; background: #f5c518; box-shadow: 0 4px 0 #111; transform: translateY(-2px); }
        @media (prefers-reduced-motion: reduce) { .format-card { transition: none; } }
      `}</style>

      <div className="editorial mx-auto max-w-[1440px] px-5 pb-20 pt-8 md:px-10">
        <section className="pb-12 pt-14">
          <div className="mb-5 inline-flex items-center gap-2.5 rounded-full border-[2.5px] border-[#111] bg-white px-3.5 py-1.5 text-[12px] font-bold tracking-[0.14em]">
            <span className="h-[9px] w-[9px] rounded-full border-2 border-[#111] bg-[#f5c518]" />
            HITY7 / DİJİTAL YAYIN
          </div>

          <div className="grid gap-8 lg:grid-cols-[1fr_350px] lg:items-end">
            <div>
              <h1 className="hd max-w-4xl text-[44px] font-extrabold leading-[0.95] tracking-[-0.045em] md:text-7xl">
                MÜZİĞİNİ<br />
                DÜNYAYA YAYINLA.
              </h1>
              <p className="mt-6 max-w-xl text-base leading-7 text-[#686868]">
                Müziğini dünyanın önde gelen dijital platformlarında yayınla.
                Yayın başvurunu oluştur, gerisini HITY7 ile tamamla.
              </p>
            </div>

            <div className="rounded-[28px] border-[3px] border-[#111] bg-[#111] p-6 text-white shadow-[0_8px_0_#f5c518]">
              <div className="text-[11px] font-bold tracking-[0.14em] text-white/70">
                HITY7 DIGITAL DISTRIBUTION
              </div>
              <div className="hd mt-4 text-3xl font-extrabold leading-tight text-[#f5c518]">
                ÖMÜR BOYU
                <br />
                KALICI YAYIN.
              </div>
              <p className="mt-3 text-sm leading-6 text-white/75">
                Yayın koşulları ve{" "}
                <Link href="/yasal/kullanim-kosullari#dijital-yayin" className="font-bold text-[#f5c518] underline underline-offset-2">
                  hizmet sözleşmesi
                </Link>{" "}
                kapsamında, müziğinin dijital platformlarda kalıcı olarak yer alması için başvurunu oluştur.
              </p>
            </div>
          </div>
        </section>

        <form onSubmit={submitOrder}>
          <div className="grid gap-8 lg:grid-cols-[1fr_370px]">
            <div className="min-w-0 space-y-10">
              {/* YAYIN TÜRÜ */}
              <section>
                <div className="mb-6 flex items-center justify-between border-b-[3px] border-[#111] pb-3">
                  <h2 className="text-sm font-bold tracking-[0.12em]">
                    01 — YAYIN TÜRÜNÜ SEÇ
                  </h2>
                  <span className="text-[11px] font-semibold tracking-[0.1em] text-[#686868]">3 SEÇENEK</span>
                </div>

                <div className="grid gap-3 sm:grid-cols-3">
                  {formats.map((item) => (
                    <button
                      key={item.id}
                      type="button"
                      onClick={() => {
                        setFormat(item.id);
                        setTrackCount(item.id === "single" ? "1" : item.id === "ep" ? "3" : "7");
                      }}
                      className={`format-card rounded-2xl border-[2.5px] p-5 text-left ${
                        format === item.id
                          ? "active"
                          : "border-[#111] bg-white"
                      }`}
                    >
                      <div className="flex items-center justify-between">
                        <span className="text-[11px] font-bold tracking-[0.12em] text-[#242424]">
                          {item.id === "single" ? "SINGLE" : item.id === "ep" ? "EXTENDED PLAY" : "FULL ALBUM"}
                        </span>
                        <span className="text-xs">{format === item.id ? "●" : "○"}</span>
                      </div>
                      <h3 className="hd mt-6 text-2xl font-extrabold">{item.name}</h3>
                      <p className="mt-2 min-h-[40px] text-[13px] leading-5 text-[#686868]">
                        {item.detail}
                      </p>
                      <div className="mt-5 border-t-2 border-[#111]/15 pt-4 text-sm font-extrabold">
                        {priceLabel(item.id)}
                      </div>
                    </button>
                  ))}
                </div>
              </section>

              {/* SANATÇI */}
              <section>
                <div className="mb-6 border-b-[3px] border-[#111] pb-3">
                  <h2 className="text-sm font-bold tracking-[0.12em]">
                    02 — SANATÇI BİLGİLERİ
                  </h2>
                </div>

                <div className="grid gap-5 sm:grid-cols-2">
                  <Field
                    label="SAHNE ADI"
                    placeholder="Sanatçı / grup adı"
                    required
                    value={artistName}
                    onChange={setArtistName}
                  />
                  <Field
                    label="GERÇEK AD SOYAD"
                    placeholder="Yasal ad ve soyad"
                    required
                  />
                  <Field
                    label="E-POSTA"
                    placeholder="ornek@mail.com"
                    type="email"
                    required
                    value={email}
                    onChange={setEmail}
                  />
                  <Field
                    label="INSTAGRAM KULLANICI ADI"
                    placeholder="@kullaniciadi"
                    value={instagram}
                    onChange={setInstagram}
                  />
                </div>

                <div className="mt-6 rounded-2xl border-[2.5px] border-[#111] bg-white p-5">
                  <div className="mb-4 text-[11px] font-bold tracking-[0.12em]">
                    DAHA ÖNCE DİJİTAL YAYININ OLDU MU?
                  </div>
                  <div className="flex flex-wrap gap-5 text-sm">
                    {[
                      ["yes", "Evet, sanatçı profillerim var"],
                      ["no", "Hayır, ilk yayınım olacak"],
                    ].map(([value, text]) => (
                      <label key={value} className="flex cursor-pointer items-center gap-2">
                        <input
                          type="radio"
                          name="artistExists"
                          value={value}
                          checked={artistExists === value}
                          onChange={() => setArtistExists(value)}
                        />
                        {text}
                      </label>
                    ))}
                  </div>
                </div>

                {artistExists === "yes" && (
                  <div className="mt-5 grid gap-5 sm:grid-cols-2">
                    <Field
                      label="SPOTIFY SANATÇI PROFİLİ"
                      placeholder="https://open.spotify.com/artist/..."
                      value={spotify}
                      onChange={setSpotify}
                    />
                    <Field
                      label="APPLE MUSIC SANATÇI PROFİLİ"
                      placeholder="Apple Music profil bağlantısı"
                      value={appleMusic}
                      onChange={setAppleMusic}
                    />
                    <Field
                      label="YOUTUBE MUSIC PROFİLİ"
                      placeholder="YouTube Music profil bağlantısı"
                      value={youtube}
                      onChange={setYoutube}
                    />
                  </div>
                )}
              </section>

              {/* YAYIN DETAYLARI */}
              <section>
                <div className="mb-6 border-b-[3px] border-[#111] pb-3">
                  <h2 className="text-sm font-bold tracking-[0.12em]">
                    03 — YAYIN DETAYLARI
                  </h2>
                </div>

                <div className="grid gap-5 sm:grid-cols-2">
                  <Field
                    label="ŞARKI / ALBÜM ADI"
                    placeholder="Yayın adı"
                    required
                    value={releaseName}
                    onChange={setReleaseName}
                  />

                  <label className="block">
                    <span className={labelClass}>ŞARKI SAYISI</span>
                    <input
                      className={inputClass}
                      type="number"
                      min={format === "single" ? 1 : format === "ep" ? 2 : 7}
                      value={trackCount}
                      onChange={(e) => {
                        const v = e.target.value;
                        setTrackCount(v);
                        const n = Number(v);
                        if (n >= 7) setFormat("album");
                        else if (n >= 2) setFormat("ep");
                        else if (n === 1) setFormat("single");
                      }}
                      required
                    />
                  </label>

                  <label className="block">
                    <span className={labelClass}>MÜZİK TÜRÜ</span>
                    <select className={inputClass} value={genre} onChange={(e) => setGenre(e.target.value)} required>
                      <option value="">Tür seç</option>
                      <option>Rap / Hip-Hop</option>
                      <option>Trap</option>
                      <option>Drill</option>
                      <option>Pop</option>
                      <option>R&B</option>
                      <option>Rock</option>
                      <option>Elektronik</option>
                      <option>Diğer</option>
                    </select>
                  </label>

                  <label className="block">
                    <span className={labelClass}>YAYIN DİLİ</span>
                    <select className={inputClass} value={language} onChange={(e) => setLanguage(e.target.value)}>
                      <option>Türkçe</option>
                      <option>İngilizce</option>
                      <option>Almanca</option>
                      <option>Arapça</option>
                      <option>İspanyolca</option>
                      <option>Enstrümantal</option>
                      <option>Diğer</option>
                    </select>
                  </label>

                  <Field
                    label="İSTENEN YAYIN TARİHİ"
                    type="date"
                    value={releaseDate}
                    onChange={setReleaseDate}
                  />

                  <label className="block">
                    <span className={labelClass}>YAYIN ÜLKESİ</span>
                    <select className={inputClass} value={country} onChange={(e) => setCountry(e.target.value)}>
                      <option>Türkiye</option>
                      <option>Dünya geneli</option>
                    </select>
                  </label>
                </div>

                <div className="mt-6 rounded-2xl border-[2.5px] border-[#111] bg-white p-5">
                  <div className="mb-4 text-[11px] font-bold tracking-[0.12em]">
                    YAYINDA AÇIK İÇERİK VAR MI?
                  </div>
                  <div className="flex gap-6 text-sm">
                    {["no", "yes"].map((value) => (
                      <label key={value} className="flex cursor-pointer items-center gap-2">
                        <input
                          type="radio"
                          name="explicit"
                          checked={explicit === value}
                          onChange={() => setExplicit(value)}
                        />
                        {value === "yes" ? "Evet, Explicit" : "Hayır"}
                      </label>
                    ))}
                  </div>
                </div>

                <div className="mt-5 rounded-2xl border-[2.5px] border-[#111] bg-white p-5">
                  <div className="mb-4 text-[11px] font-bold tracking-[0.12em]">
                    YAYIN TÜRÜ
                  </div>
                  <div className="grid gap-3 sm:grid-cols-2">
                    <label className="flex cursor-pointer items-center gap-2 text-sm">
                      <input
                        type="radio"
                        name="releaseType"
                        checked={releaseType === "original"}
                        onChange={() => setReleaseType("original")}
                      />
                      Özgün eser
                    </label>
                    <label className="flex cursor-pointer items-center gap-2 text-sm">
                      <input
                        type="radio"
                        name="releaseType"
                        checked={releaseType === "cover"}
                        onChange={() => setReleaseType("cover")}
                      />
                      Cover / Yeniden yorum
                    </label>
                  </div>
                  {releaseType === "cover" && (
                    <p className="mt-3 text-[13px] leading-6 text-[#686868]">
                      Cover yayınlarda gerekli mekanik lisans ve izin süreçleri ayrıca değerlendirilmelidir.
                    </p>
                  )}
                </div>
              </section>

              {/* ESER SAHİPLERİ */}
              <section>
                <div className="mb-6 border-b-[3px] border-[#111] pb-3">
                  <h2 className="text-sm font-bold tracking-[0.12em]">
                    04 — ESER SAHİPLERİ
                  </h2>
                </div>

                <div className="grid gap-5 sm:grid-cols-2">
                  <Field
                    label="SÖZ YAZARI / SÖZ YAZARLARI"
                    placeholder="Gerçek ad soyad"
                    value={songwriter}
                    onChange={setSongwriter}
                  />
                  <Field
                    label="BESTECİ / BESTECİLER"
                    placeholder="Gerçek ad soyad"
                    value={composer}
                    onChange={setComposer}
                  />
                  <Field
                    label="PRODÜKTÖR"
                    placeholder="Prodüktör adı"
                    value={producer}
                    onChange={setProducer}
                  />
                </div>

                <p className="mt-3 text-[13px] leading-6 text-[#686868]">
                  Birden fazla söz yazarı, besteci veya katkı sahibi varsa tüm
                  kişilerin gerçek adlarını ve katkılarını proje notunda belirt.
                </p>
              </section>

              {/* DOSYALAR */}
              <section>
                <div className="mb-6 border-b-[3px] border-[#111] pb-3">
                  <h2 className="text-sm font-bold tracking-[0.12em]">
                    05 — YAYIN DOSYALARI
                  </h2>
                </div>

                {format === "single" ? (
                  <div className="grid gap-5 sm:grid-cols-2">
                    <Upload
                      label="MASTER SES DOSYASI"
                      description="WAV tercih edilir. Her şarkı ayrı dosya olmalıdır. En fazla 50 MB."
                      accept=".wav,.flac,audio/wav,audio/flac"
                      onChange={(f) => setSingleAudio(f?.[0] || null)}
                    />
                    <Upload
                      label="KAPAK GÖRSELİ"
                      description="Kare JPG, tercihen 3000 × 3000 px."
                      accept="image/jpeg,.jpg,.jpeg,.png"
                      onChange={(f) => setCoverFile(f?.[0] || null)}
                    />
                  </div>
                ) : (
                  <>
                    <div className="space-y-5">
                      {Array.from({ length: shownTracks }, (_, i) => {
                        const t = tracks[i];
                        const num = String(i + 1).padStart(2, "0");
                        return (
                          <div
                            key={i}
                            className="rounded-3xl border-[2.5px] border-[#111] bg-white p-5 shadow-[0_5px_0_#111] sm:p-6"
                          >
                            <div className="mb-5 flex items-center justify-between gap-3">
                              <span className="hd inline-flex items-center gap-3 text-xl font-extrabold tracking-[-0.03em]">
                                <span className="grid h-10 w-10 place-items-center rounded-full border-[2.5px] border-[#111] bg-[#f5c518] text-sm">
                                  {num}
                                </span>
                                ŞARKI {num}
                              </span>
                              {i === shownTracks - 1 && shownTracks > minTracks && (
                                <button
                                  type="button"
                                  onClick={removeLastTrack}
                                  className="rounded-full border-[2.5px] border-[#111] bg-white px-3 py-1.5 text-xs font-bold transition hover:bg-[#f5c518]"
                                  aria-label={`Şarkı ${num} kaldır`}
                                >
                                  × Kaldır
                                </button>
                              )}
                            </div>

                            <div className="grid gap-5 sm:grid-cols-2">
                              <Field
                                label="ŞARKI ADI"
                                placeholder="Şarkının adı"
                                required
                                value={t.title}
                                onChange={(v) => updateTrack(i, { title: v })}
                              />
                              <Upload
                                label="MASTER SES DOSYASI"
                                description="WAV tercih edilir. En fazla 50 MB."
                                accept=".wav,.flac,audio/wav,audio/flac"
                                onChange={(f) => setTrackAudio((cur) => cur.map((x, idx) => (idx === i ? f?.[0] || null : x)))}
                              />
                              <Field
                                label="SÖZ YAZARI (GERÇEK AD)"
                                placeholder="Ad Soyad"
                                value={t.songwriter}
                                onChange={(v) => updateTrack(i, { songwriter: v })}
                              />
                              <Field
                                label="BESTECİ (GERÇEK AD)"
                                placeholder="Ad Soyad"
                                value={t.composer}
                                onChange={(v) => updateTrack(i, { composer: v })}
                              />
                              <label className="block">
                                <span className={labelClass}>ŞARKI SÖZÜ DİLİ</span>
                                <select
                                  className={inputClass}
                                  value={t.language}
                                  onChange={(e) => updateTrack(i, { language: e.target.value })}
                                >
                                  <option>Türkçe</option>
                                  <option>İngilizce</option>
                                  <option>Almanca</option>
                                  <option>Arapça</option>
                                  <option>Diğer</option>
                                </select>
                              </label>
                              <div className="grid gap-3 sm:grid-cols-1">
                                <div className="rounded-2xl border-[2.5px] border-[#111] bg-white p-4">
                                  <div className="mb-3 text-[11px] font-bold tracking-[0.12em]">
                                    AÇIK İÇERİK (EXPLICIT)
                                  </div>
                                  <div className="flex gap-6 text-sm">
                                    {["no", "yes"].map((value) => (
                                      <label key={value} className="flex cursor-pointer items-center gap-2">
                                        <input
                                          type="radio"
                                          name={`track-explicit-${i}`}
                                          checked={t.explicit === value}
                                          onChange={() => updateTrack(i, { explicit: value })}
                                        />
                                        {value === "yes" ? "Evet" : "Hayır"}
                                      </label>
                                    ))}
                                  </div>
                                </div>
                                <div className="rounded-2xl border-[2.5px] border-[#111] bg-white p-4">
                                  <div className="mb-3 text-[11px] font-bold tracking-[0.12em]">
                                    ENSTRÜMANTAL (SÖZSÜZ)
                                  </div>
                                  <div className="flex gap-6 text-sm">
                                    {["no", "yes"].map((value) => (
                                      <label key={value} className="flex cursor-pointer items-center gap-2">
                                        <input
                                          type="radio"
                                          name={`track-instrumental-${i}`}
                                          checked={t.instrumental === value}
                                          onChange={() => updateTrack(i, { instrumental: value })}
                                        />
                                        {value === "yes" ? "Evet" : "Hayır"}
                                      </label>
                                    ))}
                                  </div>
                                </div>
                              </div>
                            </div>
                          </div>
                        );
                      })}

                      <button
                        type="button"
                        onClick={addTrack}
                        disabled={shownTracks >= 40}
                        className="flex w-full items-center justify-center gap-3 rounded-3xl border-[2.5px] border-dashed border-[#111] bg-white p-5 text-sm font-bold transition hover:bg-[#fffdf2] disabled:opacity-50"
                      >
                        <span className="grid h-10 w-10 place-items-center rounded-full border-[2.5px] border-[#111] bg-[#f5c518] text-xl">
                          ＋
                        </span>
                        Ekstra şarkı ekle
                      </button>
                    </div>

                    <div className="mt-5">
                      <Upload
                        label="KAPAK GÖRSELİ"
                        description="Kare JPG, tercihen 3000 × 3000 px. Tüm yayın için tek kapak."
                        accept="image/jpeg,.jpg,.jpeg,.png"
                        onChange={(f) => setCoverFile(f?.[0] || null)}
                      />
                    </div>

                    <p className="mt-4 text-[13px] leading-6 text-[#686868]">
                      Her şarkı için ayrı bilgi ve dosya girilir. Şarkı eklediğinde veya çıkardığında
                      yukarıdaki şarkı sayısı ve yayın türü (EP / Albüm) otomatik güncellenir.
                    </p>
                  </>
                )}
              </section>

              {/* PLATFORMLAR */}
              <section>
                <div className="mb-6 border-b-[3px] border-[#111] pb-3">
                  <h2 className="text-sm font-bold tracking-[0.12em]">
                    06 — DAĞITIM PLATFORMLARI
                  </h2>
                </div>

                <div className="grid gap-3 sm:grid-cols-3">
                  {platforms.map((platform) => (
                    <label
                      key={platform}
                      className="flex cursor-pointer items-center gap-3 rounded-2xl border-[2.5px] border-[#111] bg-white p-4 text-sm font-semibold transition hover:bg-[#fffdf2] has-[:checked]:bg-[#f5c518]"
                    >
                      <input
                        type="checkbox"
                        checked={stores.includes(platform)}
                        onChange={() => toggleStore(platform)}
                      />
                      {platform}
                    </label>
                  ))}
                </div>
              </section>

              {/* NOTLAR VE ONAY */}
              <section>
                <div className="mb-6 border-b-[3px] border-[#111] pb-3">
                  <h2 className="text-sm font-bold tracking-[0.12em]">
                    07 — EK BİLGİLER VE ONAY
                  </h2>
                </div>

                <label className="block">
                  <span className={labelClass}>EK NOTLAR</span>
                  <textarea
                    className={`${inputClass} resize-none`}
                    rows={4}
                    value={notes}
                    onChange={(e) => setNotes(e.target.value)}
                    placeholder="Yayınla ilgili eklemek istediğin detaylar..."
                  />
                </label>

                <label className="mt-6 flex cursor-pointer items-start gap-3 rounded-2xl border-[2.5px] border-[#111] bg-white p-5">
                  <input
                    type="checkbox"
                    checked={accepted}
                    onChange={(e) => setAccepted(e.target.checked)}
                    className="mt-1"
                  />
                  <span className="text-sm leading-6 text-[#242424]">
                    Bu eserin dijital dağıtımı için gerekli hak ve izinlere sahip
                    olduğumu, verdiğim bilgilerin doğru olduğunu, eser sahipleri
                    ve katkı sağlayan kişiler hakkında doğru bilgi sunduğumu
                    onaylıyorum.{" "}
                    <a href="/yasal/kullanim-kosullari#dijital-yayin" target="_blank" rel="noopener noreferrer" className="font-bold underline decoration-[#f5c518] decoration-[3px] underline-offset-2">
                      Telif ve dağıtım koşullarını
                    </a>{" "}
                    kabul ediyorum.
                  </span>
                </label>
              </section>
            </div>

            {/* SAĞ SİPARİŞ ÖZETİ */}
            <aside className="min-w-0">
              <div className="sticky top-6 rounded-[32px] border-[3px] border-[#111] bg-white p-6 shadow-[0_10px_0_#111]">
                <div className="inline-block rounded-full border-[2.5px] border-[#111] bg-[#f5c518] px-3 py-1 text-[11px] font-bold tracking-[0.14em]">
                  HITY7 DIGITAL
                </div>
                <h2 className="hd mt-3 text-3xl font-extrabold tracking-[-0.04em]">YAYIN ÖZETİ</h2>

                <div className="my-6 border-t-2 border-[#e6e6e6]" />

                <div className="space-y-4 text-sm">
                  <div className="flex justify-between gap-3">
                    <span className="text-[#686868]">Yayın türü</span>
                    <strong>{activeFormat.name}</strong>
                  </div>
                  <div className="flex justify-between gap-3">
                    <span className="text-[#686868]">Sanatçı</span>
                    <strong className="max-w-[150px] truncate">{artistName || "Belirtilmedi"}</strong>
                  </div>
                  <div className="flex justify-between gap-3">
                    <span className="text-[#686868]">Yayın adı</span>
                    <strong className="max-w-[150px] truncate">{releaseName || "Belirtilmedi"}</strong>
                  </div>
                  <div className="flex justify-between gap-3">
                    <span className="text-[#686868]">Şarkı sayısı</span>
                    <strong>{trackCount || "—"}</strong>
                  </div>
                  <div className="flex justify-between gap-3">
                    <span className="text-[#686868]">Platform sayısı</span>
                    <strong>{stores.length}</strong>
                  </div>
                </div>

                <div className="my-6 border-t-2 border-[#e6e6e6]" />

                <div className="rounded-2xl border-[2.5px] border-[#111] bg-[#fff6cf] p-5">
                  <div className="text-[11px] font-bold tracking-[0.12em] text-[#242424]">
                    SEÇİLEN YAYIN PAKETİ
                  </div>
                  <div className="hd mt-2 text-2xl font-extrabold">{activeFormat.name}</div>
                  <div className="mt-3 text-sm font-bold">{priceLabel(activeFormat.id)}</div>
                </div>

                <div className="mt-5 rounded-2xl border-[2.5px] border-[#111] bg-[#111] p-5 text-white">
                  <div className="text-[11px] font-bold tracking-[0.14em] text-white/70">
                    HITY7 YAYIN HİZMETİ
                  </div>
                  <div className="hd mt-3 text-2xl font-extrabold leading-tight text-[#f5c518]">
                    ÖMÜR BOYU
                    <br />
                    KALICI DİJİTAL YAYIN
                  </div>
                  <p className="mt-3 text-[13px] leading-6 text-white/75">
                    Yayın,{" "}
                    <a href="/yasal/kullanim-kosullari#dijital-yayin" target="_blank" rel="noopener noreferrer" className="font-bold text-[#f5c518] underline underline-offset-2">
                      hizmet ve dağıtım sözleşmesinde
                    </a>{" "}
                    belirtilen koşullara bağlı olarak kalıcı şekilde dijital platformlarda tutulur.
                  </p>
                </div>

                <SozlesmeOnay tur="siparis" checked={onay} onChange={setOnay} />

                <button
                  type="submit"
                  disabled={sending}
                  className="mt-5 w-full rounded-full border-[2.5px] border-[#111] bg-[#f5c518] px-5 py-5 text-sm font-bold tracking-[0.1em] text-[#111] shadow-[0_5px_0_#111] transition hover:-translate-y-0.5 hover:bg-[#e5b600] hover:shadow-[0_7px_0_#111] active:translate-y-[3px] active:shadow-[0_1px_0_#111] disabled:cursor-wait disabled:opacity-60"
                >
                  {sending ? progress || "GÖNDERİLİYOR…" : "YAYIN BAŞVURUSU OLUŞTUR →"}
                </button>

                <p className="mt-4 text-center text-[12px] leading-5 text-[#686868]">
                  Başvuru sonrası bilgiler kontrol edilir. Ücret belirlenmişse bakiyenden düşülür.
                  ISRC ve UPC kodlarını HITY7 atar; hesabındaki Dijital Yayınlarım bölümünde görünür.
                </p>

                {notice && (
                  <div role="alert" className="mt-5 rounded-2xl border-[2.5px] border-[#111] bg-[#fff6cf] p-4 text-sm font-semibold leading-6 text-[#111]">
                    {notice}
                  </div>
                )}

                {submitted && (
                  <div role="status" className="mt-5 rounded-2xl border-[2.5px] border-[#111] bg-[#f5c518] p-4 text-sm leading-6 text-[#111]">
                    <strong>Başvurun alındı ✓</strong>
                    <br />
                    Sipariş kodun: <b className="rounded-md bg-[#111] px-2 py-0.5 font-mono text-[#f5c518]">{doneCode}</b>
                    <br />
                    Durumunu ve atanan kodları{" "}
                    <a href="/panel?tab=releases" className="font-bold underline">Dijital Yayınlarım</a> bölümünden takip edebilirsin.
                  </div>
                )}
              </div>
            </aside>
          </div>
        </form>

        <footer className="mt-16 flex flex-col justify-between gap-3 rounded-3xl bg-[#111] px-6 py-5 text-[12px] font-bold tracking-[0.08em] text-white sm:flex-row">
          <span>HITY7 — DIGITAL MUSIC DISTRIBUTION</span>
          <span className="text-[#f5c518]">YOUR MUSIC. YOUR WORLD.</span>
        </footer>
      </div>

      <SiparisOnizleme
        acik={!!onizleme}
        baslik={`Dijital yayın · ${activeFormat.name}`}
        kalemler={[
          { ad: `Dijital yayın · ${activeFormat.name}`, not: `${artistName.trim()} · ${releaseName.trim()} · ${onizleme?.list.length || 0} şarkı`, tutar: yayinUcreti },
          { ad: "Dosyalar", not: `${onizleme?.all.length || 0} dosya (kapak + master ses) onayladığında yüklenir` },
        ]}
        araToplam={yayinUcreti}
        toplam={yayinUcreti}
        gonderiliyor={sending}
        hata={progress || onizHata}
        eksik={eksik}
        onOnayla={gonder}
        onKapat={() => setOnizleme(null)}
      />
    </main>
  );
}
