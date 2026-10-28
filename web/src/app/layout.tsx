import type { Metadata, Viewport } from "next";
import { Suspense } from "react";
import { Bodoni_Moda, Schibsted_Grotesk, Martian_Mono } from "next/font/google";
import "./globals.css";
import "./testdeploy.css";
import { Masthead, Dateline, Footer, TestnetBanner } from "@/components/Shell";
import { InkFilter } from "@/components/Stamp";

const display = Bodoni_Moda({
  variable: "--font-display",
  subsets: ["latin"],
  style: ["normal", "italic"],
  weight: ["500", "600", "700"],
  display: "swap",
});
const text = Schibsted_Grotesk({
  variable: "--font-text",
  subsets: ["latin"],
  weight: ["400", "500", "700"],
  display: "swap",
});
const mono = Martian_Mono({
  variable: "--font-mono",
  subsets: ["latin"],
  weight: ["400", "500", "700"],
  display: "swap",
});

export const viewport: Viewport = { width: "device-width", initialScale: 1, viewportFit: "cover" };

const testDeploy = process.env.NEXT_PUBLIC_TEST_DEPLOY === "1";

export const metadata: Metadata = {
  ...(testDeploy ? { robots: { index: false, follow: false, nocache: true } } : {}),
  title: { default: "Clippo — pay only for clips that passed", template: "%s · Clippo" },
  description:
    "Fund a USDC pool. Verified humans post clips. An agent checks each one against your brief. Views settle on-chain, creators claim their own money.",
};

// Runs before paint so a saved "Night"/"Paper" choice never flashes the other one.
const themeInit = `try{var t=localStorage.getItem('clippo-theme');if(t==='dark'||t==='light')document.documentElement.setAttribute('data-theme',t)}catch(e){}`;

export default function RootLayout({ children }: LayoutProps<"/">) {
  return (
    <html lang="en" className={`${display.variable} ${text.variable} ${mono.variable}`} suppressHydrationWarning>
      <head>
        <script dangerouslySetInnerHTML={{ __html: themeInit }} />
      </head>
      <body>
        <a className="skip" href="#main">
          Skip to content
        </a>
        <InkFilter />
        <Dateline />
        <Suspense fallback={<header className="masthead" style={{ minHeight: 96 }} />}>
          <Masthead />
        </Suspense>
        <main id="main" tabIndex={-1}>
          {children}
        </main>
        <Footer />
      </body>
    </html>
  );
}
