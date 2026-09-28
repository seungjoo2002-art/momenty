import { notFound, redirect } from "next/navigation";
import { AppFrame } from "@/components/layout/AppFrame";
import { createServerSupabase } from "@/lib/supabase/server";

export const dynamic = "force-dynamic";

/**
 * /admin/* — 서버에서 확인한다 (클라이언트 판단 · 이메일 비교 없음).
 *   로그인 세션(쿠키) → Auth 서버 검증(getUser) → DB is_admin() (private.admin_users · SQL Editor로만 추가).
 *   admin이 아니면 이 영역이 있다는 것도 알리지 않도록 404.
 * 데이터 함수(admin_list_reports · admin_update_report)도 DB에서 다시 확인한다 — 이 화면을 우회해도 막힌다.
 */
export default async function AdminLayout({ children }: { children: React.ReactNode }) {
  const sb = await createServerSupabase();
  const { data, error } = await sb.auth.getUser();
  if (error || !data.user) redirect("/login?next=%2Fadmin%2Freports");
  const { data: isAdmin } = await sb.rpc("is_admin");
  if (isAdmin !== true) notFound();
  return <AppFrame>{children}</AppFrame>;
}
