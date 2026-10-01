"use client";

import { Check, ChevronRight, List, Loader2, RotateCcw } from "lucide-react";
import Link from "next/link";
import { useState } from "react";
import { useStudioCreator } from "@/components/auth/Gates";
import { Button, ButtonLink } from "@/components/ui/Button";
import { LoadError, LoadingBlock } from "@/components/ui/LoadState";
import { TopBar } from "@/components/ui/TopBar";
import { PROMPT_CATEGORY_HINT, PROMPT_CATEGORY_LABEL, REPLY_MAX, type AvatarReadiness, type StyleSample, type TrainingPrompt } from "@/lib/avatar";
import { useMomentData } from "@/lib/hooks/useMomentData";
import { AVATAR_NOT_READY_MESSAGE, getAvatarReadiness, getStyleSamples, getTrainingPrompts, saveStyleAnswers } from "@/lib/services/avatar";
import { cn } from "@/lib/utils/cn";

/**
 * STEP 2 — "내 말투를 알려주세요". 팬이 보낼 법한 메시지 40개에 내가 직접 답한다 (최소 32개 · 안전 관련 9개는 필수).
 * 답은 저장하면 고칠 수 없다 — "다시 답하기"로 새로 답하면 이전 답은 보관된다 (학습 데이터가 쌓이는 방식).
 * 답의 내용은 사실로 쓰이지 않는다. 말하는 방식(길이 · 어미 · 웃음 · 이모지 · 되묻기 · 거절 방식)만 배운다.
 */
export function SpeechTraining({ notice }: { notice: boolean }) {
  const creator = useStudioCreator();
  const { data, error, retry } = useMomentData(`avatar-training:${creator.id}`, async () => {
    const [prompts, samples, readiness] = await Promise.all([getTrainingPrompts(), getStyleSamples(creator.id), getAvatarReadiness()]);
    return { prompts, samples: samples.filter((s) => s.source === "onboarding"), readiness };
  });
  if (error && !data) return <LoadError message={error} onRetry={retry} className="pt-32" />;
  if (!data) return <LoadingBlock />;
  return <Body key={creator.id} prompts={data.prompts} initialSamples={data.samples} initialReadiness={data.readiness} notice={notice} />;
}

function Body({ prompts, initialSamples, initialReadiness, notice }: { prompts: TrainingPrompt[]; initialSamples: StyleSample[]; initialReadiness: AvatarReadiness; notice: boolean }) {
  const [answers, setAnswers] = useState<Record<string, string>>(() => Object.fromEntries(initialSamples.map((s) => [s.promptKey!, s.reply])));
  const [readiness, setReadiness] = useState(initialReadiness);
  const [skipped, setSkipped] = useState<Set<string>>(new Set());
  // 지금 답하는 질문 (다시 답하기로 고른 질문 포함)
  const [redo, setRedo] = useState<string | null>(null);
  const [view, setView] = useState<"quiz" | "list">("quiz");
  const [draft, setDraft] = useState("");
  const [saving, setSaving] = useState(false);
  const [error, setError] = useState<string | null>(null);

  const answered = prompts.filter((p) => answers[p.key]).length;
  const minimum = readiness.style.minimum;
  const requiredLeft = prompts.filter((p) => p.required && !answers[p.key]);
  const current = redo ? prompts.find((p) => p.key === redo) : prompts.find((p) => !answers[p.key] && !skipped.has(p.key)) ?? prompts.find((p) => !answers[p.key]);
  const pct = Math.round((Math.min(answered, prompts.length) / prompts.length) * 100);

  async function submit() {
    if (!current) return;
    const reply = draft.trim();
    if (!reply) return setError("답을 입력해 주세요. 넘기려면 ‘건너뛰기’를 눌러 주세요.");
    setSaving(true);
    setError(null);
    try {
      const r = await saveStyleAnswers([{ key: current.key, reply }]);
      setReadiness(r);
      setAnswers((a) => ({ ...a, [current.key]: reply }));
      setSkipped((s) => {
        const next = new Set(s);
        next.delete(current.key);
        return next;
      });
      setRedo(null);
      setDraft("");
    } catch (e) {
      setError(e instanceof Error ? e.message : "저장하지 못했어요.");
    } finally {
      setSaving(false);
    }
  }

  function skip() {
    if (!current) return;
    setError(null);
    setDraft("");
    if (redo) setRedo(null);
    else setSkipped((s) => new Set([...s, current.key]));
  }

  const header = (
    <div className="px-5 pt-3">
      {notice && (
        <p role="status" className="mb-4 rounded-tile bg-brand-tint px-4 py-3 break-keep text-caption text-brand-deep">
          {AVATAR_NOT_READY_MESSAGE}
        </p>
      )}
      <div className="flex items-baseline justify-between">
        <h1 className="text-section font-bold">내 말투를 알려주세요</h1>
        <button type="button" onClick={() => setView(view === "quiz" ? "list" : "quiz")} className="inline-flex h-8 items-center gap-1 text-caption text-muted">
          <List className="size-4" />
          {view === "quiz" ? "전체 보기" : "문답으로"}
        </button>
      </div>
      <div className="mt-3 h-2 overflow-hidden rounded-full bg-brand-tint" role="progressbar" aria-valuenow={answered} aria-valuemin={0} aria-valuemax={prompts.length} aria-label="말투 학습 진행">
        <div className="h-full rounded-full bg-brand transition-[width]" style={{ width: `${pct}%` }} />
      </div>
      <p className="mt-1.5 flex flex-wrap justify-between gap-x-3 text-meta text-muted tabular-nums">
        <span>
          {answered} / {prompts.length} 문답 완료
        </span>
        <span>
          {answered >= minimum ? "최소 문답 수 채움" : `최소 ${minimum}개까지 ${minimum - answered}개`}
          {requiredLeft.length ? ` · 필수 ${requiredLeft.length}개 남음` : ""}
        </span>
      </p>
    </div>
  );

  if (view === "list") {
    return (
      <main className="animate-fade-in pb-10">
        <TopBar backHref="/studio/settings/avatar" title="2 · 말투 학습" center />
        {header}
        <ul className="mt-4 divide-y divide-line border-y border-line">
          {prompts.map((p) => (
            <li key={p.key} className="px-5 py-3">
              <div className="flex items-center gap-1.5 text-meta text-muted">
                <span>{PROMPT_CATEGORY_LABEL[p.category]}</span>
                {p.required && <span className="rounded-full bg-brand-tint px-1.5 text-micro font-semibold text-brand">필수</span>}
                {answers[p.key] && <Check className="ml-auto size-4 text-brand" aria-label="답함" />}
              </div>
              <p className="mt-0.5 text-sub">팬: “{p.fanMessage}”</p>
              {answers[p.key] ? (
                <div className="mt-1.5 flex items-start gap-2">
                  <p className="min-w-0 flex-1 rounded-tile bg-brand-tint px-3 py-2 text-caption break-words text-ink">나: {answers[p.key]}</p>
                  <button
                    type="button"
                    onClick={() => {
                      setRedo(p.key);
                      setDraft("");
                      setView("quiz");
                    }}
                    className="inline-flex h-8 shrink-0 items-center gap-1 rounded-full px-2 text-meta whitespace-nowrap text-muted hover:text-ink"
                  >
                    <RotateCcw className="size-3.5" />
                    다시 답하기
                  </button>
                </div>
              ) : (
                <button
                  type="button"
                  onClick={() => {
                    setRedo(p.key);
                    setDraft("");
                    setView("quiz");
                  }}
                  className="mt-1 text-caption font-medium text-brand"
                >
                  답하기
                </button>
              )}
            </li>
          ))}
        </ul>
      </main>
    );
  }

  const done = readiness.style.done;
  // 화면 높이에서 하단 탭 높이를 뺀다 — 맨 아래 CTA가 고정 탭 뒤로 들어가지 않게
  return (
    <main className="flex min-h-[calc(100dvh-var(--bottom-nav-space))] flex-col animate-fade-in">
      <TopBar backHref="/studio/settings/avatar" title="2 · 말투 학습" center />
      {header}

      {current ? (
        <section className="flex flex-1 flex-col px-5 pt-6">
          <div className="flex items-center gap-1.5 text-meta text-muted">
            <span>{PROMPT_CATEGORY_LABEL[current.category]}</span>
            {current.required && <span className="rounded-full bg-brand-tint px-1.5 text-micro font-semibold text-brand">필수</span>}
          </div>
          <div className="mt-2 self-start rounded-[18px] rounded-tl-[6px] bg-surface px-4 py-3 text-body ring-1 ring-line ring-inset">
            <span className="mb-0.5 block text-micro text-muted">팬</span>
            {current.fanMessage}
          </div>
          {PROMPT_CATEGORY_HINT[current.category] && <p className="mt-3 break-keep text-meta leading-relaxed text-muted">{PROMPT_CATEGORY_HINT[current.category]}</p>}
          {redo && answers[redo] && <p className="mt-2 break-keep text-meta text-faint">이전 답은 지우지 않고 보관돼요. 새 답이 말투 학습에 쓰여요.</p>}

          <label className="mt-5 block">
            <span className="mb-1.5 block text-caption font-semibold text-ink-2">당신이라면 어떻게 답하시겠어요?</span>
            <textarea
              value={draft}
              onChange={(e) => setDraft(e.target.value.slice(0, REPLY_MAX))}
              rows={4}
              placeholder="평소 팬에게 쓰는 그대로 적어 주세요 (ㅋㅋ · 이모지 · 말끝도 그대로)"
              className="w-full resize-none rounded-tile border border-line-strong bg-surface px-4 py-3 text-body outline-none placeholder:text-faint focus:border-brand focus:ring-4 focus:ring-brand/10"
            />
          </label>
          <p className="mt-1 text-right text-micro text-faint tabular-nums">
            {draft.length} / {REPLY_MAX}
          </p>
          {error && (
            <p role="alert" className="mt-1 text-caption text-danger">
              {error}
            </p>
          )}

          {/* 스크롤 중에도 하단 탭 바로 위에 붙는다 (탭과 겹치지 않음 · safe-area는 탭이 이미 포함) */}
          <div className="sticky bottom-(--bottom-nav-space) z-30 -mx-5 mt-auto flex gap-2 bg-canvas px-5 pt-4 pb-3">
            <Button variant="secondary" size="lg" onClick={skip} disabled={saving} className="shrink-0">
              {redo ? "취소" : "건너뛰기"}
            </Button>
            {/* block(w-full)이면 옆 버튼 너비만큼 화면 밖으로 밀려난다 → 남은 너비만 차지 */}
            <Button size="lg" onClick={submit} disabled={saving || !draft.trim()} className="flex-1">
              {saving && <Loader2 className="size-5 animate-spin" />}
              저장하고 다음
            </Button>
          </div>
        </section>
      ) : (
        <section className="flex flex-1 flex-col items-center px-8 pt-16 text-center">
          <div className="grid size-12 place-items-center rounded-full bg-brand text-white">
            <Check className="size-6" />
          </div>
          <p className="mt-4 text-section font-semibold">모든 질문에 답했어요</p>
          <p className="mt-1 break-keep text-caption text-muted">필요하면 ‘전체 보기’에서 다시 답할 수 있어요.</p>
        </section>
      )}

      {done && current && (
        <Link href="/studio/settings/avatar/review" className="mx-5 mb-4 flex items-center justify-between rounded-tile bg-brand-tint px-4 py-3 text-caption font-semibold text-brand-deep">
          최소 문답을 채웠어요 · Avatar 확인하기
          <ChevronRight className="size-4" />
        </Link>
      )}
      {!current && (
        <div className="px-5 pb-[max(env(safe-area-inset-bottom),16px)]">
          <ButtonLink href={done ? "/studio/settings/avatar/review" : "/studio/settings/avatar"} size="lg" block>
            {done ? "Avatar 확인하기" : "돌아가기"}
          </ButtonLink>
        </div>
      )}
      <p className={cn("px-6 pb-6 break-keep text-center text-meta text-faint", !current && "pt-3")}>답의 내용은 사실로 쓰이지 않고, 말하는 방식만 배워요.</p>
    </main>
  );
}
