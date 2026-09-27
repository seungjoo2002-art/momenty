/**
 * 서버 전용 Supabase — Route Handler · Server Component(layout)에서만.
 * 요청의 쿠키 세션으로 동작하므로 쿼리는 그 사용자의 JWT로 나가고 RLS가 그대로 적용된다.
 *
 * service role key는 여기서도 쓰지 않는다. 일반 사용자 요청은 언제나 사용자 권한으로만.
 */
import "server-only";
import { createServerClient } from "@supabase/ssr";
import type { SupabaseClient, User } from "@supabase/supabase-js";
import { cookies } from "next/headers";
import { supabaseConfig } from "./client";

/** 요청마다 새로 만든다 (사용자 간 세션이 섞이지 않도록) */
export async function createServerSupabase(): Promise<SupabaseClient> {
  const { url, key } = supabaseConfig();
  const store = await cookies();
  return createServerClient(url, key, {
    cookies: {
      getAll: () => store.getAll(),
      setAll: (list) => {
        try {
          for (const { name, value, options } of list) store.set(name, value, options);
        } catch {
          // Server Component 렌더링 중에는 쿠키를 쓸 수 없다 — 갱신은 proxy가 맡는다
        }
      },
    },
  });
}

export interface ServerAuth {
  sb: SupabaseClient;
  user: User | null;
  /** 로그인 사용자의 크리에이터 id (없으면 null) — RLS를 거친 조회 */
  creatorId: string | null;
}

/**
 * 로그인 사용자 확인. getUser()는 Auth 서버에 토큰을 검증받는다 (쿠키 값을 그대로 믿지 않는다).
 * withCreator: 크리에이터 행까지 확인 (Studio)
 */
export async function getServerAuth({ withCreator = false } = {}): Promise<ServerAuth> {
  const sb = await createServerSupabase();
  const { data, error } = await sb.auth.getUser();
  const user = error ? null : data.user;
  if (!user || !withCreator) return { sb, user, creatorId: null };
  const { data: creator } = await sb.from("creators").select("id").eq("profile_id", user.id).maybeSingle();
  return { sb, user, creatorId: (creator?.id as string | undefined) ?? null };
}
