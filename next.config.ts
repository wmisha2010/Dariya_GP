import type { NextConfig } from "next";

const nextConfig: NextConfig = {
  output: "standalone",
  /* msedge-tts должен остаться внешним пакетом: webpack-бандл ломает
   * ws-хендшейк (динамические require внутри ws), и WSS-соединение
   * с Microsoft не устанавливается — голос молчит */
  serverExternalPackages: ["msedge-tts"],
  /* Превью открывается с домена gateway, а dev-сервер считает его чужим
   * origin: без этого списка Next ругается на cross-origin запросы к /_next/* */
  allowedDevOrigins: ["preview-chat-d8e654d4-40f5-415b-a16a-09dbc10c3f5d.space-z.ai"],
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
