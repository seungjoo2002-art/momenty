import { getCreators } from "@/lib/services/creators";
import { getLatestMoments, getTodayMoments } from "@/lib/services/moments";
import { DiscoverView } from "./DiscoverView";

export default async function DiscoverPage() {
  const creators = await getCreators();
  const counts = Object.fromEntries(
    await Promise.all(creators.map(async (c) => [c.id, (await getTodayMoments(c.id)).length] as const)),
  );
  // 사진·영상 중심으로: 크리에이터의 콘텐츠가 가장 먼저 보이도록
  const latest = (await getLatestMoments(30))
    .filter((m) => m.visibility === "public" && (m.type === "photo" || m.type === "video"))
    .slice(0, 6);

  return <DiscoverView creators={creators} counts={counts} latest={latest} />;
}
