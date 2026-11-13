/**
 * lib/yasal-metinler.ts
 * Yasal sayfaların VARSAYILAN metinleri ve basit biçim çözümleyicisi.
 *
 * Metinler yönetim panelinden (Site Yazıları › Yasal metinler) değiştirilebilir; değiştirilmezse bu şablonlar kullanılır.
 * Biçim: "## Başlık", "### Alt başlık", "- madde", boş satır = yeni paragraf, **kalın**, [bağlantı](/adres).
 * {{unvan}} gibi yer tutucular yönetim panelindeki şirket bilgileriyle doldurulur; boş olanlar sayfada sarı ile işaretlenir.
 *
 * ÖNEMLİ: Bu metinler genel şablondur, hukuki danışmanlık yerine geçmez. Yayına almadan önce bir hukukçuya kontrol ettirilmelidir.
 * Bu dosya React'e bağlı değildir.
 */
import type { LegalSlug } from "./yasal-belgeler";

export type PlaceholderKey = "unvan" | "adres" | "telefon" | "eposta" | "vergiDairesi" | "vergiNo" | "mersis" | "kep" | "marka" | "site";

/** optional: boşsa "—" yazılır; değilse sayfada "doldurulacak" olarak işaretlenir. */
export const PLACEHOLDERS: { key: PlaceholderKey; label: string; optional?: boolean }[] = [
  { key: "unvan", label: "Şirket unvanı" },
  { key: "adres", label: "Açık adres" },
  { key: "telefon", label: "Telefon" },
  { key: "eposta", label: "E-posta" },
  { key: "vergiDairesi", label: "Vergi dairesi" },
  { key: "vergiNo", label: "Vergi / T.C. kimlik no" },
  { key: "mersis", label: "MERSİS no", optional: true },
  { key: "kep", label: "KEP adresi", optional: true },
  { key: "marka", label: "Marka" },
  { key: "site", label: "Site adresi", optional: true },
];

export const LEGAL_TEMPLATES: Record<LegalSlug, string> = {
  kvkk: `Bu aydınlatma metni, 6698 sayılı Kişisel Verilerin Korunması Kanunu ("KVKK") 10. maddesi uyarınca, {{marka}} internet sitesini ({{site}}) ziyaret eden, üye olan ve hizmetlerimizi kullanan kişileri, kişisel verilerinin işlenmesi hakkında bilgilendirmek amacıyla hazırlanmıştır.

## 1. Veri sorumlusu
- Unvan: {{unvan}}
- Adres: {{adres}}
- E-posta: {{eposta}}
- Telefon: {{telefon}}
- KEP adresi: {{kep}}

## 2. İşlenen kişisel veriler
- **Kimlik ve iletişim:** ad soyad, e-posta adresi ve formlarda paylaştığın telefon numarası.
- **Hesap bilgileri:** üyelik bilgilerin ve üyelik tarihi. Şifren yalnızca geri döndürülemez şekilde şifrelenmiş olarak saklanır.
- **Müşteri işlem bilgileri:** siparişlerin, sipariş ayrıntıları ve notların, revizyon ve destek taleplerin.
- **Finansal bilgiler:** bakiye hareketlerin, ödeme ve iade tutarları, havale/EFT bildirimlerin. Kart bilgilerin tarafımızca görülmez ve saklanmaz; doğrudan lisanslı ödeme kuruluşu tarafından işlenir.
- **Yüklediğin dosya ve içerikler:** ses dosyaları, kapak görselleri, şarkı, sanatçı ve eser sahibi bilgileri, sosyal medya bağlantıları.
- **İşlem güvenliği bilgileri:** oturum bilgileri, işlem kayıtları ve kartla ödeme sırasında ödeme kuruluşuna iletilen IP adresin.
- **Ziyaret istatistikleri:** ziyaret edilen sayfa, yönlendiren site, cihaz ve tarayıcı türü, ülke bilgisi. Bu bilgiler kimliğinle ilişkilendirilmez.

## 3. İşleme amaçları
- Üyeliğin oluşturulması ve hesabının yönetilmesi,
- Siparişlerinin alınması, hizmetlerin yerine getirilmesi ve teslim edilmesi,
- Bakiye yükleme, ödeme ve iade işlemlerinin yürütülmesi,
- Dijital yayın başvurularında eserlerinin dağıtım platformlarına iletilmesi ve ISRC/UPC kodlarının atanması,
- Destek taleplerinin yanıtlanması ve seninle iletişim kurulması,
- Fatura, muhasebe ve tüketici mevzuatından doğan yükümlülüklerin yerine getirilmesi,
- Bilgi güvenliğinin sağlanması, kötüye kullanımın ve dolandırıcılığın önlenmesi,
- Site kullanımının istatistiksel olarak ölçülmesi ve hizmetlerin geliştirilmesi.

## 4. Hukuki sebepler
Kişisel verilerin, KVKK'nın 5. maddesinin 2. fıkrasında sayılan şu hukuki sebeplere dayanılarak işlenir:
- Bir sözleşmenin kurulması veya ifasıyla doğrudan ilgili olması (üyelik, sipariş, ödeme ve teslimat),
- Veri sorumlusunun hukuki yükümlülüğünü yerine getirebilmesi için zorunlu olması (vergi, ticaret ve tüketici mevzuatı),
- Bir hakkın tesisi, kullanılması veya korunması için zorunlu olması,
- Temel hak ve özgürlüklerine zarar vermemek kaydıyla veri sorumlusunun meşru menfaatleri için zorunlu olması (bilgi güvenliği, istatistik ve hizmetlerin geliştirilmesi).

## 5. Kişisel verilerin aktarılması
Kişisel verilerin yalnızca yukarıdaki amaçlarla ve gerekli olduğu ölçüde şu alıcı gruplarına aktarılabilir:
- Ödeme ve iade işlemleri için ödeme kuruluşları ve bankalar,
- Barındırma, veritabanı ve dosya depolama hizmeti aldığımız bulut hizmet sağlayıcıları,
- Dijital yayın başvurularında, eserin yayımlanması için dijital dağıtım iş ortakları ve müzik platformları,
- Sosyal medya ve influencer hizmetlerinde, siparişin yerine getirilmesi için gereken bağlantı ve kampanya bilgileriyle sınırlı olarak hizmet sağlayıcılar ve içerik üreticileri,
- Talep edilmesi hâlinde, mevzuatın izin verdiği ölçüde yetkili kamu kurum ve kuruluşları.

Hizmet aldığımız bazı bulut sağlayıcılarının sunucuları yurt dışında bulunmaktadır. Bu sağlayıcılara yapılan aktarımlar KVKK'nın 9. maddesine uygun olarak gerçekleştirilir.

## 6. Toplama yöntemi
Kişisel verilerin; üyelik, sipariş, bakiye yükleme ve destek formları, yüklediğin dosyalar, ödeme kuruluşlarından gelen ödeme bildirimleri ve siteyi kullanırken tarayıcın tarafından iletilen teknik bilgiler aracılığıyla, kısmen otomatik yollarla elektronik ortamda toplanır.

## 7. Saklama süresi
Kişisel verilerin, işlendikleri amaç için gerekli olan süre ve ilgili mevzuatta öngörülen süreler boyunca saklanır; bu sürelerin sonunda silinir, yok edilir veya anonim hâle getirilir. Örneğin ticari defter ve belgeler Türk Ticaret Kanunu gereği 10 yıl saklanır.

## 8. Hakların
KVKK'nın 11. maddesi uyarınca; kişisel verilerinin işlenip işlenmediğini öğrenme, işlenmişse buna ilişkin bilgi talep etme, işlenme amacını ve bunların amacına uygun kullanılıp kullanılmadığını öğrenme, yurt içinde veya yurt dışında aktarıldığı üçüncü kişileri bilme, eksik veya yanlış işlenmişse düzeltilmesini isteme, KVKK'nın 7. maddesinde öngörülen şartlar çerçevesinde silinmesini veya yok edilmesini isteme, bu işlemlerin verilerin aktarıldığı üçüncü kişilere bildirilmesini isteme, münhasıran otomatik sistemler vasıtasıyla analiz edilmesi suretiyle aleyhine bir sonucun ortaya çıkmasına itiraz etme ve kanuna aykırı işlenmesi sebebiyle zarara uğraman hâlinde zararın giderilmesini talep etme haklarına sahipsin.

Başvurunu, kimliğini tespit etmeye yarayan bilgilerle birlikte yukarıdaki adresimize yazılı olarak, KEP adresimize ya da sistemimizde kayıtlı e-posta adresinden {{eposta}} adresine iletebilirsin. Başvurun en geç 30 gün içinde ücretsiz olarak sonuçlandırılır; işlemin ayrıca bir maliyet gerektirmesi hâlinde Kişisel Verileri Koruma Kurulunca belirlenen tarifedeki ücret alınabilir.`,

  "gizlilik-cerez": `## Gizlilik
{{marka}} olarak gizliliğine önem veriyoruz. Kişisel verilerinin hangi amaçlarla ve hangi hukuki sebeplerle işlendiğini [KVKK Aydınlatma Metni](/yasal/kvkk)'nde ayrıntılı olarak açıkladık. Kısaca:
- Şifren geri döndürülemez şekilde şifrelenerek saklanır; ekibimiz dahil kimse göremez.
- Kart bilgilerin sunucularımıza ulaşmaz; ödeme, lisanslı ödeme kuruluşunun güvenli sayfasında alınır.
- Yüklediğin dosyalar tahmin edilemeyen adlarla saklanır; bağlantılarını yalnızca sen ve siparişini yürüten ekibimiz görür.
- Siparişlerini, bakiyeni ve dosyalarını diğer üyeler göremez.
- Verilerini satmayız ve reklam amacıyla üçüncü kişilerle paylaşmayız.

## Çerezler ve tarayıcı depolama alanı
Sitemiz reklam veya pazarlama çerezi kullanmaz. Siteyi çalıştırmak için tarayıcının yerel depolama alanını (local storage ve session storage) şu amaçlarla kullanırız:
- **Zorunlu – oturum bilgisi:** Giriş yaptığında oturumunun açık kalmasını sağlar. Çıkış yaptığında silinir.
- **İstatistik – ziyaret kodu:** Ziyaret sayımında aynı ziyareti tekrar saymamak için rastgele oluşturulan bir koddur. Kimliğinle ilişkilendirilmez ve tarayıcı sekmesini kapattığında silinir.

## Üçüncü taraf hizmetler
- Kartla ödeme sırasında açılan ödeme kuruluşu sayfası kendi çerezlerini kullanabilir; bu çerezler ödeme kuruluşunun politikalarına tabidir.
- Bazı sayfalarda yazı tipleri Google Fonts hizmetinden yüklenir. Bu sırada tarayıcın Google sunucularına bağlanır ve IP adresin Google'a iletilir.
- Sitemizde bağlantısı bulunan sosyal medya platformlarına geçtiğinde, o platformların kendi gizlilik ve çerez politikaları geçerli olur.

## Tercihlerin
Tarayıcının ayarlarından site verilerini dilediğin zaman silebilir veya engelleyebilirsin. Oturum bilgisini silersen yeniden giriş yapman gerekir; zorunlu depolamayı engellersen giriş yapamayabilirsin.

## İletişim
Gizlilikle ilgili tüm soruların için {{eposta}} adresine yazabilirsin.`,

  "on-bilgilendirme": `Bu form, 6502 sayılı Tüketicinin Korunması Hakkında Kanun ve Mesafeli Sözleşmeler Yönetmeliği uyarınca, sipariş vermeden veya bakiye yüklemeden önce seni bilgilendirmek amacıyla hazırlanmıştır.

## 1. Satıcı / hizmet sağlayıcı
- Unvan: {{unvan}}
- Adres: {{adres}}
- Telefon: {{telefon}}
- E-posta: {{eposta}}
- Vergi dairesi: {{vergiDairesi}}
- Vergi / T.C. kimlik no: {{vergiNo}}
- MERSİS no: {{mersis}}
- KEP adresi: {{kep}}

## 2. Hizmetlerin temel nitelikleri
{{marka}} üzerinden influencer marketing, sosyal medya (SMM) hizmetleri, remake beat prodüksiyonu, mix & mastering ve dijital müzik yayını (dağıtım) hizmetleri sunulur. Her hizmetin kapsamı, miktarı, teslim süresi ve özellikleri sipariş sayfasında ve [Kullanım Koşulları ve Hizmet Sözleşmesi](/yasal/kullanim-kosullari)'nde açıklanır.

Hizmetler, hesabına yüklediğin bakiye ile satın alınır. Bakiye yükleme, sitedeki hizmetleri satın almak için yapılan bir ön ödemedir.

## 3. Fiyat ve ödeme
- Hizmet bedelleri, sipariş sayfasında ve sipariş özetinde vergiler dahil Türk Lirası olarak gösterilir. Ayrıca teslimat veya kargo ücreti alınmaz.
- Sipariş tutarı, siparişi onayladığın anda bakiyenden düşülür. Bakiyen yetersizse sipariş oluşmaz.
- Bakiye; kredi veya banka kartıyla lisanslı ödeme kuruluşu aracılığıyla ya da havale/EFT ile yüklenir. Havale/EFT ile yapılan yüklemeler, ödemenin hesabımıza ulaştığı kontrol edildikten sonra bakiyene eklenir.

## 4. İfa ve teslim
- Hizmetler elektronik ortamda ifa edilir. Siparişinin durumu ve teslim dosyaları hesabındaki Siparişlerim bölümünde paylaşılır.
- Hizmet, sipariş sayfasında belirtilen sürede ifa edilir. Süre, siparişin ve gerekli dosya ve bilgilerin eksiksiz alınmasıyla başlar.
- Dijital yayınlarda, eserin platformlarda görünme tarihi platformların onay süreçlerine bağlıdır.

## 5. Cayma hakkı
- **Bakiye:** Kullanmadığın bakiye için, yükleme tarihinden itibaren 14 gün içinde hiçbir gerekçe göstermeden ve cezai şart ödemeden cayma hakkını kullanabilirsin.
- **Hizmetler:** Mesafeli Sözleşmeler Yönetmeliği'nin 15. maddesi uyarınca; cayma süresi sona ermeden önce senin onayınla ifasına başlanan hizmetlerde, elektronik ortamda anında ifa edilen hizmetlerde ve senin istek veya kişisel ihtiyaçların doğrultusunda hazırlanan işlerde cayma hakkı kullanılamaz. Sipariş verirken hizmetin hemen başlamasını onaylarsın; hizmetin ifasına başlanmasıyla cayma hakkın sona erer.
- İfasına başlanmamış bir siparişin iptalini isteyebilirsin; iptal edilen siparişin tutarı bakiyene iade edilir.
- Cayma bildirimini {{eposta}} adresine e-posta göndererek veya [Destek](/destek) sayfasından iletebilirsin. Cayma hakkını kullanman hâlinde, tahsil edilen tutar bildirimin bize ulaşmasından itibaren en geç 14 gün içinde, ödeme yaptığın yönteme uygun şekilde iade edilir.
- Ayrıntılar [İade ve İptal Koşulları](/yasal/iade-iptal)'ndadır.

## 6. Şikâyet ve itirazlar
Şikâyet ve itirazların için {{eposta}} adresine veya {{telefon}} numarasına başvurabilirsin. Uyuşmazlık hâlinde, Ticaret Bakanlığınca her yıl ilan edilen parasal sınırlar dâhilinde, hizmeti satın aldığın veya yerleşim yerinin bulunduğu yerdeki Tüketici Hakem Heyetine, bu sınırları aşan uyuşmazlıklarda Tüketici Mahkemesine başvurabilirsin.

## 7. Diğer bilgiler
- Sözleşme Türkçe dilinde kurulur.
- Onayladığın sözleşmenin tarihi ve sürümü, sipariş ve işlem kayıtlarında saklanır. Sözleşme metinlerinin güncel hâline bu sayfalardan her zaman ulaşabilirsin; sipariş ve ödeme kayıtlarını hesabındaki Siparişlerim ve Cüzdanım bölümlerinde görüntüleyebilirsin.`,

  "mesafeli-satis": `## 1. Taraflar
**Satıcı / hizmet sağlayıcı:** {{unvan}}
- Adres: {{adres}}
- Telefon: {{telefon}}
- E-posta: {{eposta}}
- Vergi dairesi / no: {{vergiDairesi}} / {{vergiNo}}
- MERSİS no: {{mersis}}

**Alıcı:** {{marka}} üzerinde üyelik oluşturan ve bu sözleşmeyi elektronik ortamda onaylayan kişidir. Alıcının ad, soyad ve iletişim bilgileri, üyelik ve sipariş kayıtlarında yer alan bilgilerdir.

## 2. Sözleşmenin konusu
Bu sözleşmenin konusu; Alıcının {{site}} adresindeki internet sitesi üzerinden elektronik ortamda satın aldığı hizmetlerin ve hesabına yüklediği bakiyenin satışı ile ifasına ilişkin olarak, 6502 sayılı Tüketicinin Korunması Hakkında Kanun ve Mesafeli Sözleşmeler Yönetmeliği hükümleri uyarınca tarafların hak ve yükümlülüklerinin belirlenmesidir.

## 3. Hizmet, fiyat ve ödeme
- Satın alınan hizmetin türü, kapsamı, miktarı, fiyatı ve teslim süresi; sipariş anında sipariş sayfasında ve sipariş özetinde gösterilen bilgilerdir ve sipariş kaydında saklanır.
- Fiyatlar Türk Lirası olarak ve vergiler dahil gösterilir.
- Hizmet bedeli, Alıcının hesabındaki bakiyeden tahsil edilir. Bakiye, kredi veya banka kartıyla lisanslı ödeme kuruluşu aracılığıyla ya da havale/EFT ile yüklenir.
- Bakiye yalnızca {{marka}} üzerindeki hizmetlerin satın alınmasında kullanılır; başka bir hesaba devredilemez, faiz işletilmez ve iade koşulları dışında nakde çevrilemez.

## 4. İfa ve teslim
- Hizmetler elektronik ortamda ifa edilir; sipariş durumu ve teslim dosyaları Alıcının hesabındaki Siparişlerim bölümünde paylaşılır.
- Satıcı, hizmeti sipariş sayfasında belirtilen sürede ifa eder. Sürenin başlaması için Alıcının gerekli dosya ve bilgileri eksiksiz iletmesi gerekir.
- Hizmetin ifası imkânsızlaşırsa Satıcı bu durumu öğrendiği tarihten itibaren 3 gün içinde Alıcıya bildirir ve tahsil edilen tutarı bildirim tarihinden itibaren en geç 14 gün içinde iade eder.

## 5. Cayma hakkı
- Alıcı, kullanmadığı bakiye için yükleme tarihinden itibaren 14 gün içinde hiçbir gerekçe göstermeden ve cezai şart ödemeden cayma hakkına sahiptir.
- Mesafeli Sözleşmeler Yönetmeliği'nin 15. maddesi uyarınca; cayma süresi sona ermeden önce Alıcının onayıyla ifasına başlanan hizmetlerde, elektronik ortamda anında ifa edilen hizmetlerde ve Alıcının istekleri veya kişisel ihtiyaçları doğrultusunda hazırlanan işlerde cayma hakkı kullanılamaz. Alıcı, sipariş sırasında hizmetin hemen ifasına başlanmasını talep ettiğini ve ifaya başlanmasıyla cayma hakkının sona ereceğini kabul eder.
- Cayma bildirimi {{eposta}} adresine e-posta ile veya [Destek](/destek) sayfasından yapılır. Satıcı, bildirimin kendisine ulaşmasından itibaren en geç 14 gün içinde tahsil ettiği tutarı, Alıcının ödeme yaptığı yönteme uygun şekilde iade eder.
- Ayrıntılı koşullar [İade ve İptal Koşulları](/yasal/iade-iptal)'nda yer alır.

## 6. Tarafların yükümlülükleri
- Alıcı, sipariş sırasında verdiği bilgilerin doğru olduğunu ve yüklediği dosya, eser ve içerikler üzerinde gerekli haklara sahip olduğunu kabul eder.
- Alıcı, hizmetleri hukuka ve ilgili platformların kurallarına aykırı amaçlarla kullanmayacağını kabul eder.
- Satıcı, hizmeti özenle ve sipariş sayfasında belirtilen niteliklere uygun şekilde ifa eder. Hizmetin ayıplı ifa edilmesi hâlinde Alıcının 6502 sayılı Kanun'dan doğan hakları saklıdır.

## 7. Uyuşmazlıkların çözümü
Bu sözleşmeden doğan uyuşmazlıklarda, Ticaret Bakanlığınca her yıl ilan edilen parasal sınırlar dâhilinde Tüketici Hakem Heyetleri, bu sınırları aşan uyuşmazlıklarda Tüketici Mahkemeleri yetkilidir.

## 8. Yürürlük
Alıcı, siparişi veya bakiye yüklemesini tamamlamadan önce [Ön Bilgilendirme Formu](/yasal/on-bilgilendirme)'nu ve bu sözleşmeyi okuyup kabul ettiğini elektronik ortamda onaylar. Sözleşme, onay anında kurulur; onay tarihi ve sözleşme sürümü sipariş ve işlem kayıtlarında saklanır.`,

  "iade-iptal": `## Bakiye iadesi
- Kullanmadığın bakiye için, yükleme tarihinden itibaren 14 gün içinde cayma hakkını kullanabilirsin. Gerekçe göstermen gerekmez.
- Talebini {{eposta}} adresine e-posta göndererek veya [Destek](/destek) sayfasından iletebilirsin.
- İade, talebinin bize ulaşmasından itibaren en geç 14 gün içinde yapılır. Kartla yapılan yüklemeler aynı karta, havale/EFT ile yapılan yüklemeler adına kayıtlı banka hesabına iade edilir. Kart iadelerinin hesabına yansıma süresi bankana bağlıdır.
- Siparişlerde kullanılan bakiye, aşağıdaki sipariş koşullarına tabidir.

## Sipariş iptali
- Henüz işleme alınmamış ("Ödeme Bekleniyor" veya "Alındı" durumundaki) bir siparişin iptalini isteyebilirsin. İptal edilen siparişin tutarı bakiyene iade edilir.
- Sipariş "İşlemde" durumuna geçtikten sonra iptal ve iade yapılmaz. Mesafeli Sözleşmeler Yönetmeliği'nin 15. maddesi uyarınca; cayma süresi sona ermeden önce senin onayınla ifasına başlanan hizmetlerde, elektronik ortamda anında ifa edilen hizmetlerde ve kişiye özel hazırlanan işlerde cayma hakkı kullanılamaz.
- Hizmetin ayıplı ifa edilmesi hâlinde 6502 sayılı Kanun'dan doğan hakların (hizmetin yeniden görülmesi, ayıp oranında bedelden indirim veya sözleşmeden dönme) saklıdır.

## Hizmetlere özel durumlar
- **SMM hizmetleri:** Sağlayıcı tarafından iptal edilen veya kısmen tamamlanan siparişlerde, gerçekleşmeyen kısmın tutarı bakiyene iade edilir.
- **Influencer marketing:** Seçtiğin içerik üreticisinin paylaşımı yapamaması hâlinde, o içerik üreticisinin ücreti bakiyene iade edilir.
- **Remake beat ve mix & mastering:** Teslimden sonra revizyon taleplerini hesabındaki Siparişlerim bölümünden iletebilirsin. Çalışmalar kişiye özel hazırlandığı için teslimden sonra iade yapılmaz; ayıplı hizmete ilişkin yasal hakların saklıdır.
- **Dijital yayın:** Başvurun platformlara iletilmeden önce iptal edilirse ücret bakiyene iade edilir. Platformlara iletilmiş bir yayının kaldırılmasını istediğinde kaldırma işlemi yapılır; bu durumda ücret iadesi yapılmaz.

## İletişim
İade ve iptal taleplerin için {{eposta}} adresine yazabilir veya {{telefon}} numarasından bize ulaşabilirsin. Talebinde sipariş kodunu belirtmen işlemi hızlandırır.`,

  "kullanim-kosullari": `## 1. Genel
Bu koşullar, {{unvan}} tarafından işletilen {{marka}} internet sitesinin ({{site}}) ve site üzerinden sunulan hizmetlerin kullanımını düzenler. Siteye üye olarak bu koşulları kabul etmiş olursun. Sipariş ve ödeme süreçlerinde ayrıca [Ön Bilgilendirme Formu](/yasal/on-bilgilendirme) ve [Mesafeli Satış Sözleşmesi](/yasal/mesafeli-satis) geçerlidir.

## 2. Üyelik
- Üye olmak için 18 yaşını doldurmuş olman gerekir. 18 yaşından küçüksen hizmetleri yalnızca veli veya vasinin izniyle kullanabilirsin.
- Hesap bilgilerinin doğru ve güncel olmasından, şifrenin gizli tutulmasından sen sorumlusun. Hesabında yetkisiz bir işlem fark edersen hemen bize bildir.
- Hesabın kişiseldir; başkasına devredilemez veya kullandırılamaz.
- Bu koşullara aykırı kullanım hâlinde hesabın askıya alınabilir veya kapatılabilir. Bu durumda yasal hakların saklıdır.

## 3. Bakiye
- Hizmetler, hesabına yüklediğin bakiye ile satın alınır. Bakiye yalnızca {{marka}} üzerindeki hizmetlerde kullanılabilir ve başka bir hesaba devredilemez.
- Bakiye iadesi ve cayma koşulları [İade ve İptal Koşulları](/yasal/iade-iptal)'nda açıklanır.

## 4. Hizmetler
### Influencer marketing
- Seçtiğin içerik üreticileri, tanıtılacak içeriğini seçtiğin platformda paylaşır. Paylaşımın izlenme, beğeni veya etkileşim sayısı garanti edilmez.
- Tanıtılacak içeriğin hukuka, platform kurallarına ve reklam mevzuatına uygun olmasından sen sorumlusun. Ticari tanıtımlar, mevzuat gereği reklam olduğu belirtilerek paylaşılır.

### SMM (sosyal medya) hizmetleri
- Hizmetler üçüncü taraf hizmet sağlayıcılar aracılığıyla yerine getirilir; belirtilen süreler tahminidir.
- Siparişin doğru ve herkese açık bir bağlantı için verilmesi gerekir. Gizli hesaplar veya hatalı bağlantılar nedeniyle tamamlanamayan siparişlerin sorumluluğu sana aittir.
- Platformların kendi denetimleri nedeniyle zaman içinde düşüşler yaşanabilir. Bazı platformların kullanım koşulları bu tür hizmetleri kısıtlayabilir; hizmetin hesabın üzerindeki sonuçlarını değerlendirmek sana aittir.

### Remake beat
- Remake (yeniden yapım) çalışmaları mevcut eserlere dayanır. Eser sahiplerinden gerekli izin ve lisansların alınması senin sorumluluğundadır; {{marka}} telif izni sağlamaz.
- İzinsiz kullanım nedeniyle oluşabilecek hak talepleri ve içerik kaldırma işlemlerinden sen sorumlusun.

### Mix & mastering
- Çalışma, yüklediğin dosyalar üzerinden yapılır; kaynak dosyaların kalitesi sonucu doğrudan etkiler.
- Teslimden sonra revizyon taleplerini Siparişlerim bölümünden iletebilirsin.
- Yüklediğin eserler üzerindeki tüm haklar sende kalır.

### Dijital yayın
- Eserin, seçtiğin dijital platformlara dağıtım iş ortaklarımız aracılığıyla iletilir. Yayının platformlarda görünme tarihi, platformların onay süreçlerine bağlıdır.
- Eser, kapak görseli ve paylaştığın tüm bilgiler üzerinde gerekli hak ve izinlere sahip olduğunu; söz, müzik ve ses kaydı haklarının sana ait olduğunu veya gerekli lisansları aldığını kabul edersin.
- ISRC ve UPC kodları {{marka}} tarafından atanır ve hesabındaki Dijital Yayınlarım bölümünde görünür.
- Eserin üzerindeki telif hakları sende kalır. Yayının, kaldırılmasını talep edene kadar platformlarda kalması amaçlanır; platformların içerik politikalarına aykırılık veya hak ihlali iddiası hâlinde yayın kaldırılabilir.
- Platformlardan elde edilen gelirlerin paylaşımı ve ödeme koşulları yayın başvurusu sırasında ayrıca bildirilir.

## 5. Fikri mülkiyet
- Sitenin tasarımı, logosu ve içerikleri {{marka}}'ya aittir; izinsiz kopyalanamaz ve kullanılamaz.
- Yüklediğin içeriklerin hakları sende kalır. Bu içerikleri yalnızca siparişini yerine getirmek amacıyla kullanırız.

## 6. Yasaklı kullanım
Hukuka aykırı, hakaret, nefret söylemi veya müstehcenlik içeren içeriklerin yüklenmesi; başkalarına ait eserlerin izinsiz kullanılması; siteye veya diğer kullanıcılara zarar verecek teknik girişimlerde bulunulması; başkası adına veya gerçeğe aykırı bilgilerle işlem yapılması yasaktır.

## 7. Sorumluluk
{{marka}}, kontrolü dışındaki üçüncü taraf platformların (Instagram, TikTok, YouTube, Spotify ve benzerleri) politika değişikliklerinden, erişim kesintilerinden veya hesaplara uyguladığı yaptırımlardan sorumlu değildir. Tüketici olarak yasal hakların saklıdır.

## 8. Değişiklikler
Bu koşullar güncellenebilir; güncel metin her zaman bu sayfada yayımlanır. Verilmiş siparişler, sipariş tarihindeki koşullara tabidir.

## 9. Uygulanacak hukuk ve iletişim
Bu koşullar Türk hukukuna tabidir. Tüketici uyuşmazlıklarında Tüketici Hakem Heyetleri ve Tüketici Mahkemeleri yetkilidir. Sorularını {{eposta}} adresine iletebilirsin.`,
};

/* ------------------------------------------------------------------ */
/*  Yer tutucuları doldurma                                            */
/* ------------------------------------------------------------------ */

const MISS_A = "\u0001";
const MISS_B = "\u0002";

/** {{anahtar}} yer tutucularını doldurur. Boş zorunlu alanlar "eksik" işaretiyle döner (sayfada sarı görünür). */
export function fillTemplate(text: string, values: Partial<Record<PlaceholderKey, string>>): string {
  return text.replace(/\{\{\s*([a-zA-Z]+)\s*\}\}/g, (all, key: string) => {
    const p = PLACEHOLDERS.find((x) => x.key === key);
    if (!p) return all;
    const v = String(values[p.key] ?? "")
      .replace(/[\u0001\u0002]/g, "")
      .trim();
    if (v) return v;
    return p.optional ? "—" : `${MISS_A}${p.label}${MISS_B}`;
  });
}

/* ------------------------------------------------------------------ */
/*  Basit biçim çözümleyici (HTML üretmez; React tarafı güvenle çizer) */
/* ------------------------------------------------------------------ */

export type Inline =
  | { t: "text"; v: string }
  | { t: "b"; c: Inline[] }
  | { t: "a"; v: string; href: string }
  | { t: "miss"; v: string };

export type Block = { t: "h2" | "h3"; id: string; v: Inline[] } | { t: "p"; v: Inline[] } | { t: "ul"; items: Inline[][] };

/** Yalnızca site içi, https ve e-posta bağlantılarına izin verilir. */
const SAFE_HREF = /^(\/(?!\/)|#|https:\/\/|mailto:)/i;

export function parseInline(s: string): Inline[] {
  const re = /\[([^\]\n]+)\]\(([^)\s]+)\)|\*\*([^*\n]+)\*\*|\u0001([^\u0002]*)\u0002/g;
  const out: Inline[] = [];
  let last = 0;
  let m: RegExpExecArray | null;
  while ((m = re.exec(s))) {
    if (m.index > last) out.push({ t: "text", v: s.slice(last, m.index) });
    if (m[1] !== undefined) {
      const label = m[1].replace(/[\u0001\u0002]/g, "");
      out.push(SAFE_HREF.test(m[2]) ? { t: "a", v: label, href: m[2] } : { t: "text", v: label });
    } else if (m[3] !== undefined) {
      out.push({ t: "b", c: parseInline(m[3]) });
    } else {
      out.push({ t: "miss", v: m[4] });
    }
    last = m.index + m[0].length;
  }
  if (last < s.length) out.push({ t: "text", v: s.slice(last) });
  return out;
}

const TR_MAP: Record<string, string> = { ç: "c", ğ: "g", ı: "i", ö: "o", ş: "s", ü: "u", â: "a", î: "i", û: "u" };

export function slugify(s: string): string {
  return s
    .toLocaleLowerCase("tr")
    .replace(/[çğıöşüâîû]/g, (c) => TR_MAP[c] || c)
    .replace(/[^a-z0-9]+/g, "-")
    .replace(/^-+|-+$/g, "")
    .slice(0, 60);
}

/** Metni başlık / paragraf / liste bloklarına ayırır. Başlıklara bağlantı verilebilen kimlikler (#dijital-yayin) eklenir. */
export function parseDoc(text: string): Block[] {
  const blocks: Block[] = [];
  const used = new Set<string>();
  const uid = (base: string) => {
    const b = base || "bolum";
    let id = b;
    let n = 2;
    while (used.has(id)) id = `${b}-${n++}`;
    used.add(id);
    return id;
  };
  let para: string[] = [];
  let list: Inline[][] | null = null;
  const flushPara = () => {
    if (para.length) blocks.push({ t: "p", v: parseInline(para.join(" ")) });
    para = [];
  };
  const flushList = () => {
    if (list) blocks.push({ t: "ul", items: list });
    list = null;
  };

  for (const raw of text.replace(/\r\n?/g, "\n").split("\n")) {
    const line = raw.trim();
    if (!line) {
      flushPara();
      flushList();
      continue;
    }
    const h = /^(#{1,3})\s+(.+)$/.exec(line);
    if (h) {
      flushPara();
      flushList();
      const plain = h[2].replace(/\u0001([^\u0002]*)\u0002/g, "$1").replace(/\*\*/g, "");
      blocks.push({ t: h[1].length === 3 ? "h3" : "h2", id: uid(slugify(plain)), v: parseInline(h[2]) });
      continue;
    }
    const li = /^[-•]\s+(.+)$/.exec(line);
    if (li) {
      flushPara();
      if (!list) list = [];
      list.push(parseInline(li[1]));
      continue;
    }
    flushList();
    para.push(line);
  }
  flushPara();
  flushList();
  return blocks;
}
