import { notFound } from "next/navigation";
import { getCreator } from "@/lib/services/creators";
import { SubscriptionPlans } from "./SubscriptionPlans";

export default async function SubscribePage(props: PageProps<"/subscribe/[creatorId]">) {
  const { creatorId } = await props.params;
  const creator = await getCreator(creatorId);
  if (!creator) notFound();
  return <SubscriptionPlans creator={creator} />;
}
