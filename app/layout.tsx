import type { Metadata } from "next";
import { Libre_Franklin, Space_Mono } from "next/font/google";
import "./globals.css";
import TopBar from "@/components/TopBar";
import { ToastProvider } from "@/components/Toasts";
import AuthWatch from "@/components/AuthWatch";

const libreFranklin = Libre_Franklin({
  variable: "--font-libre-franklin",
  subsets: ["latin"],
  weight: ["300", "400", "500", "600", "700"],
});

const spaceMono = Space_Mono({
  variable: "--font-space-mono",
  subsets: ["latin"],
  weight: ["400", "700"],
});

export const metadata: Metadata = {
  title: "Pipeline",
  description: "Product research and copy pipeline for DTC brands",
};

export default function RootLayout({ children }: { children: React.ReactNode }) {
  return (
    <html lang="en" data-theme="dark" className={`${libreFranklin.variable} ${spaceMono.variable}`}>
      <body className="min-h-screen" style={{ background: "var(--color-bg)", color: "var(--color-text)", fontFamily: "var(--font-libre-franklin), system-ui, sans-serif", fontSize: 14, lineHeight: 1.5, WebkitFontSmoothing: "antialiased", fontVariantNumeric: "tabular-nums" }}>
        <ToastProvider>
          <AuthWatch />
          <TopBar />
          <main>{children}</main>
        </ToastProvider>
      </body>
    </html>
  );
}
