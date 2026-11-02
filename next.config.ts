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
};

export default nextConfig;
