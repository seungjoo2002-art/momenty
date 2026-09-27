"use client";

import { useStudioCreator } from "@/components/auth/Gates";
import { RecordsView } from "./RecordsView";

export default function RecordsPage() {
  const creator = useStudioCreator();
  return <RecordsView creatorId={creator.id} />;
}
