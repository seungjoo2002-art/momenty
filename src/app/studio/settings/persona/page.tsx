import { getCurrentCreator } from "@/lib/services/studio";
import { PersonaSettings } from "./PersonaSettings";

export default async function PersonaSettingsPage() {
  const creator = await getCurrentCreator();
  return <PersonaSettings creator={creator} />;
}
