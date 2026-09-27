import { redirect } from "next/navigation";
import { CreatorGate } from "@/components/auth/Gates";
import { NotCreator } from "@/components/auth/NotCreator";
import { AppFrame } from "@/components/layout/AppFrame";
import { BottomNavigation } from "@/components/layout/BottomNavigation";
import { getServerAuth } from "@/lib/supabase/server";

// 요청마다 로그인 사용자를 확인한다
export const dynamic = "force-dynamic";

/**
 * Studio — 서버에서 먼저 확인한다: 로그인 + 이 사용자의 creators 행.
 * 크리에이터가 아니면 Studio 화면(children)을 아예 렌더링하지 않는다 → 서버 응답에 Studio 내용이 없다.
 * 데이터 자체는 DB RLS가 한 번 더 막는다. 안쪽 CreatorGate는 로그아웃 등 클라이언트 전환용(UX).
 */
export default async function StudioLayout({ children }: { children: React.ReactNode }) {
  const { user, creatorId } = await getServerAuth({ withCreator: true });
  if (!user) redirect("/login?next=%2Fstudio");
  if (!creatorId) {
    return (
      <AppFrame>
        <NotCreator />
      </AppFrame>
    );
  }
  return (
    <AppFrame>
      <CreatorGate>
        {children}
        <BottomNavigation mode="creator" />
      </CreatorGate>
    </AppFrame>
  );
}
