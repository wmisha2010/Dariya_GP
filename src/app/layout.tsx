import type { Metadata, Viewport } from "next";
import { Geist, Geist_Mono } from "next/font/google";
import "./globals.css";
import { Toaster } from "@/components/ui/toaster";

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
  icons: {
    icon: "https://z-cdn.chatglm.cn/z-ai/static/logo.svg",
  },
  openGraph: {
    title: "Дария — голосовой ИИ-ассистент",
    description: "Поговори с ИИ голосом: персонажи, память, поиск в интернете",
    siteName: "Дария",
    type: "website",
  },
};

export const viewport: Viewport = {
  themeColor: "#070b12",
  width: "device-width",
  initialScale: 1,
};

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
        {children}
        <Toaster />
      </body>
    </html>
  );
}
