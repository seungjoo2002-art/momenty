"use client";

import { useState } from "react";
import { AIBadge } from "@/components/badges";
import { Avatar } from "@/components/ui/Avatar";
import { Button } from "@/components/ui/Button";
import { Chip } from "@/components/ui/primitives";
import { ToggleRow } from "@/components/ui/Toggle";
import { TopBar } from "@/components/ui/TopBar";
import type { Creator } from "@/lib/types";

const TONES = {
  warm: { label: "다정하게", sample: "새벽님, 오늘 한강 사진 봐줘서 고마워요. 그 파란 빛, 저도 한참 보고 있었어요." },
  casual: { label: "친구처럼", sample: "오 한강 봤어? 오늘 해 뜨기 전 빛 진짜 미쳤었거든 ㅎㅎ" },
  calm: { label: "차분하게", sample: "오늘 첫 사진은 해 뜨기 직전의 한강이었어요. 조용한 시간이었죠." },
} as const;

const SCOPES = ["오늘의 Moment만", "최근 3일", "최근 7일"];

export function PersonaSettings({ creator }: { creator: Creator }) {
  const [tone, setTone] = useState<keyof typeof TONES>("warm");
  const [scope, setScope] = useState(SCOPES[0]);
  const [intro, setIntro] = useState(`${creator.name}의 오늘을 바탕으로 이야기하는 Creator AI예요.`);

  return (
    <main className="pb-10">
      <TopBar backHref="/studio/settings" title="Persona" center />

      <section className="mx-5 mt-4 overflow-hidden rounded-card border border-line bg-surface [&>div]:border-b [&>div]:border-line [&>div:last-child]:border-none">
        <ToggleRow title="Creator AI 사용" description="끄면 팬은 Moment만 보고, 대화는 열리지 않아요." defaultOn={creator.personaEnabled} />
        <ToggleRow title="AI 응답에 AI 표시" description="모든 AI 답변에는 항상 표시돼요. 끌 수 없어요." defaultOn locked />
      </section>

      <section className="px-5 pt-8">
        <h2 className="text-body font-semibold">AI가 참고할 기록</h2>
        <p className="mt-1 text-caption text-muted">
          AI는 이 범위 안에서, ‘AI 참고 허용’한 Moment만 근거로 답해요. 기록에 없는 일은 지어내지 않아요.
        </p>
        <div className="mt-3 flex flex-wrap gap-2">
          {SCOPES.map((s) => (
            <Chip key={s} active={scope === s} onClick={() => setScope(s)}>
              {s}
            </Chip>
          ))}
        </div>
      </section>

      <section className="px-5 pt-8">
        <h2 className="text-body font-semibold">말투</h2>
        <div className="mt-3 flex flex-wrap gap-2">
          {(Object.keys(TONES) as (keyof typeof TONES)[]).map((k) => (
            <Chip key={k} active={tone === k} onClick={() => setTone(k)}>
              {TONES[k].label}
            </Chip>
          ))}
        </div>

        <div className="mt-4 rounded-card bg-canvas p-4">
          <p className="mb-3 text-meta font-medium text-muted">미리보기</p>
          <div className="flex gap-2.5">
            <Avatar src={creator.avatarUrl} name={creator.name} size="sm" ring="ai" />
            <div>
              <AIBadge className="mb-1" />
              <div className="rounded-[20px] rounded-tl-md border border-ai-line bg-surface px-4 py-3 text-sub leading-relaxed">
                {TONES[tone].sample}
              </div>
            </div>
          </div>
        </div>
      </section>

      <section className="px-5 pt-8">
        <h2 className="text-body font-semibold">AI 소개 문구</h2>
        <textarea
          value={intro}
          onChange={(e) => setIntro(e.target.value)}
          rows={3}
          className="mt-3 w-full resize-none rounded-tile border border-line-strong bg-surface px-4 py-3 text-body outline-none focus:border-brand"
        />
      </section>

      <div className="px-4 pt-6">
        <Button block size="lg">
          저장하기
        </Button>
      </div>
    </main>
  );
}
