# HITY7 · 18 aşamalık geliştirme — durum dosyası

Başlangıç: 2026-11-16. Bu dosya her aşamadan sonra güncellenir. "Tamamlandı" yalnızca yerelde yazılıp test edilen iş için
kullanılır; canlıya uygulanmayan (migration, secret, deploy) her şey ayrıca belirtilir.

## 0. Analiz bulguları (2026-11-16, salt okunur)

| Konu | Bulgu |
|---|---|
| Canlı site | https://hity7.net yayında (Worker `hity7`, son dağıtım 2026-11-13 16:10, wrangler). `www.hity7.net` için DNS kaydı yok. |
| Canlı Cloudflare değişkenleri | Yalnızca 2 secret: `NEXT_PUBLIC_SUPABASE_URL`, `NEXT_PUBLIC_SUPABASE_PUBLISHABLE_KEY`. **`SUPABASE_SECRET_KEY` yok.** `ANTHROPIC_API_KEY` yok. |
| Canlı veritabanı (wxmoiyqschkcbrvvnmpr) | Temel tablolar var (profiles, orders, wallet_transactions, influencers, site_content, support_*, role_permissions, payment_providers, provider_secrets, smm_*, samples, page_views). **Migration 01–07'nin hiçbiri uygulanmamış**: audit_log, order_events, releases yok; place_order, wallet_balance, h7_* fonksiyonlarının hiçbiri yok. |
| Moderatör atama hatası (3. aşama) | Panel `h7_uye_rol` fonksiyonunu çağırıyor; canlıda yok. |
| Manuel bakiye hatası (5. aşama) | Panel `h7_bakiye_duzelt` fonksiyonunu çağırıyor; canlıda yok (ayrıca `wallet_balance` yok). |
| Dosya yükleme hatası (18. aşama) | `/api/yukle` → `serverReady()` = `SUPABASE_SECRET_KEY` (veya `SUPABASE_SERVICE_ROLE_KEY`) tanımlı değil. Cloudflare'de bu secret yok. |
| Bakım modu (9. aşama) | Yalnızca tarayıcıda bir perde (GlobalMenu). Sayfalar ve API'ler kapanmıyor. Oturum localStorage'da olduğu için sunucu rolü bilemiyor. |
| Ana sayfa yazıları (16. aşama) | `app/page.tsx` site_content'i hiç okumuyor; tüm yazılar kodda sabit. Panel kaydediyor ama sayfa okumuyor. |
| PayTR (17. aşama) | Bildirim adresi zaten var: `/api/odeme/paytr-bildirim`. İmza hesapları resmî şemayla uyumlu. **Açık:** test modundaki başarılı ödeme gerçek bakiye ekliyor. |
| Influencer kuralı | Kodda TikTok için en az **30** hesap; istenen **5**. |
| Maliyet gizliliği | `influencers` tablosunun aktif satırları herkese açık (RLS satır bazlı) → maliyet bu tabloya yazılamaz, ayrı CEO tablosu gerekir. |
| Canlı ↔ yerel | Canlı CEO panelinde de `h7_uye_rol` / `h7_bakiye_duzelt` çağrıları var; "Site Yayında" adında ayrı bir anahtar yok (yalnızca "Bakım modu" ve hizmet başına "Sitede yayında"). |

## Aşama durumları

| # | Aşama | Durum | Not |
|---|---|---|---|
| 1 | Hizmet görünürlüğü | Yerelde hazır | canlıya uygulanmadı |
| 2 | CEO yapay zekâ asistanı | Yerelde hazır | canlıya uygulanmadı |
| 3 | Moderatör ve yetki | Yerelde hazır | canlıya uygulanmadı |
| 4 | Altyapı ve güvenlik | Yerelde hazır | canlıya uygulanmadı |
| 5 | Bakiye / Cüzdanım / manuel bakiye | Yerelde hazır | canlıya uygulanmadı |
| 6 | Doğrudan sipariş (sepetsiz) | Yerelde hazır | canlıya uygulanmadı |
| 7 | R2 depolama ve yedekleme | Yerelde hazır | canlıya uygulanmadı |
| 8 | Teslimat merkezi + destek dosyaları | Yerelde hazır | canlıya uygulanmadı |
| 9 | Site yayın kontrolü + min. 5 influencer | Yerelde hazır | canlıya uygulanmadı |
| 10 | Bireysel influencer indirimi | Yerelde hazır | canlıya uygulanmadı |
| 11 | Influencer maliyet ve kâr | Yerelde hazır | canlıya uygulanmadı |
| 12 | Influencer fiyat/indirim gösterimi | Yerelde hazır | canlıya uygulanmadı |
| 13 | İki tür hazır paket | Yerelde hazır | canlıya uygulanmadı |
| 14 | Süreli kampanya + ara testler | Yerelde hazır | canlıya uygulanmadı |
| 15 | E-posta doğrulama | Yerelde hazır | canlıya uygulanmadı |
| 16 | CEO içerik düzenleme | Yerelde hazır | canlıya uygulanmadı |
| 17 | PayTR | Yerelde hazır | canlıya uygulanmadı |
| 18 | Üç hizmette dosya yükleme | Yerelde hazır | canlıya uygulanmadı |

## Yapılanlar (yerel, 2026-11-16)

- Migration 08 (erişim, kişiye özel yetki, kimlikli manuel bakiye, ödeme modu koruması), 09 (maliyet, 2 tür paket,
  kampanya, sipariş anı finans kaydı, indirimli sipariş fonksiyonları, raporlar), 10 (teslimat, bildirim, destek ekleri,
  PayTR test/canlı kayıtları, özel depolar). PGlite provası: 01–10 iki kez temiz; **93/93 davranış testi geçti**
  (scratchpad/h7prova/test.mjs). Eşzamanlılık testi tek bağlantılı provada yapılamaz (07'deki kilit mevcut).
- API: /api/siparis (erişim + fiyat onayı + paket + ek hizmet + özel dosya), /api/oturum, /api/zaman, /api/yukle (özel depo,
  tür/MIME/boyut, doğrulama), /api/dosya (imzalı indirme), /api/teslim, /api/yonetim/teslimat, /api/destek (ekler),
  /api/bakiye (PayTR test/canlı), /api/odeme/paytr-bildirim (h7_paytr_sonuc). /api/sepet KALDIRILDI.
- proxy.ts (bakım + gizli hizmet), lib/erisim.ts, lib/server/oturum.ts (imzalı çerez), lib/server/depo.ts (Supabase/R2),
  lib/paket.ts, lib/influencer-kural.ts (min 5, indirim), components/SiparisOnizleme.tsx, BakiyeChip, SiteMenu (sepet yok),
  site içeriği (home kartları, nav, footer, seo, erisim), layout generateMetadata, ana sayfa yazıları içerikten.
- Sayfalar: influencer (kendin seç + paketler + kampanya geri sayımı + 10 gün uyarısı), remake/mix/yayın/smm (önizlemeli
  doğrudan sipariş), /teslim, /teslim/[kod], /destek (ekler), /bakim, /erisim-yok.
- 2026-11-17: CEO paneli bölümleri (erişim matrisi, site yayında, kişiye özel yetki, paketler/kampanyalar, finans, teslimatlar,
  depolama, site metinleri) panele bağlı. E-posta doğrulama: sunucu doğrulanmamış hesabın sipariş / bakiye / dosya yüklemesini
  reddeder (403, needVerify); giriş sayfasında "doğrulama e-postasını tekrar gönder". Yapay zekâ asistanına hizmet erişimi aracı
  (update_access) eklendi. Siparişlerim → Teslimat Merkezi bağlantısı. Derleme hatası giderildi (influencer sayfasında Date.now,
  teslimat ayrıntı rotası). Sonuç: tsc temiz, next build geçti (42 sayfa), veritabanı testleri 93/93.
- Açık küçük işler: lint’in "efekt içinde state" kuralı (27 uyarı-hata, derlemeyi engellemiyor); R2 aktarımı gerçek anahtar olmadan
  denenemez; e-posta doğrulamanın canlıda çalışması için Supabase’de "Confirm email" açık olmalı.

## Onay bekleyen canlı işlemler (hiçbiri yapılmadı)

1. Canlı veritabanının tam yedeği (veritabanı bağlantı adresi gerekli).
2. Migration 01–07 ve yeni migration'ların canlıya uygulanması.
3. Cloudflare secret'ları: `SUPABASE_SECRET_KEY` (zorunlu), `ANTHROPIC_API_KEY` (asistan için), oturum imza anahtarı.
4. GitHub push ve Cloudflare dağıtımı.
