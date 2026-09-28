import { StudioDashboard } from "./StudioDashboard";

export default async function CreatorDashboardPage(props: PageProps<"/studio">) {
  const { posted, at } = await props.searchParams;
  // posted=scheduled&at=…: Safe Delay로 공개 예정 (크리에이터 본인 화면에서만 쓰는 값)
  const scheduledAt = posted === "scheduled" && typeof at === "string" && !Number.isNaN(Date.parse(at)) ? at : null;
  return <StudioDashboard posted={!!posted} scheduledAt={scheduledAt} />;
}
