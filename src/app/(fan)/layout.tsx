import { AppFrame } from "@/components/layout/AppFrame";
import { BottomNavigation } from "@/components/layout/BottomNavigation";

// "오늘"은 요청할 때마다 달라진다 — Mock 데이터도 매 요청 시점 기준으로 렌더링
export const dynamic = "force-dynamic";

export default function FanLayout({ children }: { children: React.ReactNode }) {
  return (
    <AppFrame>
      {children}
      <BottomNavigation mode="fan" />
    </AppFrame>
  );
}
