import { notFound } from "next/navigation";
import { getCurrentCreator, getStudioFan } from "@/lib/services/studio";
import { FanManager } from "./FanManager";

export default async function FanManagerPage(props: PageProps<"/studio/fans/[fanId]">) {
  const { fanId } = await props.params;
  const [fan, creator] = await Promise.all([getStudioFan(fanId), getCurrentCreator()]);
  if (!fan) notFound();
  return <FanManager fan={fan} creator={creator} />;
}
