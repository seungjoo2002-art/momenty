import { getAnalytics, getCurrentCreator, getStudioFans, getStudioToday } from "@/lib/services/studio";
import { FansView } from "./FansView";

export default async function FansPage() {
  const [creator, fans, today, analytics] = await Promise.all([
    getCurrentCreator(),
    getStudioFans(),
    getStudioToday(),
    getAnalytics(),
  ]);
  return (
    <FansView creator={creator} fans={fans} fanBrief={today.fanBrief} newSubscribersToday={analytics.periods.today.newSubscribers} />
  );
}
