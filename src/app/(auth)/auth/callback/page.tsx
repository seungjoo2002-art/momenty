"use client";

import Link from "next/link";
import { useRouter } from "next/navigation";
import { useEffect } from "react";
import { useAuth } from "@/components/auth/AuthProvider";
import { readLinkError, useBrowserValue } from "@/lib/hooks/useBrowserValue";
import { nextPathFor } from "@/lib/services/auth";

/**
 * 가입 확인 메일의 링크가 돌아오는 곳.
 * Supabase 클라이언트가 주소의 토큰을 세션으로 바꾸면(AuthProvider) 다음 단계로 보낸다.
 */
export default function AuthCallbackPage() {
  const router = useRouter();
  const { state } = useAuth();
  // 만료 · 이미 사용한 링크는 주소 뒤(#error_description=...)로 알려준다
  const linkError = useBrowserValue(readLinkError);

  useEffect(() => {
    if (state.status === "signedIn") router.replace(nextPathFor(state.account));
  }, [state, router]);

  if (linkError || state.status === "signedOut") {
    return (
      <main className="flex min-h-dvh flex-col items-center justify-center px-8 text-center">
        <p className="text-name font-semibold">링크를 확인하지 못했어요</p>
        <p className="mt-1 text-caption text-muted">링크가 만료됐거나 이미 사용됐어요. 로그인하면 확인 메일을 다시 받을 수 있어요.</p>
        <Link href="/login" className="mt-6 text-sub font-semibold text-brand">
          로그인하기
        </Link>
      </main>
    );
  }
  return (
    <main aria-busy className="flex min-h-dvh items-center justify-center text-caption text-muted">
      가입을 확인하는 중이에요…
    </main>
  );
}
