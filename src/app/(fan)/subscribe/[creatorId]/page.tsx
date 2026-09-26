import { notFound } from "next/navigation";
import { getCreator } from "@/lib/services/creators";
import { getTier } from "@/lib/services/fan";
import { SubscriptionPlans } from "./SubscriptionPlans";

export default async function SubscribePage(props: PageProps<"/subscribe/[creatorId]">) {
  const { creatorId } = await props.params;
  const creator = await getCreator(creatorId);
  if (!creator) notFound();
  const tier = await getTier(creatorId);

  return <SubscriptionPlans creator={creator} currentTier={tier} />;
}
