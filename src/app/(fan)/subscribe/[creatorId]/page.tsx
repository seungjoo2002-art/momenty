import { notFound } from "next/navigation";
import { isQaSubscriptionEnabled } from "@/lib/qa";
import { getCreator } from "@/lib/services/creators";
import { SubscriptionPlans } from "./SubscriptionPlans";

export default async function SubscribePage(props: PageProps<"/subscribe/[creatorId]">) {
  const { creatorId } = await props.params;
  const creator = await getCreator(creatorId);
  if (!creator) notFound();
  // QA 버튼은 서버 설정으로만 켠다 (운영에서는 렌더링 자체가 없다 · API도 404)
  return <SubscriptionPlans creator={creator} qaEnabled={isQaSubscriptionEnabled()} />;
}
