"use client";

import { Check, Loader2 } from "lucide-react";
import { useState } from "react";
import { useStudioCreator } from "@/components/auth/Gates";
import { Button } from "@/components/ui/Button";
import { LoadError, LoadingBlock } from "@/components/ui/LoadState";
import { Chip, SectionHeader, Segmented } from "@/components/ui/primitives";
import { TopBar } from "@/components/ui/TopBar";
import { useMomentData } from "@/lib/hooks/useMomentData";
import { describeSafeDelay, getSafeDelay, SAFE_DELAY_MINUTES, saveSafeDelay, type SafeDelayMinutes, type SafeDelayMode, type SafeDelaySettings } from "@/lib/services/creatorSafety";

/**
 * SafeShare · Safe Delay — "Share your day, not your location."
 * 항상 켜져 있는 보호(metadata 제거 · 기기 안 사진 확인)와, 크리에이터가 고르는 공개 지연.
 * 지연 시각은 서버가 정하고, 팬에게는 설정값이 보이지 않는다.
 */
export default function SafeShareSettingsPage() {
  const creator = useStudioCreator();
  const { data, error, retry } = useMomentData(`safe-delay:${creator.id}`, () => getSafeDelay(creator.id));
  const [draft, setDraft] = useState<SafeDelaySettings | null>(null);
  const [state, setState] = useState<"idle" | "saving" | "saved" | "error">("idle");
  const value = draft ?? data;

  function change(patch: Partial<SafeDelaySettings>) {
    setDraft({ ...(value ?? { mode: "off", minutes: 30 }), ...patch });
    setState("idle");
  }

  async function save() {
    if (!value) return;
    setState("saving");
    try {
      await saveSafeDelay(creator.id, value);
      setState("saved");
    } catch {
      setState("error");
    }
  }

  return (
    <main className="animate-fade-in pb-10">
      <TopBar backHref="/studio/settings" title="SafeShare" center />
      <p className="px-5 pt-2 text-caption text-muted">Share your day, not your location.</p>

      <section className="mt-5">
        <SectionHeader title="항상 켜져 있어요" />
        <ul className="space-y-2.5 px-5">
          <Item title="사진 위치 정보 제거" body="사진의 GPS · 촬영 기기 정보(EXIF)는 올리기 전에 지워요. 파일 이름도 남기지 않아요." />
          <Item title="영상 · 음성 위치 정보 제거" body="MP4 · MOV · M4A 파일 속 위치 · 기기 정보, MP3 태그를 지워요. 다른 형식은 확인하지 못하면 그렇다고 알려드려요." />
          <Item title="사진 속 개인정보 확인" body="공개 전에 사진 속 주소 · 전화번호 · 차량번호 · 영수증 · 명찰 같은 글자를 기기 안에서 확인해요. 사진은 외부로 보내지 않고, 찾은 곳은 가릴 수 있어요." />
        </ul>
        <p className="mx-5 mt-2 break-keep text-meta text-faint">자동 확인은 놓칠 수 있어요. 창밖 풍경 · 간판 모양처럼 글자가 아닌 단서는 직접 봐 주세요.</p>
      </section>

      <section className="mt-8">
        <SectionHeader title="Safe Delay" caption="기록한 순간과 팬에게 보이는 순간 사이에 간격을 둬요" />
        {error && !data && <LoadError message={error} onRetry={retry} />}
        {!data && !error && <LoadingBlock className="min-h-24" />}
        {value && (
          <div className="px-5">
            <Segmented<SafeDelayMode>
              value={value.mode}
              onChange={(mode) => change({ mode })}
              options={[
                { value: "off", label: "끄기" },
                { value: "fixed", label: "정한 시간" },
                { value: "variable", label: "매번 다르게" },
              ]}
            />
            {value.mode !== "off" && (
              <div className="mt-3 flex flex-wrap gap-2" role="group" aria-label="지연 시간">
                {SAFE_DELAY_MINUTES.map((m) => (
                  <Chip key={m} active={value.minutes === m} onClick={() => change({ minutes: m as SafeDelayMinutes })}>
                    {m >= 60 ? `${m / 60}시간` : `${m}분`}
                  </Chip>
                ))}
              </div>
            )}
            <p className="mt-3 break-keep text-caption leading-relaxed text-ink-2">{describeSafeDelay(value)}</p>
            <ul className="mt-2 space-y-1 break-keep text-meta leading-relaxed text-muted">
              <li>· 공개 시각은 서버가 정해요. 공개 전에는 팬 · Creator AI 누구도 그 Moment를 볼 수 없어요.</li>
              <li>· 팬에게 지연 시간은 보이지 않아요. 프로필에 “실제 기록 시점과 공개 시점이 다를 수 있어요”라는 안내만 보여요.</li>
              <li>· 설정을 바꿔도 이미 공개 예정인 Moment는 그대로예요. Studio에서 “지금 공개”로 앞당길 수 있어요.</li>
            </ul>
            <div className="mt-4 flex items-center gap-3">
              <Button onClick={save} disabled={state === "saving" || draft === null}>
                {state === "saving" && <Loader2 className="size-4 animate-spin" />}
                저장
              </Button>
              {state === "saved" && (
                <span className="inline-flex items-center gap-1 text-caption text-muted">
                  <Check className="size-4 text-brand" />
                  저장했어요
                </span>
              )}
              {state === "error" && <span className="text-caption text-danger">저장하지 못했어요</span>}
            </div>
          </div>
        )}
      </section>
    </main>
  );
}

function Item({ title, body }: { title: string; body: string }) {
  return (
    <li className="flex gap-2.5">
      <Check className="mt-0.5 size-4 shrink-0 text-brand" />
      <div>
        <p className="text-sub font-medium">{title}</p>
        <p className="mt-0.5 break-keep text-caption leading-relaxed text-muted">{body}</p>
      </div>
    </li>
  );
}
