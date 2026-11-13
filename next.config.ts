import type { NextConfig } from "next";

const nextConfig: NextConfig = {
  /* config options here */
  experimental: {
    agentFeedback: true,
  },
  cacheComponents: true,
  partialPrefetching: true,
  redirects() {
    return [
      // Eski yönetim paneli adresi: /admin → /ceo
      { source: "/admin", destination: "/ceo", permanent: false },
      { source: "/admin/:path*", destination: "/ceo", permanent: false },
      // Ana sayfadaki "Hemen Başla" düğmeleri /uye-ol adresine gider; üyelik ekranı /giris?tab=kayit
      { source: "/uye-ol", destination: "/giris?tab=kayit", permanent: false },
    ];
  },
  turbopack: {
    rules: {
      "*.css": {
        loaders: ["@tailwindcss/turbopack"],
        as: "*.css",
      },
    },
  },
};

export default nextConfig;
