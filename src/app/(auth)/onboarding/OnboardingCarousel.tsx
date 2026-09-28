"use client";

import { Camera, Mic, PenLine, Video } from "lucide-react";
import Link from "next/link";
import { useState } from "react";
import { AIBadge, HumanBadge } from "@/components/badges";
import { Button, ButtonLink } from "@/components/ui/Button";
import { cn } from "@/lib/utils/cn";

/**
 * 가입 전 소개. 그림은 추상적인 예시뿐이다 — 실제(또는 실제처럼 보이는) 크리에이터 이름 · 사진 · 숫자 · Moment 내용을 쓰지 않는다.
 * 글자 대신 회색 줄(skeleton)과 역할 이름("크리에이터", "크리에이터 AI")만.
 */
function Lines({ widths, className }: { widths: string[]; className?: string }) {
  return (
    <div className={cn("space-y-1.5", className)} aria-hidden>
      {widths.map((w, i) => (
        <span key={i} className="block h-2 rounded-full bg-line-strong/70" style={{ width: w }} />
      ))}
    </div>
  );
}

function Dot({ className }: { className?: string }) {
  return <span aria-hidden className={cn("grid size-8 shrink-0 place-items-center rounded-full bg-brand-soft text-micro font-semibold text-brand-deep", className)} />;
}

const TYPES = [
  { icon: Camera, label: "사진" },
  { icon: Video, label: "영상" },
  { icon: Mic, label: "음성" },
  { icon: PenLine, label: "글" },
];

export function OnboardingCarousel() {
  const [step, setStep] = useState(0);

  const slides = [
    {
      kicker: "Moment",
      title: "원하는 순간,\n자유롭게 남긴 기록",
      body: "정해진 시간도, 정해진 횟수도 없어요. 크리에이터가 남기고 싶은 순간에 사진, 영상, 음성, 글로 기록해요.",
      visual: (
        <div className="grid h-full grid-cols-2 gap-3 px-4">
          {TYPES.map(({ icon: Icon, label }, i) => (
            <div key={label} className={cn("flex flex-col justify-between rounded-card bg-surface p-4 ring-1 ring-line ring-inset", i % 2 ? "translate-y-4" : "-translate-y-1")}>
              <span className="grid size-10 place-items-center rounded-full bg-brand-tint text-brand">
                <Icon className="size-5" />
              </span>
              <div>
                <p className="text-caption font-semibold text-ink-2">{label}</p>
                <Lines widths={["80%", "55%"]} className="mt-2" />
              </div>
            </div>
          ))}
        </div>
      ),
    },
    {
      kicker: "Today",
      title: "순간이 쌓여\n하나의 하루가 돼요",
      body: "실제로 남긴 Moment만 시간순으로 이어져요. 좋아하는 사람의 하루를 조용히 따라가 보세요.",
      visual: (
        <div className="mx-auto w-[88%] rounded-card border border-line bg-surface p-4">
          <div className="mb-4 flex items-center gap-2.5">
            <Dot />
            <p className="text-caption">
              <b>크리에이터</b>의 Today
            </p>
          </div>
          <ol>
            {["70%", "50%", "82%", "60%"].map((w, i) => (
              <li key={i} className="grid grid-cols-[16px_1fr] gap-x-3 pb-4">
                <span className="relative flex justify-center">
                  {i < 3 && <span className="absolute top-2 -bottom-4 left-1/2 w-[2px] -translate-x-1/2 bg-brand-tint" />}
                  <span className="relative mt-0.5 size-3 rounded-full border-[3px] border-brand bg-surface" />
                </span>
                <Lines widths={[w, "35%"]} />
              </li>
            ))}
          </ol>
        </div>
      ),
    },
    {
      kicker: "Persona",
      title: "오늘의 기록으로\n대화하는 Creator AI",
      body: "Creator AI는 크리에이터가 실제로 남긴 Moment만을 바탕으로 이야기해요. AI의 답변에는 언제나 AI 표시가 붙어요.",
      visual: (
        <div className="mx-auto w-[88%] space-y-3">
          <div className="ml-auto w-[62%] rounded-[20px] rounded-tr-md bg-ink px-4 py-3">
            <span aria-hidden className="block h-2 w-full rounded-full bg-white/40" />
          </div>
          <div className="flex gap-2">
            <Dot className="ring-2 ring-ai-line" />
            <div className="w-[75%]">
              <div className="mb-1 flex items-center gap-1.5">
                <span className="text-meta text-ink-2">🤖 크리에이터 AI</span>
                <AIBadge />
              </div>
              <div className="rounded-[20px] rounded-tl-md border border-ai-line bg-surface px-4 py-3">
                <Lines widths={["90%", "70%"]} />
              </div>
              <span className="mt-1 inline-flex h-6 items-center gap-1 rounded-full bg-ai-soft px-2 text-micro text-ai">
                <span className="size-1.5 rounded-full bg-brand" />
                Moment 기반
              </span>
            </div>
          </div>
        </div>
      ),
    },
    {
      kicker: "Human",
      title: "그리고, 진짜 그 사람",
      body: "크리에이터가 직접 대화에 들어오면 분명하게 알려드려요. 중심은 언제나 실제 크리에이터와 그 사람의 하루예요.",
      visual: (
        <div className="relative mx-auto w-[88%]">
          <div aria-hidden className="aspect-[4/3] rounded-[28px] bg-gradient-to-br from-brand-tint via-brand-soft to-surface" />
          <div className="absolute inset-x-4 -bottom-10 flex gap-2 rounded-card bg-surface p-3 shadow-card">
            <Dot className="ring-2 ring-brand" />
            <div className="min-w-0 flex-1">
              <div className="flex items-center gap-1.5 text-meta font-semibold">
                ✓ 크리에이터 본인
                <HumanBadge />
              </div>
              <Lines widths={["85%", "50%"]} className="mt-2" />
            </div>
          </div>
        </div>
      ),
    },
  ];

  const s = slides[step];
  const last = step === slides.length - 1;

  return (
    <main className="flex min-h-dvh flex-col bg-canvas px-6 pt-6 pb-8">
      <div className="flex items-center justify-between">
        <span className="text-body font-extrabold tracking-[0.18em]">MOMENTY</span>
        <Link href="/login" className="text-caption text-muted">
          건너뛰기
        </Link>
      </div>

      <div className="relative mt-8 h-[340px] shrink-0">
        {s.visual}
        <span className="absolute -top-5 right-0 text-micro text-faint">예시 화면</span>
      </div>

      <div className="mt-14 flex-1">
        <div className="mb-3 flex items-center gap-2 text-meta font-semibold text-muted">
          {slides.map((sl, i) => (
            <span key={sl.kicker} className="flex items-center gap-2">
              <span className={cn(i === step ? "text-brand" : i < step ? "text-ink-2" : "text-faint")}>{sl.kicker}</span>
              {i < slides.length - 1 && <span className="text-faint">→</span>}
            </span>
          ))}
        </div>
        <h1 className="text-title leading-[1.3] font-bold whitespace-pre-line">{s.title}</h1>
        <p className="mt-3 text-body leading-relaxed text-ink-2">{s.body}</p>
      </div>

      <div className="mt-6 -ml-1 flex items-center pb-3">
        {slides.map((sl, i) => (
          <button
            key={sl.kicker}
            onClick={() => setStep(i)}
            aria-label={`${i + 1}번째 소개`}
            className="grid h-8 min-w-8 place-items-center px-1"
          >
            <span className={cn("block h-1.5 rounded-full transition-all duration-200", i === step ? "w-6 bg-brand" : "w-1.5 bg-line-strong")} />
          </button>
        ))}
      </div>

      {last ? (
        <ButtonLink href="/signup" size="lg" block>
          좋아하는 사람의 하루 구독하기
        </ButtonLink>
      ) : (
        <Button size="lg" block onClick={() => setStep(step + 1)}>
          다음
        </Button>
      )}
      <p className="mt-4 text-center text-caption text-muted">
        이미 계정이 있나요?{" "}
        <Link href="/login" className="font-semibold text-ink">
          로그인
        </Link>
      </p>
    </main>
  );
}
