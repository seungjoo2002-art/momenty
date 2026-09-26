import { notFound } from "next/navigation";
import { getCreator } from "@/lib/services/creators";
import type { CreatorTab } from "./CreatorTabs";
import { CreatorScreenView } from "./CreatorScreenView";

/**
 * 크리에이터 화면 (MOMENTY에서 가장 중요한 화면).
 * /creators/[id]/today → 오늘 탭, /creators/[id] → 소개 탭으로 열린다.
 */
export async function CreatorScreen({ creatorId, initialTab }: { creatorId: string; initialTab: CreatorTab }) {
  const creator = await getCreator(creatorId);
  if (!creator) notFound();
  return <CreatorScreenView creator={creator} initialTab={initialTab} />;
}
