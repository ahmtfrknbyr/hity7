/**
 * lib/server/kod.ts
 * Tahmin edilemeyen bağlantı kodu (ör. teslimat: a8K2mP9xQ4vN7rT3). Kriptografik rastgele, eşit dağılımlı [A-Za-z0-9].
 */
const ALFABE = "ABCDEFGHIJKLMNOPQRSTUVWXYZabcdefghijklmnopqrstuvwxyz0123456789";

export function rastgeleKod(uzunluk = 16): string {
  let out = "";
  while (out.length < uzunluk) {
    const buf = new Uint8Array(uzunluk * 2);
    crypto.getRandomValues(buf);
    for (const b of buf) {
      // 62'nin katı olan 248'in üstü atılır (modülo sapması olmasın)
      if (b < 248) out += ALFABE[b % 62];
      if (out.length === uzunluk) break;
    }
  }
  return out;
}
