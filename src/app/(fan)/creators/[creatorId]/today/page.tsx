import { CreatorScreen } from "@/components/creator/CreatorScreen";

/** Creator Today — MOMENTY에서 가장 중요한 화면. '오늘' 탭으로 연다 */
export default async function CreatorTodayPage(props: PageProps<"/creators/[creatorId]/today">) {
  const { creatorId } = await props.params;
  return <CreatorScreen creatorId={creatorId} initialTab="today" />;
}
