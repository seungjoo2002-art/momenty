import { CreatorGate } from "@/components/auth/Gates";
import { AppFrame } from "@/components/layout/AppFrame";
import { BottomNavigation } from "@/components/layout/BottomNavigation";

// "오늘"은 요청할 때마다 달라진다 — 매 요청 시점 기준으로 렌더링
export const dynamic = "force-dynamic";

/** Studio는 크리에이터 프로필이 있는 로그인 사용자만 (CreatorGate). 데이터 권한은 DB RLS가 한 번 더 막는다. */
export default function StudioLayout({ children }: { children: React.ReactNode }) {
  return (
    <AppFrame>
      <CreatorGate>
        {children}
        <BottomNavigation mode="creator" />
      </CreatorGate>
    </AppFrame>
  );
}
