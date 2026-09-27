/**
 * proxy(구 middleware)에서 쓰는 세션 갱신 + 서버 라우트 보호.
 *
 * · 모든 페이지 요청에서 만료가 가까운 세션 쿠키를 갱신한다 (@supabase/ssr 권장 방식).
 * · 로그인이 필요한 경로에 세션 없이 들어오면 서버에서 바로 /login?next= 로 보낸다 → 비공개 화면의 HTML이 나가지 않는다.
 * · /studio의 "크리에이터인지" 확인은 studio/layout.tsx(서버)가 한다 (DB 조회가 필요한 판단은 proxy에 두지 않는다).
 * · API(/api/*)는 리다이렉트하지 않는다 — Route Handler가 직접 401을 돌려준다.
 */
import { createServerClient } from "@supabase/ssr";
import { NextResponse, type NextRequest } from "next/server";
import { supabaseConfig } from "./client";

/** 로그인해야 볼 수 있는 경로 (클라이언트 Gate와 같은 목록 — 여기가 서버 쪽 보호) */
export const PRIVATE_PATHS = /^\/(today|my|archive|chat|subscribe|studio|setup)(\/|$)/;

export async function updateSession(request: NextRequest): Promise<NextResponse> {
  const { url, key } = supabaseConfig();
  let response = NextResponse.next({ request });

  const sb = createServerClient(url, key, {
    cookies: {
      getAll: () => request.cookies.getAll(),
      setAll: (list, headers) => {
        for (const { name, value } of list) request.cookies.set(name, value);
        response = NextResponse.next({ request });
        for (const { name, value, options } of list) response.cookies.set(name, value, options);
        // 인증 쿠키가 담긴 응답은 캐시되지 않게 (라이브러리가 알려 주는 헤더)
        for (const [h, v] of Object.entries(headers ?? {})) response.headers.set(h, v);
      },
    },
  });

  // 서명을 검증한 claims (쿠키 값을 그대로 믿지 않는다). 이 호출이 필요하면 세션도 갱신한다.
  const { data } = await sb.auth.getClaims();
  const signedIn = !!data?.claims?.sub;

  const { pathname, search } = request.nextUrl;
  if (!signedIn && PRIVATE_PATHS.test(pathname)) {
    const login = request.nextUrl.clone();
    login.pathname = "/login";
    login.search = `?next=${encodeURIComponent(pathname + search)}`;
    const redirect = NextResponse.redirect(login);
    for (const c of response.cookies.getAll()) redirect.cookies.set(c);
    return redirect;
  }
  return response;
}
