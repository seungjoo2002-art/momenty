import { notFound } from "next/navigation";
import { ChatRoom } from "@/components/chat/ChatRoom";
import { getCreator } from "@/lib/services/creators";

/** 크리에이터와의 대화방 (로그인 필요 — proxy · FanGate). AI 권한은 /api/ai/chat, 직접 메시지 권한은 DB 함수가 매번 다시 확인한다 */
export default async function ChatRoomPage(props: PageProps<"/chat/[creatorId]">) {
  const { creatorId } = await props.params;
  const { moment } = await props.searchParams;
  const creator = await getCreator(creatorId);
  if (!creator) notFound();
  const momentId = typeof moment === "string" && /^[0-9a-f-]{36}$/i.test(moment) ? moment : undefined;
  // 한 대화방 — 예전 링크의 ?mode=human은 무시한다 (받는 쪽은 AI Avatar ON/OFF로 정해진다)
  return <ChatRoom creator={creator} focusMomentId={momentId} />;
}
