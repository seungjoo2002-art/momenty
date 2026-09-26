import { getCurrentCreator } from "@/lib/services/studio";
import { MomentPreview } from "./MomentPreview";

export default async function MomentPreviewPage() {
  const creator = await getCurrentCreator();
  return <MomentPreview creator={creator} />;
}
