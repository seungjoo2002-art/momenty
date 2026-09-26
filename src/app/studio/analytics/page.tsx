import { getMomentsByIds } from "@/lib/services/moments";
import { getAnalytics } from "@/lib/services/studio";
import { AnalyticsView } from "./AnalyticsView";

export default async function AnalyticsPage() {
  const analytics = await getAnalytics();
  const found = await getMomentsByIds(analytics.topMomentIds);
  const topMoments = analytics.topMomentIds.map((id) => found.find((m) => m.id === id)!).filter(Boolean);
  return <AnalyticsView analytics={analytics} topMoments={topMoments} />;
}
