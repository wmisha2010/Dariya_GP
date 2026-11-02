import type { Metadata, Viewport } from "next";
import { Geist, Geist_Mono } from "next/font/google";
import "./globals.css";
import { Toaster } from "@/components/ui/toaster";
import { PwaRegister } from "@/components/pwa-register";

const geistSans = Geist({
  variable: "--font-geist-sans",
  subsets: ["latin", "cyrillic"],
});

const geistMono = Geist_Mono({
  variable: "--font-geist-mono",
  subsets: ["latin", "cyrillic"],
});

export const metadata: Metadata = {
  title: "Дария — голосовой ИИ-ассистент",
  description:
    "Голосовой ассистент с командой ИИ-персонажей: разговор голосом, память, поиск в интернете, дневник. Веб-аналог Dewiar.",
  keywords: ["голосовой ассистент", "ИИ", "Дария", "AI voice assistant", "Dewiar"],
  authors: [{ name: "Дария" }],
  applicationName: "Дария",
  // PWA: манифест + локальные иконки орбиса (публичные, без CDN)
  manifest: "/manifest.json",
  icons: {
    icon: [
      { url: "/icons/icon-192.png", sizes: "192x192", type: "image/png" },
      { url: "/icons/icon-512.png", sizes: "512x512", type: "image/png" },
    ],
    apple: "/icons/apple-touch-icon.png",
  },
  appleWebApp: {
    capable: true,
    title: "Дария",
    statusBarStyle: "black-translucent",
  },
  openGraph: {
    title: "Дария — голосовой ИИ-ассистент",
    description: "Поговори с ИИ голосом: персонажи, память, поиск в интернете",
    siteName: "Дария",
    type: "website",
  },
};

export const viewport: Viewport = {
  themeColor: "#0b0817",
  width: "device-width",
  initialScale: 1,
};

/**
 * Аварийный выключатель сервис-воркера, инлайн в <body> первым узлом.
 * Выполняется из СВЕЖЕГО HTML до старых бандлов: если в браузере сидит
 * старый воркер (закэшировал дев-чанки — «приложение откатилось»), снимаем
 * его и чистим кэши, затем один reload. В проде — неактивен.
 */
const SW_KILL_SWITCH = `(function(){try{
if(!('serviceWorker' in navigator))return;
if("${process.env.NODE_ENV}"==="production")return;
var had=!!navigator.serviceWorker.controller;
navigator.serviceWorker.getRegistrations().then(function(regs){
if(!regs||!regs.length)return;
Promise.all(regs.map(function(r){return r.unregister();}))
.then(function(){return caches.keys().then(function(ks){return Promise.all(ks.map(function(k){return caches.delete(k);}));});})
.then(function(){
try{if(had&&!sessionStorage.getItem('daria-sw-cleaned')){sessionStorage.setItem('daria-sw-cleaned','1');location.reload();}}catch(e){}
}).catch(function(){});
}).catch(function(){});
}catch(e){}})();`;

export default function RootLayout({
  children,
}: Readonly<{
  children: React.ReactNode;
}>) {
  return (
    <html lang="ru" suppressHydrationWarning>
      <body
        className={`${geistSans.variable} ${geistMono.variable} antialiased bg-background text-foreground`}
      >
        <script dangerouslySetInnerHTML={{ __html: SW_KILL_SWITCH }} />
        {children}
        <Toaster />
        <PwaRegister />
      </body>
    </html>
  );
}
