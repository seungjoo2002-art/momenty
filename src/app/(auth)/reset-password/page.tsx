"use client";

import { Loader2 } from "lucide-react";
import Link from "next/link";
import { useRouter } from "next/navigation";
import { useState } from "react";
import { useAuth } from "@/components/auth/AuthProvider";
import { Button } from "@/components/ui/Button";
import { Field } from "@/components/ui/Field";
import { readLinkError, useBrowserValue } from "@/lib/hooks/useBrowserValue";
import { nextPathFor, PASSWORD_MIN, updatePassword } from "@/lib/services/auth";

/** 재설정 메일의 링크로 들어온 화면 — 링크가 임시 로그인 세션을 만들어 준다 */
export default function ResetPasswordPage() {
  const router = useRouter();
  const { state, refresh } = useAuth();
  const [password, setPassword] = useState("");
  const [confirm, setConfirm] = useState("");
  const [pending, setPending] = useState(false);
  const [error, setError] = useState<string | null>(null);
  const linkError = useBrowserValue(readLinkError);

  async function submit(e: React.FormEvent) {
    e.preventDefault();
    if (password !== confirm) {
      setError("두 비밀번호가 같지 않아요.");
      return;
    }
    setPending(true);
    setError(null);
    try {
      await updatePassword(password);
      const account = await refresh();
      router.replace(account ? nextPathFor(account) : "/login");
    } catch (err) {
      setError(err instanceof Error ? err.message : "비밀번호를 바꾸지 못했어요.");
      setPending(false);
    }
  }

  if (state.status === "loading") return <main aria-busy className="min-h-dvh" />;
  if (linkError || state.status !== "signedIn") {
    return (
      <main className="flex min-h-dvh flex-col items-center justify-center px-8 text-center">
        <p className="text-name font-semibold">재설정 링크가 유효하지 않아요</p>
        <p className="mt-1 text-caption text-muted">링크가 만료됐거나 이미 사용됐어요. 다시 요청해 주세요.</p>
        <Link href="/forgot-password" className="mt-6 text-sub font-semibold text-brand">
          재설정 링크 다시 받기
        </Link>
      </main>
    );
  }

  return (
    <main className="flex min-h-dvh flex-col">
      <form onSubmit={submit} noValidate className="flex flex-1 flex-col px-6 pt-12 pb-8">
        <h1 className="text-title leading-snug font-bold">새 비밀번호</h1>
        <p className="mt-1.5 text-body text-muted">{state.account.email}</p>
        <div className="mt-8 space-y-4">
          <Field label="새 비밀번호" type="password" autoComplete="new-password" placeholder={`${PASSWORD_MIN}자 이상, 영문 + 숫자`} value={password} onChange={(e) => setPassword(e.target.value)} />
          <Field label="새 비밀번호 확인" type="password" autoComplete="new-password" value={confirm} onChange={(e) => setConfirm(e.target.value)} />
        </div>
        {error && <p role="alert" className="mt-3 text-caption text-danger">{error}</p>}
        <div className="mt-auto pt-8">
          <Button type="submit" size="lg" block disabled={pending || !password || !confirm}>
            {pending && <Loader2 className="size-5 animate-spin" />}
            비밀번호 바꾸기
          </Button>
        </div>
      </form>
    </main>
  );
}
