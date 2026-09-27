import { notFound } from "next/navigation";
import { ChatRoom } from "@/components/chat/ChatRoom";
import { getCreator } from "@/lib/services/creators";

/** Creator AI 대화방 (로그인 필요 — proxy · FanGate). 권한은 /api/ai/chat이 매 요청 다시 확인한다 */
export default async function ChatRoomPage(props: PageProps<"/chat/[creatorId]">) {
  const { creatorId } = await props.params;
  const { moment } = await props.searchParams;
  const creator = await getCreator(creatorId);
  if (!creator) notFound();
  const momentId = typeof moment === "string" && /^[0-9a-f-]{36}$/i.test(moment) ? moment : undefined;
  return <ChatRoom creator={creator} focusMomentId={momentId} />;
}
