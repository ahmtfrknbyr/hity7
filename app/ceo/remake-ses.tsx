"use client";

/**
 * app/ceo/remake-ses.tsx
 * Hizmetler bölümü · Remake Beat örnek sesleri: dört paketin (FREE BEAT, BİREBİR, MODERN, ÖZGÜN REMAKE) DİNLE düğmeleri.
 *  - Her paket için ayrı MP3 / WAV yükleme, değiştirme, dinleme ve kaldırma.
 *  - Dosya mevcut herkese açık "site-media" deposuna yüklenir (yalnızca yetkili yönetici yazabilir); adres ve dosya bilgisi
 *    site_content tablosunda "remake_sesler" kaydına yazılır. Müşteri sayfası bu kaydı okuyup ilgili düğmeye bağlar.
 *  - Değişiklik ANINDA kaydedilir ("Kaydet" düğmesine gerek yok) ve sayfa taslağındaki fiyat / açıklama düzenlemelerinden bağımsızdır;
 *    "varsayılana dön" gibi toplu işlemler bu kaydı etkilemez.
 *  - Bir paketin sesi değişince diğer paketlerin kaydına dokunulmaz. Kaldırılan / değiştirilen eski dosya depoda kalır (silinmez).
 */
import { useCallback, useEffect, useState } from "react";
import { boyut } from "../../lib/dosya";
import {
  REMAKE_PAKETLERI,
  SES_ANAHTARI,
  SES_MAX_BOYUT,
  sesBirlestir,
  sesDosyasiDogrula,
  sesleriTemizle,
  type RemakePaketId,
  type SesHaritasi,
} from "../../lib/ses-dogrula";
import { Badge, SetupNote, btnGhost, btnPrimary, card, uploadMedia, type Notify, type SB } from "./extra";

const tarihSaat = (iso: string) =>
  iso ? new Date(iso).toLocaleString("tr-TR", { timeZone: "Europe/Istanbul", day: "2-digit", month: "short", year: "numeric", hour: "2-digit", minute: "2-digit" }) : "";

export default function RemakeSesleri({ sb, notify }: { sb: SB; notify: Notify }) {
  const [sesler, setSesler] = useState<SesHaritasi>({});
  const [hazir, setHazir] = useState(false);
  const [hata, setHata] = useState("");
  const [mesgul, setMesgul] = useState<RemakePaketId | "">("");

  /** Veritabanındaki güncel kayıt. Okunamazsa null: bu durumda hiçbir şey yazılmaz (başka kayıtları ezmemek için). */
  const guncelOku = useCallback(async (): Promise<unknown | null> => {
    const { data, error } = await sb.from("site_content").select("value").eq("key", SES_ANAHTARI).maybeSingle();
    if (error) return null;
    return (data as { value?: unknown } | null)?.value ?? {};
  }, [sb]);

  // İlk yükleme: durum yalnızca yanıt geldikten sonra (asenkron) güncellenir
  useEffect(() => {
    let canli = true;
    guncelOku().then((v) => {
      if (!canli) return;
      if (v === null) setHata("Örnek sesler okunamadı. Bağlantını kontrol edip sayfayı yenile.");
      else setSesler(sesleriTemizle(v));
      setHazir(true);
    });
    return () => {
      canli = false;
    };
  }, [guncelOku]);

  async function yaz(yeni: SesHaritasi) {
    const { error } = await sb.from("site_content").upsert({ key: SES_ANAHTARI, value: yeni, updated_at: new Date().toISOString() });
    if (error) throw new Error("Kaydedilemedi: " + error.message);
  }

  async function sesYukle(id: RemakePaketId, ad: string, file: File | undefined) {
    if (!file) return;
    setMesgul(id);
    try {
      const bas = new Uint8Array(await file.slice(0, 4096).arrayBuffer());
      const d = sesDosyasiDogrula(bas, file.name, file.size);
      if (!d.ok) return notify(d.error);
      // Önce dosya yüklenir; kayıt yalnızca yükleme başarılıysa değişir (başarısız yüklemede mevcut ses korunur)
      // Depoya DOĞRULANMIŞ türle gider (tarayıcının bildirdiği tür yok sayılır): "x.mp3" adlı bir HTML dosyası zaten reddedildi,
      // ayrıca tür ses olarak sabitlenir ki herkese açık depoda sayfa / betik olarak sunulamasın.
      const guvenli = file.slice(0, file.size, d.mime);
      const url = await uploadMedia(sb, guvenli, `remake-ses/${id}`, file.name, d.mime);
      const guncel = await guncelOku();
      if (guncel === null) throw new Error("Kayıt okunamadı, ses bağlanmadı. Lütfen tekrar dene.");
      const yeni = sesBirlestir(guncel, id, { url, name: file.name.slice(0, 200), size: file.size, type: d.type, at: new Date().toISOString() });
      await yaz(yeni);
      setSesler(yeni);
      notify(`${ad} örnek sesi kaydedildi. Müşteri sayfasındaki DİNLE düğmesine bağlandı.`);
    } catch (e) {
      notify(e instanceof Error ? e.message : "Ses yüklenemedi.");
    } finally {
      setMesgul("");
    }
  }

  async function sesKaldir(id: RemakePaketId, ad: string) {
    if (!confirm(`${ad} örnek sesi kaldırılsın mı?\n\nMüşteri sayfasında bu pakette DİNLE düğmesi görünmez olur. Dosya depoda kalır; istediğin zaman yeniden yükleyebilirsin.`)) return;
    setMesgul(id);
    try {
      const guncel = await guncelOku();
      if (guncel === null) throw new Error("Kayıt okunamadı, işlem yapılmadı. Lütfen tekrar dene.");
      const yeni = sesBirlestir(guncel, id, null);
      await yaz(yeni);
      setSesler(yeni);
      notify(`${ad} örnek sesi kaldırıldı.`);
    } catch (e) {
      notify(e instanceof Error ? e.message : "Kaldırılamadı.");
    } finally {
      setMesgul("");
    }
  }

  return (
    <div className={`${card} border-[3px] p-5 sm:p-7`}>
      <h2 className="hd text-xl font-extrabold">Remake Beat · örnek sesler (DİNLE düğmeleri)</h2>
      <p className="mb-5 mt-1 text-sm leading-6 text-[#686868]">
        Remake Beat sayfasında her paketin kartındaki DİNLE düğmesi buradaki sesi çalar. Her paketin sesi ayrıdır; birini değiştirmek
        diğerlerini etkilemez. Ses yüklenmeyen pakette DİNLE düğmesi görünmez. MP3 veya WAV, en fazla {Math.round(SES_MAX_BOYUT / 1048576)} MB.
        Yükleme, değiştirme ve kaldırma <b>anında</b> kaydedilir (“Kaydet” düğmesi gerekmez) ve en geç 15 saniyede müşteri sayfasında görünür.
      </p>
      {hata && <SetupNote message={hata} />}
      {!hazir ? (
        <p className="text-sm text-[#686868]">Yükleniyor…</p>
      ) : (
        <div className="grid gap-4 sm:grid-cols-2">
          {REMAKE_PAKETLERI.map(({ id, ad }) => {
            const s = sesler[id];
            const inputId = `remake-ses-${id}`;
            return (
              <div
                key={id}
                className={`flex flex-col gap-3 rounded-2xl border-[2.5px] p-4 ${s ? "border-solid border-[#111] bg-white" : "border-dashed border-[#111] bg-[#f5f5f5]"}`}
              >
                <div className="flex flex-wrap items-center justify-between gap-2">
                  <h3 className="text-sm font-extrabold tracking-[0.04em]">{ad}</h3>
                  {s ? <Badge tone="yellow">DİNLE görünür</Badge> : <Badge tone="plain">DİNLE gizli</Badge>}
                </div>
                {s ? (
                  <>
                    <div className="min-w-0">
                      <p className="break-all text-sm font-bold">{s.name}</p>
                      <p className="text-xs text-[#686868]">
                        {s.type.toUpperCase()} · {boyut(s.size)}
                        {s.at ? ` · ${tarihSaat(s.at)}` : ""}
                      </p>
                    </div>
                    <audio controls preload="none" src={s.url} className="h-9 w-full" />
                  </>
                ) : (
                  <p className="text-[13px] text-[#686868]">Henüz örnek ses yok. Müşteri sayfasında bu pakette DİNLE düğmesi gösterilmez.</p>
                )}
                <div className="flex flex-wrap gap-2">
                  <label
                    htmlFor={inputId}
                    className={(s ? btnGhost : btnPrimary + " !px-4 !py-2 !text-[13px]") + (mesgul ? " pointer-events-none opacity-60" : " cursor-pointer")}
                  >
                    {mesgul === id ? "Yükleniyor…" : s ? "Sesi değiştir" : "MP3 / WAV yükle"}
                  </label>
                  {s && (
                    <button type="button" className={btnGhost} disabled={!!mesgul} onClick={() => sesKaldir(id, ad)}>
                      Kaldır
                    </button>
                  )}
                  <input
                    id={inputId}
                    type="file"
                    accept=".mp3,.wav,audio/mpeg,audio/wav,audio/x-wav"
                    className="sr-only"
                    disabled={!!mesgul}
                    onChange={(e) => {
                      void sesYukle(id, ad, e.target.files?.[0]);
                      e.target.value = "";
                    }}
                  />
                </div>
              </div>
            );
          })}
        </div>
      )}
    </div>
  );
}
