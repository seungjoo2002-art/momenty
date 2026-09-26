import { getCurrentCreator } from "@/lib/services/studio";
import { RecordsView } from "./RecordsView";

export default async function RecordsPage() {
  const creator = await getCurrentCreator();
  return <RecordsView creatorId={creator.id} />;
}
