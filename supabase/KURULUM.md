# HITY7 — Kurulum ve canlıya alma

Bu adımlar yapılmadan sipariş, bakiye, dosya yükleme ve destek **çalışmaz**. Site bunu gizlemez; ilgili ekranlarda "henüz kurulmamış" uyarısı gösterir.

## 1. Gizli sunucu anahtarı (zorunlu)

Supabase → **Project Settings → API Keys → Secret keys** bölümünden bir *secret key* (`sb_secret_...`) oluşturun. Eski projelerde **Legacy API keys → `service_role`** anahtarı da olur.

`.env.local` dosyasına ve canlı sunucunun (ör. Vercel) ortam değişkenlerine ekleyin:

```
SUPABASE_SECRET_KEY=sb_secret_...
```

- Bu anahtar yalnızca sunucuda kullanılır. Adında `NEXT_PUBLIC_` olmamalı, tarayıcıya hiçbir zaman gönderilmez.
- `SUPABASE_SERVICE_ROLE_KEY` adı da desteklenir.

## 2. Veritabanı kurulumu (migration)

Sıra önemlidir. SQL adımları Supabase → **SQL Editor**'de dosyanın tamamını yapıştırıp **Run** ile yapılır.

1. **Tam yedek** (ücretsiz planda Supabase otomatik yedek almaz, panelden yedek indirilemez):
   - CSV dışa aktarma tam yedek **değildir**: fonksiyonlar, RLS politikaları, tetikleyiciler, kısıtlar ve üye hesapları CSV'ye girmez.
   - Önerilen: `supabase/yedek-al.ps1`. Kendi PowerShell pencerende proje klasöründe `powershell -ExecutionPolicy Bypass -File .\supabase\yedek-al.ps1` çalıştır.
     - Gerekli: PostgreSQL 17 komut satırı araçları (https://www.postgresql.org/download/windows/ → EDB yükleyicisi → yalnızca "Command Line Tools").
     - Bağlantı adresi: Supabase → projen → **Connect** → **Session pooler**. Şifre gizli sorulur; dosyaya yazılmaz.
     - Çıktı: `Belgeler\hity7-yedekler\<tarih-saat>` → `public-tam.dump` (tüm tablolar + veriler + fonksiyonlar + politikalar), `public-sema.sql`, `uyelik-hesaplari.dump`.
     - Betik sonunda yedekteki tablo, fonksiyon ve politika sayısını gösterir. Bu sayılar sıfırsa durun.
   - Alternatif (Docker Desktop varsa): Supabase CLI ile `npx supabase db dump --db-url "<adres>" -f roles.sql --role-only`, `... -f schema.sql`, `... -f data.sql --use-copy --data-only`.
   - Storage'daki dosyalar (WAV, görseller) veritabanı yedeğine girmez; migration'lar onlara dokunmaz.
2. **Ön kontrol** (`supabase/on-kontrol.sql`) — yalnızca okur, hiçbir şeyi değiştirmez:
   1. supabase.com → projen → sol menü **SQL Editor** → **New query** (+).
   2. VS Code'da `supabase/on-kontrol.sql` dosyasını aç → `Ctrl+A`, `Ctrl+C` → SQL Editor'e `Ctrl+V`.
   3. Sağ üstteki rol seçimi varsayılan **postgres** kalsın.
   4. **Run** (veya `Ctrl+Enter`). "Destructive operation" uyarısı çıkarsa DUR: yanlış dosya yapıştırılmıştır.
   5. Sonuçta tek satır, tek sütun (`hity7_kontrol`) görünür. Hücreye tıkla, metni kopyala ve geliştiriciye gönder.
   6. Sorguyu kaydetmen gerekmez. Sonuç kişisel veri içermez; yalnızca tablo / kural bilgisi ve sayılar vardır.
3. **Kurulum:** `supabase/TUM-MIGRATIONLAR.sql` (01 → 07 sırasıyla). Sonuçta "Success" görünmeli.
   - `orders.status` bir ENUM ise dosyayı **bir kez daha** çalıştırın (eski durum adları ikinci çalıştırmada çevrilir).
4. **Son kontrol:** `supabase/on-kontrol.sql` yeniden. `hity7_kurulum` bölümünde `place_order`, `wallet_balance`, `h7_sepet_siparis` **true** olmalı.
5. **Site denemesi:** Giriş, kayıt, CEO paneli; ardından CEO panelinden test üyeye elle bakiye ekleyip küçük bir sipariş deneyin.

Ne değişir, ne değişmez:

- Mevcut siparişler, bakiyeler ve üyeler silinmez. Üye kayıt tetikleyicisine dokunulmaz.
- Eski sipariş durumları yeni adlarına çevrilir: "Beklemede" → "Alındı", "İptal" → "İptal Edildi".
- Eski RLS politikaları kaldırılmadan önce `h7_politika_yedegi`, tabloların eski RLS durumu `h7_rls_yedegi` tablosuna yedeklenir.
- 07, tablolar `place_order` ile uyumlu değilse açıklayıcı bir hata verir ve hiçbir şey değiştirmez.
- Hata olursa o bölümdeki hiçbir değişiklik uygulanmaz. Dosyalar tekrar çalıştırılabilir.

Geri dönüş (yalnızca sorun çıkarsa):

- Giriş / panel erişiminde sorun: `supabase/geri-al/05-rls-geri-al.sql`. Eski politikaları ve RLS durumunu geri kurar.
- Sipariş fonksiyonlarında sorun: `supabase/geri-al/07-cuzdan-cekirdek-geri-al.sql`. Bu durumda site sipariş alamaz.

## 3. İlk CEO ataması

`supabase/ilk-ceo-atama.sql` dosyasındaki e-postayı kendi hesabınızla değiştirip SQL Editor'de çalıştırın.

- CEO hesabı kayıt ekranından açılamaz; yalnızca bu yolla atanır.
- Eski düzende "ilk kayıt olan admin olur" kuralı vardı. Bu kural artık kapalı.

## 4. Dosya deposu (Storage)

Supabase → **Storage** → `site-media` deposunun var olduğundan ve **public** olduğundan emin olun.

- Sipariş dosyaları kullanıcının kendi klasörüne (`siparis/<kullanıcı>/...`) tahmin edilemeyen adlarla yüklenir.
- Dosya başına sınır 50 MB'tır. Supabase ücretsiz planda genel sınır da 50 MB'tır.

## 5. Ödeme

- **Kart (PayTR):** Admin paneli → Ödeme Yöntemleri → PayTR. Mağaza no, Merchant Key ve Merchant Salt girin.
  - PayTR mağaza panelinde **Bildirim URL** alanına `https://SITENIZ/api/odeme/paytr-bildirim` yazın.
  - Önce **test** modunda deneyin, sonra canlıya alın.
- **Havale / EFT:** Aynı bölümden IBAN ekleyin. Bildirimler Cüzdan bölümünden dekont kontrolüyle onaylanır.
- iyzico, Stripe, Shopier ve Papara için anahtar kaydedilebilir ama ödeme akışları **henüz yazılmadı**. Bu sağlayıcılar kapalı eklenir ve sitede görünmez.

## 6. SMM sağlayıcıları

Admin paneli → SMM Sağlayıcıları → API adresi ve anahtarı ekleyin, servisleri çekin ve satılacakları **Satışta** yapın.

- Satıştaki hizmet sipariş edildiğinde sağlayıcıya **otomatik** gönderilir.
- Siparişler bölümündeki **"SMM durumlarını güncelle"** düğmesi durumları sağlayıcıdan sorgular.
- Hatalar İşlem Kayıtları → "SMM hata kayıtları" bölümünde görünür.
- ⚠️ Sağlayıcı fiyatları çoğunlukla **USD**'dir; kâr oranı aynı sayının üzerine eklenir. Satış fiyatının TL karşılığını mutlaka kontrol edin.

## 7. Yapay zekâ asistanı

`ANTHROPIC_API_KEY` ortam değişkenini ekleyin. Model isteğe bağlı olarak `ANTHROPIC_MODEL` ile değiştirilebilir; varsayılan `claude-sonnet-5-5`.

Asistanın önerilerini yalnızca **CEO** uygular.

## 8. Dijital dağıtım

Platformlara gönderim için bir dağıtım ortağı API'si bağlı **değildir**. Yayınlar yönetim tarafından elle iletilir.

- ISRC ve UPC kodları Admin paneli → **Dijital Yayınlar** bölümünden atanır.
- Atanan kodları müşteri kendi panelinde görür.

## 9. Giriş, e-posta ve şifre sıfırlama

Supabase → **Authentication → URL Configuration**:

- **Site URL:** canlıda `https://SITENIZ`. Şimdilik `http://localhost:3000` kalabilir.
- **Redirect URLs:** `https://SITENIZ/**` ve `http://localhost:3000/**` ekleyin.
  - "Şifremi unuttum" bağlantısı `/sifre-yenile` sayfasına döner.
  - Bu adres listede yoksa Supabase ana sayfaya döner; site kullanıcıyı yine şifre sayfasına yönlendirir.

E-posta servisi (SMTP):

- Supabase'in hazır e-posta servisinin gönderim sınırı çok düşüktür, gerçek müşterilere yetmez.
- **Authentication → Emails → SMTP Settings** bölümüne Resend, Brevo gibi bir servisin bilgilerini girin.
- Türkçe e-posta şablonları: `supabase/eposta-sablonlari.md`.

## 10. Şirket bilgileri ve yasal metinler

Yönetim paneli → **Site Yazıları → Şirket bilgileri** bölümünü doldurun: unvan, adres, telefon, vergi dairesi ve numarası, varsa MERSİS ve KEP. E-posta için aynı sayfadaki "İletişim e-postası" kullanılır.

- Bu bilgiler yasal sayfalarda (`/yasal/...`) ve sitenin en altında görünür. Boş alanlar sarı "doldurulacak" işaretiyle görünür.
- Yasal sayfalar: KVKK Aydınlatma Metni, Gizlilik ve Çerez Politikası, Ön Bilgilendirme Formu, Mesafeli Satış Sözleşmesi, İade ve İptal Koşulları, Kullanım Koşulları ve Hizmet Sözleşmesi.
- Hazır metinler genel şablondur, hukuki danışmanlık yerine geçmez. Yayına almadan önce bir hukukçuya kontrol ettirin.
- Düzeltilmiş metinleri **Site Yazıları → Yasal metinler** bölümüne yapıştırabilirsiniz.
- Sipariş, bakiye yükleme ve üyelik formlarında sözleşme onay kutusu vardır. Onay tarihi ve sözleşme sürümü sipariş kaydına ve işlem kayıtlarına yazılır.

## 11. Sepet ve ek hizmetler (upsell)

Remake Beat ve Mix & Mastering siparişleri sepet üzerinden tamamlanır. Sağ üstteki sepet ikonu her sayfada görünür.

- **Ek hizmet fiyatları ve öneriler:** Yönetim paneli → **Hizmetler & Fiyatlar → Ek hizmetler (sepet önerileri)**.
  - Fiyat, ad ve satış durumu değiştirilebilir; yeni ek hizmet eklenebilir.
  - Her sayfa için kartın görünürlüğü, başlığı ve önerilecek ek hizmetler seçilir.
- **Sipariş:** Ana hizmet ile ek hizmeti aynı siparişte kaydedilir. Siparişler bölümünde "Sipariş kalemleri" altında ikisi birlikte görünür.
- **Ödeme yalnızca bakiyeden yapılır.** Tutar sunucuda Supabase'teki güncel fiyatlardan yeniden hesaplanır; tarayıcıdan gelen fiyat kullanılmaz.
  - Müşterinin ekranda gördüğü toplam farklıysa sipariş oluşmaz, müşteriden yeni toplamı onaylaması istenir.
  - Bakiye yetmezse sipariş oluşmaz ve bakiyeden hiçbir şey düşmez.
  - Sahte ödeme veya deneme bakiyesi yoktur. Bakiye yalnızca gerçek yüklemeyle (PayTR, onaylanan havale) ya da yönetimin elle düzeltmesiyle artar.
- **Tek işlem:** Sipariş + bakiye düşümü `place_order` fonksiyonuyla tek işlemde yapılır (migration 07).
  - Sepette iki hizmet birden (Remake Beat + Mix & Mastering) varsa `h7_sepet_siparis` (migration 06) iki siparişi ve bakiye düşümünü tek işlemde yapar.
  - Bu fonksiyonlar kurulmamışsa müşteriye "sipariş sistemi kurulmamış" uyarısı gösterilir; yarım ödeme yapılmaz.
- Aynı sepet ikinci kez gönderilirse (çift tıklama, bağlantı kopması) yeni sipariş oluşmaz.
- Sepetten çıkarılan ve hiçbir siparişte geçmeyen yüklenmiş dosyalar depodan silinir.

## Geri dönüş

- Değişiklikler öncesi proje yedeği: `Documents/hit7y-yedek-2026-11-10-oncesi.zip`
- Eski RLS politikaları: `select * from public.h7_politika_yedegi;`
