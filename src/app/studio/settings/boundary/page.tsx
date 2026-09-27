import { redirect } from "next/navigation";

/** Boundary 설정은 Creator AI 설정 화면 안으로 옮겼다 */
export default function BoundarySettingsPage() {
  redirect("/studio/settings/persona#boundaries");
}
