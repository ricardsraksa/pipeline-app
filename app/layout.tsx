import type { Metadata } from "next";
import { Space_Grotesk, JetBrains_Mono } from "next/font/google";
import "./globals.css";
import TopBar from "@/components/TopBar";
import { ToastProvider } from "@/components/Toasts";
import AuthWatch from "@/components/AuthWatch";

const spaceGrotesk = Space_Grotesk({
  variable: "--font-space-grotesk",
  subsets: ["latin"],
  weight: ["400", "500", "600", "700"],
});

const jetBrainsMono = JetBrains_Mono({
  variable: "--font-jetbrains-mono",
  subsets: ["latin"],
  weight: ["400", "500", "600"],
});

export const metadata: Metadata = {
  title: "Pipeline v2 — DTC Research",
  description: "Product research and copy pipeline for DTC brands",
};

export default function RootLayout({ children }: { children: React.ReactNode }) {
  return (
    <html lang="en" data-theme="light" className={`${spaceGrotesk.variable} ${jetBrainsMono.variable}`}>
      <body className="min-h-screen" style={{ background: "var(--color-bg)", color: "var(--color-text)", fontFamily: "var(--font-space-grotesk), system-ui, sans-serif", fontSize: 14, lineHeight: 1.5, WebkitFontSmoothing: "antialiased", fontVariantNumeric: "tabular-nums" }}>
        <ToastProvider>
          <AuthWatch />
          <TopBar />
          <main>{children}</main>
        </ToastProvider>
      </body>
    </html>
  );
}
