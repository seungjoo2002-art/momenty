"use client";

import { useStudioCreator } from "@/components/auth/Gates";
import { PersonaSettings } from "./PersonaSettings";

export default function PersonaSettingsPage() {
  return <PersonaSettings creator={useStudioCreator()} />;
}
