"use client";

import { usePathname, useRouter } from "next/navigation";
import { createContext, useContext, useEffect, useRef } from "react";
import { LoadError } from "@/components/ui/LoadState";
import type { Creator } from "@/lib/types";
import { useAuth } from "./AuthProvider";
import { NotCreator } from "./NotCreator";

export { safeNext } from "@/lib/utils/safeNext";

export function loginHref(next: string) {
  return `/login?next=${encodeURIComponent(next)}`;
}

function Blank() {
  return <main aria-busy className="min-h-dvh" />;
}

/**
 * 로그인한 사용자만. 로그아웃 상태로 주소를 직접 입력하면 로그인 화면으로 보낸다.
 * (화면 가드일 뿐이다 — 데이터는 DB의 RLS가 로그인 사용자 기준으로 막는다)
 */
export function RequireAuth({ children }: { children: React.ReactNode }) {
  const { state, refresh } = useAuth();
  const router = useRouter();
  const pathname = usePathname();
  const wasSignedIn = useRef(false);

  useEffect(() => {
    if (state.status === "signedIn") wasSignedIn.current = true;
    // 주소를 직접 입력해 들어온 경우만 돌아올 곳(next)을 기억한다. 방금 로그아웃했다면 그냥 로그인 화면으로.
    if (state.status === "signedOut") router.replace(wasSignedIn.current ? "/login" : loginHref(pathname));
  }, [state.status, router, pathname]);

  if (state.status === "error") return <LoadError message={state.message} onRetry={() => void refresh()} className="min-h-dvh justify-center" />;
  if (state.status !== "signedIn") return <Blank />;
  return <>{children}</>;
}

/** 팬 영역 중 로그인이 필요한 화면 — 나머지(Discover · 크리에이터 · Moment 상세)는 누구나 */
const FAN_PRIVATE = /^\/(today|my|chat|archive|subscribe)(\/|$)/;

export function FanGate({ children }: { children: React.ReactNode }) {
  const pathname = usePathname();
  return FAN_PRIVATE.test(pathname) ? <RequireAuth>{children}</RequireAuth> : <>{children}</>;
}

const StudioContext = createContext<Creator | null>(null);

/** Studio 안에서 로그인한 크리에이터 본인 프로필 */
export function useStudioCreator(): Creator {
  const creator = useContext(StudioContext);
  if (!creator) throw new Error("CreatorGate 안에서만 쓸 수 있어요.");
  return creator;
}

/**
 * /studio/* — 크리에이터 프로필이 있는 사용자만.
 * 팬 계정이 주소를 직접 입력하면 Studio 화면 대신 안내만 보인다 (Studio 데이터는 불러오지도 않는다).
 */
export function CreatorGate({ children }: { children: React.ReactNode }) {
  return (
    <RequireAuth>
      <CreatorOnly>{children}</CreatorOnly>
    </RequireAuth>
  );
}

function CreatorOnly({ children }: { children: React.ReactNode }) {
  const { state } = useAuth();
  const creator = state.status === "signedIn" ? state.account.creator : null;
  if (!creator) return <NotCreator />;
  return <StudioContext.Provider value={creator}>{children}</StudioContext.Provider>;
}
