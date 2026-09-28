import { FanDetail } from "./FanDetail";

/** Creator-safe Fan Profile — 권한은 fan_manager_fan()이 매번 확인한다 (내 채널과 관계있는 팬만) */
export default async function FanDetailPage(props: PageProps<"/studio/fans/[fanId]">) {
  const { fanId } = await props.params;
  return <FanDetail fanId={fanId} />;
}
