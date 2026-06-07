import type { Metadata } from "next";
import { Space_Grotesk, JetBrains_Mono } from "next/font/google";
import "./globals.css";
import AppShell from "@/components/AppShell";

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
  title: "DTC Research Pipeline",
  description: "Product research and copy pipeline for DTC brands",
};

export default function RootLayout({ children }: { children: React.ReactNode }) {
  return (
    <html lang="en" data-theme="dark" className={`${spaceGrotesk.variable} ${jetBrainsMono.variable}`}>
      <body className="min-h-screen" style={{ background: "var(--color-bg)", color: "var(--color-text)", fontFamily: "var(--font-space-grotesk), system-ui, sans-serif", fontSize: 14, lineHeight: 1.5, WebkitFontSmoothing: "antialiased", fontVariantNumeric: "tabular-nums" }}>
        <AppShell>{children}</AppShell>
      </body>
    </html>
  );
}
