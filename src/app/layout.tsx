import type { Metadata, Viewport } from "next";
import { AuthProvider } from "@/components/auth/AuthProvider";
// Pretendard (npm pretendard 1.3.9 · SIL OFL 1.1 — 전문: /licenses/pretendard-OFL-1.1.txt).
// 가변 굵기 한 벌을 글자 범위별 조각(dynamic subset)으로 — Next가 이 앱의 정적 파일로 함께 배포하고, 브라우저는 쓰인 글자 범위의 조각만 받는다. 외부 CDN 없음.
import "pretendard/dist/web/variable/pretendardvariable-dynamic-subset.css";
import "./globals.css";

export const metadata: Metadata = {
  title: "MOMENTY — 좋아하는 사람의 하루를 구독하다",
  description: "크리에이터가 남긴 오늘의 Moment를 따라가는 팬 플랫폼",
};

export const viewport: Viewport = {
  width: "device-width",
  initialScale: 1,
  viewportFit: "cover",
  // 키보드가 열리면 레이아웃이 줄어들어 Chat 입력창이 가려지지 않도록
  interactiveWidget: "resizes-content",
  themeColor: "#faf9ff",
};

export default function RootLayout({ children }: LayoutProps<"/">) {
  return (
    <html lang="ko" className="h-full antialiased">
      <body className="min-h-full">
        <AuthProvider>{children}</AuthProvider>
      </body>
    </html>
  );
}
