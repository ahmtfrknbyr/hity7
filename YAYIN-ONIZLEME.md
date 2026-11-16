# HITY7 · Önizleme (Preview) yayını

Önizleme, canlı siteden (`hity7` Worker'ı, hity7.net) tamamen ayrı bir Cloudflare Worker'dır: **`hity7-onizleme`**.
Adres: https://hity7-onizleme.afbymanagement.workers.dev

## Güvenlik kuralları
- Canlı Supabase'e bağlantı YOKTUR. Derleme sırasında veritabanı adresi `https://onizleme-test-yok.invalid` yer tutucusudur;
  canlı proje kimliği ve anahtarı pakette bulunmaz (her yayında kontrol edilir).
- `HITY7_ONIZLEME=1`: bakiye yükleme, ödeme başlatma, havale bildirimi ve PayTR bildirimi sunucuda reddedilir.
- Gizli anahtar (SUPABASE_SECRET_KEY, ANTHROPIC_API_KEY, PayTR, R2) tanımlı değildir.
- Sayfalar `noindex` ve ekranda "ÖNİZLEME" şeridi vardır. Adres bilen herkes açabilir (parola yok).
- Git: `onizleme` dalı. `main` (canlı) dalına dokunulmaz.

## Yayın adımları (sıra önemli)
```
# 1) Derleme (canlı değerler yerine yer tutucular)
NEXT_PUBLIC_SUPABASE_URL=https://onizleme-test-yok.invalid NEXT_PUBLIC_SUPABASE_PUBLISHABLE_KEY=onizleme-anahtari-yok \
NEXT_PUBLIC_ONIZLEME=1 HITY7_ONIZLEME=1 npx opennextjs-cloudflare build
# 2) Sayfa önbelleğini pakete koy (bu adım atlanırsa sayfalar Cloudflare'de takılır, 500 verir)
npx opennextjs-cloudflare populateCache remote --config wrangler.onizleme.jsonc
# 3) Yayın (yalnızca hity7-onizleme Worker'ı)
npx wrangler deploy --config wrangler.onizleme.jsonc
```
Not: `.env.local` canlı değerleri içerir; derleme komutunda yukarıdaki değişkenlerin verilmesi bu yüzden zorunludur.

## Önizlemede çalışmayanlar
Veritabanı olmadığı için: giriş / kayıt, sipariş, bakiye, dosya yükleme, teslimat, CEO paneline giriş, e-posta doğrulama,
yapay zekâ asistanı, PayTR, R2. Sayfaların görünümü ve düzeni çalışır; veri gelen bölümler boş / hata durumunu gösterir.
