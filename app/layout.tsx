import type { Metadata } from "next";
import { Geist, Geist_Mono } from "next/font/google";
import "./globals.css";
import GlobalMenu from "../components/GlobalMenu";
import GlobalFooter from "../components/GlobalFooter";
import HityTracker from "../components/HityTracker";

const geistSans = Geist({
  variable: "--font-geist-sans",
  subsets: ["latin"],
});

const geistMono = Geist_Mono({
  variable: "--font-geist-mono",
  subsets: ["latin"],
});

export const metadata: Metadata = {
  title: "HITY7 — Müziğin Geleceğini Şekillendir",
  description: "Influencer marketing, SMM panel, remake beat, mix & mastering ve dijital yayın hizmetleri tek platformda.",
};

export default function RootLayout({ children }: LayoutProps<"/">) {
  return (
    <html
      lang="tr"
      className={`${geistSans.variable} ${geistMono.variable} h-full antialiased`}
    >
      <body className="min-h-full flex flex-col">
        <GlobalMenu />
        <HityTracker />
        {children}
        <GlobalFooter />
      </body>
    </html>
  );
}
