"use client";

/**
 * components/DestekEkleri.tsx
 * Destek mesajı dosya ekleri (8. aşama): seçme (EkSecici) ve görüntüleme / dinleme / indirme (EkListesi).
 * Ekler özel depodadır; görüntülemek için /api/dosya'dan kısa süreli imzalı bağlantı istenir
 * (yalnızca talep sahibi ve destek yetkili personel alabilir). Müşteri sayfası ve CEO paneli ortak kullanır.
 */
import { useState } from "react";
import { boyut, dosyaBaglantisi } from "../lib/dosya";

export const EK_UZANTILAR = ["jpg", "jpeg", "png", "webp", "mp4", "mov", "mp3", "wav", "flac"];
export const EK_ACCEPT = ".jpg,.jpeg,.png,.webp,.mp4,.mov,.mp3,.wav,.flac,image/jpeg,image/png,image/webp,video/mp4,video/quicktime,audio/mpeg,audio/wav,audio/flac";
const MB = 1024 * 1024;

export type Ek = { name: string; key: string; size?: number; mime?: string; provider?: string };

const tur = (ad: string) => {
  const e = (ad.split(".").pop() || "").toLowerCase();
  if (["jpg", "jpeg", "png", "webp"].includes(e)) return "gorsel";
  if (["mp4", "mov"].includes(e)) return "video";
  if (["mp3", "wav", "flac"].includes(e)) return "ses";
  return "dosya";
};

/** Dosya seçimi (türü ve boyutu tarayıcıda da kontrol edilir; asıl kontrol sunucuda) */
export function EkSecici({ dosyalar, onChange, karanlik = false }: { dosyalar: File[]; onChange: (f: File[]) => void; karanlik?: boolean }) {
  const [hata, setHata] = useState("");
  return (
    <div style={{ marginTop: 10 }}>
      <label
        style={{
          display: "inline-flex",
          alignItems: "center",
          gap: 8,
          border: `2.5px dashed ${karanlik ? "#f5c518" : "#111"}`,
          borderRadius: 14,
          padding: "9px 14px",
          cursor: "pointer",
          fontSize: 12.5,
          fontWeight: 800,
          background: karanlik ? "transparent" : "#fff",
        }}
      >
        📎 Dosya ekle (fotoğraf, video, şarkı)
        <input
          type="file"
          multiple
          accept={EK_ACCEPT}
          style={{ display: "none" }}
          onChange={(e) => {
            setHata("");
            const yeni = Array.from(e.target.files || []);
            e.target.value = "";
            const kotu = yeni.find((f) => !EK_UZANTILAR.includes((f.name.split(".").pop() || "").toLowerCase()));
            if (kotu) return setHata(`“${kotu.name}” desteklenmiyor. İzin verilenler: JPG, PNG, WEBP, MP4, MOV, MP3, WAV, FLAC.`);
            const buyuk = yeni.find((f) => f.size > 50 * MB);
            if (buyuk) return setHata(`“${buyuk.name}” 50 MB'tan büyük.`);
            onChange([...dosyalar, ...yeni].slice(0, 10));
          }}
        />
      </label>
      {dosyalar.length > 0 && (
        <ul style={{ listStyle: "none", padding: 0, margin: "8px 0 0", display: "grid", gap: 6 }}>
          {dosyalar.map((f, i) => (
            <li key={`${f.name}-${i}`} style={{ display: "flex", justifyContent: "space-between", gap: 8, fontSize: 12.5, fontWeight: 600 }}>
              <span style={{ overflowWrap: "anywhere" }}>
                {f.name} · {boyut(f.size)}
              </span>
              <button type="button" onClick={() => onChange(dosyalar.filter((_, j) => j !== i))} style={{ border: 0, background: "none", textDecoration: "underline", cursor: "pointer", fontWeight: 700, color: "inherit" }}>
                Kaldır
              </button>
            </li>
          ))}
        </ul>
      )}
      {hata && <p style={{ margin: "8px 0 0", fontSize: 12.5, fontWeight: 700, color: "#b42318" }}>{hata}</p>}
    </div>
  );
}

/** Mesajdaki ekler: görüntüle / dinle / indir */
export function EkListesi({ mesajId, ekler, karanlik = false }: { mesajId: string; ekler: Ek[]; karanlik?: boolean }) {
  const [acik, setAcik] = useState<Record<string, string>>({});
  const [hata, setHata] = useState("");
  const [bekle, setBekle] = useState("");
  if (!ekler?.length) return null;

  async function ac(e: Ek, indir: boolean) {
    setHata("");
    setBekle(e.key);
    try {
      const url = await dosyaBaglantisi({ tur: "destek", mesajId, key: e.key });
      if (indir) {
        const a = document.createElement("a");
        a.href = url;
        a.rel = "noopener";
        document.body.appendChild(a);
        a.click();
        a.remove();
      } else setAcik((c) => ({ ...c, [e.key]: url }));
    } catch (err) {
      setHata(err instanceof Error ? err.message : "Dosya açılamadı.");
    }
    setBekle("");
  }

  const btn: React.CSSProperties = {
    border: `2px solid ${karanlik ? "#f5c518" : "#111"}`,
    borderRadius: 999,
    background: "transparent",
    color: "inherit",
    padding: "4px 10px",
    fontSize: 11,
    fontWeight: 800,
    cursor: "pointer",
  };

  return (
    <div style={{ marginTop: 8, display: "grid", gap: 8 }}>
      {ekler.map((e) => {
        const t = tur(e.name);
        const url = acik[e.key];
        return (
          <div key={e.key} style={{ border: `2px solid ${karanlik ? "#444" : "#ddd"}`, borderRadius: 12, padding: 8 }}>
            <div style={{ display: "flex", flexWrap: "wrap", gap: 8, alignItems: "center", justifyContent: "space-between" }}>
              <span style={{ fontSize: 12.5, fontWeight: 700, overflowWrap: "anywhere" }}>
                {t === "gorsel" ? "🖼" : t === "video" ? "🎬" : t === "ses" ? "🎵" : "📄"} {e.name}
                {e.size ? ` · ${boyut(e.size)}` : ""}
              </span>
              <span style={{ display: "flex", gap: 6 }}>
                {t !== "dosya" && !url && (
                  <button type="button" style={btn} onClick={() => ac(e, false)} disabled={bekle === e.key}>
                    {t === "gorsel" ? "GÖRÜNTÜLE" : t === "video" ? "İZLE" : "DİNLE"}
                  </button>
                )}
                <button type="button" style={btn} onClick={() => ac(e, true)} disabled={bekle === e.key}>
                  İNDİR ↓
                </button>
              </span>
            </div>
            {url && t === "gorsel" && <img src={url} alt={e.name} style={{ marginTop: 8, maxWidth: "100%", maxHeight: 320, borderRadius: 10, display: "block" }} />}
            {url && t === "video" && <video src={url} controls style={{ marginTop: 8, width: "100%", maxHeight: 320, borderRadius: 10 }} />}
            {url && t === "ses" && <audio src={url} controls style={{ marginTop: 8, width: "100%" }} />}
          </div>
        );
      })}
      {hata && <p style={{ margin: 0, fontSize: 12, fontWeight: 700, color: karanlik ? "#ffb4a8" : "#b42318" }}>{hata}</p>}
    </div>
  );
}
