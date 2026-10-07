import type { Metadata } from "next";
import { IBM_Plex_Sans } from "next/font/google";
import "./globals.css";

// Self-hosted Latin subset only (digits, Latin text, symbols). Korean glyphs use the platform's
// default Korean sans-serif (lang="ko"): the Korean web-font slices cost ~50 requests and a page-wide
// relayout per slice on phones. No Arial-based metric fallback: looking up a missing local font is
// slow on some platforms, and Latin text is a small share of the page.
const sans = IBM_Plex_Sans({
  variable: "--font-sans",
  weight: ["400"],
  subsets: ["latin"],
  display: "swap",
  preload: false,
  adjustFontFallback: false,
  fallback: ["sans-serif"],
});

export const metadata: Metadata = {
  title: "변동성 항력 실데이터 재현",
  description: "시뮬레이션 제출본과 사전등록 실데이터 재현을 같은 기준으로 비교한 결과",
};

export const viewport = { width: "device-width", initialScale: 1 };

export default function RootLayout({ children }: LayoutProps<"/">) {
  return (
    <html lang="ko" data-theme="light" className={sans.variable}>
      <body>{children}</body>
    </html>
  );
}
