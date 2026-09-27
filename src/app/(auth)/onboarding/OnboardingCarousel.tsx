"use client";

import Link from "next/link";
import { useState } from "react";
import { AIBadge, HumanBadge } from "@/components/badges";
import { MomentMedia } from "@/components/moment/MomentMedia";
import { Avatar } from "@/components/ui/Avatar";
import { Button, ButtonLink } from "@/components/ui/Button";
import { Photo } from "@/components/ui/Photo";
import type { Creator, Moment } from "@/lib/types";
import { cn } from "@/lib/utils/cn";
import { formatClock } from "@/lib/utils/format";

interface Props {
  /** 소개용 예시 크리에이터 */
  creator: Omit<Creator, "profileId">;
  moments: Moment[];
}

export function OnboardingCarousel({ creator, moments }: Props) {
  const [step, setStep] = useState(0);
  const photoMoment = moments.find((m) => m.type === "photo")!;
  const voiceMoment = moments.find((m) => m.type === "voice")!;
  const textMoment = moments.find((m) => m.type === "text")!;

  const slides = [
    {
      kicker: "Moment",
      title: "원하는 순간,\n자유롭게 남긴 기록",
      body: "정해진 시간도, 정해진 횟수도 없어요. 크리에이터가 남기고 싶은 순간에 사진, 영상, 음성, 글로 기록해요.",
      visual: (
        <div className="relative h-full">
          <div className="absolute top-2 left-4 w-[58%] -rotate-3">
            <MomentMedia moment={photoMoment} variant="full" className="shadow-card" />
          </div>
          <div className="absolute top-28 right-3 w-[56%] rotate-2 rounded-card bg-surface p-2">
            <MomentMedia moment={voiceMoment} variant="card" />
          </div>
          <div className="absolute right-10 bottom-2 left-8 rounded-card bg-surface p-4">
            <p className="text-sub leading-relaxed font-medium">{textMoment.content}</p>
          </div>
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
            <Avatar src={creator.avatarUrl} name={creator.name} size="sm" ring="today" />
            <div className="text-caption">
              <b>{creator.name}</b>의 Today · <span className="text-brand">{moments.length} Moments</span>
            </div>
          </div>
          <ol>
            {moments.slice(0, 5).map((m, i) => (
              <li key={m.id} className="grid grid-cols-[40px_16px_1fr] gap-x-2 pb-3.5">
                <span className="text-right text-micro font-semibold text-muted tabular-nums">{formatClock(m.createdAt)}</span>
                <span className="relative flex justify-center">
                  {i < 4 && <span className="absolute top-2 -bottom-3.5 left-1/2 w-[2px] -translate-x-1/2 bg-brand-tint" />}
                  <span className="relative mt-0.5 size-3 rounded-full border-[3px] border-brand bg-surface" />
                </span>
                <span className="truncate text-caption text-ink-2">{m.content}</span>
              </li>
            ))}
          </ol>
        </div>
      ),
    },
    {
      kicker: "Persona",
      title: "오늘의 기록으로\n대화하는 Creator AI",
      body: "Creator AI는 크리에이터가 오늘 실제로 남긴 Moment만을 바탕으로 이야기해요. AI의 답변에는 언제나 AI 표시가 붙어요.",
      visual: (
        <div className="mx-auto w-[88%] space-y-3">
          <div className="ml-auto w-fit rounded-[20px] rounded-tr-md bg-ink px-4 py-2.5 text-sub text-white">
            오늘 한강 사진 어떻게 찍은 거예요?
          </div>
          <div className="flex gap-2">
            <Avatar src={creator.avatarUrl} name={creator.name} size="sm" ring="ai" />
            <div>
              <AIBadge className="mb-1" />
              <div className="rounded-[20px] rounded-tl-md border border-ai-line bg-surface px-4 py-2.5 text-sub leading-relaxed">
                오늘 첫 컷이었어요. 물빛이 유난히 파래서 한참 서 있었어요.
              </div>
              <span className="mt-1 inline-flex h-6 items-center gap-1 rounded-full bg-ai-soft px-2 text-micro text-ai">
                <span className="size-1.5 rounded-full bg-brand" />
                오늘의 첫 Moment 기반
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
          <Photo src={creator.coverUrl} alt="" className="aspect-[4/3] rounded-[28px]" />
          <div className="absolute inset-x-4 -bottom-10 flex gap-2 rounded-card bg-surface p-3">
            <Avatar src={creator.avatarUrl} name={creator.name} size="sm" ring="human" />
            <div className="min-w-0">
              <div className="flex items-center gap-1.5 text-meta font-semibold">
                {creator.name}
                <HumanBadge />
              </div>
              <p className="mt-1 text-caption leading-relaxed text-ink-2">첫 롤 현상하면 꼭 보여주세요 :)</p>
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
