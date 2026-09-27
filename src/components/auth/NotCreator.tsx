import { Lock } from "lucide-react";
import { ButtonLink } from "@/components/ui/Button";

/** 크리에이터 프로필이 없는 사용자가 /studio에 들어왔을 때 — 서버 · 클라이언트 모두 이 화면만 보여준다 */
export function NotCreator() {
  return (
    <main className="flex min-h-dvh flex-col items-center justify-center px-8 text-center">
      <span className="grid size-11 place-items-center rounded-full bg-brand-tint text-brand">
        <Lock className="size-5" />
      </span>
      <p className="mt-3 text-name font-semibold">크리에이터만 들어올 수 있어요</p>
      <p className="mt-1 text-caption text-muted">크리에이터 프로필을 만들면 나의 하루를 Moment로 남길 수 있어요.</p>
      <div className="mt-6 w-full space-y-2">
        <ButtonLink href="/setup/creator" block>
          크리에이터로 시작하기
        </ButtonLink>
        <ButtonLink href="/today" variant="ghost" block>
          Today로 돌아가기
        </ButtonLink>
      </div>
    </main>
  );
}
