/**
 * POST /api/account/delete — 계정 삭제 (본인만). service role을 쓰지 않는다.
 *
 *   1. 같은 origin의 요청만 (CSRF) · 쿠키 세션 → Auth 서버 검증(getUser)
 *   2. 확인 문구("계정 삭제") + 비밀번호 재확인 (임시 클라이언트로 로그인 확인 후 그 세션만 끝낸다)
 *   3. 내 Storage 파일을 Storage API로 지운다 (본인 세션 · Storage 정책: 본인 폴더만)
 *        avatars/{user_id}/…  ·  moment-media/{creator_id}/…
 *      SQL로 storage.objects 행만 지우면 실제 파일이 남는다 → 반드시 Storage API로
 *   4. delete_my_account() — 남은 파일이 있으면 DB가 거부(storage_not_empty). auth.users → 모든 개인 데이터 cascade
 *   5. 쿠키 세션 정리
 * 비밀번호 · 이메일은 로그에 남기지 않는다.
 */
import { createClient, type SupabaseClient } from "@supabase/supabase-js";
import { NextResponse, type NextRequest } from "next/server";
import { DELETE_CONFIRM_PHRASE as CONFIRM_PHRASE } from "@/lib/services/account";
import { supabaseConfig } from "@/lib/supabase/client";
import { createServerSupabase } from "@/lib/supabase/server";

export const dynamic = "force-dynamic";

function sameOrigin(req: NextRequest) {
  const origin = req.headers.get("origin");
  if (!origin) return false;
  try {
    return new URL(origin).host === req.headers.get("host");
  } catch {
    return false;
  }
}

const json = (status: number, body: Record<string, unknown>) => NextResponse.json(body, { status, headers: { "Cache-Control": "no-store" } });

/** 한 폴더의 파일 전부 (페이지로) */
async function listAll(sb: SupabaseClient, bucket: string, folder: string): Promise<string[]> {
  const out: string[] = [];
  for (let offset = 0; ; offset += 100) {
    const { data, error } = await sb.storage.from(bucket).list(folder, { limit: 100, offset });
    if (error) throw error;
    const files = (data ?? []).filter((f) => f.id); // 폴더 항목 제외
    out.push(...files.map((f) => `${folder}/${f.name}`));
    if ((data ?? []).length < 100) return out;
  }
}

async function removeAll(sb: SupabaseClient, bucket: string, paths: string[]) {
  for (let i = 0; i < paths.length; i += 100) {
    const { error } = await sb.storage.from(bucket).remove(paths.slice(i, i + 100));
    if (error) throw error;
  }
}

export async function POST(req: NextRequest) {
  if (!sameOrigin(req)) return json(403, { ok: false, error: { code: "forbidden_origin" } });
  const sb = await createServerSupabase();
  const { data: auth, error: authError } = await sb.auth.getUser();
  const user = authError ? null : auth.user;
  if (!user?.email) return json(401, { ok: false, error: { code: "unauthenticated", message: "로그인이 필요해요." } });

  let body: { confirm?: unknown; password?: unknown };
  try {
    body = await req.json();
  } catch {
    return json(400, { ok: false, error: { code: "invalid_input" } });
  }
  if (body.confirm !== CONFIRM_PHRASE || typeof body.password !== "string" || !body.password) {
    return json(400, { ok: false, error: { code: "invalid_input", message: `확인 문구 "${CONFIRM_PHRASE}"와 비밀번호를 입력해 주세요.` } });
  }

  // 비밀번호 재확인 — 저장하지 않는 임시 클라이언트. 확인 뒤 그 세션만(local) 끝낸다 (다른 기기 세션은 건드리지 않음)
  const { url, key } = supabaseConfig();
  const check = createClient(url, key, { auth: { persistSession: false, autoRefreshToken: false } });
  const { error: pwError } = await check.auth.signInWithPassword({ email: user.email, password: body.password });
  if (pwError) return json(403, { ok: false, error: { code: "wrong_password", message: "비밀번호가 맞지 않아요." } });
  await check.auth.signOut({ scope: "local" }).catch(() => {});

  try {
    const { data: creator } = await sb.from("creators").select("id").eq("profile_id", user.id).maybeSingle();
    await removeAll(sb, "avatars", await listAll(sb, "avatars", user.id));
    if (creator?.id) await removeAll(sb, "moment-media", await listAll(sb, "moment-media", creator.id as string));
    const { error } = await sb.rpc("delete_my_account");
    if (error) {
      console.error("[momenty/account] delete failed", error.code ?? "unknown");
      return json(500, { ok: false, error: { code: /storage_not_empty/.test(error.message) ? "storage_not_empty" : "error", message: "지금은 삭제하지 못했어요. 잠시 후 다시 시도해 주세요." } });
    }
  } catch (e) {
    console.error("[momenty/account] delete failed", e instanceof Error ? e.name : "unknown");
    return json(500, { ok: false, error: { code: "error", message: "지금은 삭제하지 못했어요. 잠시 후 다시 시도해 주세요." } });
  }
  // 이미 없는 사용자라 서버 로그아웃은 실패할 수 있다 — 쿠키만 정리되면 된다
  await sb.auth.signOut({ scope: "local" }).catch(() => {});
  return json(200, { ok: true });
}
