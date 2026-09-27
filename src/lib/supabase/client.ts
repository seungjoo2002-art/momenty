/**
 * Supabase 연결 (브라우저 · 공용) — services/* 에서만 import한다. UI 컴포넌트는 Supabase를 직접 호출하지 않는다.
 *
 * 클라이언트 역할 구분
 *   이 파일   supabase()               브라우저: 로그인 세션(쿠키)을 가진 클라이언트 — @supabase/ssr createBrowserClient
 *                                      서버(공용 services): 세션 없는 공개 클라이언트(anon) — 공개 데이터만
 *   server.ts createServerSupabase()   서버 전용: 요청의 쿠키 세션으로 동작 (Route Handler · Server Component)
 *   proxy.ts  updateSession()          모든 요청에서 세션 쿠키 갱신 + 보호 경로 로그인 확인
 *
 * 세션은 쿠키에 있다 → 서버도 로그인 사용자를 알 수 있다 (서버 라우트 보호 · AI Route Handler).
 * service role key는 어디에서도 쓰지 않는다 — 권한 판단은 전부 로그인 사용자의 JWT + RLS.
 * 크리에이터 여부는 역할 플래그가 아니라 creators 행(profile_id = auth.uid())으로 판단한다.
 */
import { createBrowserClient } from "@supabase/ssr";
import { createClient, type SupabaseClient } from "@supabase/supabase-js";

const url = process.env.NEXT_PUBLIC_SUPABASE_URL;
const key = process.env.NEXT_PUBLIC_SUPABASE_PUBLISHABLE_KEY || process.env.NEXT_PUBLIC_SUPABASE_ANON_KEY;

const isBrowser = typeof window !== "undefined";

let browserClient: SupabaseClient | null = null;
let publicClient: SupabaseClient | null = null;

export function supabaseConfig() {
  if (!url || !key) {
    throw new Error("Supabase 환경 변수(NEXT_PUBLIC_SUPABASE_URL · NEXT_PUBLIC_SUPABASE_PUBLISHABLE_KEY)가 설정되지 않았어요. .env.example을 참고하세요.");
  }
  return { url, key };
}

/**
 * 지금 환경에 맞는 클라이언트.
 * 브라우저: 쿠키 세션 클라이언트 (RLS가 로그인 사용자 기준으로 적용된다)
 * 서버: 세션 없는 공개 클라이언트 — 로그인 사용자 기준 서버 작업은 server.ts의 createServerSupabase()
 */
export function supabase(): SupabaseClient {
  const { url, key } = supabaseConfig();
  if (!isBrowser) {
    publicClient ??= createClient(url, key, { auth: { persistSession: false, autoRefreshToken: false } });
    return publicClient;
  }
  if (!browserClient) {
    browserClient =
      typeof document === "undefined"
        ? // DOM이 없는 환경(Node 통합 테스트가 앱 services를 그대로 부를 때): 쿠키 대신 메모리 세션
          createClient(url, key, { auth: { persistSession: true, autoRefreshToken: false, detectSessionInUrl: false } })
        : // 가입 확인 · 비밀번호 재설정 메일의 링크(?code=…)를 자동으로 세션으로 바꾼다 (PKCE)
          createBrowserClient(url, key);
  }
  return browserClient;
}

/** 로그인한 사용자 id (없으면 null). 서버의 공용 services에서는 항상 null. */
export async function currentUserId(): Promise<string | null> {
  if (!isBrowser) return null;
  const { data } = await supabase().auth.getSession();
  return data.session?.user.id ?? null;
}
