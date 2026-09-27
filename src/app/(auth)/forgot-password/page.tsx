"use client";

import { Loader2, MailCheck } from "lucide-react";
import { useState } from "react";
import { Button, ButtonLink } from "@/components/ui/Button";
import { Field } from "@/components/ui/Field";
import { TopBar } from "@/components/ui/TopBar";
import { requestPasswordReset } from "@/lib/services/auth";

export default function ForgotPasswordPage() {
  const [email, setEmail] = useState("");
  const [pending, setPending] = useState(false);
  const [error, setError] = useState<string | null>(null);
  const [sent, setSent] = useState(false);

  async function submit(e: React.FormEvent) {
    e.preventDefault();
    setPending(true);
    setError(null);
    try {
      await requestPasswordReset(email);
      setSent(true);
    } catch (err) {
      setError(err instanceof Error ? err.message : "메일을 보내지 못했어요.");
    } finally {
      setPending(false);
    }
  }

  return (
    <main className="flex min-h-dvh flex-col">
      <TopBar backHref="/login" />
      {sent ? (
        <div className="flex flex-1 flex-col px-6 pb-8">
          <div className="flex flex-1 flex-col items-center justify-center text-center">
            <span className="grid size-12 place-items-center rounded-full bg-brand-tint text-brand">
              <MailCheck className="size-6" />
            </span>
            <h1 className="mt-4 text-section font-semibold">메일을 확인해 주세요</h1>
            <p className="mt-1.5 text-sub text-muted">
              가입된 이메일이라면 비밀번호를 다시 정하는 링크가 도착해요.
            </p>
          </div>
          <ButtonLink href="/login" size="lg" block>
            로그인으로 돌아가기
          </ButtonLink>
        </div>
      ) : (
        <form onSubmit={submit} noValidate className="flex flex-1 flex-col px-6 pb-8">
          <h1 className="mt-4 text-title leading-snug font-bold">비밀번호 재설정</h1>
          <p className="mt-1.5 text-body text-muted">가입한 이메일로 새 비밀번호를 정하는 링크를 보내드려요.</p>
          <Field className="mt-8" label="이메일" type="email" autoComplete="email" inputMode="email" placeholder="you@momenty.app" value={email} onChange={(e) => setEmail(e.target.value)} />
          {error && <p role="alert" className="mt-3 text-caption text-danger">{error}</p>}
          <div className="mt-auto pt-8">
            <Button type="submit" size="lg" block disabled={pending || !email}>
              {pending && <Loader2 className="size-5 animate-spin" />}
              재설정 링크 받기
            </Button>
          </div>
        </form>
      )}
    </main>
  );
}
