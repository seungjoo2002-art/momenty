"use client";

import { createContext, useCallback, useContext, useEffect, useMemo, useRef, useState } from "react";
import { getAccount, onAuthChange, type Account } from "@/lib/services/auth";
import { clearSignedUrls, notifyMomentsChanged } from "@/lib/services/moments";
import { invalidateCreators } from "@/lib/services/creators";

export type AuthState =
  | { status: "loading" }
  | { status: "signedOut" }
  | { status: "signedIn"; account: Account }
  | { status: "error"; message: string };

interface AuthContextValue {
  state: AuthState;
  /** 계정 정보를 다시 읽는다 (크리에이터 프로필 생성 · 수정 후) */
  refresh: () => Promise<Account | null>;
}

const AuthContext = createContext<AuthContextValue | null>(null);

/**
 * 로그인 상태 — 새로고침하면 Supabase가 저장해 둔 세션을 복원하고, 다른 탭의 로그인 · 로그아웃도 따라간다.
 * 권한 판단은 DB(RLS)가 한다. 여기서는 어떤 화면을 보여줄지만 정한다.
 */
export function AuthProvider({ children }: { children: React.ReactNode }) {
  const [state, setState] = useState<AuthState>({ status: "loading" });
  const lastUser = useRef<string | null | undefined>(undefined);

  const load = useCallback(async () => {
    try {
      const account = await getAccount();
      const uid = account?.userId ?? null;
      if (lastUser.current !== undefined && lastUser.current !== uid) {
        // 다른 사용자가 되면: 이전 권한으로 받은 파일 URL · 목록 캐시를 버리고 화면을 다시 불러온다
        clearSignedUrls();
        invalidateCreators();
        notifyMomentsChanged();
      }
      lastUser.current = uid;
      setState(account ? { status: "signedIn", account } : { status: "signedOut" });
      return account;
    } catch (e) {
      setState({ status: "error", message: e instanceof Error ? e.message : "계정 정보를 불러오지 못했어요." });
      return null;
    }
  }, []);

  useEffect(() => {
    // 첫 로드는 onAuthStateChange의 INITIAL_SESSION이 알려준다 (세션 복원 · 메일 링크 처리 이후)
    const off = onAuthChange((event) => {
      if (event === "TOKEN_REFRESHED") return;
      // Supabase 콜백 안에서 다른 Supabase 호출을 기다리지 않도록 다음 틱에 실행
      setTimeout(() => void load(), 0);
    });
    return off;
  }, [load]);

  const value = useMemo(() => ({ state, refresh: load }), [state, load]);
  return <AuthContext.Provider value={value}>{children}</AuthContext.Provider>;
}

export function useAuth(): AuthContextValue {
  const ctx = useContext(AuthContext);
  if (!ctx) throw new Error("AuthProvider 안에서만 쓸 수 있어요.");
  return ctx;
}

/** 로그인한 계정 (로그인 전 · 불러오는 중이면 null) */
export function useAccount(): Account | null {
  const { state } = useAuth();
  return state.status === "signedIn" ? state.account : null;
}
