// Cloudflare (OpenNext) yayın ayarı.
// Uygulama ISR / revalidate kullanmıyor; önceden hazırlanan sayfalar derleme çıktısından okunur.
// Bu yüzden R2 (kart gerektirir) yerine ücretsiz "static assets" önbelleği seçildi.
import { defineCloudflareConfig } from "@opennextjs/cloudflare";
import staticAssetsIncrementalCache from "@opennextjs/cloudflare/overrides/incremental-cache/static-assets-incremental-cache";

export default defineCloudflareConfig({
  incrementalCache: staticAssetsIncrementalCache,
});
