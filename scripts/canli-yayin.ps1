<#
HITY7 · Canlı yayın betiği (hity7.net, Cloudflare Worker "hity7").
VS Code terminalinde proje klasöründen çalıştırılır:

  powershell -ExecutionPolicy Bypass -File .\scripts\canli-yayin.ps1            # HAZIRLIK: derler, paketi doğrular, YAYINLAMAZ
  powershell -ExecutionPolicy Bypass -File .\scripts\canli-yayin.ps1 -Onayliyorum  # hazırlık + CANLIYA YAYINLAR + yayın sonrası kontrol

Güvenlik:
  • -Onayliyorum olmadan canlıya hiçbir şey gitmez.
  • Yalnızca "hity7" Worker'ını yayınlar (wrangler.jsonc). Önizleme Worker'ına (hity7-onizleme) ve veritabanına dokunmaz.
  • Gizli anahtar değerleri hiçbir çıktıya yazılmaz. SUPABASE_SECRET_KEY bu betikle girilmez (kendi terminalinde: npx wrangler secret put SUPABASE_SECRET_KEY).
  • Derleme, önizleme değişkenlerini (yer tutucu veritabanı, önizleme bayrağı) temizler; paket taranır ve önizleme / gizli anahtar kalıntısı varsa DURUR.
#>
param([switch]$Onayliyorum)
$ErrorActionPreference = "Stop"
Set-Location (Split-Path $PSScriptRoot -Parent)
function Adim($m) { Write-Host "`n▶ $m" -ForegroundColor Yellow }
function Hata($m) { Write-Host "✗ $m" -ForegroundColor Red; exit 1 }
function Tamam($m) { Write-Host "✓ $m" -ForegroundColor Green }

Adim "1/7 Ön kontroller"
foreach ($v in "NEXT_PUBLIC_SUPABASE_URL", "NEXT_PUBLIC_SUPABASE_PUBLISHABLE_KEY", "NEXT_PUBLIC_SUPABASE_ANON_KEY", "NEXT_PUBLIC_ONIZLEME", "HITY7_ONIZLEME") {
  Remove-Item "Env:$v" -ErrorAction SilentlyContinue   # önizleme oturumundan kalan değişkenler canlı paketi bozmasın
}
if (-not (Test-Path ".env.local")) { Hata ".env.local yok (canlı herkese açık Supabase adresi / anahtarı bunun içinde)." }
$env_ = Get-Content ".env.local" -Raw
if ($env_ -match "SECRET|SERVICE_ROLE|ANTHROPIC|R2_") { Hata ".env.local içinde gizli anahtar adı var. Gizli anahtarlar .env dosyalarına YAZILMAZ (pakete gömülür); yalnızca Cloudflare secret olarak girilir." }
if ($env_ -notmatch "NEXT_PUBLIC_SUPABASE_URL=https://([a-z0-9]+)\.supabase\.co") { Hata ".env.local'daki NEXT_PUBLIC_SUPABASE_URL canlı bir supabase.co adresi değil." }
$ref = $Matches[1]
if ($env_ -match "invalid|onizleme") { Hata ".env.local önizleme / yer tutucu değer içeriyor." }
Tamam "Canlı Supabase adresi tanındı (proje kimliği gizli tutuldu)"
$dal = (git branch --show-current)
Write-Host "  Git dalı: $dal"
if ((git status --porcelain | Measure-Object).Count -gt 0) { Write-Host "  Uyarı: işlenmemiş (commit edilmemiş) değişiklikler var; yayın çalışma klasöründeki hâliyle yapılır." -ForegroundColor DarkYellow }

Adim "2/7 Tip denetimi"
npx tsc --noEmit
if ($LASTEXITCODE -ne 0) { Hata "TypeScript hataları var." }
Tamam "Tip denetimi temiz"

Adim "3/7 Üretim derlemesi (OpenNext / Cloudflare)"
if (Test-Path ".open-next") { Remove-Item ".open-next" -Recurse -Force }
npx opennextjs-cloudflare build
if ($LASTEXITCODE -ne 0) { Hata "Derleme başarısız." }
Tamam "Derleme tamam"

Adim "4/7 Paket taraması (önizleme / gizli anahtar kalıntısı)"
$yasak = @(
  @{ Ad = "önizleme yer tutucu adresi"; Desen = "onizleme-test-yok" },
  @{ Ad = "sb_secret anahtarı"; Desen = "sb_secret_[A-Za-z0-9_-]{8,}" },
  @{ Ad = "Anthropic anahtarı"; Desen = "sk-ant-[A-Za-z0-9_-]{8,}" }
)
$dosyalar = Get-ChildItem ".open-next" -Recurse -File -Include *.js, *.html, *.json, *.rsc, *.cache, *.mjs -ErrorAction SilentlyContinue
foreach ($y in $yasak) {
  $bulunan = $dosyalar | Select-String -Pattern $y.Desen -List -ErrorAction SilentlyContinue
  if ($bulunan) { Hata "Pakette $($y.Ad) bulundu ($($bulunan.Count) dosya). Yayın durduruldu." }
}
# Önizleme şeridi: sunucu kodunda yalnızca "NEXT_PUBLIC_ONIZLEME=1 ise" koşuluyla durur (canlıda tanımsız). Müşteriye giden dosyalarda (istemci + hazır sayfalar) HİÇ olmamalı.
$musteri = Get-ChildItem ".open-next/assets", ".open-next/cache" -Recurse -File -ErrorAction SilentlyContinue
if ($musteri | Select-String -Pattern "ÖNİZLEME · test ortamı" -List -ErrorAction SilentlyContinue) { Hata "Müşteriye giden dosyalarda önizleme şeridi var. Yayın durduruldu." }
$canli = $dosyalar | Select-String -Pattern ([regex]::Escape($ref)) -List -ErrorAction SilentlyContinue
if (-not $canli) { Hata "Pakette canlı Supabase adresi YOK (yanlış değişkenlerle derlenmiş olabilir)." }
Tamam "Pakette önizleme veya gizli anahtar kalıntısı yok; canlı adres gömülü"

Adim "5/7 Sayfa önbelleğini pakete koy (bu adım atlanırsa sayfalar Cloudflare'de açılmaz)"
npx opennextjs-cloudflare populateCache remote
if ($LASTEXITCODE -ne 0) { Hata "Önbellek doldurulamadı." }
Tamam "Önbellek hazır"

if (-not $Onayliyorum) {
  Write-Host "`nHAZIRLIK TAMAM. Canlıya HİÇBİR ŞEY yayınlanmadı." -ForegroundColor Cyan
  Write-Host "Yayınlamak için: powershell -ExecutionPolicy Bypass -File .\scripts\canli-yayin.ps1 -Onayliyorum"
  exit 0
}

Adim "6/7 CANLIYA YAYIN (Worker: hity7)"
npx wrangler deploy
if ($LASTEXITCODE -ne 0) { Hata "Yayın başarısız. Canlı site önceki sürümde duruyor." }
Tamam "Yayınlandı"

Adim "7/7 Yayın sonrası kontrol"
$hatali = 0
foreach ($u in "/", "/influencer-marketing", "/smm-panel", "/remake-beat", "/mix-mastering", "/dijital-yayin", "/giris", "/kayit", "/ceo", "/panel", "/bakiye", "/teslim", "/destek", "/yasal/kvkk") {
  try { $r = Invoke-WebRequest "https://hity7.net$u" -UseBasicParsing -TimeoutSec 40; $k = $r.StatusCode } catch { $k = $_.Exception.Response.StatusCode.value__ }
  if ($k -eq 200) { Write-Host ("  200  {0}" -f $u) } else { Write-Host ("  {0}  {1}" -f $k, $u) -ForegroundColor Red; $hatali++ }
}
try { $b = Invoke-WebRequest "https://hity7.net/api/bakiye" -Method Post -Body '{"action":"summary"}' -ContentType "application/json" -UseBasicParsing -TimeoutSec 30 } catch { $bk = $_.Exception.Response.StatusCode.value__ }
if ($bk -eq 401) { Tamam "API sunucu anahtarını görüyor (giriş istiyor: 401)" }
elseif ($bk -eq 503) { Write-Host "  /api/bakiye 503: SUPABASE_SECRET_KEY henüz girilmemiş. Sipariş / bakiye / yükleme çalışmaz. Gir: npx wrangler secret put SUPABASE_SECRET_KEY" -ForegroundColor DarkYellow }
else { Write-Host "  /api/bakiye beklenmedik durum: $bk" -ForegroundColor Red; $hatali++ }
if ($hatali -gt 0) { Hata "$hatali kontrol başarısız. Gerekirse önceki sürüme dön: npx wrangler rollback" }
Tamam "Yayın sonrası kontroller geçti"
