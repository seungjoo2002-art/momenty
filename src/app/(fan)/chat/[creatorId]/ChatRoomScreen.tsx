"use client";

import { ChatRoom } from "@/components/chat/ChatRoom";
import { LoadError } from "@/components/ui/LoadState";
import { useMomentData } from "@/lib/hooks/useMomentData";
import { getTier } from "@/lib/services/fan";
import { getTodayMoments } from "@/lib/services/moments";
import type { ChatThread, Creator } from "@/lib/types";
import { canChat, isMomentLocked } from "@/lib/utils/access";

export function ChatRoomScreen({
  creator,
  thread,
  focusId,
}: {
  creator: Creator;
  thread: ChatThread;
  focusId?: string;
}) {
  const { data, error, retry } = useMomentData(`chat:${creator.id}`, async () => {
    const [tier, todayMoments] = await Promise.all([getTier(creator.id), getTodayMoments(creator.id)]);
    return { tier, todayMoments };
  });
  if (!data) return <main className="min-h-dvh">{error && <LoadError message={error} onRetry={retry} className="pt-32" />}</main>;
  const { tier, todayMoments } = data;

  // 팬이 볼 수 있고, 크리에이터가 AI 참고를 허락한 Moment만 대화의 근거가 된다
  const moments = todayMoments.filter((m) => !isMomentLocked(m, tier) && m.aiContextEnabled);
  const focusMoment = focusId ? moments.find((m) => m.id === focusId) : undefined;

  return <ChatRoom creator={creator} thread={thread} moments={moments} canChat={canChat(tier)} focusMoment={focusMoment} />;
}
