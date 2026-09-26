import { ShieldCheck } from "lucide-react";
import { SafetyBadge } from "@/components/badges";
import { ButtonLink } from "@/components/ui/Button";
import { ToggleRow } from "@/components/ui/Toggle";
import { TopBar } from "@/components/ui/TopBar";

const group = "mx-5 overflow-hidden rounded-card border border-line bg-surface [&>div]:border-b [&>div]:border-line [&>div:last-child]:border-none";

export default function SafeShareSettingsPage() {
  return (
    <main className="pb-10">
      <TopBar backHref="/studio/settings" title="SafeShare" center />

      <section className="mx-5 mt-4 flex gap-3 rounded-card bg-safe-soft p-5">
        <ShieldCheck className="size-6 shrink-0 text-safe" />
        <div>
          <p className="text-body font-semibold text-safe">실시간 기록, 안전하게</p>
          <p className="mt-1 text-caption leading-relaxed text-ink-2">
            하루를 실시간으로 나누는 만큼, 지금 있는 곳이 드러나지 않도록 Moment를 올리기 전에 자동으로 보호해요.
          </p>
          <div className="mt-3 flex flex-wrap gap-1.5">
            <SafetyBadge flag="location_delayed" />
            <SafetyBadge flag="faces_blurred" />
            <SafetyBadge flag="location_removed" />
          </div>
        </div>
      </section>

      <h2 className="px-5 pt-8 pb-3 text-body font-semibold">위치</h2>
      <div className={group}>
        <ToggleRow title="위치 지연 공개" description="장소를 떠난 뒤 30분이 지나야 위치 태그가 보여요." defaultOn />
        <ToggleRow title="사진 속 위치 정보(EXIF) 제거" description="업로드되는 모든 사진·영상에서 GPS 정보를 지워요." defaultOn locked />
        <ToggleRow title="집 주변 위치 숨기기" description="등록한 장소 반경 1km에서는 위치를 표시하지 않아요." defaultOn />
      </div>

      <h2 className="px-5 pt-8 pb-3 text-body font-semibold">사람과 정보</h2>
      <div className={group}>
        <ToggleRow title="타인 얼굴 자동 흐림" description="함께 찍힌 사람의 얼굴을 흐리게 처리해요." defaultOn />
        <ToggleRow title="번호판 · 주소 · 간판 감지" description="식별 가능한 정보가 보이면 올리기 전에 알려드려요." defaultOn />
        <ToggleRow title="보호 워터마크" description="Premium Moment에 팬 닉네임 워터마크를 넣어 무단 유출을 막아요." />
      </div>

      <h2 className="px-5 pt-8 pb-3 text-body font-semibold">기본 공개범위</h2>
      <div className={group}>
        <ToggleRow title="새 Moment는 구독자 공개로 시작" description="올릴 때마다 바꿀 수 있어요." />
      </div>

      <div className="px-4 pt-6">
        <ButtonLink href="/studio/settings" block size="lg">
          저장하기
        </ButtonLink>
      </div>
    </main>
  );
}
