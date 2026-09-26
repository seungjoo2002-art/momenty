/**
 * Supabase 연결 — services/* 에서만 import한다. UI 컴포넌트는 Supabase를 직접 호출하지 않는다.
 *
 * 환경 변수(.env.local)가 없으면 isSupabaseConfigured = false 이고,
 * 서비스는 localStorage 구현(개발용 fallback)으로 동작한다.
 *
 * 세션 (데모 단계)
 *   MOMENTY는 한 브라우저에서 팬 모드와 크리에이터 모드(/studio)를 오간다.
 *   그래서 역할마다 별도 세션(storageKey)을 둔다:
 *     fan     — Today · Detail · 반응
 *     creator — Studio에서 Moment 생성 · 수정 · 삭제
 *   로그인 화면을 Supabase Auth에 연결하기 전까지는 NEXT_PUBLIC_DEMO_* 계정으로 자동 로그인한다.
 *   ⚠ 데모 전용: 이 값은 브라우저 번들에 포함된다. 실제 서비스에서는 비워 두고 로그인 화면을 연결한다.
 */
import { createClient, type SupabaseClient } from "@supabase/supabase-js";

const url = process.env.NEXT_PUBLIC_SUPABASE_URL;
const key = process.env.NEXT_PUBLIC_SUPABASE_PUBLISHABLE_KEY || process.env.NEXT_PUBLIC_SUPABASE_ANON_KEY;

export const isSupabaseConfigured = Boolean(url && key);

export type Role = "fan" | "creator";

const DEMO_ACCOUNTS: Record<Role, { email?: string; password?: string }> = {
  fan: { email: process.env.NEXT_PUBLIC_DEMO_FAN_EMAIL, password: process.env.NEXT_PUBLIC_DEMO_FAN_PASSWORD },
  creator: { email: process.env.NEXT_PUBLIC_DEMO_CREATOR_EMAIL, password: process.env.NEXT_PUBLIC_DEMO_CREATOR_PASSWORD },
};

const isBrowser = typeof window !== "undefined";
const clients = new Map<string, SupabaseClient>();

function client(name: string, withSession: boolean): SupabaseClient {
  if (!url || !key) throw new Error("Supabase 환경 변수가 설정되지 않았어요 (.env.example 참고)");
  let c = clients.get(name);
  if (!c) {
    c = createClient(url, key, {
      auth: withSession
        ? { storageKey: `momenty-auth-${name}`, persistSession: true, autoRefreshToken: true }
        : { persistSession: false, autoRefreshToken: false },
    });
    clients.set(name, c);
  }
  return c;
}

/** 지금 화면의 모드. 서버 렌더링에서는 로그인 세션이 없다 (공개 데이터만). */
export function activeRole(): Role | null {
  if (!isBrowser) return null;
  return window.location.pathname.startsWith("/studio") ? "creator" : "fan";
}

const sessions = new Map<Role, Promise<string | null>>();

/** 역할의 로그인 사용자 id. 세션이 없으면 데모 계정으로 로그인을 시도한다. */
export function sessionUserId(role: Role): Promise<string | null> {
  if (!isBrowser) return Promise.resolve(null);
  let p = sessions.get(role);
  if (!p) {
    p = (async () => {
      const sb = client(role, true);
      const { data } = await sb.auth.getSession();
      if (data.session) return data.session.user.id;
      const { email, password } = DEMO_ACCOUNTS[role];
      if (!email || !password) return null;
      const { data: signed, error } = await sb.auth.signInWithPassword({ email, password });
      if (error) throw error;
      return signed.user.id;
    })();
    // 실패(네트워크 등)하면 다음 호출에서 다시 시도
    p.catch(() => sessions.delete(role));
    sessions.set(role, p);
  }
  return p;
}

/**
 * 역할에 맞는 클라이언트. 로그인이 끝난 뒤 돌려주므로 쿼리에 RLS가 사용자 기준으로 적용된다.
 * role이 null이면(서버) 세션 없는 공개 클라이언트.
 */
export async function supabaseFor(role: Role | null): Promise<SupabaseClient> {
  if (!role || !isBrowser) return client("public", false);
  await sessionUserId(role);
  return client(role, true);
}
