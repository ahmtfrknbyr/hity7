<#
HITY7 · Supabase veritabanı YEDEĞİ — yalnızca OKUR, veritabanında hiçbir şeyi değiştirmez.

Neden? Supabase ücretsiz planda otomatik yedek yoktur ve panelden yedek indirilemez. Table Editor'deki CSV dışa
aktarma yalnızca tablo satırlarını alır; fonksiyonlar, RLS politikaları, tetikleyiciler, kısıtlar ve üye hesapları
(auth) CSV'ye girmez. Bu betik pg_dump ile şunları alır:
  1) public-tam.dump      : public şemasının TAMAMI (tablolar + veriler + fonksiyonlar + politikalar + tetikleyiciler)
  2) public-sema.sql      : aynı şemanın okunabilir SQL hali (yalnızca yapı)
  3) uyelik-hesaplari.dump: üye hesapları (auth.users, auth.identities) — migration'lar bunlara dokunmaz, ek güvence
Storage'daki dosyalar (WAV, kapak görselleri) veritabanı yedeğine girmez; migration'lar onlara dokunmaz.

KULLANIM (kendi PowerShell pencerende, proje klasöründe):
  powershell -ExecutionPolicy Bypass -File .\supabase\yedek-al.ps1

GEREKEN: PostgreSQL komut satırı araçları (pg_dump 17). Kurulum: https://www.postgresql.org/download/windows/
  → EDB yükleyicisinde yalnızca "Command Line Tools" seçilmesi yeterli.
BAĞLANTI: Supabase → projen → üstteki "Connect" → "Session pooler" adresi (postgresql://postgres.xxxx:[YOUR-PASSWORD]@...:5432/postgres)
  Şifre ayrıca, gizli olarak sorulur. Ekranda görünmez, hiçbir dosyaya yazılmaz.
Yedekler proje klasörünün DIŞINA yazılır: Belgeler\hity7-yedekler\<tarih-saat>. Kişisel veri içerir; kimseyle paylaşma.
#>
param([string]$Uri = "")

$ErrorActionPreference = "Stop"
Write-Host "HITY7 veritabanı yedeği (salt okunur)" -ForegroundColor Yellow

# 1) pg_dump bul
$pgDump = (Get-Command pg_dump -ErrorAction SilentlyContinue).Source
if (-not $pgDump) {
  $aday = Get-ChildItem "C:\Program Files\PostgreSQL\*\bin\pg_dump.exe" -ErrorAction SilentlyContinue | Sort-Object FullName -Descending | Select-Object -First 1
  if ($aday) { $pgDump = $aday.FullName }
}
if (-not $pgDump) {
  Write-Host "pg_dump bulunamadı." -ForegroundColor Red
  Write-Host "Kurulum: https://www.postgresql.org/download/windows/ → EDB yükleyicisi → yalnızca 'Command Line Tools' seç (sürüm 17)."
  Write-Host "Kurduktan sonra bu betiği yeniden çalıştır."
  exit 2
}
$surum = & $pgDump --version
Write-Host "Kullanılan: $surum"
if ($surum -match "\s(\d+)\.") { if ([int]$Matches[1] -lt 15) { Write-Host "pg_dump 15 veya üstü gerekli (Supabase sürümüyle uyum için 17 önerilir)." -ForegroundColor Red; exit 2 } }

# 2) Bağlantı adresi ve şifre (şifre adresten ayrılır, yalnızca bu işlem süresince ortam değişkeninde tutulur)
if (-not $Uri) { $Uri = Read-Host "Session pooler bağlantı adresi" }
$Uri = $Uri.Trim()
if ($Uri -notmatch '^(postgres(?:ql)?://)([^:@/]+)(?::([^@]*))?@(.+)$') {
  Write-Host "Adres anlaşılamadı. Supabase → Connect → Session pooler adresini olduğu gibi yapıştır." -ForegroundColor Red
  exit 2
}
$sema = $Matches[1]; $kullanici = $Matches[2]; $sifre = $Matches[3]; $kalan = $Matches[4]
$temizAdres = "$sema$kullanici@$kalan"
if ($kalan -notmatch ':5432/') { Write-Host "Uyarı: Session pooler adresi genellikle :5432 portunu kullanır. (Transaction pooler :6543 yedek için uygun değildir.)" -ForegroundColor Yellow }
if (-not $env:PGPASSWORD) {
  if ($sifre -and $sifre -ne "[YOUR-PASSWORD]") {
    $env:PGPASSWORD = [Uri]::UnescapeDataString($sifre)
  } else {
    $guvenli = Read-Host "Veritabanı şifresi (görünmez)" -AsSecureString
    $env:PGPASSWORD = [Runtime.InteropServices.Marshal]::PtrToStringAuto([Runtime.InteropServices.Marshal]::SecureStringToBSTR($guvenli))
  }
}
$env:PGSSLMODE = "require"

# 3) Yedek klasörü (proje dışında)
$klasor = Join-Path ([Environment]::GetFolderPath("MyDocuments")) ("hity7-yedekler\" + (Get-Date -Format "yyyyMMdd-HHmmss"))
New-Item -ItemType Directory -Force $klasor | Out-Null

function Calistir($ad, [string[]]$arglar) {
  Write-Host "→ $ad"
  & $pgDump @arglar
  if ($LASTEXITCODE -ne 0) { throw "$ad alınamadı (pg_dump çıkış kodu $LASTEXITCODE)." }
}

$tamam = $true
try {
  Calistir "public şeması (tam)" @("--dbname=$temizAdres", "--schema=public", "--format=custom", "--file=$klasor\public-tam.dump")
  Calistir "public şeması (okunabilir yapı)" @("--dbname=$temizAdres", "--schema=public", "--schema-only", "--file=$klasor\public-sema.sql")
  try {
    Calistir "üye hesapları (auth)" @("--dbname=$temizAdres", "--data-only", "--table=auth.users", "--table=auth.identities", "--format=custom", "--file=$klasor\uyelik-hesaplari.dump")
  } catch {
    Write-Host "Üye hesapları yedeği alınamadı (yetki). Migration'lar auth şemasına dokunmadığı için kurulum için zorunlu değil." -ForegroundColor Yellow
  }
} catch {
  $tamam = $false
  Write-Host $_.Exception.Message -ForegroundColor Red
} finally {
  Remove-Item Env:\PGPASSWORD -ErrorAction SilentlyContinue
}

# 4) Doğrulama: dosyalar boş olmamalı, pg_restore içeriği okuyabilmeli
Write-Host ""
Get-ChildItem $klasor | ForEach-Object { "{0,-24} {1,10:N0} KB" -f $_.Name, ($_.Length / 1KB) }
$pgRestore = Join-Path (Split-Path $pgDump) "pg_restore.exe"
if ($tamam -and (Test-Path "$klasor\public-tam.dump") -and (Test-Path $pgRestore)) {
  $liste = & $pgRestore --list "$klasor\public-tam.dump"
  $tablo = ($liste | Select-String " TABLE public ").Count
  $veri = ($liste | Select-String " TABLE DATA public ").Count
  $pol = ($liste | Select-String " POLICY public ").Count
  $fn = ($liste | Select-String " FUNCTION public ").Count
  Write-Host "Yedek içeriği: $tablo tablo, $veri tablo verisi, $fn fonksiyon, $pol RLS politikası" -ForegroundColor Green
}
if ($tamam) {
  Write-Host "YEDEK TAMAM: $klasor" -ForegroundColor Green
  Write-Host "Bu klasörü güvenli bir yere (ör. şifreli USB) kopyala. Kişisel veri içerir, paylaşma."
  exit 0
}
Write-Host "Yedek tamamlanamadı. Hata mesajını geliştiriciye ilet (şifreyi paylaşma)." -ForegroundColor Red
exit 1
