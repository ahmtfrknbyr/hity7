# HITY7 · İlk sürüm yayın planı (MVP)

Kural: Yeni özellik yok. Mevcut özellikler çalışan ve güvenli hâle getirilir. Biten aşama yeniden açılmaz; yalnızca testte
gerçek bir hata çıkarsa geri dönülür. Canlı veritabanı, ödeme, üretim ortamı ve kritik değişiklikler ayrı onayla yapılır.

Durum tarihi: 2026-11-11 · Güncelleme 2026-11-12: alan adı **hity7.net** kararı; Aşama 4'ün yerel hazırlığı bitti
(Cloudflare ayarları eklendi, yerel Cloudflare provası geçti; henüz yayın YOK). Aşama 2 hâlâ bekliyor (yedek klasörü yok,
ön kontrol çıktısı gelmedi); canlı veritabanında değişiklik yapılmadı.
Genel denetim (2026-11-12): tsc temiz, üretim derlemesi geçti; 20 sayfa × (390 px + 1366 px) Chrome'da konsol hatası /
taşma / kırık bağlantı yok; para ve yetki API'leri incelendi, kritik açık yok. 4 küçük lint düzeltmesi yapıldı. Kalan 15
lint uyarısı davranışı etkilemiyor (bilerek dokunulmadı). Giriş yapılmış CEO paneli Aşama 3'ten sonra test edilecek.

---

## Durum raporu

### 1. Tamamen çalışan özellikler
- Tüm sayfalar ve tasarım (masaüstü + mobil): ana sayfa, Remake Beat, Mix & Mastering, SMM Panel, Influencer Marketing,
  Dijital Yayın, Destek, yasal sayfalar, giriş / üye ol / şifre sıfırlama ekranları, Hesabım, Bakiye.
- Üyelik: kayıt, giriş, oturum (Supabase Auth). CEO panelinde üyeler görünüyor.
- CEO paneli içerik yönetimi: site yazıları, hizmet ve fiyatlar, ek hizmet (upsell) ayarları, prodüktörler, şirket bilgileri,
  yasal metinler, influencer ekleme, duyuru / bakım modu.
- Sepet ve upsell arayüzü: ekleme, çıkarma, adet, sayfalar arasında kalıcılık, aynı hizmetin iki kez eklenmemesi.
- Influencer TikTok kuralı (en az 30 farklı hesap; arayüz + sunucu).
- Ziyaret sayacı, yasal onay kutuları.

### 2. Kodu hazır; migration veya entegrasyon bekleyen
| Özellik | Bekleyen |
|---|---|
| Tüm siparişler + bakiyeden düşüm (sepet dahil) | Migration 06–07 + sunucu gizli anahtarı |
| Dosya yükleme (WAV, kapak), destek talepleri, bakiye ekranı | Sunucu gizli anahtarı |
| Havale / EFT ile bakiye yükleme | Anahtar + CEO panelinde IBAN |
| Kartla ödeme (PayTR) | Mağaza onayı + anahtarlar + yayında adres |
| Sipariş durumu, teslimat, iade, havale onayı, elle bakiye, rol verme, CEO istatistikleri, işlem kayıtları, ISRC / UPC | Migration 01–05 |
| Satır güvenliği (RLS) kuralları | Migration 05 |
| SMM otomatik gönderim | SMM sağlayıcı API anahtarı + "Satışta" hizmetler |
| CEO yapay zekâ asistanı (isteğe bağlı) | ANTHROPIC_API_KEY |
| Cloudflare'de yayın | OpenNext ayarları + yayın onayı |

### 3. Eksikler ve hatalar
Aşama 1'de düzeltilenler:
- Mix & Mastering "Farkı kendin duy" oynatıcısı projede olmayan dosyalara bağlıydı (bozuk). CEO panelindeki örneklere bağlandı; örnek yoksa bölüm gizli.
- SMM / Influencer / Dijital Yayın'da çift gönderim koruması yoktu. İstek kimliği (idempotency) eklendi.
- Bakiye sayfası, sistem kurulmamışken sebebini göstermiyordu. Açıklayıcı mesaj eklendi.
- CEO panelinde üye bakiyeleri görünmüyordu. Üye bakiyeleri listesi ve düzeltme formunda mevcut bakiye eklendi.
- PayTR'a giden müşteri IP'si Cloudflare'de yanlış okunacaktı. Düzeltildi.
- Migration 01/02 ENUM sütunlarda çalışmıyordu. Düzeltildi.

Kalan (kod dışı veya karar):
- İçerik: şirket bilgileri boş (yasal sayfalarda "doldurulacak"), örnek prodüktörler ve fiyatları, gerçek influencer yok
  (TikTok için ≥30 gerekir), satışta SMM hizmeti yok, Mix örnek sesi yok.
- Remake Beat sayfasında örnek dinleme alanı yok. CEO panelindeki "Remake Beat örnek çalışmalar" bölümü şu an sayfaya yansımıyor (karar).
- PayTR'a telefon ve adres sabit gönderiliyor. Canlı modda gerçek bilgi istenip istenmediği PayTR'a sorulacak.
- `public/models/character.glb` (123 MB) kullanılmıyor ve Cloudflare'in 25 MB dosya sınırını aşıyor. Yayın aşamasında proje dışına taşınacak.
- 15 eski lint uyarısı/hatası var; derlemeyi ve çalışmayı etkilemiyor.

### 4. Yayını engelleyen kritik sorunlar
1. Canlı veritabanında sipariş / bakiye fonksiyonları yok; migration'lar hiç çalıştırılmamış. Hiçbir sipariş alınamaz.
2. Sunucu gizli anahtarı (SUPABASE_SECRET_KEY) hiçbir ortamda yok. Sipariş, yükleme, bakiye ve destek kapalı.
3. Site yayında değil. PayTR bildirimi, e-posta bağlantıları ve Supabase yönlendirmeleri canlı adrese ayarlanamıyor.
4. E-posta: özel SMTP olmadan Supabase yalnızca ekip üyelerine ve saatte 2 e-posta gönderir. Gerçek müşterilere kayıt onayı ve şifre sıfırlama ulaşmaz.
5. Aktif ödeme yöntemi yok; müşteri bakiye yükleyemez. En hızlı yol: Havale/EFT + CEO onayı. PayTR mağaza onayı sonra.
6. RLS kuralları eski hâlinde ve doğrulanmamış. Gerçek ödeme ve anahtar girilmeden önce migration 05 çalışmalı.
7. Satıcı / şirket bilgileri boş (mesafeli satış için zorunlu).

---

## RLS değişikliği (migration 05) risk değerlendirmesi
05, 19 tablodaki eski RLS politikalarını yedekleyip (h7_politika_yedegi, h7_rls_yedegi) yenileriyle değiştirir.

| Alan | Neden bozulmaz | On-kontrol'de doğrulanacak |
|---|---|---|
| Üye kaydı | Profil satırı veritabanı tetikleyicisiyle oluşur; tarayıcı profil eklemez | auth.users tetikleyicisinin fonksiyonu `fonksiyon_security_definer: true` |
| Giriş | Supabase Auth public tablolara dokunmaz | — |
| Profil okuma / ad güncelleme | "Kendi profilini okur / günceller" kuralı koda birebir uyuyor (provada test edildi) | — |
| Sipariş oluşturma | Yalnızca sunucu (service_role RLS'i atlar) | `roller.service_role.rls_atlar: true` |
| Sipariş durumu / iade / bakiye işlemleri | SECURITY DEFINER fonksiyonlar tablo sahibi olarak çalışır | orders, wallet_transactions: `sahip: postgres`, `rls_zorunlu: false` |
| CEO / admin erişimi | h7_rol() rol değerine bakar | `veri.roller` içinde CEO hesabı tam olarak `ceo` (veya `admin`) |
| Tarayıcıdan yazan panel bölümleri | Site yazıları, influencer, örnek sesler, SMM, ödeme yöntemleri, destek, rol yetkileri yeni kurallarda karşılanıyor (kod taraması) | — |
| Kodun bilmediği eski erişimler | Kaldırılır | `politikalar` listesi tek tek karşılaştırılır |

Geri dönüş: `supabase/geri-al/05-rls-geri-al.sql` eski politikaları ve RLS durumunu geri kurar (provada denendi).
Sonuç: 4 doğrulama maddesi geçerse risk düşük. Geçmeyen madde olursa canlıya geçmeden önce yerelde düzeltilip provada test edilir.

---

## Tamamlanma planı (6 aşama)

### Aşama 1 — Yerel kod tamamlama ve hazırlık · onay gerekmez · TAMAMLANDI (2026-11-11)
Bitiş kriterleri:
- [x] Tip kontrolü hatasız
- [x] Lint'te yeni hata yok
- [x] Üretim derlemesi başarılı
- [x] Yerel prova: migration 01–07, iki şema türünde, güvenlik + geri alma senaryoları geçti
- [x] Uçtan uca tekrar koruması testleri geçti
- [x] Arayüz duman testi: sayfalar açılıyor, konsolda hata yok
- [x] Yedek betiği, ön kontrol rehberi, RLS risk değerlendirmesi hazır

### Aşama 2 — Tam yedek ve ön kontrol · senin işlemin (salt okunur)
- Sen: `supabase/yedek-al.ps1` ile tam yedek al, `supabase/on-kontrol.sql` çalıştırıp çıktıyı gönder.
- Ben: çıktıyı RLS tablosundaki 4 maddeye ve sütun / kısıt uyumuna göre değerlendiririm.

Bitiş kriterleri:
- Yedek klasöründe dosyalar var; betiğin gösterdiği tablo, fonksiyon ve politika sayıları > 0.
- 4 doğrulama maddesi geçti (geçmeyen madde yerelde düzeltildi ve provada test edildi).

### Aşama 3 — Canlı veritabanı kurulumu · ONAY: canlı veritabanı
- `TUM-MIGRATIONLAR.sql` çalıştırılır (orders.status ENUM ise iki kez), ardından `on-kontrol.sql`.

Bitiş kriterleri:
- `place_order`, `wallet_balance`, `h7_sepet_siparis` true; 19 tabloda RLS açık.
- Mevcut üyeyle giriş, yeni test üyesi kaydı ve CEO panelinin tüm bölümleri çalışıyor.
- CEO test üyesine elle bakiye ekleyebiliyor; üye başka üyenin verisini göremiyor.

### Aşama 4 — Sunucu, alan adı ve yayın · ONAY: üretim ortamı (Cloudflare), gizli anahtar, e-posta
Karar (2026-11-12): workers.dev yerine kendi alan adı kullanılacak. Alan adını kullanıcı kendisi satın alır.
- Alan adı: **hity7.net** (karar 2026-11-12; kod zaten `panel.hity7.net` kullanıcı adreslerini kullanıyor, bu yüzden
  alan adının bize ait olması güvenlik açısından da gerekli). Cloudflare Registrar'dan alınır (maliyetine satış,
  ücretsiz WHOIS gizliliği, DNS otomatik, otomatik yenileme açık).
- ✅ (2026-11-12, yerel) OpenNext + wrangler ayarları eklendi: `@opennextjs/cloudflare` 1.20.16 + `wrangler` 4.161.0
  (devDependencies), `open-next.config.ts` (R2 yerine ücretsiz static-assets önbelleği), `wrangler.jsonc` (Worker adı
  `hity7`), `npm run cf:build | cf:preview | cf:deploy`. `character.glb` → `Documents\hity7-disari\public-models\`
  (geri koyma notu yanında). Yerel prova: Worker 1,48 MB (gzip; ücretsiz sınır 3 MB), 51 statik dosya (en büyüğü
  0,23 MB); tüm sayfalar 200, API'ler doğru hata kodları, Chrome'da 9 sayfada konsol hatası yok; pakette gizli anahtar
  yok. Not: önizleme yalnızca `npm run cf:preview` ile yapılır (önbelleği doldurur); doğrudan `wrangler dev` sayfaları
  askıda bırakır. OpenNext Windows için "tam uyumlu değil" uyarısı veriyor; yerel prova sorunsuz geçti.
- Yayın öncesi kullanıcı: Cloudflare hesabı açar, hity7.net'i satın alır; ilk yayında `npx wrangler login` ile
  tarayıcıdan izin verir.
- Gizli anahtar Cloudflare secret olarak girilir; yayın yapılır; alan adı Worker'a "Custom Domain" olarak bağlanır
  (SSL otomatik); `www` → ana adres yönlendirmesi.
- İlk yayında CEO panelinden bakım modu AÇIK kalır (Aşama 6'ya kadar müşteriye açılmaz).
- Supabase Auth Site URL ve yönlendirme adresleri alan adına ayarlanır; alan adlı gönderici ile özel SMTP kurulur
  (SPF / DKIM DNS kayıtları); isteğe bağlı info@ adresi Cloudflare Email Routing ile kişisel e-postaya yönlendirilir.

Bitiş kriterleri:
- Alan adı (https, www dahil) siteyi açıyor; workers.dev adresi de çalışıyor.
- Canlı adreste tüm sayfalar açılıyor.
- Kayıt onayı ve şifre sıfırlama e-postası gerçek bir adrese ulaşıyor ve canlı adrese dönüyor.
- Dosya yükleme çalışıyor.
- Yayın paketinde gizli anahtar yok (tarama); işlemci sınırı hatası yok.

### Aşama 5 — Ödeme ve uçtan uca sipariş · ONAY: ödeme
- Havale / EFT (IBAN) açılır. PayTR mağaza bilgileri hazırsa test modu da açılır.

Bitiş kriterleri:
- Test üyesi havale bildirir, CEO onaylar, bakiye artar.
- Her hizmetten bir sipariş verilir (sepette Remake + Mix, SMM, Influencer Reels, Dijital Yayın). Bakiye her siparişte tam bir kez düşer; CEO siparişleri kalemleriyle görür.
- Bir iptal + iade denenir.
- PayTR açıldıysa test kartıyla yapılan ödeme bildirimle "ok" olur.

### Aşama 6 — İçerik ve canlıya açılış · ONAY: açılış
- Şirket bilgileri ve yasal metin kontrolü (hukukçu önerilir).
- Örnek prodüktör ve fiyatlar gerçekleriyle değiştirilir; gerçek influencerlar eklenir; SMM hizmetleri satışa açılır; Mix örnek sesleri yüklenir.
- Test verileri onayla temizlenir; varsa PayTR canlı moda alınır.

Bitiş kriterleri:
- Yasal sayfalarda "doldurulacak" işareti yok; sitede örnek veri görünmüyor.
- Canlı adreste son duman testi geçti; açılış onayı verildi.
