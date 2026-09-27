import { StudioDashboard } from "./StudioDashboard";

export default async function CreatorDashboardPage(props: PageProps<"/studio">) {
  const { posted } = await props.searchParams;
  return <StudioDashboard posted={!!posted} />;
}
