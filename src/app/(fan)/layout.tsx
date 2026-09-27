import { FanGate } from "@/components/auth/Gates";
import { AppFrame } from "@/components/layout/AppFrame";
import { BottomNavigation } from "@/components/layout/BottomNavigation";

// "오늘"은 요청할 때마다 달라진다 — 매 요청 시점 기준으로 렌더링
export const dynamic = "force-dynamic";

/** Discover · 크리에이터 · Moment 상세는 누구나, Today · My · Archive · Chat · 구독은 로그인 후 (FanGate) */
export default function FanLayout({ children }: { children: React.ReactNode }) {
  return (
    <AppFrame>
      <FanGate>{children}</FanGate>
      <BottomNavigation mode="fan" />
    </AppFrame>
  );
}
