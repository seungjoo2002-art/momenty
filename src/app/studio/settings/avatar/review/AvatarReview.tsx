"use client";

import { Check, ChevronRight, Loader2 } from "lucide-react";
import Link from "next/link";
import { useRouter } from "next/navigation";
import { useState } from "react";
import { useAuth } from "@/components/auth/AuthProvider";
import { useStudioCreator } from "@/components/auth/Gates";
import { AIBadge } from "@/components/badges";
import { Avatar } from "@/components/ui/Avatar";
import { Button } from "@/components/ui/Button";
import { LoadError, LoadingBlock } from "@/components/ui/LoadState";
import { Chip } from "@/components/ui/primitives";
import { TopBar } from "@/components/ui/TopBar";
import { analyzeStyle, describeStyle, firstIncompleteStep, PROMPT_CATEGORY_LABEL, type AvatarReadiness, type StyleSample, type TrainingPrompt } from "@/lib/avatar";
import { useMomentData } from "@/lib/hooks/useMomentData";
import { BOUNDARY_META, BOUNDARY_TOPICS, LIMITS, TRAIT_LABEL, type Boundaries, type Trait } from "@/lib/persona";
import { AVATAR_NOT_READY_MESSAGE, confirmAvatarBoundaries, getAvatarOverview, getStyleSamples, getTrainingPrompts, saveAvatarTraits, setAvatarEnabled } from "@/lib/services/avatar";
import { getPersonaSettings } from "@/lib/services/persona";
import type { Creator } from "@/lib/types";
import { cn } from "@/lib/utils/cn";
import { formatShortDate } from "@/lib/utils/format";

/**
 * STEP 3 — Avatar 확인하기. 학습한 말투(답변에서 센 특징 · 추정 아님) · 내가 쓴 답 · 성향 · 대화 경계를 확인하고,
 * 모두 끝나면 AI 문답을 켤 수 있다. 말투 자체는 여기서 고치지 않는다 (다시 답하기 · 추가 학습으로만).
 */
export function AvatarReview({ notice }: { notice: boolean }) {
  const creator = useStudioCreator();
  const { data, error, retry } = useMomentData(`avatar-review:${creator.id}`, async () => {
    const [overview, samples, prompts, persona] = await Promise.all([getAvatarOverview(creator.id), getStyleSamples(creator.id), getTrainingPrompts(), getPersonaSettings(creator.id)]);
    return { overview, samples, prompts, boundaries: persona.boundaries };
  });
  if (error && !data) return <LoadError message={error} onRetry={retry} className="pt-32" />;
  if (!data) return <LoadingBlock />;
  return (
    <Body
      key={creator.id}
      creator={creator}
      notice={notice}
      readiness={data.overview.readiness}
      enabled={data.overview.enabled}
      initialTraits={data.overview.traits}
      confirmedAt={data.overview.boundariesConfirmedAt}
      samples={data.samples}
      prompts={data.prompts}
      boundaries={data.boundaries}
    />
  );
}

function Body({
  creator,
  notice,
  readiness: initialReadiness,
  enabled,
  initialTraits,
  confirmedAt,
  samples,
  prompts,
  boundaries,
}: {
  creator: Creator;
  notice: boolean;
  readiness: AvatarReadiness;
  enabled: boolean;
  initialTraits: Trait[];
  confirmedAt: string | null;
  samples: StyleSample[];
  prompts: TrainingPrompt[];
  boundaries: Boundaries;
}) {
  const router = useRouter();
  const { refresh } = useAuth();
  const [traits, setTraits] = useState(initialTraits);
  const [hasPersona, setHasPersona] = useState(initialReadiness.persona);
  const [confirmed, setConfirmed] = useState(initialReadiness.boundaries);
  const [busy, setBusy] = useState<string | null>(null);
  const [error, setError] = useState<string | null>(null);

  const profile = analyzeStyle(samples.map((s) => s.reply));
  const summary = describeStyle(profile);
  const categoryOf = new Map(prompts.map((p) => [p.key, p.category]));
  const showcase = samples.filter((s) => s.source === "onboarding").slice(0, 4);
  const ready = initialReadiness.basics.done && initialReadiness.style.done && hasPersona && confirmed;

  async function run(key: string, action: () => Promise<void>) {
    setBusy(key);
    setError(null);
    try {
      await action();
    } catch (e) {
      setError(e instanceof Error ? e.message : "저장하지 못했어요.");
    } finally {
      setBusy(null);
    }
  }

  const toggleTrait = (t: Trait) => {
    const next = traits.includes(t) ? traits.filter((x) => x !== t) : traits.length < LIMITS.traits ? [...traits, t] : traits;
    if (next === traits) return;
    setTraits(next);
    void run("traits", async () => {
      await saveAvatarTraits(creator.id, next);
      setHasPersona(true);
    });
  };

  return (
    <main className="animate-fade-in pb-6">
      <TopBar backHref="/studio/settings/avatar" title="3 · Avatar 확인" center />
      <div className="px-5 pt-3">
        {notice && (
          <p role="status" className="mb-4 rounded-tile bg-brand-tint px-4 py-3 break-keep text-caption text-brand-deep">
            {AVATAR_NOT_READY_MESSAGE}
          </p>
        )}
        {(!initialReadiness.basics.done || !initialReadiness.style.done) && (
          <Link href={firstIncompleteStep(initialReadiness).replace("?notice=1", "")} className="mb-4 flex items-center justify-between rounded-tile border border-line bg-surface px-4 py-3 text-caption">
            <span>{!initialReadiness.basics.done ? "기본정보를 먼저 마쳐 주세요" : `말투 문답 ${initialReadiness.style.answered} / ${initialReadiness.style.minimum} · 조금만 더 알려 주세요`}</span>
            <ChevronRight className="size-4 text-faint" />
          </Link>
        )}

        <h1 className="text-section font-bold">학습한 말투</h1>
        <p className="mt-1 break-keep text-caption text-muted">내가 쓴 답 {profile.sampleCount}개에서 센 특징이에요. 말투를 바꾸고 싶으면 다시 답하거나 더 알려 주세요.</p>
        {summary.length ? (
          <ul className="mt-3 space-y-1.5 rounded-card border border-line bg-surface px-4 py-3.5">
            {summary.map((l) => (
              <li key={l} className="text-caption text-ink-2">
                · {l}
              </li>
            ))}
          </ul>
        ) : (
          <p className="mt-3 rounded-tile bg-canvas px-4 py-3 text-caption text-muted">아직 학습한 답이 없어요.</p>
        )}

        {showcase.length > 0 && (
          <div className="mt-4 space-y-3 rounded-card bg-canvas p-4">
            <p className="text-meta font-medium text-muted">AI Avatar가 참고하는 내 답 (일부)</p>
            {showcase.map((s) => (
              <div key={s.id}>
                <p className="text-meta text-muted">
                  {s.promptKey && categoryOf.get(s.promptKey) ? PROMPT_CATEGORY_LABEL[categoryOf.get(s.promptKey)!] : "추가 학습"} · 팬: “{s.fanMessage}”
                </p>
                <div className="mt-1 flex gap-2">
                  <Avatar src={creator.avatarUrl || undefined} name={creator.name} size="xs" ring="ai" />
                  <p className="min-w-0 flex-1 rounded-[14px] rounded-tl-[4px] border border-ai-line bg-surface px-3 py-2 text-caption break-words">{s.reply}</p>
                </div>
              </div>
            ))}
            <p className="flex items-center gap-1 text-micro text-faint">
              팬에게는 모든 답에 <AIBadge /> 표시가 붙어요 · 답의 내용은 사실로 쓰이지 않아요
            </p>
          </div>
        )}

        <section className="mt-7">
          <h2 className="text-sub font-semibold">성향</h2>
          <p className="mt-0.5 text-meta text-muted">어울리는 것을 {LIMITS.traits}개까지 골라 주세요. 바로 저장돼요.</p>
          <div className="mt-2.5 flex flex-wrap gap-2">
            {(Object.keys(TRAIT_LABEL) as Trait[]).map((t) => (
              <Chip key={t} active={traits.includes(t)} onClick={() => toggleTrait(t)} disabled={busy === "traits"}>
                {TRAIT_LABEL[t]}
              </Chip>
            ))}
          </div>
          {!hasPersona && <p className="mt-2 text-meta text-muted">하나 이상 고르면 Avatar가 만들어져요.</p>}
        </section>

        <section className="mt-7">
          <div className="flex items-baseline justify-between">
            <h2 className="text-sub font-semibold">대화 경계</h2>
            <Link href="/studio/settings/persona#boundaries" className="text-caption text-muted underline-offset-2 hover:underline">
              바꾸기
            </Link>
          </div>
          <p className="mt-0.5 text-meta text-muted">AI가 하지 않을 이야기예요. 꺼 둔 주제는 자연스럽게 거절해요.</p>
          <ul className="mt-2.5 flex flex-wrap gap-1.5">
            {BOUNDARY_TOPICS.map((t) => (
              <li key={t} className={cn("rounded-full px-2.5 py-1 text-meta", boundaries[t] ? "bg-brand-tint text-brand-deep" : "bg-canvas text-muted line-through")}>
                {BOUNDARY_META[t].label}
              </li>
            ))}
          </ul>
          <Button
            variant={confirmed ? "secondary" : "soft"}
            block
            className="mt-3"
            disabled={busy === "boundaries"}
            onClick={() =>
              run("boundaries", async () => {
                await confirmAvatarBoundaries();
                setConfirmed(true);
              })
            }
          >
            {busy === "boundaries" ? <Loader2 className="size-4 animate-spin" /> : confirmed && <Check className="size-4" />}
            {confirmed ? `대화 경계 확인함${confirmedAt ? ` · ${formatShortDate(confirmedAt)}` : ""}` : "대화 경계를 확인했어요"}
          </Button>
        </section>
      </div>

      <div className="sticky bottom-0 z-10 mt-8 bg-canvas/95 px-5 pt-3 pb-[max(env(safe-area-inset-bottom),12px)] backdrop-blur-md">
        {error && (
          <p role="alert" className="mb-2 text-center text-caption text-danger">
            {error}
          </p>
        )}
        {enabled ? (
          <Button block size="lg" variant="secondary" onClick={() => router.push("/studio/settings/avatar")}>
            AI 문답이 켜져 있어요
          </Button>
        ) : (
          <Button
            block
            size="lg"
            disabled={!ready || busy === "on"}
            onClick={() =>
              run("on", async () => {
                await setAvatarEnabled(creator.id, true);
                await refresh();
                router.push("/studio/settings/avatar");
              })
            }
          >
            {busy === "on" && <Loader2 className="size-5 animate-spin" />}
            {ready ? "AI 문답 시작하기" : "위 단계를 마치면 시작할 수 있어요"}
          </Button>
        )}
      </div>
    </main>
  );
}
