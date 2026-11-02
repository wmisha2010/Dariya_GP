import type { NextConfig } from "next";

const nextConfig: NextConfig = {
  output: "standalone",
  /* msedge-tts должен остаться внешним пакетом: webpack-бандл ломает
   * ws-хендшейк (динамические require внутри ws), и WSS-соединение
   * с Microsoft не устанавливается — голос молчит */
  serverExternalPackages: ["msedge-tts"],
  /* config options here */
  typescript: {
    ignoreBuildErrors: true,
  },
  reactStrictMode: false,
  async headers() {
    return [
      {
        /* Сервис-воркер обязан всегда приходить свежим: закэшированный sw.js
         * «приклеивает» старую версию приложения в браузере навсегда */
        source: "/sw.js",
        headers: [
          { key: "Cache-Control", value: "no-cache, no-store, must-revalidate" },
          { key: "Clear-Site-Data", value: '"cache"' },
        ],
      },
    ];
  },
};

export default nextConfig;
