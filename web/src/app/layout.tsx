import type { Metadata } from "next";
import { IBM_Plex_Sans_KR, Noto_Serif_KR } from "next/font/google";
import "./globals.css";

const serif = Noto_Serif_KR({
  variable: "--font-serif",
  weight: ["500", "700"],
  subsets: ["latin"],
  preload: false,
});

const sans = IBM_Plex_Sans_KR({
  variable: "--font-sans",
  weight: ["400", "500", "600", "700"],
  subsets: ["latin"],
  preload: false,
});

export const metadata: Metadata = {
  title: "변동성 항력 실데이터 재현",
  description: "시뮬레이션 제출본과 사전등록 실데이터 재현을 같은 기준으로 비교한 결과",
};

export default function RootLayout({ children }: LayoutProps<"/">) {
  return (
    <html lang="ko" data-theme="light" className={`${serif.variable} ${sans.variable}`}>
      <body>{children}</body>
    </html>
  );
}
