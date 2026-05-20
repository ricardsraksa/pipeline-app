import type { Metadata } from "next";
import { IBM_Plex_Mono, DM_Sans } from "next/font/google";
import "./globals.css";
import Sidebar from "@/components/Sidebar";

const ibmPlexMono = IBM_Plex_Mono({
  variable: "--font-ibm-plex-mono",
  subsets: ["latin"],
  weight: ["400", "500", "600"],
});

const dmSans = DM_Sans({
  variable: "--font-dm-sans",
  subsets: ["latin"],
  weight: ["400", "500", "600"],
});

export const metadata: Metadata = {
  title: "DTC Research Pipeline",
  description: "Product research and copy pipeline for DTC brands",
};

export default function RootLayout({ children }: { children: React.ReactNode }) {
  return (
    <html lang="en" data-theme="light" className={`${ibmPlexMono.variable} ${dmSans.variable}`}>
      <body className="min-h-screen" style={{ background: "var(--color-bg)", color: "var(--color-text)", fontFamily: "var(--font-dm-sans), DM Sans, system-ui, sans-serif", fontSize: 14, lineHeight: 1.5, WebkitFontSmoothing: "antialiased", fontVariantNumeric: "tabular-nums" }}>
        <div style={{ display: "grid", gridTemplateColumns: "236px 1fr", minHeight: "100vh" }}>
          <Sidebar />
          <div style={{ minWidth: 0, overflowX: "hidden", display: "flex", flexDirection: "column" }}>
            {children}
          </div>
        </div>
      </body>
    </html>
  );
}
