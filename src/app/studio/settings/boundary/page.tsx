"use client";

import { Plus, X } from "lucide-react";
import { useState } from "react";
import { Button } from "@/components/ui/Button";
import { Chip } from "@/components/ui/primitives";
import { ToggleRow } from "@/components/ui/Toggle";
import { TopBar } from "@/components/ui/TopBar";

const PRESET_TOPICS = ["연애 · 사생활", "가족", "거주지 · 숙소", "건강 · 부상", "수입 · 계약", "정치 · 종교", "다른 크리에이터 비교"];
const RESPONSE_OPTIONS = ["정중하게 화제 돌리기", "답하지 않는다고 알리기"];

export default function BoundarySettingsPage() {
  const [blocked, setBlocked] = useState<string[]>(["연애 · 사생활", "거주지 · 숙소", "가족"]);
  const [custom, setCustom] = useState<string[]>(["전 소속사 이야기"]);
  const [input, setInput] = useState("");
  const [response, setResponse] = useState(RESPONSE_OPTIONS[0]);

  const toggle = (t: string) => setBlocked((b) => (b.includes(t) ? b.filter((x) => x !== t) : [...b, t]));

  return (
    <main className="pb-10">
      <TopBar backHref="/studio/settings" title="Boundary" center />

      <section className="px-5 pt-5">
        <p className="text-sub leading-relaxed text-ink-2">
          Creator AI가 <b className="font-semibold">절대 대신 말하지 않을</b> 주제를 정해요. 이 주제의 질문에는 AI가 답하지 않고, 필요하면
          알려드려요.
        </p>
      </section>

      <section className="px-5 pt-6">
        <h2 className="text-body font-semibold">AI가 답하지 않을 주제</h2>
        <div className="mt-3 flex flex-wrap gap-2">
          {PRESET_TOPICS.map((t) => (
            <Chip key={t} active={blocked.includes(t)} onClick={() => toggle(t)}>
              {t}
            </Chip>
          ))}
        </div>

        <h3 className="mt-6 text-caption font-semibold text-ink-2">직접 추가한 주제</h3>
        <div className="mt-2 flex flex-wrap gap-2">
          {custom.map((t) => (
            <span key={t} className="inline-flex h-9 items-center gap-1 rounded-full bg-ink pr-2 pl-4 text-caption font-medium text-white">
              {t}
              <button onClick={() => setCustom(custom.filter((c) => c !== t))} aria-label={`${t} 삭제`} className="-mr-1.5 grid size-8 place-items-center">
                <X className="size-3.5" />
              </button>
            </span>
          ))}
        </div>
        <form
          className="mt-3 flex gap-2"
          onSubmit={(e) => {
            e.preventDefault();
            if (input.trim()) setCustom([...custom, input.trim()]);
            setInput("");
          }}
        >
          <input
            value={input}
            onChange={(e) => setInput(e.target.value)}
            placeholder="예: 다음 앨범 발매일"
            className="h-11 flex-1 rounded-tile border border-line-strong bg-surface px-4 text-body outline-none focus:border-brand"
          />
          <button type="submit" className="grid size-11 place-items-center rounded-tile bg-brand-soft text-brand" aria-label="추가">
            <Plus className="size-5" />
          </button>
        </form>
      </section>

      <section className="px-5 pt-8">
        <h2 className="text-body font-semibold">경계에 닿은 질문을 받으면</h2>
        <div className="mt-3 flex flex-wrap gap-2">
          {RESPONSE_OPTIONS.map((r) => (
            <Chip key={r} active={response === r} onClick={() => setResponse(r)}>
              {r}
            </Chip>
          ))}
        </div>
      </section>

      <section className="mx-5 mt-8 overflow-hidden rounded-card border border-line bg-surface [&>div]:border-b [&>div]:border-line [&>div:last-child]:border-none">
        <ToggleRow title="만남 · 연락처 요청 자동 차단" description="오프라인 만남, 연락처 교환 요청에 AI가 응하지 않아요." defaultOn locked />
        <ToggleRow title="반복 질문 팬 알림" description="같은 경계 질문을 반복하면 Fan Manager에 표시해요." defaultOn />
        <ToggleRow title="밤 시간 AI 대화 쉬기" description="00:00 – 07:00에는 AI도 쉬어요." />
      </section>

      <div className="px-4 pt-6">
        <Button block size="lg">
          저장하기
        </Button>
      </div>
    </main>
  );
}
