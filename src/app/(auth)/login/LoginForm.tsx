"use client";

import { Loader2 } from "lucide-react";
import Link from "next/link";
import { useRouter } from "next/navigation";
import { useEffect, useState } from "react";
import { useAuth } from "@/components/auth/AuthProvider";
import { safeNext } from "@/components/auth/Gates";
import { Button } from "@/components/ui/Button";
import { Field } from "@/components/ui/Field";
import { TopBar } from "@/components/ui/TopBar";
import { nextPathFor, resendConfirmation, signIn } from "@/lib/services/auth";
import { ServiceError } from "@/lib/services/errors";

export function LoginForm({ next }: { next?: string }) {
  const router = useRouter();
  const { state, refresh } = useAuth();
  const [email, setEmail] = useState("");
  const [password, setPassword] = useState("");
  const [pending, setPending] = useState(false);
  const [error, setError] = useState<string | null>(null);
  const [unconfirmed, setUnconfirmed] = useState(false);
  const [notice, setNotice] = useState<string | null>(null);

  // 이미 로그인한 상태로 들어오면 바로 이어서
  useEffect(() => {
    if (state.status === "signedIn" && !pending) router.replace(safeNext(next) || nextPathFor(state.account));
  }, [state, next, router, pending]);

  async function submit(e: React.FormEvent) {
    e.preventDefault();
    setPending(true);
    setError(null);
    setNotice(null);
    setUnconfirmed(false);
    try {
      await signIn(email, password);
      const account = await refresh();
      router.replace(safeNext(next) || (account ? nextPathFor(account) : "/today"));
    } catch (err) {
      setError(err instanceof Error ? err.message : "로그인하지 못했어요.");
      setUnconfirmed(err instanceof ServiceError && /확인 링크/.test(err.message));
      setPending(false);
    }
  }

  async function resend() {
    setNotice(null);
    try {
      await resendConfirmation(email);
      setNotice("확인 메일을 다시 보냈어요. 메일함을 확인해 주세요.");
    } catch (err) {
      setError(err instanceof Error ? err.message : "메일을 보내지 못했어요.");
    }
  }

  return (
    <main className="flex min-h-dvh flex-col">
      <TopBar backHref="/onboarding" />
      <form onSubmit={submit} noValidate className="flex flex-1 flex-col px-6 pb-8">
        <h1 className="mt-4 text-title leading-snug font-bold">
          다시 만나서 반가워요.
          <br />
          <span className="text-muted">오늘도 함께하는 하루.</span>
        </h1>

        <div className="mt-10 space-y-4">
          <Field label="이메일" type="email" name="email" autoComplete="email" inputMode="email" placeholder="you@momenty.app" value={email} onChange={(e) => setEmail(e.target.value)} required />
          <Field label="비밀번호" type="password" name="password" autoComplete="current-password" placeholder="••••••••" value={password} onChange={(e) => setPassword(e.target.value)} required />
        </div>

        <div className="mt-2 flex justify-end">
          <Link href="/forgot-password" className="py-2 text-caption text-muted hover:text-ink">
            비밀번호를 잊었어요
          </Link>
        </div>

        {error && (
          <p role="alert" className="mt-2 text-caption text-danger">
            {error}
            {unconfirmed && (
              <button type="button" onClick={resend} className="ml-1.5 font-semibold text-ink underline underline-offset-2">
                확인 메일 다시 받기
              </button>
            )}
          </p>
        )}
        {notice && <p role="status" className="mt-2 text-caption text-safe">{notice}</p>}

        <div className="mt-6">
          <Button type="submit" size="lg" block disabled={pending || !email || !password}>
            {pending && <Loader2 className="size-5 animate-spin" />}
            로그인
          </Button>
        </div>

        <div className="mt-auto pt-8 text-center text-caption text-muted">
          처음이신가요?{" "}
          <Link href="/signup" className="font-semibold text-ink">
            회원가입
          </Link>
        </div>
      </form>
    </main>
  );
}
