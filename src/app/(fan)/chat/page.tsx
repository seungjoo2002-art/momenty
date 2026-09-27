import { ComingSoon } from "@/components/ui/ComingSoon";

/** Creator AI 대화는 v0.5에서 연다 — 지금은 예시 대화를 보여주지 않는다 */
export default function ChatListPage() {
  return (
    <ComingSoon
      title="Creator AI 대화는 준비 중이에요"
      description="크리에이터가 남긴 오늘의 Moment를 바탕으로 이야기하는 대화가 곧 열려요. AI의 말과 크리에이터 본인의 말은 언제나 구분해서 보여드릴게요."
      primary={{ href: "/today", label: "오늘의 Moment 보기" }}
    />
  );
}
