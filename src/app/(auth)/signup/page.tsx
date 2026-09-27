"use client";

import { Check, Heart, Loader2, MailCheck, Sparkle } from "lucide-react";
import Link from "next/link";
import { useRouter } from "next/navigation";
import { useEffect, useState } from "react";
import { useAuth } from "@/components/auth/AuthProvider";
import { Button, ButtonLink } from "@/components/ui/Button";
import { Field } from "@/components/ui/Field";
import { TopBar } from "@/components/ui/TopBar";
import { nextPathFor, PASSWORD_MIN, resendConfirmation, signUp, type StartRole } from "@/lib/services/auth";
import { cn } from "@/lib/utils/cn";

const ROLES = [
  { key: "fan", icon: Heart, title: "팬으로 시작", body: "좋아하는 크리에이터의 하루를 구독하고 따라가요." },
  { key: "creator", icon: Sparkle, title: "크리에이터로 시작", body: "나의 순간을 기록하고, 팬과 하루를 나눠요." },
] as const;

export default function SignupPage() {
  const router = useRouter();
  const { state, refresh } = useAuth();
  const [role, setRole] = useState<StartRole>("fan");
  const [nickname, setNickname] = useState("");
  const [email, setEmail] = useState("");
  const [password, setPassword] = useState("");
  const [pending, setPending] = useState(false);
  const [error, setError] = useState<string | null>(null);
  const [sentTo, setSentTo] = useState<string | null>(null);
  const [notice, setNotice] = useState<string | null>(null);

  useEffect(() => {
    if (state.status === "signedIn" && !pending && !sentTo) router.replace(nextPathFor(state.account));
  }, [state, router, pending, sentTo]);

  async function submit(e: React.FormEvent) {
    e.preventDefault();
    setPending(true);
    setError(null);
    try {
      const { needsConfirmation } = await signUp({ email, password, nickname, role });
      if (needsConfirmation) {
        setSentTo(email.trim());
        setPending(false);
        return;
      }
      const account = await refresh();
      router.replace(account ? nextPathFor(account) : "/today");
    } catch (err) {
      setError(err instanceof Error ? err.message : "가입하지 못했어요.");
      setPending(false);
    }
  }

  async function resend() {
    if (!sentTo) return;
    setNotice(null);
    try {
      await resendConfirmation(sentTo);
      setNotice("확인 메일을 다시 보냈어요.");
    } catch (err) {
      setNotice(err instanceof Error ? err.message : "메일을 보내지 못했어요.");
    }
  }

  if (sentTo) {
    return (
      <main className="flex min-h-dvh flex-col px-6 pb-8">
        <div className="flex flex-1 flex-col items-center justify-center text-center">
          <span className="grid size-12 place-items-center rounded-full bg-brand-tint text-brand">
            <MailCheck className="size-6" />
          </span>
          <h1 className="mt-4 text-section font-semibold">메일함을 확인해 주세요</h1>
          <p className="mt-1.5 text-sub text-muted">
            <b className="font-semibold text-ink">{sentTo}</b>로 가입 확인 링크를 보냈어요.
            <br />
            링크를 누르면 {role === "creator" ? "크리에이터 프로필 만들기" : "관심사 고르기"}로 이어져요.
          </p>
          {notice && <p role="status" className="mt-3 text-caption text-muted">{notice}</p>}
        </div>
        <div className="space-y-2">
          <ButtonLink href="/login" size="lg" block>
            로그인하러 가기
          </ButtonLink>
          <Button variant="ghost" size="lg" block onClick={resend}>
            메일 다시 보내기
          </Button>
        </div>
      </main>
    );
  }

  return (
    <main className="flex min-h-dvh flex-col">
      <TopBar backHref="/onboarding" />
      <form onSubmit={submit} noValidate className="flex flex-1 flex-col px-6 pb-8">
        <h1 className="mt-4 text-title leading-snug font-bold">MOMENTY 시작하기</h1>
        <p className="mt-1.5 text-body text-muted">어떤 방식으로 함께할까요?</p>

        <div className="mt-7 grid grid-cols-2 gap-3" role="radiogroup" aria-label="시작 방식">
          {ROLES.map(({ key, icon: Icon, title, body }) => {
            const active = role === key;
            return (
              <button
                key={key}
                type="button"
                role="radio"
                aria-checked={active}
                onClick={() => setRole(key)}
                className={cn(
                  "relative rounded-card border bg-surface p-4 text-left transition-all",
                  active ? "border-brand ring-4 ring-brand/10" : "border-line-strong",
                )}
              >
                {active && (
                  <span className="absolute top-3 right-3 grid size-5 place-items-center rounded-full bg-brand text-white">
                    <Check className="size-3" />
                  </span>
                )}
                <Icon className={cn("size-6", active ? "text-brand" : "text-muted")} />
                <div className="mt-3 text-body font-semibold">{title}</div>
                <p className="mt-1 text-caption leading-relaxed text-muted">{body}</p>
              </button>
            );
          })}
        </div>
        <p className="mt-2.5 text-meta text-faint">어느 쪽으로 시작해도 나중에 다른 쪽 기능을 함께 쓸 수 있어요.</p>

        <div className="mt-6 space-y-4">
          <Field
            label={role === "creator" ? "활동명" : "닉네임"}
            name="nickname"
            autoComplete="nickname"
            maxLength={30}
            placeholder={role === "creator" ? "나를 부르는 이름" : "팬 활동에 쓸 이름"}
            value={nickname}
            onChange={(e) => setNickname(e.target.value)}
          />
          <Field label="이메일" type="email" name="email" autoComplete="email" inputMode="email" placeholder="you@momenty.app" value={email} onChange={(e) => setEmail(e.target.value)} />
          <Field
            label="비밀번호"
            type="password"
            name="password"
            autoComplete="new-password"
            placeholder={`${PASSWORD_MIN}자 이상, 영문 + 숫자`}
            value={password}
            onChange={(e) => setPassword(e.target.value)}
          />
        </div>

        <p className="mt-5 text-meta leading-relaxed text-muted">
          가입하면 MOMENTY의 이용약관과 개인정보 처리방침에 동의하게 됩니다.
        </p>
        {error && (
          <p role="alert" className="mt-3 text-caption text-danger">
            {error}
          </p>
        )}

        <div className="mt-auto pt-8">
          <Button type="submit" size="lg" block disabled={pending || !email || !password || !nickname.trim()}>
            {pending && <Loader2 className="size-5 animate-spin" />}
            가입하고 시작하기
          </Button>
          <p className="mt-4 text-center text-caption text-muted">
            이미 계정이 있나요?{" "}
            <Link href="/login" className="font-semibold text-ink">
              로그인
            </Link>
          </p>
        </div>
      </form>
    </main>
  );
}
