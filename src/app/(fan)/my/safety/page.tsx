import { TopBar } from "@/components/ui/TopBar";

/** SafeShare 안내 (팬) — MOMENTY가 크리에이터의 하루를 안전하게 나누는 방법 */
export default function SafetyInfoPage() {
  return (
    <main className="animate-fade-in pb-10">
      <TopBar backHref="/my" title="SafeShare 안내" center />
      <div className="space-y-5 px-5 pt-3 break-keep">
        <p className="text-sub font-semibold">Share your day, not your location.</p>
        <Block title="기록 시점과 공개 시점이 다를 수 있어요">
          크리에이터를 보호하기 위해 Moment는 기록한 뒤 조금 늦게 공개될 수 있어요. Moment에 보이는 장소는 기록 당시의 장소이고, 크리에이터가 지금 그곳에 있다는 뜻이 아니에요.
        </Block>
        <Block title="사진 속 위치 정보는 지워져요">
          크리에이터가 올린 사진 · 영상의 위치 · 기기 정보는 공개 전에 지워지고, 사진 속 주소 · 번호판 같은 정보는 공개 전에 한 번 더 확인해요.
        </Block>
        <Block title="Creator AI도 같은 원칙을 지켜요">
          Creator AI는 공개된 Moment만 참고하고, 크리에이터의 현재 위치나 사는 곳은 말하지 않아요.
        </Block>
        <Block title="불편한 메시지는 신고 · 차단할 수 있어요">
          직접 메시지에서 신고하거나 차단할 수 있어요. 신고한 사실은 상대에게 알려지지 않아요.
        </Block>
      </div>
    </main>
  );
}

function Block({ title, children }: { title: string; children: React.ReactNode }) {
  return (
    <section>
      <h2 className="text-sub font-medium">{title}</h2>
      <p className="mt-1 text-caption leading-relaxed text-muted">{children}</p>
    </section>
  );
}
