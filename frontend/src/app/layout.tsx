import type { Metadata, Viewport } from "next";
import { Allura, DM_Sans, Fraunces, JetBrains_Mono, Outfit } from "next/font/google";
import "./globals.css";

const dmSans = DM_Sans({
  subsets: ["latin"],
  variable: "--font-sans",
  display: "swap",
});

const fraunces = Fraunces({
  subsets: ["latin"],
  variable: "--font-display",
  display: "swap",
  axes: ["opsz"],
});

const allura = Allura({
  subsets: ["latin"],
  variable: "--font-script",
  weight: ["400"],
  display: "swap",
});

// Wordmark face — Outfit's flat terminals + geometric structure read as a
// crafted logotype rather than body type. Used for the "BEAKON" wordmark and
// the "B" inside the brand tile.
const outfit = Outfit({
  subsets: ["latin"],
  variable: "--font-wordmark",
  weight: ["700", "800", "900"],
  display: "swap",
});

// Monospace — financial figures, codes, references. JetBrains Mono has
// genuine tabular figures (cv11) and tight tracking, so columns of
// amounts line up cleanly without per-cell width gymnastics.
const jetbrainsMono = JetBrains_Mono({
  subsets: ["latin"],
  variable: "--font-mono",
  display: "swap",
  weight: ["400", "500", "600"],
});

export const metadata: Metadata = {
  title: "Beakon — The AI Operating System for Fiduciary Excellence",
  description:
    "AI-native accounting for fiduciaries, family offices, and SMEs. Multi-entity, intercompany, multi-currency. Hosted in Switzerland.",
  icons: {
    icon: "/favicon.svg",
    shortcut: "/favicon.svg",
  },
};

export const viewport: Viewport = {
  width: "device-width",
  initialScale: 1,
  viewportFit: "cover",
};

export default function RootLayout({
  children,
}: {
  children: React.ReactNode;
}) {
  return (
    <html lang="en" className={`${dmSans.variable} ${fraunces.variable} ${allura.variable} ${outfit.variable} ${jetbrainsMono.variable}`}>
      <body suppressHydrationWarning>{children}</body>
    </html>
  );
}
