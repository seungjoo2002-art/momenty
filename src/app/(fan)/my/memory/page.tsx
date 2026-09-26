import { getCreators } from "@/lib/services/creators";
import { getFanMemory } from "@/lib/services/fan";
import { FanMemoryView } from "./FanMemoryView";

export default async function FanMemoryPage() {
  const [memory, creators] = await Promise.all([getFanMemory(), getCreators()]);
  const involved = creators.filter((c) => memory.some((m) => m.creatorId === c.id));
  return <FanMemoryView memory={memory} creators={involved} />;
}
