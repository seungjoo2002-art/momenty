import { RequireAuth } from "@/components/auth/Gates";

/** 가입 직후 단계 — 로그인한 사용자만 */
export default function SetupLayout({ children }: { children: React.ReactNode }) {
  return <RequireAuth>{children}</RequireAuth>;
}
