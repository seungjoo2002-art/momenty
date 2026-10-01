"use client";

import { Loader2 } from "lucide-react";
import { useRouter } from "next/navigation";
import { useState } from "react";
import { useAuth } from "@/components/auth/AuthProvider";
import { useStudioCreator } from "@/components/auth/Gates";
import { Button } from "@/components/ui/Button";
import { LoadError, LoadingBlock } from "@/components/ui/LoadState";
import { Chip } from "@/components/ui/primitives";
import { TopBar } from "@/components/ui/TopBar";
import { BASIC_KEYS, BASIC_META, BASIC_VALUE_MAX, JOB_MAX, JOB_PRESETS, type BasicKey, type BasicValue } from "@/lib/avatar";
import { useMomentData } from "@/lib/hooks/useMomentData";
import { AVATAR_NOT_READY_MESSAGE, getAvatarBasics, saveAvatarBasics, type AvatarBasics } from "@/lib/services/avatar";
import { cn } from "@/lib/utils/cn";

const OTHER = "기타";

/**
 * STEP 1 — "먼저 나에 대해 알려주세요". Verified Facts가 된다 (AI가 사실로 말할 수 있는 근거).
 * 주소 · 현재 위치 · 전화번호 · 실명 · 연애 · 가족 같은 정보는 묻지 않는다. 항목마다 "말하고 싶지 않아요"를 고를 수 있다.
 * 언제든 다시 고칠 수 있다.
 */
export function AvatarBasicsForm({ notice }: { notice: boolean }) {
  const creator = useStudioCreator();
  const { data, error, retry } = useMomentData(`avatar-basics:${creator.id}`, () => getAvatarBasics(creator.id));
  if (error && !data) return <LoadError message={error} onRetry={retry} className="pt-32" />;
  if (!data) return <LoadingBlock />;
  return <Body key={creator.id} initial={data} notice={notice} />;
}

function Body({ initial, notice }: { initial: AvatarBasics; notice: boolean }) {
  const router = useRouter();
  const { refresh } = useAuth();
  const preset = (JOB_PRESETS as readonly string[]).includes(initial.job);
  const [jobChoice, setJobChoice] = useState(preset ? initial.job : initial.job ? OTHER : "");
  const [customJob, setCustomJob] = useState(preset ? "" : initial.job);
  const [values, setValues] = useState<Record<BasicKey, BasicValue>>(initial.values);
  const [saving, setSaving] = useState(false);
  const [error, setError] = useState<string | null>(null);

  const job = jobChoice === OTHER ? customJob.trim() : jobChoice;
  const setValue = (k: BasicKey, patch: Partial<BasicValue>) => setValues((v) => ({ ...v, [k]: { ...v[k], ...patch } }));
  const missing = BASIC_KEYS.filter((k) => !values[k].undisclosed && !values[k].value.trim());

  async function save() {
    setError(null);
    if (!job) return setError("직업 / 활동 분야를 골라 주세요.");
    if (missing.length) return setError(`${BASIC_META[missing[0]].label}을(를) 적거나 “말하고 싶지 않아요”를 골라 주세요.`);
    setSaving(true);
    try {
      await saveAvatarBasics(job, values);
      await refresh();
      router.push("/studio/settings/avatar/training");
    } catch (e) {
      setError(e instanceof Error ? e.message : "저장하지 못했어요.");
      setSaving(false);
    }
  }

  return (
    <main className="animate-fade-in pb-6">
      <TopBar backHref="/studio/settings/avatar" title="1 · 기본정보" center />
      <div className="px-5 pt-3">
        {notice && (
          <p role="status" className="mb-4 rounded-tile bg-brand-tint px-4 py-3 break-keep text-caption text-brand-deep">
            {AVATAR_NOT_READY_MESSAGE}
          </p>
        )}
        <h1 className="text-title leading-snug font-bold">먼저 나에 대해 알려주세요</h1>
        <p className="mt-1.5 break-keep text-caption leading-relaxed text-muted">AI Avatar가 사실과 다른 내용을 말하지 않도록 기본적인 정보를 설정합니다. 적은 내용만 사실로 말하고, 적지 않은 것은 지어내지 않아요.</p>

        <section className="mt-6">
          <h2 className="text-sub font-semibold">직업 / 활동 분야</h2>
          <p className="mt-0.5 text-meta text-muted">프로필에도 공개돼요.</p>
          <div className="mt-2 flex flex-wrap gap-1.5" role="group" aria-label="직업 / 활동 분야">
            {[...JOB_PRESETS, OTHER].map((j) => (
              <Chip key={j} active={jobChoice === j} onClick={() => setJobChoice(j)}>
                {j}
              </Chip>
            ))}
          </div>
          {jobChoice === OTHER && (
            <input
              value={customJob}
              maxLength={JOB_MAX}
              onChange={(e) => setCustomJob(e.target.value)}
              placeholder="직접 입력"
              aria-label="직업 / 활동 분야 직접 입력"
              className="mt-2 h-11 w-full rounded-tile border border-line-strong bg-surface px-4 text-sub outline-none focus:border-brand"
            />
          )}
        </section>

        <div className="mt-6 space-y-5">
          {BASIC_KEYS.map((k) => {
            const v = values[k];
            return (
              <section key={k}>
                <div className="flex items-center justify-between gap-3">
                  <label htmlFor={`basic-${k}`} className="text-sub font-semibold">
                    {BASIC_META[k].label}
                  </label>
                  <button
                    type="button"
                    aria-pressed={v.undisclosed}
                    onClick={() => setValue(k, { undisclosed: !v.undisclosed })}
                    className={cn("h-7 shrink-0 rounded-full px-2.5 text-meta whitespace-nowrap", v.undisclosed ? "bg-ink text-white" : "border border-line-strong text-muted")}
                  >
                    말하고 싶지 않아요
                  </button>
                </div>
                {v.undisclosed ? (
                  <p className="mt-2 rounded-tile bg-canvas px-4 py-3 break-keep text-caption text-muted">AI는 이 주제를 “말하지 않기로 했어요”라고 부드럽게 넘겨요.</p>
                ) : (
                  <input
                    id={`basic-${k}`}
                    value={v.value}
                    maxLength={BASIC_VALUE_MAX}
                    onChange={(e) => setValue(k, { value: e.target.value })}
                    placeholder={BASIC_META[k].placeholder}
                    className="mt-2 h-11 w-full rounded-tile border border-line-strong bg-surface px-4 text-sub outline-none placeholder:text-faint focus:border-brand"
                  />
                )}
              </section>
            );
          })}
        </div>
        <p className="mt-5 break-keep text-meta leading-relaxed text-faint">주소 · 지금 있는 곳 · 연락처 · 실명 · 연애 · 가족 정보는 적지 않아도 돼요. 공개해도 괜찮은 것만 적어 주세요.</p>
      </div>

      <div className="sticky bottom-0 z-10 mt-6 bg-canvas/95 px-5 pt-3 pb-[max(env(safe-area-inset-bottom),12px)] backdrop-blur-md">
        {error && (
          <p role="alert" className="mb-2 text-center text-caption text-danger">
            {error}
          </p>
        )}
        <Button block size="lg" onClick={save} disabled={saving}>
          {saving && <Loader2 className="size-5 animate-spin" />}
          저장하고 말투 알려주기
        </Button>
      </div>
    </main>
  );
}
