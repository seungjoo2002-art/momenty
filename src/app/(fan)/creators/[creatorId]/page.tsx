import { CreatorScreen } from "@/components/creator/CreatorScreen";
import type { CreatorTab } from "@/components/creator/CreatorTabs";

const TABS: CreatorTab[] = ["today", "archive", "intro"];

/** 크리에이터 프로필 — 같은 화면을 '소개' 탭(또는 ?tab=)으로 연다 */
export default async function CreatorProfilePage(props: PageProps<"/creators/[creatorId]">) {
  const { creatorId } = await props.params;
  const { tab } = await props.searchParams;
  const initialTab = TABS.includes(tab as CreatorTab) ? (tab as CreatorTab) : "intro";
  return <CreatorScreen creatorId={creatorId} initialTab={initialTab} />;
}
