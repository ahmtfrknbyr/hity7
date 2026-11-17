"use client";

/**
 * lib/remake-ses.ts
 * Remake Beat sayfasındaki DİNLE düğmelerinin örnek sesleri. CEO panelinden yüklenen sesler site_content tablosunda
 * "remake_sesler" anahtarında tutulur (her paket ayrı kayıt). Veritabanına ulaşılamazsa veya ses yoksa boş döner;
 * sayfa hiçbir zaman bozulmaz ve sesi olmayan pakette DİNLE düğmesi gösterilmez.
 */
import { useEffect, useState } from "react";
import { getSupabase } from "./supabase";
import { SES_ANAHTARI, sesleriTemizle, type SesHaritasi } from "./ses-dogrula";

export { REMAKE_PAKETLERI, type RemakePaketId, type SesHaritasi, type SesKaydi } from "./ses-dogrula";

const TTL = 15000;
let paylasilan: { at: number; promise: Promise<SesHaritasi> } | null = null;

export async function remakeSesleriOku(): Promise<SesHaritasi> {
  try {
    const { data, error } = await getSupabase().from("site_content").select("value").eq("key", SES_ANAHTARI).maybeSingle();
    if (error) return {};
    return sesleriTemizle((data as { value?: unknown } | null)?.value);
  } catch {
    return {};
  }
}

/** Sayfadaki tüm kullanıcılar tek isteği paylaşır; 15 saniyeden eskiyse yeniden okunur. */
function yukle(): Promise<SesHaritasi> {
  const simdi = Date.now();
  if (!paylasilan || simdi - paylasilan.at > TTL) paylasilan = { at: simdi, promise: remakeSesleriOku() };
  return paylasilan.promise;
}

/** Yüklenme bitene kadar null döner (düğmeler gösterilmez: "çalışmayan düğme" anlık bile görünmez). */
export function useRemakeSesler(): SesHaritasi | null {
  const [sesler, setSesler] = useState<SesHaritasi | null>(null);
  useEffect(() => {
    let canli = true;
    yukle().then((s) => {
      if (canli) setSesler(s);
    });
    return () => {
      canli = false;
    };
  }, []);
  return sesler;
}
