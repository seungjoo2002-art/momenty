/**
 * Supabase 연결 — services/* 에서만 import한다. UI 컴포넌트는 Supabase를 직접 호출하지 않는다.
 *
 * 세션
 *   브라우저에는 로그인한 사용자 한 명의 세션만 있다 (Supabase Auth · localStorage에 보관, 자동 갱신).
 *   한 계정이 팬이면서 크리에이터일 수 있다 — "크리에이터인지"는 역할 플래그가 아니라
 *   creators 행(profile_id = auth.uid())이 있는지로 판단한다.
 *
 *   서버 렌더링에는 세션이 없다 → 세션 없는 공개 클라이언트(anon)로 공개 데이터만 읽는다.
 *   권한 판단은 전부 DB(RLS · Storage 정책)가 한다. 화면의 판단은 표시용일 뿐이다.
 */
import { createClient, type SupabaseClient } from "@supabase/supabase-js";

const url = process.env.NEXT_PUBLIC_SUPABASE_URL;
const key = process.env.NEXT_PUBLIC_SUPABASE_PUBLISHABLE_KEY || process.env.NEXT_PUBLIC_SUPABASE_ANON_KEY;

const isBrowser = typeof window !== "undefined";
const AUTH_STORAGE_KEY = "momenty-auth";

let browserClient: SupabaseClient | null = null;
let publicClient: SupabaseClient | null = null;

function config() {
  if (!url || !key) {
    throw new Error("Supabase 환경 변수(NEXT_PUBLIC_SUPABASE_URL · NEXT_PUBLIC_SUPABASE_PUBLISHABLE_KEY)가 설정되지 않았어요. .env.example을 참고하세요.");
  }
  return { url, key };
}

/**
 * 지금 환경에 맞는 클라이언트.
 * 브라우저: 로그인 세션을 가진 클라이언트 (RLS가 로그인 사용자 기준으로 적용된다)
 * 서버: 세션 없는 공개 클라이언트
 */
export function supabase(): SupabaseClient {
  const { url, key } = config();
  if (!isBrowser) {
    publicClient ??= createClient(url, key, { auth: { persistSession: false, autoRefreshToken: false } });
    return publicClient;
  }
  browserClient ??= createClient(url, key, {
    auth: {
      storageKey: AUTH_STORAGE_KEY,
      persistSession: true,
      autoRefreshToken: true,
      // 가입 확인 · 비밀번호 재설정 메일의 링크(#access_token=...)를 자동으로 세션으로 바꾼다
      detectSessionInUrl: true,
    },
  });
  return browserClient;
}

/** 로그인한 사용자 id (없으면 null). 서버 렌더링에서는 항상 null. */
export async function currentUserId(): Promise<string | null> {
  if (!isBrowser) return null;
  const { data } = await supabase().auth.getSession();
  return data.session?.user.id ?? null;
}
