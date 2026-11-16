/**
 * app/api/zaman/route.ts
 * Sunucu saati. Kampanya geri sayımı tarayıcı saatine güvenmeden, sunucu saatine göre gösterilsin diye kullanılır.
 * (Kampanyanın geçerliliği sipariş anında ayrıca veritabanında sunucu saatiyle kontrol edilir.)
 */
import { connection } from "next/server";

export async function GET() {
  // Her istekte çalışsın (derleme anında sabitlenmesin)
  await connection();
  return Response.json({ now: Date.now(), tz: "Europe/Istanbul" }, { headers: { "Cache-Control": "no-store" } });
}
