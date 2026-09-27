import { getCreators } from "@/lib/services/creators";
import { getAllTodayMoments } from "@/lib/services/moments";
import { DiscoverView } from "./DiscoverView";

/** 공개 정보만 (서버 렌더링 · 세션 없음): 크리에이터 목록 · 오늘 Moment 개수 · 전체 공개 사진/영상 */
export default async function DiscoverPage() {
  const [creators, today] = await Promise.all([getCreators(), getAllTodayMoments()]);
  const counts: Record<string, number> = {};
  for (const m of today) counts[m.creatorId] = (counts[m.creatorId] ?? 0) + 1;
  // 사진·영상 중심으로: 크리에이터의 콘텐츠가 가장 먼저 보이도록 (잠기지 않은 전체 공개만)
  const latest = [...today]
    .reverse()
    .filter((m) => m.visibility === "public" && !m.locked && ((m.type === "photo" && m.mediaUrl) || (m.type === "video" && m.posterUrl)))
    .slice(0, 6);

  return <DiscoverView creators={creators} counts={counts} latest={latest} />;
}
