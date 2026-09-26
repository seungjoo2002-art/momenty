import { notFound } from "next/navigation";
import { getCreator } from "@/lib/services/creators";
import { getChatThread } from "@/lib/services/fan";
import { ChatRoomScreen } from "./ChatRoomScreen";

export default async function ChatRoomPage(props: PageProps<"/chat/[creatorId]">) {
  const { creatorId } = await props.params;
  const { moment: focusId } = await props.searchParams;
  const creator = await getCreator(creatorId);
  if (!creator) notFound();

  const thread = await getChatThread(creatorId);

  return (
    <ChatRoomScreen creator={creator} thread={thread} focusId={typeof focusId === "string" ? focusId : undefined} />
  );
}
