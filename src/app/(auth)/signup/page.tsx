"use client";

import { Check, Heart, Sparkle } from "lucide-react";
import Link from "next/link";
import { useState } from "react";
import { ButtonLink } from "@/components/ui/Button";
import { Field } from "@/components/ui/Field";
import { TopBar } from "@/components/ui/TopBar";
import { cn } from "@/lib/utils/cn";

const ROLES = [
  {
    key: "fan",
    icon: Heart,
    title: "팬으로 시작",
    body: "좋아하는 크리에이터의 하루를 구독하고 따라가요.",
    next: "/today",
  },
  {
    key: "creator",
    icon: Sparkle,
    title: "크리에이터로 시작",
    body: "나의 순간을 기록하고, 팬과 하루를 나눠요.",
    next: "/studio",
  },
] as const;

export default function SignupPage() {
  const [role, setRole] = useState<(typeof ROLES)[number]["key"]>("fan");
  const next = ROLES.find((r) => r.key === role)!.next;

  return (
    <main className="flex min-h-dvh flex-col">
      <TopBar backHref="/onboarding" />
      <div className="flex flex-1 flex-col px-6 pb-8">
        <h1 className="mt-4 text-title leading-snug font-bold">MOMENTY 시작하기</h1>
        <p className="mt-1.5 text-body text-muted">어떤 방식으로 함께할까요?</p>

        <div className="mt-7 grid grid-cols-2 gap-3">
          {ROLES.map(({ key, icon: Icon, title, body }) => {
            const active = role === key;
            return (
              <button
                key={key}
                type="button"
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

        <div className="mt-8 space-y-4">
          <Field label={role === "creator" ? "활동명" : "닉네임"} placeholder={role === "creator" ? "한하린" : "새벽산책"} />
          <Field label="이메일" type="email" placeholder="you@momenty.app" />
          <Field label="비밀번호" type="password" placeholder="8자 이상" />
        </div>

        <p className="mt-5 text-meta leading-relaxed text-muted">
          가입하면 MOMENTY의 이용약관과 개인정보 처리방침, 그리고 Creator AI 이용 안내에 동의하게 됩니다.
        </p>

        <div className="mt-auto pt-8">
          <ButtonLink href={next} size="lg" block>
            가입하고 시작하기
          </ButtonLink>
          <p className="mt-4 text-center text-caption text-muted">
            이미 계정이 있나요?{" "}
            <Link href="/login" className="font-semibold text-ink">
              로그인
            </Link>
          </p>
        </div>
      </div>
    </main>
  );
}
