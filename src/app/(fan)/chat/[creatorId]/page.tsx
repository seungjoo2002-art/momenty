import { ComingSoon } from "@/components/ui/ComingSoon";

export default async function ChatRoomPage(props: PageProps<"/chat/[creatorId]">) {
  const { creatorId } = await props.params;
  return (
    <ComingSoon
      backHref={`/creators/${creatorId}/today`}
      title="Creator AI 대화는 준비 중이에요"
      description="지금은 크리에이터의 오늘을 Today에서 함께 따라가 주세요."
      primary={{ href: `/creators/${creatorId}/today`, label: "오늘의 하루 보기" }}
    />
  );
}
